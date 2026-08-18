/**
 * The one patch on the system's roll pipeline, and the dice-timing machinery
 * every feature window shares.
 *
 * ## Why one patch and not one per window
 *
 * Both feature windows so far need the same seam — after the roll is evaluated,
 * before the chat message exists — and that seam is `DHRoll.buildPost`. Two
 * modules each wrapping it independently would work, but the order in which they
 * ran would depend on the order `module.ts` happened to call them, and a window
 * that *replaces* the roll (see {@link RollWindow.run}) would have to hand the
 * replacement to whatever wrapped it next by accident rather than by design. One
 * patch with an explicit handler list makes that ordering visible.
 *
 * ## Why `DHRoll.buildPost` is the seam
 *
 * `DHRoll.build` runs `buildConfigure` → `buildEvaluate` → `buildPost`, and
 * `buildPost` is the step that fires the system's `postRoll*` hooks and then
 * creates the chat message. Everything a feature might want to pre-empt happens
 * at or after that message:
 *
 * - the card the table reads,
 * - the Fear, the Hope and the countdown updates (`DualityRoll.buildPost`),
 * - the `fearRoll` and `dualityRoll` triggers on every other feature,
 * - `TargetField.execute`, which turns `config.roll.total` into each target's
 *   `hitResult`, and the damage that follows from it.
 *
 * Sitting at the *bottom* of the class chain also matters. `DualityRoll` defines
 * its own `buildPost`, which stamps the Hope/Fear 3D dice presets and only then
 * calls `super.buildPost` — and `super` resolves past `D20Roll` (which defines no
 * `buildPost` at all) to here. So a window installed here runs after the presets
 * are in place but before the message, which is what makes {@link showDiceEarly}
 * possible. `D20Roll` having no `buildPost` is also why adversary attack rolls
 * arrive here directly.
 */
import { LOG_PREFIX } from "../constants.js";

/**
 * The system version these seams were read against. Everything here reaches into
 * unexported internals with no stability guarantee, so a mismatch is worth one
 * loud line in the console — silently wrong behaviour at the table is far worse
 * than a warning nobody needed.
 */
const VERIFIED_SYSTEM_VERSION = "2.7.2";

/**
 * Marks a roll whose 3D dice this module has already rolled by hand, so the chat
 * message it eventually produces does not roll them a second time.
 *
 * Deliberately dot-free. Foundry's object helpers (`expandObject`, `mergeObject`)
 * treat a dot in a key as a path, and roll options pass through `mergeObject` on
 * construction — a namespaced `module-id.key` would risk being silently expanded
 * into a nested object and never read back.
 */
const DSN_SHOWN = "eeDiceShown";

/** Dice So Nice's own "do not animate this message" flag. */
const DSN_SKIP_FLAG = "flags.dice-so-nice.skip";

/**
 * One interception point on the roll pipeline.
 *
 * Split into {@link matches} and {@link run} so the pipeline can tell "this
 * window is not interested" (the overwhelmingly common case, and free) from "this
 * window ran and chose to do nothing".
 */
export interface RollWindow {
  /** Stable id, used only in logs. */
  id: string;
  /** Is this roll one this window handles? Must be cheap and must not throw. */
  matches(roll: AnyObject, config: AnyObject): boolean;
  /**
   * Do the work. Returning a Roll **replaces** the one the rest of `buildPost`
   * will post and act on — which is how a reroll is delivered without the
   * original ever reaching a chat message. Returning nothing keeps the roll as
   * it is; mutating `config` in place is the other way to change the outcome.
   */
  run(roll: AnyObject, config: AnyObject, message: AnyObject): Promise<AnyObject | void>;
}

/** Installed windows, in the order they were registered. */
const windows: RollWindow[] = [];

/**
 * Add a window. Registration order is execution order, so a window that rewrites
 * a roll outright should be registered before one that merely reads it.
 */
export function registerRollWindow(window: RollWindow): void {
  windows.push(window);
}

