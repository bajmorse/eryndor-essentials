/**
 * **Hold Them Off** (Ranger class feature, SRD) — "Spend 3 Hope when you succeed
 * on an attack with a weapon to use that same roll against two additional
 * adversaries within range of the attack."
 *
 * ## What the SRD ships, and what it leaves to the table
 *
 * `Compendium.daggerheart.classes.Item.2Cyb9ZeuAesf5Sb3`, a `feature` Item
 * carrying one action: an effect action named "Spend Hope" that charges 3 Hope
 * and does nothing else. Everything the feature is actually *for* — a second and
 * third adversary resolved against the roll that already happened — is left to be
 * done by hand, and by the time the player can press the button the attack's chat
 * card has posted naming one target, the damage has been rolled and applied to
 * that one, and reproducing it against two more means re-rolling damage the rule
 * says should be the same roll.
 *
 * ## The whole trick: add targets before anything reads them
 *
 * `config.targets` is a plain array that the rest of the action workflow keeps
 * consulting. Everything downstream of the roll derives from it:
 *
 * - `TargetField.execute` (order 20) gives every entry a `hitResult` by comparing
 *   `config.roll.total` against that entry's `difficulty || evasion`;
 * - `DamageField.applyDamage` (order 75) applies `config.damage` to every entry
 *   whose `hitResult.success` is true, cloning the damage per target;
 * - `DHRoll.toMessage` deep-clones the whole config into the chat card, so the
 *   card lists them and its buttons act on them.
 *
 * This window sits inside the *roll* step (order 10), in `DHRoll.buildPost`,
 * which is before all three. So "use that same roll against two additional
 * adversaries" is literally that: append two entries and let the system resolve
 * the roll it already made against them. Nothing is re-rolled, nothing is undone,
 * and the card is correct the first time it renders.
 *
 * ## Reading the conditions
 *
 * - **"succeed on an attack"** — `config.roll.success`, which
 *   `D20Roll.buildEvaluate` has already set. Only populated when the attack had
 *   targets or a set difficulty; a GM eyeballing an untargeted roll gets nothing,
 *   which is the same silence every window here keeps.
 * - **"with a weapon"** — the action's parent Item is a `weapon`. This is exact
 *   rather than a guess: a character's unarmed strike lives on `actor.system
 *   .attack` rather than on an Item, so it resolves to no weapon and correctly
 *   raises nothing.
 * - **"two additional adversaries"** — `actor.type === "adversary"`, excluding
 *   everyone the attack already targeted. Up to two, never more; taking one, or
 *   none, is allowed.
 * - **"within range of the attack"** — measured from the *attacker*, against the
 *   range the action prints (which is the Reach-adjusted derived value, so a
 *   Giant's Melee weapon reaches Very Close here too). An adversary whose
 *   distance can't be measured is not offered, for the same reason as everywhere
 *   else in this module: 3 Hope must not be spent on an assumed range.
 *
 * Deliberately **not** checked: whether the roll would actually hit the ones
 * picked. It is the same roll against a different Difficulty, and it may well
 * miss — that is the gamble the feature is, and the card shows each result. For
 * the same reason the picker never shows an adversary's Difficulty, which is the
 * GM's to reveal.
 */
