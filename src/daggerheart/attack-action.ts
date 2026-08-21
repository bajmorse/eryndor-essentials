/**
 * Resolving a roll back to the **attack** that produced it.
 *
 * Two Ranger features key off attacks — Hold Them Off and Ranger's Focus — and
 * both have to turn a roll config that carries only ids back into documents. Two
 * copies of that would be two things to keep in step with the system, so it lives
 * here. They want *different* attacks, though, and the difference is the printed
 * wording rather than a simplification:
 *
 * - Hold Them Off says "an attack **with a weapon**", so it uses
 *   {@link weaponAttackOf} and a punch or a spell correctly raises nothing.
 * - Ranger's Focus says only "an attack", so it uses {@link attackActionOf} and
 *   an unarmed strike or a Spellcast attack qualifies.
 *
 * Nothing here is obvious from the config:
 *
 * - `config.source.actor` is a UUID and `config.source.item` / `.action` are bare
 *   ids, so everything has to be looked up.
 * - **An action's parent is not always an Item.** A character's unarmed strike
 *   lives on `actor.system.attack`, so `source.item` is the *actor's* id and
 *   `actor.items.get` finds nothing. That is what makes "with a weapon" an exact
 *   test rather than a heuristic, and it is why {@link attackActionOf} falls back
 *   to the actor as the action's holder.
 * - A weapon's built-in attack is **not** a member of its `system.actions`
 *   collection, so resolving the action means checking both places, the way
 *   `DHRoll.toMessage` does.
 * - An attack made with a weapon rolls `attack`; the same action on anything else
 *   rolls `spellcast` (`DHAttackAction.getRollType` branches on exactly that). A
 *   window that means "any attack" has to match both roll types and then confirm
 *   the *action* is an attack — a `spellcast` roll on its own does not say so.
 */
import { LOG_PREFIX } from "../constants.js";
import type { PromptOption } from "./feature-prompt.js";

/** `CONFIG.DH.ACTIONS.actionTypes.attack.id` — the action type all of this wants. */
const ATTACK_ACTION = "attack";

/** One resolved attack: who made it, with what, using which action. */
export interface AttackAction {
  /** The character who attacked. */
  actor: AnyObject;
  /**
   * The Item the action belongs to, or **null** for an attack that lives on the
   * actor itself — a character's unarmed strike, an adversary's statblock attack.
   */
  item: AnyObject | null;
  /** The action itself — an entry in `system.actions`, or `system.attack`. */
  action: AnyObject;
  /**
   * The printed range, as an id from `CONFIG.DH.GENERAL.range`, or `""` when the
   * action prints none. Read off the *action*, so it is the derived value — a
   * Giant's `reach.ts` promotion from Melee to Very Close is already accounted
   * for.
   */
  range: string;
  /** What to call it in a sentence: the item's name, falling back to the action's. */
  name: string;
}

/** The same, narrowed to an attack made with a weapon. */
export interface WeaponAttack {
  actor: AnyObject;
  weapon: AnyObject;
  action: AnyObject;
  /** Never empty here — {@link weaponAttackOf} declines an action with no range. */
  range: string;
}

/**
 * The **character** who made this roll, or null.
 *
 * Silent on every path, deliberately. Anything registered on the roll pipeline
 * sees every roll in the world — every adversary's, every other character's — and
 * "not a character's roll" is the overwhelmingly common answer rather than a
 * diagnosis worth a console line. A window that wants to explain itself should
 * start logging *after* this gate, once the roll is one a player might reasonably
 * have expected something to happen on.
 */
export function rollingCharacter(config: AnyObject): AnyObject | null {
  // Guarded before the lookup: an adversary's attack and a bare sheet roll both
  // reach the pipeline, and `fromUuidSync` is not obliged to be kind about "".
  const actorUuid = String(config["source"]?.["actor"] ?? "");
  if (!actorUuid) return null;

  const actor = fromUuidSync(actorUuid) as AnyObject | null;
  return actor && actor["type"] === "character" ? actor : null;
}

/** An action's id, however the system happens to be exposing it. */
function idOf(action: AnyObject | undefined): string {
  return String(action?.["id"] ?? action?.["_id"] ?? "");
}

/**
 * Resolve `config` back to the attack `actor` made with it, or null.
 *
 * `label` prefixes the console line, so two features sharing this can still be
 * told apart while diagnosing a roll that raised no prompt.
 */
