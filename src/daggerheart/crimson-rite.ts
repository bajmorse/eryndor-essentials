/**
 * **Crimson Rite** (Blood Hunter class, *Void for Daggerheart*) — "Mark a Hit
 * Point to enchant one of your active weapons with bloodthirsty power until the
 * end of your next rest or you use this feature again. When you succeed on an
 * attack with the enchanted weapon, it deals an extra 1d4 magic damage. This
 * extra damage increases to 2d4 at level 2, 3d4 at level 5, and 4d4 at level 8."
 *
 * Unlike `fearless.ts` and `blood-maledict.ts` this is not a roll window. Nothing
 * about the rite has to pre-empt a result: activating it is an action, and the
 * damage it adds is a standing bonus the system already knows how to apply. So it
 * registers hooks of its own instead of a {@link RollWindow}, and takes no part in
 * `roll-pipeline.ts`'s ordering.
 *
 * ## What the Void ships, and why it does nothing
 *
 * The Item carries a "Mark HP" action (which correctly charges 1 Hit Point and
 * then stops), a manual "Damage" button, and four **disabled** effects named
 * "Crimson Rite: Tier 1–4", each adding `+Nd4` to
 * `system.bonuses.damage.magical.dice`.
 *
 * Those four are dead code on any ordinary weapon. `DamageRoll.applyBaseBonus`
 * pulls type bonuses per damage part, keyed on that part's *own* types:
 *
 * ```js
 * options.damageTypes?.forEach(t => {
 *     modifiers.push(...this.getBonus(`${type}.${t}`, ...));
 * });
 * ```
 *
 * A normal weapon's damage part is `type: ["physical"]`, so `damage.magical` is
 * never consulted and enabling the tier effect changes nothing. (They also write
 * `"+2d4"`, but `formatModifier` prepends its own `+` — the system's own `sharp`
 * armour feature, which uses the same bonus keys, writes an unsigned `"1d4"`.)
 *
 * ## What this does instead
 *
 * Three pieces, each leaning on machinery the system already has:
 *
 * 1. **The dice** come from `system.bonuses.damage.{primaryWeapon,secondaryWeapon}.dice`.
 *    That bucket is gated on the damage roll's source item actually *being* the
 *    equipped weapon in that slot — `applyBaseBonus` compares
 *    `options.source.item === this.data[slot]?.id` — which is native, exact
 *    weapon scoping, and is what makes "enchant **one** of your active weapons"
 *    expressible at all. Since a character has exactly two weapon slots, the
 *    choice is always primary-or-secondary. It also arrives in the damage dialog
 *    as a toggleable "Weapon Bonus", so a player can decline it on a hit where
 *    the rite shouldn't apply.
 * 2. **The expiry** is `system.duration.type = "shortRest"`. The system's
 *    `expireActiveEffects` is called on both rests, and `refreshIsAllowed` lets a
 *    `shortRest` duration expire on *either* — which is exactly "until the end of
 *    your next rest". A `longRest` duration would survive a short one.
 * 3. **The damage type** is the one thing the system cannot express, so it is the
 *    only part that needs code: {@link registerRiteDamageType} adds `magical` to
 *    the enchanted weapon's damage part as the roll is configured.
 *
 * ## Why the extra dice are not their own damage part
 *
 * They read like a separate 1d4 of magic damage, and modelling them that way was
 * the first instinct. It is wrong. `Actor#takeDamage` runs the main damage
 * through `convertDamageToThreshold`, and Daggerheart thresholds work on the
 * *total* — 8 physical plus 4 magic as two parts would be converted twice and
 * mark the wrong number of Hit Points. The rider has to join the weapon's own
 * damage roll, which means it inherits that part's types.
 *
 * So the part becomes `["physical", "magical"]` rather than the rite dice being
 * magical on their own. That is a deviation, and it is in the character's favour:
 * `getResistanceStatus` requires resistance to **all** of a part's types before
 * it counts, so an enchanted weapon is resisted only by something resistant to
 * both. It is also the reading the Void's own author took — their manual Damage
 * action is typed `["magical"]` — and "enchanted with bloodthirsty power" is a
 * fair description of a weapon whose damage is no longer merely physical.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS, FLAGS } from "../constants.js";
import { isWriter } from "../utils/is-writer.js";
import { weaponOption } from "./attack-action.js";
import { chooseOne } from "./feature-prompt.js";

/** The Void Item this comes from — matched ahead of the printed name. */
const CRIMSON_RITE_SOURCE = "Compendium.the-void-unofficial.classes.Item.otb0ThXWuqQzzWho";

