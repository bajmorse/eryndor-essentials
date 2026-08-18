/**
 * The **duality outcome** window — the point at which a Duality roll's Hope/Fear
 * result can still be rewritten before anything in the system has acted on it.
 *
 * ## Where the interception goes, and why it has to be here
 *
 * `DualityRoll.buildPost` (system 2.7.2) runs four things in a fixed order:
 *
 * 1. `setDiceSoNiceForDualityRoll` — stamps the Hope/Fear 3D dice presets onto
 *    `roll.dice[].options`.
 * 2. `super.buildPost` — fires the system's `postRoll*` hooks, then **creates the
 *    chat message** (which is what makes Dice So Nice animate).
 * 3. `dualityUpdate` — advances Fear countdowns, then queues the GM's +1 Fear (or
 *    the character's +1 Hope) into `config.resourceUpdates`.
 * 4. `handleTriggers` — runs the `dualityRoll` trigger, and the `fearRoll`
 *    trigger *only* when the result is still Fear.
 *
 * Every one of those consumers reads the same field — `config.roll.result.duality`
 * — rather than the roll's own getters. So rewriting that field before step 2
 * means the Fear was never gained, the countdowns never advanced, and any other
 * feature's `fearRoll` trigger never fired at all. Reconciling *after* the fact
 * would have to undo four separate effects and could not un-fire a trigger.
 *
 * The system's own hooks cannot be used for this: they are all `Hooks.call`, so a
 * listener cannot await a player's answer. Hence a wrapper on the `async` static.
 *
 * **The wrapper sits between steps 1 and 2**, by patching `DHRoll.buildPost` —
 * what `super.buildPost` resolves to — rather than `DualityRoll.buildPost` itself.
 * That is what lets the 3D dice be rolled *before* the player is asked (see
 * {@link showDiceBeforePrompt}): the presets from step 1 are already in place, so
 * a hand-rolled animation is indistinguishable from the automatic one, while
 * everything from step 2 onwards still reads the converted result.
 *
 * ## Why the result is flipped by a flag rather than by swapping dice
 *
 * `withHope`/`withFear` are getters that compare the two dice totals, with no
 * setter and no override beyond `guaranteedCritical`. The chat card renders from
 * the *Roll object* (`roll.totalLabel`, `roll.dHope.total` in the system's
 * `roll-part.hbs`), and the Roll is rebuilt from its serialized form on reload —
 * so an override set on the instance would vanish for every other client.
 *
 * Swapping the two dice totals would persist and would even preserve the roll's
 * total, but it would contradict the dice the table just watched land. Instead we
 * persist a marker in `roll.options` (which round-trips through `toJSON`, the same
 * way `options.roll.difficulty` does) and teach the two getters to honour it. The
 * dice keep showing their honest faces; only the interpretation changes, for
 * everyone, permanently. `totalLabel` and `isCritical` follow on their own —
 * the first derives from these getters, and the second is unaffected because a
 * converted roll had unequal dice and still does.
 */
import { LOG_PREFIX } from "../constants.js";
import { chooseOffers } from "./feature-prompt.js";
import {
  applyOffer,
  offersFor,
  resourceUpdatesFor,
  type FeatureContextBase,
  type FeatureCost,
} from "./feature-registry.js";

/**
 * The system version this was read against. The wrapper reaches into unexported
 * internals with no stability guarantee, so a mismatch is worth one loud line in
 * the console — silently wrong behaviour at the table is far worse than a warning.
 */
const VERIFIED_SYSTEM_VERSION = "2.7.2";

/**
 * Key under `roll.options` holding a rewritten result: `1` for Hope, `-1` for
 * Fear. Prefixed because `options` is the system's own object.
 *
 * Deliberately dot-free. Foundry's object helpers (`expandObject`, `mergeObject`)
 * treat a dot in a key as a path, and roll options pass through `mergeObject` on
 * construction — a namespaced `module-id.key` would risk being silently expanded
 * into a nested object and never read back.
 */
const DUALITY_OVERRIDE = "eeDualityOverride";

/**
 * Marks a roll whose 3D dice this module has already rolled by hand, so the chat
 * message it eventually produces does not roll them a second time. Lives in
 * `roll.options` beside {@link DUALITY_OVERRIDE}, and dot-free for the same reason.
 */