export function attackActionOf(
  actor: AnyObject,
  config: AnyObject,
  label: string,
): AttackAction | null {
  const source = config["source"];
  const item = (actor["items"]?.get?.(String(source?.["item"] ?? "")) ?? null) as AnyObject | null;

  // An attack with no Item behind it belongs to the actor — see the header.
  const holder = item ?? actor;
  const actionId = String(source?.["action"] ?? "");
  const builtIn = holder["system"]?.["attack"] as AnyObject | undefined;
  const action =
    (holder["system"]?.["actions"]?.get?.(actionId) as AnyObject | undefined) ??
    (idOf(builtIn) === actionId ? builtIn : undefined);

  if (!action || String(action["type"] ?? "") !== ATTACK_ACTION) {
    console.debug(
      `${LOG_PREFIX} ${label}: ${holder["name"]} action ${actionId} is not an attack.`,
    );
    return null;
  }

  return {
    actor,
    item,
    action,
    range: String(action["range"] ?? builtIn?.["range"] ?? ""),
    name: String(item?.["name"] ?? action["name"] ?? ""),
  };
}

/**
 * The same, but only for an attack made **with a weapon** and with a range to
 * measure against.
 *
 * Both extra conditions are silent: a punch and a spell are not
 * misconfigurations, they are the rule declining, and logging either would print
 * on every swing that isn't this one.
 */
export function weaponAttackOf(
  actor: AnyObject,
  config: AnyObject,
  label: string,
): WeaponAttack | null {
  const resolved = attackActionOf(actor, config, label);
  if (!resolved) return null;

  const weapon = resolved.item;
  if (!weapon || String(weapon["type"] ?? "") !== "weapon") return null;

  if (!resolved.range) {
    console.debug(`${LOG_PREFIX} ${label}: ${weapon["name"]} prints no range; standing down.`);
    return null;
  }

  return { actor, weapon, action: resolved.action, range: resolved.range };
}

/** A weapon summarised for a picker row: what it is, how far, how hard. */
export interface WeaponSummary {
  img: string;
  name: string;
  /** Localized range band, or `""` when the weapon declares none. */
  range: string;
  /** Resolved damage formula, or `""` when the weapon deals none. */
  damage: string;
}

/**
 * Describe an equipped weapon for a choice prompt.
 *
 * Both figures come from the system rather than being reassembled here:
 *
 * - the **range** is localized through `DAGGERHEART.CONFIG.Range.<id>.name`, the
 *   system's own string, so it reads as the weapon tooltip and the chat card do
 *   and stays translated in a world that isn't in English. Same documented
 *   exception as the content names in `apps/automation-catalog.ts` — it is the
 *   *system's* string, and a copy under `EE.` would be a worse one. Read off the
 *   action, so `reach.ts` having promoted Melee to Very Close shows here too.
 * - the **damage** is `action.getDamageFormula()`, which is exactly what the
 *   system's own `damageFormula` Handlebars helper calls to fill the weapon
 *   tooltip. It has already resolved `@prof` against the actor's roll data, so
 *   what the player reads is what will be rolled.
 */
export function describeWeapon(weapon: AnyObject): WeaponSummary {
  const attack = weapon["system"]?.["attack"] as AnyObject | undefined;
  const range = String(attack?.["range"] ?? "");

  let damage = "";
  try {
    damage = String(attack?.["getDamageFormula"]?.() ?? "");
  } catch (error) {
    // A row without a damage figure is still a usable row.
    console.debug(`${LOG_PREFIX} Could not read ${weapon["name"]}'s damage formula.`, error);
  }

  return {
    img: String(weapon["img"] ?? ""),
    name: String(weapon["name"] ?? ""),
    range: range ? game.i18n.localize(`DAGGERHEART.CONFIG.Range.${range}.name`) : "",
    damage,
  };
}

/**
 * A weapon as one row of a {@link chooseOne} prompt: artwork, name over its
 * range band, damage on the right.
 *
 * `id` is the caller's, not the weapon's — Crimson Rite answers in slots and
 * Ranger's Focus in Item ids, and which of the two a prompt wants back is the
 * caller's business. Everything shown is the same either way, which is the point
 * of having this here rather than in each of them.
 */
export function weaponOption(id: string, weapon: AnyObject): PromptOption {
  const { img, name, range, damage } = describeWeapon(weapon);

  return {
    id,
    label: name,
    img: img || undefined,
    tag: range || undefined,
    // No damage figure rather than an empty box: a weapon that deals none has
    // nothing to say in that column.
    stat: damage
      ? { label: game.i18n.localize("EE.Features.WeaponDamage"), value: damage }
      : undefined,
  };
}