/** Printed name, as the fallback match for a hand-copied card. */
const CRIMSON_RITE_NAME = "Crimson Rite";

/** The resource the activation costs, and the only reliable way to spot it. */
const HIT_POINTS = "hitPoints";

/** The two weapon slots the system scopes damage bonuses to. */
const SLOTS = ["primaryWeapon", "secondaryWeapon"] as const;
type WeaponSlot = (typeof SLOTS)[number];

/** The die the rite adds, once per tier. */
const RITE_DIE = "d4";

/** The damage type the rite confers on the weapon it enchants. */
const MAGICAL = "magical";

/**
 * `CONFIG.DH.EFFECTS.activeEffectDurations.shortRest.id`. Chosen over `longRest`
 * because `refreshIsAllowed` expires a `shortRest` effect on either kind of rest,
 * and the printed wording is "your next rest" without qualification.
 */
const UNTIL_NEXT_REST = "shortRest";

/** The system's world-level automation settings, which own effect expiry. */
const DH_ID = "daggerheart";
const DH_AUTOMATION = "Automation";

/** An equipped weapon and the slot it occupies. */
interface ActiveWeapon {
  slot: WeaponSlot;
  weapon: AnyObject;
}

/** What the rite effect remembers about what it enchanted. */
interface RiteMark {
  slot: WeaponSlot;
  /** Embedded Item id — what the damage roll's `source.item` is compared against. */
  weaponId: string;
  /** Full uuid, for logging and for surviving a look at the effect by hand. */
  weaponUuid: string;
}

/** Is this the Crimson Rite card? Compendium source first, printed name second. */
function isCrimsonRite(item: AnyObject | null | undefined): boolean {
  if (!item) return false;

  // The homebrew escape hatch the registry uses, honoured here for the same
  // reason: a table that rewrote the card should still get the automation.
  const flagged = item["flags"]?.[MODULE_ID]?.[FLAGS.featureId];
  if (typeof flagged === "string" && flagged.trim() === "crimsonRite") return true;

  if (String(item["_stats"]?.["compendiumSource"] ?? "") === CRIMSON_RITE_SOURCE) return true;

  return String(item["name"] ?? "").trim().toLowerCase() === CRIMSON_RITE_NAME.toLowerCase();
}

/**
 * Is this the action that *activates* the rite?
 *
 * Matched on the Hit Point cost rather than on the action's name ("Mark HP"),
 * which is the Void's wording and not the rule's. The card's other action is a
 * damage button and costs nothing, so the cost tells the two apart without
 * depending on a string a homebrewer might reasonably change.
 */
function isActivation(action: AnyObject | null | undefined): boolean {
  const costs = action?.["cost"] ?? [];
  return Array.from(costs).some(
    (cost) => String((cost as AnyObject)?.["key"] ?? "") === HIT_POINTS,
  );
}

/** The character's equipped weapons, primary first. */
function activeWeapons(actor: AnyObject): ActiveWeapon[] {
  const found: ActiveWeapon[] = [];
  for (const slot of SLOTS) {
    const weapon = actor["system"]?.[slot];
    if (weapon) found.push({ slot, weapon });
  }
  return found;
}

/**
 * How many `d4` the rite adds.
 *
 * `system.tier` is 1 at level 1 and otherwise looked up in the world's LevelTiers
 * setting, whose defaults are 2–4, 5–7 and 8–10 — which is precisely the printed
 * scaling ("2d4 at level 2, 3d4 at level 5, 4d4 at level 8"). The Void's own
 * manual damage action reaches the same answer with `multiplier: "tier"`.
 *
 * Resolved to a literal here rather than left as an `@tier` formula on the
 * effect: the rite lasts until the next rest, so the value cannot meaningfully
 * change while it is active, and a literal cannot be misparsed.
 */
function riteFormula(actor: AnyObject): string {
  const tier = Number(actor["system"]?.["tier"]);
  const count = Number.isFinite(tier) && tier > 0 ? Math.floor(tier) : 1;
  return `${count}${RITE_DIE}`;
}

/** The rite effect currently on this actor, if any. */
function activeRite(actor: AnyObject): AnyObject | null {
  for (const effect of actor["effects"] ?? []) {
    if (effect?.["flags"]?.[MODULE_ID]?.[FLAGS.crimsonRite]) return effect;
  }
  return null;
}