const DSN_SHOWN = "eeDiceShown";

/** Dice So Nice's own "do not animate this message" flag. */
const DSN_SKIP_FLAG = "flags.dice-so-nice.skip";

/** The system's own duality encoding, shared by `config.roll.result.duality`. */
const WITH_HOPE = 1;
const WITH_FEAR = -1;

/** Context handed to every feature registered on this window. */
export interface DualityOutcomeContext extends FeatureContextBase {
  /** The evaluated roll. */
  roll: AnyObject;
  /** The roll config — what the rest of the pipeline reads. */
  config: AnyObject;
  /** `1` Hope, `-1` Fear, `0` critical or indeterminate. */
  duality: number;
  /** Whether the roll is a critical success (matched dice). */
  isCritical: boolean;
  /** The two dice, for the prompt to quote back. */
  hopeTotal: number;
  fearTotal: number;
  /** Rewrite the result. Everything downstream of the wrapper reads the change. */
  setDuality(next: number): void;
}

/**
 * The system's DualityRoll class, or undefined if the system changed shape.
 *
 * `CONFIG.Dice.daggerheart` is preferred over `game.system.api.dice` because the
 * system assigns it at script load, while `game.system.api` is only populated
 * inside the system's own `init` listener — so this stays correct even if hook
 * ordering ever puts us first. Both point at the same class object.
 */
function dualityRollClass(): AnyObject | undefined {
  return (CONFIG["Dice"]?.daggerheart?.DualityRoll ??
    game.system?.api?.dice?.DualityRoll) as AnyObject | undefined;
}

/**
 * Teach `withHope`/`withFear` to honour a persisted override.
 *
 * Installed unconditionally, and independently of whether any feature is turned
 * on: a message from a roll converted last session still has to render as Hope
 * today, on every client, whatever the settings now say.
 */
function patchDualityGetters(DualityRoll: AnyObject): void {
  const prototype = DualityRoll["prototype"] as AnyObject | undefined;
  if (!prototype) return;

  for (const [name, matches] of [
    ["withHope", WITH_HOPE],
    ["withFear", WITH_FEAR],
  ] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    const original = descriptor?.get;
    if (typeof original !== "function") {
      console.warn(`${LOG_PREFIX} Duality: no ${name} getter to patch — results won't convert.`);
      continue;
    }

    // A non-configurable getter would make this throw, and a throw here would
    // take the whole module's `init` down with it — so failing to patch degrades
    // to "results never convert" rather than to a broken world.
    try {
      Object.defineProperty(prototype, name, {
        ...descriptor,
        get(this: AnyObject) {
          const override = this["options"]?.[DUALITY_OVERRIDE];
          if (typeof override === "number") return override === matches;
          return original.call(this);
        },
      });
    } catch (error) {
      console.warn(`${LOG_PREFIX} Duality: could not patch ${name}.`, error);
    }
  }
}

/** The actor that made the roll, or null when the roll has no owner. */
function rollActor(roll: AnyObject, config: AnyObject): AnyObject | null {
  // What the system's own `handleTriggers` uses; the uuid is the fallback for
  // paths that never attached the actor to the roll data.
  const parent = roll["data"]?.["parent"];
  if (parent) return parent as AnyObject;

  const uuid = config["source"]?.["actor"];
  return uuid ? fromUuidSync(String(uuid)) : null;
}

/**
 * Build the context, including the two mutations features are allowed to make.
 */
