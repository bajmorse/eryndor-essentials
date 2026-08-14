/**
 * Automatic Session Log event sources.
 *
 * Each source below turns a Foundry (or Daggerheart) event into one plain-text
 * log line and hands it to `recordSessionLogEvent`, which decides whether to
 * actually keep it (master switch, per-category switch, one writer). Nothing
 * here writes to the world setting directly.
 *
 * ## Rolls
 * `createChatMessage`, filtered to the Daggerheart message types that carry a
 * meaningful result: `dualityRoll` (checks and attacks — Daggerheart's core d12
 * Hope/Fear mechanic), `fateRoll` (reactions and similar single-die Fate rolls),
 * and `adversaryRoll`. Read off `message.rolls[0]`, the deserialized Roll
 * instance — `.total` and `.totalLabel` ("Hope" / "Fear" / "Critical Success" /
 * "Guaranteed Critical Success"), matching `DualityRoll`/`FateRoll`'s getters.
 * Deliberately does **not** try to resolve hit/miss or a target — that isn't a
 * roll property, and the resource line below tells that part of the story well
 * enough sitting next to this one. Damage/healing *roll* chat messages
 * (`message.type === "damage"/"healing"`) are skipped in favor of the resources
 * source, which logs what was actually applied after mitigation rather than
 * what was rolled. **Verified against the Daggerheart system v2.7.2 bundle**
 * (`message.type` / `getHooks()` / roll getters) — re-check `build/daggerheart.js`
 * (search `messageType` and `getHooks`) if this stops matching after a system
 * update.
 *
 * ## Resources
 * `preUpdateActor` snapshots `system.resources.{hitPoints,stress,armor,hope}`
 * before the write lands; `updateActor` compares against the new values and
 * logs whatever changed. Deliberately not built on Daggerheart's own
 * `daggerheart.postTakeDamage`/`postTakeHealing` hooks — those are plain
 * function-local `Hooks.call`s inside `Actor#takeDamage`/`takeHealing`, so they
 * only fire on whichever single client called the method (e.g. a player
 * self-marking their own Hit Points), not broadcast the way a document update
 * is. `updateActor` is a real document hook and reaches the GM's client
 * regardless of who triggered the change — the same reasoning
 * `void-hybrid-form-stress.ts` already relies on. GM Fear is a world-level pool,
 * not a per-actor resource, and its storage in the installed v2.7.2 system
 * couldn't be confidently pinned down from the minified bundle alone, so it's
 * out of scope here for now.
 *
 * "Down" (a character's Hit Points fully marked) is logged under `status`
 * rather than `resources`, off the same snapshot/compare.
 *
 * ## Status
 * `createActiveEffect`/`deleteActiveEffect`, resolving the owning actor the
 * same way `void-hybrid-form.ts` does (an effect usually lives on its item and
 * transfers — see `utils/actor-of-effect.ts`). Logs every effect gained/lost,
 * not just narrative conditions — some of what Daggerheart automates as effects
 * is mechanical bookkeeping, so this can get chatty. That's what this
 * category's settings toggle is for.
 *
 * ## Combat
 * Daggerheart's own `combatStart` hook (`Hooks.callAll("combatStart", combat)`,
 * unprefixed — see the system's `build/daggerheart.js`) for the start, since "a
 * Combat document was created" is a much weaker signal than "combat actually
 * began." `deleteCombat` for the end, skipped if the round never advanced past
 * 0 (an empty/abandoned combat tracker).
 *
 * ## Scenes
 * `updateScene`, filtered to `changes.active === true` — fires only when a GM
 * *activates* a scene, not on every client's local view change.
 */
import { actorOfEffect } from "../utils/actor-of-effect.js";
import { isWriter } from "../utils/is-writer.js";
import { masterEnabled, recordSessionLogEvent } from "./session-log-store.js";

/* -------------------------------------------------------------------------- */
/*  Shared                                                                     */
/* -------------------------------------------------------------------------- */

function stripHtml(value: unknown): string {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, "").trim() : "";
}

/* -------------------------------------------------------------------------- */
/*  Rolls                                                                      */
/* -------------------------------------------------------------------------- */

const ROLL_MESSAGE_TYPES = new Set(["dualityRoll", "fateRoll", "adversaryRoll"]);

function describeRollMessage(message: AnyObject): string | null {
  const type = message["type"];
  if (typeof type !== "string" || !ROLL_MESSAGE_TYPES.has(type)) return null;

  const roll = message["rolls"]?.[0] as AnyObject | undefined;
  const total = roll?.["total"];
  if (typeof total !== "number") return null;

  const speaker =
    stripHtml(message["speaker"]?.["alias"]) || game.i18n.localize("EE.SessionLog.UnknownActor");
  const title =
    stripHtml(message["flavor"]) ||
    stripHtml(roll?.["title"]) ||
    game.i18n.localize("EE.SessionLog.RollFallbackTitle");
  const outcome = typeof roll?.["totalLabel"] === "string" ? ` — ${roll["totalLabel"] as string}` : "";

  return `${speaker} rolled ${title}: ${total}${outcome}.`;
}

/* -------------------------------------------------------------------------- */
/*  Resources                                                                  */
/* -------------------------------------------------------------------------- */

/** `system.resources` keys we track, and the short label each gets in the log. */
const RESOURCE_LABELS: Record<string, string> = {
  hitPoints: "HP",
  stress: "Stress",
  armor: "Armor",
  hope: "Hope",
};

/** Actor id → resource values captured just before an update lands. */
const resourceSnapshots = new Map<string, Record<string, number>>();