import { FLAGS, LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { chooseUpTo, type PromptChoice } from "./feature-prompt.js";
import { chargeCosts } from "./feature-registry.js";
import { tokenForActor, withinActionRange } from "./range-bands.js";
import { registerRollWindow, rollTypeOf, showDiceEarly } from "./roll-pipeline.js";

/** The SRD Item this comes from — matched ahead of the printed name. */
const HOLD_THEM_OFF_SOURCE = "Compendium.daggerheart.classes.Item.2Cyb9ZeuAesf5Sb3";

/** Printed name, as the fallback match for a hand-copied feature. */
const HOLD_THEM_OFF_NAME = "Hold Them Off";

/** Registry id, for the `flags.eryndor-essentials.featureId` escape hatch. */
const FEATURE_ID = "holdThemOff";

/** `CONFIG.DH.GENERAL.rollTypes.attack.id` — what a weapon attack rolls. */
const ATTACK = "attack";

/** `CONFIG.DH.ACTOR.actorTypes` — the only kind of actor this feature reaches. */
const ADVERSARY = "adversary";

/** The resource the feature charges, and how much of it. */
const HOPE = "hope";
const HOPE_COST = 3;

/** "two additional adversaries" — the ceiling, not a quota. */
const EXTRA_TARGETS = 2;

/** One resolved Hold Them Off attack: who swung, with what, using which action. */
interface WeaponAttack {
  actor: AnyObject;
  weapon: AnyObject;
  /** The printed range of the attack, as an id from `CONFIG.DH.GENERAL.range`. */
  range: string;
}

/** One adversary the feature could reach, with the distance that qualified it. */
interface Candidate {
  token: Token;
  distance: number;
}

/** Does this actor hold the Hold Them Off feature? Flag, compendium, then name. */
function holdsFeature(actor: AnyObject): AnyObject | null {
  for (const item of actor["items"] ?? []) {
    if (String(item?.["type"] ?? "") !== "feature") continue;

    // The homebrew escape hatch the feature registry uses, honoured here for the
    // same reason: a table that rewrote the card should still get the automation.
    const flagged = item?.["flags"]?.[MODULE_ID]?.[FLAGS.featureId];
    if (typeof flagged === "string" && flagged.trim() === FEATURE_ID) return item;

    if (String(item?.["_stats"]?.["compendiumSource"] ?? "") === HOLD_THEM_OFF_SOURCE) return item;

    if (String(item?.["name"] ?? "").trim().toLowerCase() === HOLD_THEM_OFF_NAME.toLowerCase()) {
      return item;
    }
  }

  return null;
}

/**
 * The character whose Hold Them Off this roll could use, or null.
 *
 * Silent on every path, deliberately: this window sees every attack roll in the
 * world — every adversary's, every other character's — and "not this actor's
 * business" is the overwhelmingly common answer, not a diagnosis. Everything
 * *after* this gate says why it declined, because from there on the roll is one a
 * player might reasonably have expected a prompt for.
 */
function holderOf(config: AnyObject): AnyObject | null {
  // Guarded before the lookup: an adversary's attack and a bare sheet roll both
  // reach this window, and `fromUuidSync` is not obliged to be kind about "".
  const actorUuid = String(config["source"]?.["actor"] ?? "");
  if (!actorUuid) return null;

  const actor = fromUuidSync(actorUuid) as AnyObject | null;
  if (!actor || actor["type"] !== "character") return null;

  return holdsFeature(actor) ? actor : null;
}

/**
 * Resolve the roll config back to the weapon attack that produced it, or null.
 *
 * `config.source` carries the *ids* of the item and action. The action is looked
 * up the way `DHRoll.toMessage` looks it up — the item's `system.actions`
 * collection first, then its `system.attack`, which is where a weapon's built-in
 * attack lives and is not a member of that collection.
 *
 * The range is read off the *action*, which is the derived value, so `reach.ts`
 * having promoted a Melee weapon to Very Close is already accounted for. It falls
 * back to the weapon's own attack range only if the action carries none.
 */
function weaponAttackOf(actor: AnyObject, config: AnyObject): WeaponAttack | null {
  const source = config["source"];

  // "with a weapon", exactly: an unarmed strike lives on `actor.system.attack`
  // rather than on an Item, so `source.item` is the *actor's* id and this finds
  // nothing — which is the right answer, and not worth a line every swing.
  const weapon = actor["items"]?.get?.(String(source?.["item"] ?? "")) as AnyObject | undefined;
  if (!weapon || String(weapon["type"] ?? "") !== "weapon") return null;

  const actionId = String(source?.["action"] ?? "");
  const attack = weapon["system"]?.["attack"] as AnyObject | undefined;
  const action =
    (weapon["system"]?.["actions"]?.get?.(actionId) as AnyObject | undefined) ??
    (String(attack?.["id"] ?? attack?.["_id"] ?? "") === actionId ? attack : undefined);
  if (!action || String(action["type"] ?? "") !== ATTACK) {
    console.debug(`${LOG_PREFIX} Hold Them Off: ${weapon["name"]} action ${actionId} is not an attack.`);
    return null;
  }

  const range = String(action["range"] ?? attack?.["range"] ?? "");
  if (!range) {
    console.debug(`${LOG_PREFIX} Hold Them Off: ${weapon["name"]} prints no range; standing down.`);
    return null;
  }

  return { actor, weapon, range };
}

/** How much Hope the character is holding. */
function hopeOn(actor: AnyObject): number {
  const held = Number(actor["system"]?.["resources"]?.[HOPE]?.["value"]);
  return Number.isFinite(held) ? held : 0;
}

/**
 * Is this token fair game as a target for whoever is choosing?
 *
 * `document.hidden` only — the GM's explicit "this is not on the board yet" — and
 * only for the people it is hidden from. This is exactly the filter
 * `daggerheart-target-helper` applies to its own candidate list, which is the
 * targeting surface this table already uses, so the two agree about who exists.
 *
 * Deliberately **not** `token.visible`, and deliberately **not** this module's
 * own `invisibleToPlayers` flag — an earlier version of this file checked both,
 * and both are wrong:
 *
 * - At this table *every* token the GM drops carries `invisibleToPlayers`, and
 *   the whole point of that feature is that such tokens stay **targetable and
 *   measurable** — only their artwork is hidden (see `tokens/invisible-tokens.ts`,
 *   where "targeting is unaffected, and that is load-bearing"). Filtering on it
 *   made this feature offer a player nothing, ever.
 * - `token.visible` folds in vision and fog, and fails the same way for a
 *   theatre-of-mind token parked off-screen. The Target Helper rejects it for
 *   that reason too.
 */
function targetable(token: Token): boolean {
  if (game.user?.isGM === true) return true;

  return token.document.hidden !== true;
}

/**
 * Every adversary this attack could still reach, nearest first.
 *
 * Nearest first because that is the order the player is thinking in when the rule
 * says "within range", and because it makes the list stable between two rolls
 * from the same spot.
 */
function candidatesFor(attacker: Token, config: AnyObject, range: string): Candidate[] {
  // Both keys, because either can identify an existing target: the token id for
  // the one that was clicked, the actor uuid for a self- or uuid-targeted action
  // that formatted a prototype token with no placeable behind it. Empties are
  // dropped so a target missing one of them cannot match a token missing it too.
  const taken = new Set(
    ((config["targets"] ?? []) as AnyObject[])
      .flatMap((target) => [String(target["id"] ?? ""), String(target["actorId"] ?? "")])
      .filter((key) => key !== ""),
  );

  const found: Candidate[] = [];

  for (const token of canvas.tokens?.placeables ?? []) {
    const actor = token.actor;
    if (!actor || actor["type"] !== ADVERSARY) continue;
    // "*additional* adversaries" — whoever the attack already went at is not one.
    if (taken.has(token.id) || taken.has(String(actor["uuid"] ?? ""))) continue;
    if (!targetable(token)) continue;

    let distance: number;
    try {
      distance = attacker.distanceTo(token);
    } catch {
      continue;
    }

    // Every rejection past this point is traced. By here the roll is a Ranger's
    // landed weapon hit with the Hope to spend, so "why was nobody offered" is a
    // question someone is about to ask, and the answer is almost always a number.
    if (!Number.isFinite(distance) || withinActionRange(distance, range) !== true) {
      console.debug(
        `${LOG_PREFIX} Hold Them Off: ${token.document.name} at ${distance}, outside ${range}.`,
      );
      continue;
    }

    found.push({ token, distance });
  }

  return found.sort((a, b) => a.distance - b.distance);
}

/** The picker's row for one adversary: portrait, token name, how far off it is. */
function choiceFor(candidate: Candidate): PromptChoice {
  const actor = candidate.token.actor as AnyObject;
  const units = String(canvas.scene?.["grid"]?.["units"] ?? "");

  return {
    id: candidate.token.id,
    // The *token's* name, so an unlinked "Minor Treant #2" reads as itself rather
    // than as its statblock — the same choice `TargetField.formatTarget` makes.
    name: String(candidate.token.document.name ?? actor["name"] ?? ""),
    img: actor["img"] ? String(actor["img"]) : undefined,
    detail: game.i18n.format("EE.Features.HoldThemOff.Distance", {
      distance: Math.round(candidate.distance),
      units,
    }),
  };
}

/**
 * Append one adversary to the roll's targets, exactly as if it had been targeted
 * before the roll.
 *
 * The entry mirrors `TargetField.formatTarget` (system 2.7.2) field for field,
 * and `hit` is decided the way `D20Roll.buildEvaluate` decided it for the
 * original targets — `config.roll.difficulty ?? target.difficulty ??
 * target.evasion` — so the two can never disagree. `hitResult` is deliberately
 * *not* set here: `TargetField.execute` sets it a moment later for the whole
 * list, and duplicating that would be one more thing to keep in step.
 */
function appendTarget(config: AnyObject, roll: AnyObject, token: Token): void {
  const actor = token.actor as AnyObject;

  const entry: AnyObject = {
    id: token.id,
    actorId: String(actor["uuid"] ?? ""),
    name: String(token.document.name ?? actor["name"] ?? ""),
    img: String(actor["img"] ?? ""),
    difficulty: actor["system"]?.["difficulty"],
    evasion: actor["system"]?.["evasion"],
    saveResult: { success: false },
  };

  const against = config["roll"]?.["difficulty"] ?? entry["difficulty"] ?? entry["evasion"];
  entry["hit"] =
    roll["isCritical"] === true || Number(config["roll"]?.["total"] ?? 0) >= Number(against);

  config["targets"] ??= [];
  (config["targets"] as AnyObject[]).push(entry);
}

/** The sentence at the top of the picker: what landed, and what this will cost. */
function introFor(config: AnyObject, attack: WeaponAttack): string {
  const hits = ((config["targets"] ?? []) as AnyObject[])
    .filter((target) => target["hit"] === true)
    .map((target) => String(target["name"] ?? ""));

  const data = {
    weapon: String(attack.weapon["name"] ?? ""),
    targets: hits.join(", "),
    hope: HOPE_COST,
    // The system's own name for the band, so it reads as the card and the weapon
    // tooltip do — and stays translated in a world that isn't in English. Same
    // exception as the content names in `apps/automation-catalog.ts`: this is the
    // *system's* string, and duplicating it under `EE.` would be a worse copy.
    range: game.i18n.localize(`DAGGERHEART.CONFIG.Range.${attack.range}.name`),
  };

  return game.i18n.format(
    hits.length > 0 ? "EE.Features.HoldThemOff.Intro" : "EE.Features.HoldThemOff.IntroNoTarget",
    data,
  );
}

/**
 * Offer the extra adversaries, charge the Hope, and add whoever was picked.
 *
 * Returns once the targets are settled, so the rest of the action workflow — the
 * damage roll, `TargetField.execute`, `applyDamage` and the chat card — all see
 * the final list.
 */
async function runHoldThemOffWindow(roll: AnyObject, config: AnyObject): Promise<void> {
  if (game.settings.get(MODULE_ID, SETTINGS.holdThemOffExtraTargets) !== true) return;

  // Silent gate: most attack rolls in the world are nothing to do with this.
  // Past here every exit says why, because past here a player might reasonably
  // have expected the prompt and needs to be able to find out.
  const holder = holderOf(config);
  if (!holder) return;

  const attack = weaponAttackOf(holder, config);
  if (!attack) return;

  // Only populated when the attack had targets or a set difficulty. Without it
  // nothing here knows whether it succeeded — see the header note.
  if (config["roll"]?.["success"] !== true) {
    console.debug(`${LOG_PREFIX} Hold Them Off: attack did not succeed (or had no target).`);
    return;
  }

  // Checked before the prompt rather than after it: an offer the player cannot
  // take is worse than no offer. No notification, because a Ranger below 3 Hope
  // attacks just as often as one above it, and one per swing would be noise.
  if (hopeOn(attack.actor) < HOPE_COST) {
    console.debug(
      `${LOG_PREFIX} Hold Them Off: ${hopeOn(attack.actor)} Hope, needs ${HOPE_COST}; nothing offered.`,
    );
    return;
  }

  const attacker = tokenForActor(attack.actor);
  if (!canvas.ready || !attacker) {
    console.debug(`${LOG_PREFIX} Hold Them Off: attacker has no token; cannot measure range.`);
    return;
  }

  const candidates = candidatesFor(attacker, config, attack.range);
  if (candidates.length === 0) {
    console.debug(`${LOG_PREFIX} Hold Them Off: no further adversaries within ${attack.range}.`);
    return;
  }

  // The player has to watch the attack land before being asked to pay for it.
  await showDiceEarly(roll, config);

  const picked = await chooseUpTo({
    title: game.i18n.localize("EE.Features.HoldThemOff.Title"),
    // No portrait banner here, unlike the other prompts: the choices below carry
    // portraits of their own, and a second row of them would compete with the one
    // the player is actually reading.
    intro: introFor(config, attack),
    choices: candidates.map(choiceFor),
    max: EXTRA_TARGETS,
    confirmLabel: game.i18n.format("EE.Features.HoldThemOff.Confirm", { hope: HOPE_COST }),
    declineLabel: game.i18n.localize("EE.Features.HoldThemOff.Decline"),
  });

  // Confirming with nothing ticked means the same as dismissing: no Hope changes
  // hands, and the attack resolves against whoever it already went at.
  if (picked.length === 0) return;

  chargeCosts(attack.actor, config, [{ key: HOPE, value: HOPE_COST }]);

  const byId = new Map(candidates.map((candidate) => [candidate.token.id, candidate.token]));
  for (const id of picked) {
    const token = byId.get(id);
    // The answer came from a dialog this client built a moment ago, but it is
    // still re-checked against that list rather than trusted to name a token.
    if (token) appendTarget(config, roll, token);
  }

  console.debug(`${LOG_PREFIX} Hold Them Off: ${picked.length} more caught by the same roll.`);
}

/**
 * Install the window.
 *
 * Registered after the others, which costs nothing — a weapon attack is not a
 * spellcast, so Blood Spike's window declines it, and Fearless only rewrites the
 * Hope/Fear result, which changes no total this reads. Ordering it last keeps the
 * pipeline's handler list reading in the order the windows were introduced.
 */
export function registerHoldThemOff(): void {
  registerRollWindow({
    id: "holdThemOff",
    // Cheap and total: `rollTypeOf` reads the type captured at `preRoll`, before
    // the system overwrites it with the action type. An adversary's attack is the
    // same roll type and reaches `run`, where it resolves to no character and
    // stops immediately.
    matches: (_roll, config) => rollTypeOf(config) === ATTACK,
    run: async (roll, config) => {
      await runHoldThemOffWindow(roll, config);
    },
  });
}