/** What that effect enchanted, or null if it isn't ours or is malformed. */
function riteMark(effect: AnyObject | null): RiteMark | null {
  const mark = effect?.["flags"]?.[MODULE_ID]?.[FLAGS.crimsonRite];
  const slot = String(mark?.["slot"] ?? "");
  const weaponId = String(mark?.["weaponId"] ?? "");
  if (!weaponId || !SLOTS.includes(slot as WeaponSlot)) return null;

  return { slot: slot as WeaponSlot, weaponId, weaponUuid: String(mark?.["weaponUuid"] ?? "") };
}

/**
 * Turn off any of the Void's own tier effects that have been enabled by hand.
 *
 * Normally dormant — they ship disabled, and on a physical weapon they do nothing
 * even when enabled. But this module gives the weapon a `magical` damage type,
 * which is the one condition under which `bonuses.damage.magical.dice` starts
 * being read: an effect someone had switched on in the days of doing this by hand
 * would suddenly begin stacking on top of the automated rite.
 *
 * Matched on the change key rather than the name, so a renamed copy is still
 * caught. Only ever *disables* — nothing is deleted, and re-enabling one by hand
 * remains possible for anyone who wants the old behaviour back.
 */
async function silenceManualTierEffects(item: AnyObject): Promise<void> {
  const updates: AnyObject[] = [];

  for (const effect of item["effects"] ?? []) {
    if (effect?.["disabled"] === true) continue;

    const changes = effect?.["system"]?.["changes"] ?? [];
    const stacks = Array.from(changes).some((change) =>
      String((change as AnyObject)?.["key"] ?? "").includes(`damage.${MAGICAL}.dice`),
    );
    if (stacks) updates.push({ _id: effect["id"], disabled: true });
  }

  if (updates.length === 0) return;

  await item["updateEmbeddedDocuments"]?.("ActiveEffect", updates);
  console.warn(
    `${LOG_PREFIX} Crimson Rite: disabled ${updates.length} manually-enabled tier ` +
      `effect(s) on "${item["name"]}" — the automation supersedes them.`,
  );
}

/**
 * Ask which weapon to enchant. Only ever called with two of them; one is applied
 * without asking, and none is refused earlier.
 *
 * `chooseOne` rather than a dialog of its own: Ranger's Focus asks the same
 * question of the same list, and two copies would be two things to restyle. It
 * is also the one prompt shape in `feature-prompt.ts` with no timeout, which is
 * exactly right here — nothing is being held back, the Hit Point is spent and the
 * chat card has posted, so an unanswered dialog costs the table nothing but this
 * player's own rite.
 */
async function chooseWeapon(weapons: ActiveWeapon[]): Promise<ActiveWeapon | null> {
  const answer = await chooseOne({
    title: game.i18n.localize("EE.Features.CrimsonRite.ChooseTitle"),
    intro: game.i18n.localize("EE.Features.CrimsonRite.ChooseIntro"),
    // Answered in *slots*, since that is what the rite is anchored to, but shown
    // exactly as Ranger's Focus shows the same two weapons.
    options: weapons.map(({ slot, weapon }) => weaponOption(slot, weapon)),
  });

  return weapons.find(({ slot }) => slot === answer) ?? null;
}

/**
 * Put the rite on a weapon, replacing whatever it was on before.
 *
 * Deleting first is what implements "or you use this feature again" — the rule
 * allows exactly one enchanted weapon, and two effects would otherwise both feed
 * their dice into their respective slots.
 */
async function applyRite(actor: AnyObject, item: AnyObject, choice: ActiveWeapon): Promise<void> {
  const existing = activeRite(actor);
  if (existing) await actor["deleteEmbeddedDocuments"]?.("ActiveEffect", [existing["id"]]);

  await silenceManualTierEffects(item);

  const formula = riteFormula(actor);
  const mark: RiteMark = {
    slot: choice.slot,
    weaponId: String(choice.weapon["id"] ?? ""),
    weaponUuid: String(choice.weapon["uuid"] ?? ""),
  };

  await actor["createEmbeddedDocuments"]?.("ActiveEffect", [
    {
      name: game.i18n.format("EE.Features.CrimsonRite.EffectName", {
        weapon: String(choice.weapon["name"] ?? ""),
      }),
      img: item["img"],
      // The card it came from, so the effect is traceable on the sheet and so
      // `getChangeValue` can resolve item roll data if a future change needs it.
      origin: String(item["uuid"] ?? ""),
      disabled: false,
      // Created straight onto the actor, so there is no item for it to transfer
      // *from* — the Void's own tier effects are the transferring ones.
      transfer: false,
      type: "base",
      system: {
        duration: { type: UNTIL_NEXT_REST },
        changes: [
          {
            key: `system.bonuses.damage.${choice.slot}.dice`,
            type: "add",
            // Unsigned: `formatModifier` supplies the operator, and the system's
            // own `sharp` armour feature writes its `1d4` the same way.
            value: formula,
            priority: null,
            phase: "initial",
          },
        ],
      },
      flags: { [MODULE_ID]: { [FLAGS.crimsonRite]: mark } },
    },
  ]);

  ui.notifications?.info(
    game.i18n.format("EE.Features.CrimsonRite.Applied", {
      weapon: String(choice.weapon["name"] ?? ""),
      formula,
    }),
  );

  warnIfExpiryDisabled();
}

