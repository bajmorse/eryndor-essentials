/**
 * Publishing what a character-creation or level-up wizard is sitting on, so the
 * rest of the table can see a card is spoken for before it reaches a sheet.
 *
 * The two wizards are `DhCharacterCreation` and `DhlevelUp` (the base class of
 * both `DhCharacterLevelUp` and `DhCompanionLevelUp` — ApplicationV2 fires
 * render/close hooks for every class in the chain, so the base name catches
 * both). Each keeps its in-progress choices in one object: `app.setup` for
 * creation, the `app.levelup` DataModel for level-up. Both re-render on every
 * change, since they're configured `submitOnChange`, which is what makes a
 * render hook a good enough signal — no polling and no patching of system code.
 *
 * **Selections are found by walking that object for UUIDs** rather than by
 * reading known paths (`setup.primaryAncestry.uuid`,
 * `levelup.levels.3.domainCards.abc.uuid`, …). The paths are numerous, nested,
 * and entirely the system's business to change; the convention that a chosen
 * card is stored under a `uuid`/`itemUuid` key is far more stable. UUIDs
 * pointing *into an actor* are skipped — those are cards already on the sheet,
 * which the census in `deck-pool.ts` counts on its own.
 *
 * If the system reorganizes its wizard state, the walk quietly finds nothing:
 * holds stop being published, and the limit falls back to counting only what has
 * actually been created. That's the intended failure direction.
 */
import { LOG_PREFIX } from "../constants.js";
import { cardKeyOf, sameCard, type CardKey, type CardSource } from "./deck-card-key.js";
import { publishHolds, releaseHolds } from "./deck-holds.js";
import { deckLimitActive } from "./deck-limit.js";

/**
 * Properties that identify what a selection *is*, in order of preference.
 *
 * `sourceUuid` is the Daggerheart Item's own getter and the best answer: for a
 * compendium entry it's the entry's UUID, and for a copy it resolves back
 * through `duplicateSource`/`compendiumSource` to the original.
 *
 * These are read with **property access, not `Object.entries`**. Character
 * creation stores selections as live Item *documents* (`this.setup.class = item`
 * in its `_onDrop`), where `uuid` is a prototype getter and therefore invisible
 * to enumeration. Level-up stores plain `{uuid, itemUuid}` objects. Property
 * access reads both.
 */
const UUID_PROPERTIES = ["sourceUuid", "uuid", "itemUuid"] as const;

/** Depth cap, so a surprise cycle or a deep model can't stall a render. */
const MAX_DEPTH = 8;

/**
 * Is this a UUID for something that could still be drawn from the deck?
 *
 * `Actor.…` is excluded on purpose: a UUID pointing inside an actor is a card
 * that has already been created, and counting it here would take it out of the
 * pool twice.
 */
function isDeckUuid(value: string): boolean {
  return value.startsWith("Compendium.") || value.startsWith("Item.");
}

/**
 * The cards already on the wizard's own sheet.
 *
 * A level-up model is seeded from the character's previous level-ups, so its
 * state still refers to cards that were applied long ago. Reserving those would
 * count them twice — once by the census that can see them on the sheet, once
 * again as a hold — and quietly take a copy away from everyone else.
 */
function alreadyOnSheet(actor: AnyObject | null | undefined): CardKey[] {
  const keys: CardKey[] = [];
  for (const item of (actor?.["items"] ?? []) as Iterable<AnyObject>) {
    const key = cardKeyOf(item as CardSource);
    if (key) keys.push(key);
  }
  return keys;
}

/** The UUID this node stands for, if it stands for a card at all. */
function selectionUuid(node: AnyObject): string | null {
  for (const property of UUID_PROPERTIES) {
    const value = node[property];
    if (typeof value === "string" && isDeckUuid(value)) return value;
  }
  return null;
}

/** Is this a Foundry Document? Its graph reaches the whole world — don't walk in. */
function isDocument(node: AnyObject): boolean {
  return typeof node["documentName"] === "string";
}

/** Collect every card UUID a wizard's state object refers to. */
function collectCardUuids(root: unknown, actor: AnyObject | null | undefined): string[] {
  const found = new Set<string>();
  const seen = new Set<object>();

  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > MAX_DEPTH) return;
    if (seen.has(node as object)) return;
    seen.add(node as object);

    // A node that names a card *is* the selection; there's nothing below it
    // worth reading, and descending into an Item document would wander off
    // through its parent, collection, and effects.
    const uuid = selectionUuid(node as AnyObject);
    if (uuid) {
      found.add(uuid);
      return;
    }
    if (isDocument(node as AnyObject)) return;

    for (const value of Object.values(node as AnyObject)) {
      if (value && typeof value === "object") walk(value, depth + 1);
    }
  };

  walk(root, 0);

  const existing = alreadyOnSheet(actor);

  return [...found].filter((uuid) => {
    // Only cards the limit actually covers — a wizard's state also references
    // weapons, armor, and inventory choices.
    const source = fromUuidSync(uuid, { strict: false }) as CardSource | null;
    const key = cardKeyOf(source, uuid);
    if (!key) return false;

    return !existing.some((onSheet) => sameCard(onSheet, key));
  });
}

/**
 * A DataModel's own properties aren't reliably enumerable, so level-up state is
 * read through `toObject()`. A plain object (character creation) passes through.
 */
function stateOf(app: AnyObject, property: string): unknown {
  const state = app[property];
  if (!state || typeof state !== "object") return null;
  return (state as AnyObject)["toObject"]?.() ?? state;
}

/** Republish one wizard's holds from its current state. */
function syncHolds(app: AnyObject, property: string): void {
  const appId = String(app["id"] ?? "");
  if (!appId) return;

  if (!deckLimitActive()) {
    void releaseHolds(appId);
    return;
  }

  // `character` on creation, `actor` on level-up.
  const actor = (app["character"] ?? app["actor"]) as AnyObject | null;

  try {
    const cards = collectCardUuids(stateOf(app, property), actor);
    void publishHolds(appId, String(actor?.["name"] ?? ""), cards);
  } catch (error) {
    console.warn(`${LOG_PREFIX} Deck Limit: could not read wizard selections.`, error);
  }
}

/** Watch the wizards and keep this user's holds in step. Called during `init`. */
export function registerDeckLimitWizard(): void {
  // Character creation keeps its choices in `app.setup`.
  Hooks.on("renderDhCharacterCreation", (app: AnyObject) => syncHolds(app, "setup"));
  Hooks.on("closeDhCharacterCreation", (app: AnyObject) =>
    void releaseHolds(String(app["id"] ?? "")),
  );

  // Level-up (character and companion both) keeps its choices in `app.levelup`.
  Hooks.on("renderDhlevelUp", (app: AnyObject) => syncHolds(app, "levelup"));
  Hooks.on("closeDhlevelUp", (app: AnyObject) => void releaseHolds(String(app["id"] ?? "")));
}