function buildContext(roll: AnyObject, config: AnyObject, actor: AnyObject): DualityOutcomeContext {
  const result = config["roll"]?.["result"] ?? {};

  return {
    actor,
    roll,
    config,
    duality: Number(result["duality"] ?? 0),
    // Read off the roll rather than the config: `roll.isCritical` is the getter
    // the system itself trusts, while `config.roll.isCritical` is only populated
    // on some paths and would read false-but-present on the rest.
    isCritical: roll["isCritical"] === true,
    hopeTotal: Number(config["roll"]?.["hope"]?.["value"] ?? 0),
    fearTotal: Number(config["roll"]?.["fear"]?.["value"] ?? 0),

    setDuality(next: number): void {
      // The config field is what the four downstream consumers read, so this is
      // the change that actually suppresses the Fear, the countdowns and the
      // `fearRoll` triggers.
      result["duality"] = next;
      result["label"] = game.i18n.localize(
        next === WITH_HOPE ? "DAGGERHEART.GENERAL.hope" : "DAGGERHEART.GENERAL.fear",
      );

      // The persisted marker is what makes the chat card, a page reload and every
      // other client agree — see the note at the top of this file.
      if (roll["options"]) roll["options"][DUALITY_OVERRIDE] = next;

      this.duality = next;
    },

    payCost(costs: readonly FeatureCost[]): void {
      if (costs.length === 0) return;
      const updates = resourceUpdatesFor(actor, costs);

      // Fold into the roll's own pending update so the cost, the suppressed Fear
      // and the gained Hope all land as a single actor write. Every path that
      // builds a duality roll (`Actor#diceRoll` and `DHBaseAction#use`) flushes
      // this map once the roll returns.
      const pending = config["resourceUpdates"];
      if (pending?.addResources) {
        pending.addResources(updates);
        return;
      }

      // No pending map — pay directly rather than silently skip the price.
      console.debug(`${LOG_PREFIX} Duality: no pending resource update; charging directly.`);
      void actor["modifyResource"]?.(updates);
    },
  };
}

/**
 * Roll the 3D dice ourselves, before the prompt, and stop them being rolled a
 * second time when the chat message finally lands.
 *
 * Dice So Nice animates off the *chat message*, which is exactly the thing this
 * window holds back — so without this the player would be asked to convert a
 * result they had not yet watched arrive. Taking the animation over is only safe
 * from inside `DHRoll.buildPost`: by then `DualityRoll.buildPost` has already run
 * `setDiceSoNiceForDualityRoll`, which stamps the Hope/Fear presets onto
 * `roll.dice[].options`, so the manual roll looks exactly like the automatic one.
 *
 * Returns whether the animation actually played.
 */
async function showDiceBeforePrompt(roll: AnyObject, config: AnyObject): Promise<boolean> {
  const dice3d = game["dice3d"];
  if (typeof dice3d?.showForRoll !== "function") return false;

  try {
    // `synchronize: true` so the rest of the table watches the same dice.
    // Resolves false when Dice So Nice declines (a blind roll, or its
    // visibility setting) — in which case the message path would not have
    // animated either, so leave both the flag and the sound alone.
    const shown = await dice3d.showForRoll(roll, game.user, true);
    if (shown === false) return false;

    if (roll["options"]) roll["options"][DSN_SHOWN] = true;
    // The system's own convention when it has already rolled dice by hand
    // (`DamageRoll.buildPost` does the same): mute the message so the dice sound
    // does not play twice.
    config["mute"] = true;
    return true;
  } catch (error) {
    console.warn(`${LOG_PREFIX} Duality: could not roll the dice early.`, error);
    return false;
  }
}

/**
 * Offer, ask, apply. Returns once the outcome is settled and the rest of
 * `buildPost` can run against it.
 */
async function runDualityOutcomeWindow(roll: AnyObject, config: AnyObject): Promise<void> {
  // `buildEvaluate` is what populates `roll.result`; an unevaluated roll
  // (`config.evaluate === false`) has no outcome to rewrite yet.
  if (!config?.["roll"]?.["result"]) return;

  const actor = rollActor(roll, config);
  if (!actor) return;

  const context = buildContext(roll, config, actor);
  const offers = offersFor("dualityOutcome", context);
  if (offers.length === 0) return;

  const optional = offers.filter((offer) => offer.feature.optional);
  const automatic = offers.filter((offer) => !offer.feature.optional);

  // Rules that are not a choice apply first and without asking, so the prompt
  // describes the situation the player is actually deciding about.
  for (const offer of automatic) applyOffer(context, offer);

  if (optional.length > 0) {
    // Only when something is actually going to be asked: a roll that raises no
    // prompt should keep the system's ordinary timing, dice and all.
    await showDiceBeforePrompt(roll, config);

    const chosen = await chooseOffers(
      game.i18n.localize("EE.Features.DualityTitle"),
      game.i18n.format("EE.Features.DualityIntro", {
        hope: context.hopeTotal,
        fear: context.fearTotal,
        result: String(config["roll"]?.["result"]?.["label"] ?? ""),
      }),
      optional,
    );

    // Re-checked in priority order rather than in the order the dialog returned,
    // so two features that both rewrite the outcome compose predictably.
    for (const offer of optional) {
      if (chosen.has(offer.feature.id)) applyOffer(context, offer);
    }
  }
}