/**
 * The rite's duration is enforced by the *system*, not by this module, and the
 * system lets a world turn that off. Worth one line when it is off, because the
 * symptom otherwise is a rite that quietly never ends.
 */
function warnIfExpiryDisabled(): void {
  try {
    const automation = game.settings?.get(DH_ID, DH_AUTOMATION) as AnyObject | undefined;
    if (automation?.["autoExpireActiveEffects"] === false) {
      console.warn(
        `${LOG_PREFIX} Crimson Rite: the system's "auto expire active effects" ` +
          `automation is off, so the rite will not end on its own at a rest.`,
      );
    }
  } catch (error) {
    console.warn(`${LOG_PREFIX} Crimson Rite: could not read the system's expiry setting.`, error);
  }
}

/**
 * Activation: watch for the Hit Point being marked, then enchant a weapon.
 *
 * `daggerheart.postUseAction` rather than `preUseAction` because the cost has to
 * have been paid before the rite exists — and because `Hooks.call` is synchronous,
 * so a `pre` hook could not have awaited the weapon dialog anyway. The work is
 * therefore started and not awaited; nothing downstream of the hook depends on it.
 *
 * The hook fires only on the client that used the action, which is the character's
 * owner, so no relay is needed: they can already write their own actor's effects.
 */
function registerRiteActivation(): void {
  Hooks.on("daggerheart.postUseAction", (action: AnyObject) => {
    try {
      if (game.settings.get(MODULE_ID, SETTINGS.crimsonRiteEnchant) !== true) return;

      const item = action?.["item"];
      const actor = action?.["actor"];
      if (!actor || !isCrimsonRite(item) || !isActivation(action)) return;

      void enchant(actor, item);
    } catch (error) {
      console.warn(`${LOG_PREFIX} Crimson Rite: could not start the rite.`, error);
    }
  });
}

/** The activation proper, async so it can ask which weapon. */
async function enchant(actor: AnyObject, item: AnyObject): Promise<void> {
  try {
    const weapons = activeWeapons(actor);

    // The Hit Point is already spent by the time this runs — the hook fires after
    // `updateResources`. Nothing here can refund it, so say plainly what happened
    // rather than failing silently.
    if (weapons.length === 0) {
      ui.notifications?.warn(game.i18n.localize("EE.Features.CrimsonRite.NoWeapon"));
      return;
    }

    const choice = weapons.length === 1 ? weapons[0]! : await chooseWeapon(weapons);
    if (!choice) return;

    await applyRite(actor, item, choice);
  } catch (error) {
    console.warn(`${LOG_PREFIX} Crimson Rite: could not apply the rite.`, error);
  }
}

/**
 * Give the enchanted weapon's damage a `magical` type, so the rite is magic
 * damage rather than more of whatever the weapon already dealt.
 *
 * `daggerheart.preRoll` is fired at the top of `DHRoll.buildConfigure` for every
 * roll, damage rolls included (`DamageRoll` inherits `buildConfigure` and adds no
 * hook suffix of its own). A damage roll is the one carrying a `damageFormula`,
 * which at this point is still the plain `{ formula, damageTypes, applyTo }`
 * object `DamageField.formatFormulas` produced — `buildEvaluate` copies its
 * `damageTypes` onto the evaluated roll afterwards, so a type added here reaches
 * both the chat card and `takeDamage`'s resistance check.
 *
 * One known imprecision: a player who unticks the rite's "Weapon Bonus" in the
 * damage dialog gets a magically-typed hit with no rite dice in it, because the
 * dialog runs after this. Harmless — the typing is in their favour either way —
 * and not worth reaching into the dialog to fix.
 */