/**
 * Roll the 3D dice now, ahead of a prompt, and mark the roll so the chat message
 * does not roll them again.
 *
 * Dice So Nice animates off the *chat message*, which is exactly the thing a
 * window holds back — so without this a player would be asked to react to a
 * result they had not yet watched arrive. Only safe from inside `buildPost`,
 * where the dice already carry whatever appearance presets the roll type stamped
 * onto them, so the manual animation is indistinguishable from the automatic one.
 *
 * Call it only when a prompt is actually going to appear: a roll nobody is asked
 * about should keep the system's ordinary timing.
 *
 * Returns whether the animation actually played.
 */
export async function showDiceEarly(roll: AnyObject, config: AnyObject): Promise<boolean> {
  const dice3d = game["dice3d"];
  if (typeof dice3d?.showForRoll !== "function") return false;

  try {
    // `synchronize: true` so the rest of the table watches the same dice.
    // Resolves false when Dice So Nice declines (a blind roll, or its visibility
    // setting) — in which case the message path would not have animated either,
    // so leave both the marker and the sound alone.
    const shown = await dice3d.showForRoll(roll, game.user, true);
    if (shown === false) return false;

    if (roll["options"]) roll["options"][DSN_SHOWN] = true;
    // The system's own convention when it has already rolled dice by hand
    // (`DamageRoll.buildPost` does the same): mute the message so the dice sound
    // does not play twice.
    config["mute"] = true;
    return true;
  } catch (error) {
    console.warn(`${LOG_PREFIX} Roll pipeline: could not roll the dice early.`, error);
    return false;
  }
}

/**
 * Undo {@link showDiceEarly} for a roll that is about to be thrown away.
 *
 * A window that *replaces* the roll has to call this: the dice the table watched
 * belong to the discarded roll, while the replacement's dice have never been seen
 * and must animate normally. Both flags have to be cleared through `config`
 * rather than the roll, because the system builds every roll with the config
 * object *as* its `options` (`createRollInstance` passes `config` straight
 * through), so the old roll and the new one share one object.
 */
export function clearEarlyDice(config: AnyObject): void {
  // Only undo what we actually set. A window may replace a roll whose dice were
  // never shown early — sometimes because Dice So Nice declined — and `mute` is a
  // field the system sets for its own reasons elsewhere.
  if (config[DSN_SHOWN] !== true) return;

  delete config[DSN_SHOWN];
  config["mute"] = false;
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
      console.warn(`${LOG_PREFIX} Roll pipeline: could not suppress a duplicate dice roll.`, error);
    }
  });
}

/**
 * Install the patch. Call once during `init`, after every window has registered.
 *
 * The original is always called, and a throw from any window is swallowed: a
 * broken feature must degrade to an ordinary, unmodified roll rather than eat the
 * chat card and the resource updates behind it.
 */
export function installRollPipeline(): void {
  const DHRoll = CONFIG["Dice"]?.daggerheart?.DHRoll as AnyObject | undefined;
  if (!DHRoll) {
    console.warn(`${LOG_PREFIX} Roll pipeline: DHRoll not found — feature automation is off.`);
    return;
  }

  if (game.system?.version && game.system.version !== VERIFIED_SYSTEM_VERSION) {
    console.warn(
      `${LOG_PREFIX} Roll pipeline: verified against Daggerheart ${VERIFIED_SYSTEM_VERSION}, ` +
        `running ${game.system.version}. Re-check DHRoll.buildPost if rolls misbehave.`,
    );
  }

  const original = DHRoll["buildPost"];
  if (typeof original !== "function") {
    console.warn(`${LOG_PREFIX} Roll pipeline: no buildPost to wrap — feature automation is off.`);
    return;
  }

  registerDiceSuppression();

  DHRoll["buildPost"] = async function (
    this: AnyObject,
    roll: AnyObject,
    config: AnyObject,
    message: AnyObject,
  ): Promise<unknown> {
    let current = roll;

    for (const window of windows) {
      try {
        if (!window.matches(current, config)) continue;
        const replacement = await window.run(current, config, message);
        if (replacement) current = replacement;
      } catch (error) {
        console.warn(
          `${LOG_PREFIX} Roll window "${window.id}" failed; leaving the roll alone.`,
          error,
        );
      }
    }

    return original.call(this, current, config, message);
  };
}