function snapshotResources(actor: AnyObject): Record<string, number> {
  const resources = (actor["system"]?.["resources"] ?? {}) as AnyObject;
  const snapshot: Record<string, number> = {};
  for (const key of Object.keys(RESOURCE_LABELS)) {
    const value = resources[key]?.["value"];
    if (typeof value === "number") snapshot[key] = value;
  }
  return snapshot;
}

function describeResourceChanges(
  actor: AnyObject,
  before: Record<string, number>,
  changes: AnyObject,
): string | null {
  const resources = (actor["system"]?.["resources"] ?? {}) as AnyObject;
  const parts: string[] = [];

  for (const [key, label] of Object.entries(RESOURCE_LABELS)) {
    if (!foundry.utils.hasProperty(changes, `system.resources.${key}.value`)) continue;
    const after = resources[key]?.["value"];
    const beforeValue = before[key];
    if (typeof after !== "number" || beforeValue === undefined || beforeValue === after) continue;
    const max = resources[key]?.["max"];
    const suffix = typeof max === "number" ? `/${max}` : "";
    parts.push(`${label} ${beforeValue}→${after}${suffix}`);
  }

  return parts.length ? `${actor["name"] as string}: ${parts.join(", ")}.` : null;
}

/** Newly at max Hit Points marked — Daggerheart's "down, make a death move" state. */
function describeDown(
  actor: AnyObject,
  before: Record<string, number>,
  changes: AnyObject,
): string | null {
  if (!foundry.utils.hasProperty(changes, "system.resources.hitPoints.value")) return null;

  const hp = (actor["system"]?.["resources"]?.["hitPoints"] ?? {}) as AnyObject;
  const beforeValue = before["hitPoints"];
  if (
    typeof hp["value"] !== "number" ||
    typeof hp["max"] !== "number" ||
    beforeValue === undefined ||
    beforeValue >= hp["max"] ||
    hp["value"] < hp["max"]
  ) {
    return null;
  }

  return `${actor["name"] as string} is down — all Hit Points marked.`;
}

/* -------------------------------------------------------------------------- */
/*  Status                                                                     */
/* -------------------------------------------------------------------------- */

function describeEffect(effect: AnyObject, verb: string): string | null {
  const actor = actorOfEffect(effect);
  if (!actor) return null;
  const name = stripHtml(effect["name"]) || "an effect";
  return `${actor["name"] as string}: ${verb} "${name}".`;
}

/* -------------------------------------------------------------------------- */
/*  Combat                                                                     */
/* -------------------------------------------------------------------------- */

function describeCombatStart(combat: AnyObject): string {
  const names = ((combat["combatants"]?.["contents"] ?? []) as AnyObject[])
    .map((combatant) => stripHtml(combatant["name"]))
    .filter((name): name is string => Boolean(name));
  return names.length ? `Combat began: ${names.join(", ")}.` : "Combat began.";
}

/* -------------------------------------------------------------------------- */
/*  Registration                                                               */
/* -------------------------------------------------------------------------- */

/** Install every automatic event source. Called once during `init`. */
export function registerSessionLog(): void {
  Hooks.on("createChatMessage", (message: AnyObject) => {
    if (!isWriter() || !masterEnabled()) return;
    const text = describeRollMessage(message);
    if (text) void recordSessionLogEvent("rolls", text);
  });

  Hooks.on("preUpdateActor", (actor: AnyObject, changes: AnyObject) => {
    if (!isWriter() || !masterEnabled()) return;
    const touched = Object.keys(RESOURCE_LABELS).some((key) =>
      foundry.utils.hasProperty(changes, `system.resources.${key}.value`),
    );
    if (!touched) return;
    resourceSnapshots.set(String(actor["id"]), snapshotResources(actor));
  });

  Hooks.on("updateActor", (actor: AnyObject, changes: AnyObject) => {
    if (!isWriter() || !masterEnabled()) return;
    const actorId = String(actor["id"]);
    const before = resourceSnapshots.get(actorId);
    resourceSnapshots.delete(actorId);
    if (!before) return;

    const resourceText = describeResourceChanges(actor, before, changes);
    if (resourceText) void recordSessionLogEvent("resources", resourceText);

    const downText = describeDown(actor, before, changes);
    if (downText) void recordSessionLogEvent("status", downText);
  });

  for (const [hook, verb] of [
    ["createActiveEffect", "gained"],
    ["deleteActiveEffect", "lost"],
  ] as const) {
    Hooks.on(hook, (effect: AnyObject) => {
      if (!isWriter() || !masterEnabled()) return;
      const text = describeEffect(effect, verb);
      if (text) void recordSessionLogEvent("status", text);
    });
  }

  Hooks.on("combatStart", (combat: AnyObject) => {
    if (!isWriter() || !masterEnabled()) return;
    void recordSessionLogEvent("combat", describeCombatStart(combat));
  });

  Hooks.on("deleteCombat", (combat: AnyObject) => {
    if (!isWriter() || !masterEnabled()) return;
    if (!(Number(combat["round"]) > 0)) return;
    void recordSessionLogEvent("combat", "Combat ended.");
  });

  Hooks.on("updateScene", (scene: AnyObject, changes: AnyObject) => {
    if (!isWriter() || !masterEnabled()) return;
    if (changes["active"] !== true) return;
    const name = stripHtml(scene["name"]) || String(scene["name"] ?? "");
    void recordSessionLogEvent("scenes", `Scene activated: ${name}.`);
  });
}