function registerRiteDamageType(): void {
  Hooks.on("daggerheart.preRoll", (config: AnyObject) => {
    try {
      // Cheapest and most selective check first: this hook sees every roll the
      // system makes, and only damage rolls carry a `damageFormula`.
      const formula = config?.["damageFormula"];
      if (!formula) return;

      if (game.settings.get(MODULE_ID, SETTINGS.crimsonRiteEnchant) !== true) return;

      const sourceItem = String(config["source"]?.["item"] ?? "");
      if (!sourceItem) return;

      const actorUuid = String(config["source"]?.["actor"] ?? "");
      if (!actorUuid) return;

      const actor = fromUuidSync(actorUuid);
      if (!actor) return;

      const mark = riteMark(activeRite(actor));
      if (!mark || mark.weaponId !== sourceItem) return;

      addMagical(formula);
    } catch (error) {
      console.warn(`${LOG_PREFIX} Crimson Rite: could not type the rite's damage.`, error);
    }
  });
}

/**
 * Add `magical` to a damage formula's types, whichever container it is using.
 *
 * `formatFormulas` writes `x.type ?? new Set()`, and the schema field is a Set —
 * but the same object is reachable from raw action data where it is an array, and
 * being wrong about that would silently drop the type rather than throw.
 */
function addMagical(formula: AnyObject): void {
  const types = formula["damageTypes"];

  if (types instanceof Set) {
    types.add(MAGICAL);
    return;
  }

  if (Array.isArray(types)) {
    if (!types.includes(MAGICAL)) types.push(MAGICAL);
    return;
  }

  formula["damageTypes"] = new Set([MAGICAL]);
}

/**
 * End the rite if the weapon it enchanted is no longer the weapon in that slot.
 *
 * The two halves of this feature are anchored differently and cannot be made to
 * agree: the bonus dice are keyed to the **slot**, because that is the only
 * scoping the system offers, while the magic damage type is keyed to the
 * **weapon**, because that is what the rule enchants. Swap weapons and they come
 * apart — the new weapon would inherit the dice it was never given, and the old
 * one would keep a damage type it can no longer use.
 *
 * Rather than pick which half to be wrong, the rite ends. That is also the
 * defensible reading: an enchantment placed on a specific weapon does not follow
 * you to a different one when you sheathe it.
 */
async function reconcileRite(actor: AnyObject): Promise<void> {
  const effect = activeRite(actor);
  const mark = riteMark(effect);
  if (!effect || !mark) return;

  // Still the same weapon in the same slot: nothing to do, which is the case
  // every time this runs for an unrelated equipment change.
  if (String(actor["system"]?.[mark.slot]?.["id"] ?? "") === mark.weaponId) return;

  await actor["deleteEmbeddedDocuments"]?.("ActiveEffect", [effect["id"]]);
  ui.notifications?.info(game.i18n.localize("EE.Features.CrimsonRite.Unequipped"));
}

/**
 * Watch for the enchanted weapon being unequipped, swapped or deleted.
 *
 * Gated to a single writer, as every world-scoped write in this module is —
 * document hooks fire on every connected client, and the delete must happen once.
 * The `updateItem` filter is deliberately narrow: this hook sees every item update
 * in the world, and only the two equipment fields can move a weapon between slots.
 */
function registerRiteEquipGuard(): void {
  Hooks.on("updateItem", (item: AnyObject, changes: AnyObject) => {
    try {
      if (!isWriter()) return;
      if (String(item?.["type"] ?? "") !== "weapon") return;

      const equipment = changes?.["system"];
      if (equipment?.["equipped"] === undefined && equipment?.["secondary"] === undefined) return;

      const actor = item["parent"];
      if (actor?.["documentName"] !== "Actor") return;

      void reconcileRite(actor);
    } catch (error) {
      console.warn(`${LOG_PREFIX} Crimson Rite: could not reconcile after an equipment change.`, error);
    }
  });

  Hooks.on("deleteItem", (item: AnyObject) => {
    try {
      if (!isWriter()) return;
      if (String(item?.["type"] ?? "") !== "weapon") return;

      const actor = item["parent"];
      if (actor?.["documentName"] !== "Actor") return;

      void reconcileRite(actor);
    } catch (error) {
      console.warn(`${LOG_PREFIX} Crimson Rite: could not reconcile after a weapon was deleted.`, error);
    }
  });
}

/** Install every hook. Call once during `init`. */
export function registerCrimsonRite(): void {
  registerRiteActivation();
  registerRiteDamageType();
  registerRiteEquipGuard();
}