/**
 * Stop Dice So Nice animating a message whose dice we already rolled by hand.
 *
 * A `preCreateChatMessage` hook, because the flag has to be on the document
 * *before* it is created — DSN decides in its own create hook, and its
 * `shouldInterceptMessage` bails on `flags.dice-so-nice.skip`. The marker is read
 * off the roll rather than tracked in a variable, so nothing can go stale or
 * attach itself to an unrelated message created in between.
 */
function registerDiceSuppression(): void {
  Hooks.on("preCreateChatMessage", (document: AnyObject) => {
    try {
      const rolls = document["rolls"] ?? [];
      const alreadyShown = rolls.some((entry: unknown) => {
        // Prepared documents hold Roll instances; fall back to the stored JSON in
        // case this ever runs before `prepareDerivedData`.
        const roll = typeof entry === "string" ? JSON.parse(entry) : (entry as AnyObject);
        return roll?.["options"]?.[DSN_SHOWN] === true;
      });
      if (!alreadyShown) return;

      document["updateSource"]?.({ [DSN_SKIP_FLAG]: true });
    } catch (error) {
      console.warn(`${LOG_PREFIX} Duality: could not suppress the duplicate dice roll.`, error);
    }
  });
}

/**
 * Install the window.
 *
 * The wrapper goes on **`DHRoll.buildPost`**, not `DualityRoll.buildPost`, and the
 * one level matters. `DualityRoll.buildPost` runs
 * `setDiceSoNiceForDualityRoll` → `super.buildPost` → `dualityUpdate` →
 * `handleTriggers`, and `super` resolves past `D20Roll` (which defines no
 * `buildPost`) to `DHRoll`. Sitting there puts this window *after* the Hope/Fear
 * dice presets are stamped — so the dice can be rolled early and still look
 * right — and still before the chat message, the Fear, the countdowns and every
 * other feature's `fearRoll` trigger.
 *
 * `DHRoll.buildPost` is the base every roll type inherits, so the wrapper checks
 * the roll is actually a Duality roll before doing anything. The original is
 * always called, and a throw from our side is swallowed: a broken feature must
 * degrade to an ordinary, unmodified roll rather than eat the chat card and the
 * resource updates.
 */
export function registerDualityOutcome(): void {
  const DualityRoll = dualityRollClass();
  const DHRoll = CONFIG["Dice"]?.daggerheart?.DHRoll as AnyObject | undefined;
  if (!DualityRoll || !DHRoll) {
    console.warn(`${LOG_PREFIX} Duality: roll classes not found — feature automation is off.`);
    return;
  }

  if (game.system?.version && game.system.version !== VERIFIED_SYSTEM_VERSION) {
    console.warn(
      `${LOG_PREFIX} Duality: verified against Daggerheart ${VERIFIED_SYSTEM_VERSION}, ` +
        `running ${game.system.version}. Re-check DualityRoll.buildPost if rolls misbehave.`,
    );
  }

  patchDualityGetters(DualityRoll);
  registerDiceSuppression();

  const original = DHRoll["buildPost"];
  if (typeof original !== "function") {
    console.warn(`${LOG_PREFIX} Duality: no buildPost to wrap — feature automation is off.`);
    return;
  }

  DHRoll["buildPost"] = async function (
    this: AnyObject,
    roll: AnyObject,
    config: AnyObject,
    message: AnyObject,
  ): Promise<unknown> {
    if (roll instanceof (DualityRoll as unknown as new () => unknown)) {
      try {
        await runDualityOutcomeWindow(roll, config);
      } catch (error) {
        console.warn(`${LOG_PREFIX} Duality: outcome window failed; leaving the roll alone.`, error);
      }
    }
    return original.call(this, roll, config, message);
  };
}
