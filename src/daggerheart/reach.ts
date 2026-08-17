/**
 * Reach — a character with the **Reach** feature uses Melee things at Very Close.
 *
 * The Giant ancestry's secondary feature reads "Treat any weapon, ability, spell,
 * or other feature that has a Melee range as though it had a Very Close range."
 * The system stores that as prose on a `feature` Item and enforces nothing, so
 * the character's dagger still says *Melee* everywhere the range is read.
 *
 * ## Where the change is made
 *
 * On the **derived** `range` of every Action the actor can use, never on stored
 * data. Every consumer reads the prepared value — the weapon and action tooltips
 * (`templates/ui/tooltip/*.hbs`), the inventory rows, and the Target Helper's
 * range gate (`daggerheart-target-helper`'s `isWithinRange`, which is what
 * actually stops a Very Close target being picked for a Melee attack) — while the
 * action config sheet edits `source.range`, so the GM still sees and edits the
 * real printed range. Nothing is written to the database, which means the rule
 * un-applies itself: drop the feature, or turn this off, and the next data
 * preparation puts `melee` back.
 *
 * Two hook points, because the system prepares actions in two places:
 * - `Item#prepareEmbeddedDocuments` — Daggerheart overrides it to call
 *   `prepareData()` on each action, so it runs on every item preparation. Covers
 *   `system.actions` on any item plus a weapon's base `system.attack`.
 * - `Actor#prepareData` — for the actor's *own* base attack (`system.attack`,
 *   the unarmed strike on a character, the statblock attack on an adversary),
 *   which lives on the actor rather than on an item.
 *
 * Both are patched during `init`: the system assigns `CONFIG.Actor.documentClass`
 * and `CONFIG.Item.documentClass` at script load, before any `init` hook, and no
 * document is constructed until `setup` — so the patch is in place for the first
 * preparation and there is nothing to catch up on at load.
 *
 * `reconcileReach` exists for the *setting* changing mid-session, where documents
 * are already prepared and no preparation is pending.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";

/**
 * The feature name that grants Reach, lower-cased for comparison.
 *
 * Content rather than a localized string: it's the name printed on the card and
 * stored on the Item, so it reads the same whatever the client's language is.
 * Matched on `feature` Items only — the ancestry's feature is embedded on the
 * character as one of those (that's how the system's own `sheetLists` finds it),
 * and a *weapon* someone happened to name "Reach" shouldn't grant the rule.
 */
const REACH_FEATURE_NAME = "reach";

/** Range band ids, from `CONFIG.DH.GENERAL.range`. */
const MELEE = "melee";
const VERY_CLOSE = "veryClose";

/** Is the rule switched on? Checked on every preparation, so toggling is live. */
function reachActive(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.reachMeleeAsVeryClose) === true;
}

/**
 * Does this actor hold a feature called "Reach"?
 *
 * Re-derived on every preparation rather than cached: the answer depends only on
 * a name comparison per item, and a cache would need invalidating on every item
 * create, delete and rename to stay honest.
 */
function hasReachFeature(actor: AnyObject | null | undefined): boolean {
  const items = actor?.["items"];
  if (!items) return false;

  for (const item of items) {
    if (item?.["type"] !== "feature") continue;
    if (String(item["name"] ?? "").trim().toLowerCase() === REACH_FEATURE_NAME) return true;
  }
  return false;
}

/**
 * Every Action attached to a document: the ones it lists, plus its base attack.
 *
 * `system.actions` is the system's `ActionCollection` (a Foundry `Collection`, so
 * iterating yields the actions themselves). `system.attack` is separate and is
 * *not* in that collection — it's a weapon's attack, a character's unarmed
 * strike, or an adversary's statblock attack, and it's the one that matters most
 * here since it's where `melee` is the default.
 */
function actionsOf(document: AnyObject | null | undefined): AnyObject[] {
  const system = document?.["system"];
  if (!system) return [];

  const actions: AnyObject[] = system["actions"] ? [...system["actions"]] : [];
  if (system["attack"]) actions.push(system["attack"]);
  return actions;
}

/**
 * Make one action's range agree with the rule. Returns whether it changed.
 *
 * Idempotent in both directions, which is what lets it run on every preparation:
 * a preparation that doesn't rebuild the data model (`Actor#prepareData` calls
 * `Item#prepareData`, which does not re-initialize `system` from source) would
 * otherwise leave the last answer in place forever. The undo is deliberately
 * narrow — it only reverts a Very Close that is stored as `melee`, so an action
 * genuinely printed as Very Close is never touched.
 */
function applyToAction(action: AnyObject, granted: boolean): boolean {
  if (granted) {
    if (action["range"] !== MELEE) return false;
    action["range"] = VERY_CLOSE;
    return true;
  }

  if (action["range"] !== VERY_CLOSE) return false;
  if (action["_source"]?.["range"] !== MELEE) return false;
  action["range"] = MELEE;
  return true;
}

/** Apply the rule to every action on one item or actor. Returns whether it changed. */
function applyToDocument(document: AnyObject | null | undefined, granted: boolean): boolean {
  let changed = false;
  for (const action of actionsOf(document)) {
    // Not `changed ||=`: every action has to be visited, not just the ones
    // before the first change.
    changed = applyToAction(action, granted) || changed;
  }
  return changed;
}

/**
 * Apply the rule across a whole actor — its own base attack and every item it
 * owns — optionally re-rendering whatever is on screen showing the old range.
 *
 * Only used by {@link reconcileReach}; the preparation patches do the same work
 * one document at a time, as each is prepared.
 */
function applyToActor(actor: AnyObject, render: boolean): void {
  const granted = reachActive() && hasReachFeature(actor);

  let changed = applyToDocument(actor, granted);
  for (const item of actor["items"] ?? []) {
    if (!applyToDocument(item, granted)) continue;
    changed = true;
    if (render) item.render(false);
  }

  // The actor sheet lists its weapons' ranges too, so it's re-rendered whether
  // the change landed on the actor's own attack or on one of its items.
  if (changed && render) actor.render(false);
}

/**
 * Bring every actor in play into line with the current setting.
 *
 * Needed only when the *setting* changes: turning it on or off should take effect
 * against sheets that are already prepared and already open, and nothing would
 * otherwise re-prepare them. Unlinked token actors are separate documents from
 * anything in `game.actors`, hence the second pass; linked ones are the same
 * object, which is what the `seen` set skips.
 */
export function reconcileReach(): void {
  const seen = new Set<string>();

  for (const actor of game.actors?.contents ?? []) {
    applyToActor(actor, true);
    seen.add(String(actor["uuid"] ?? ""));
  }

  for (const token of canvas.tokens?.placeables ?? []) {
    const actor = token.actor;
    if (!actor || seen.has(String(actor["uuid"] ?? ""))) continue;
    applyToActor(actor, true);
  }
}

/**
 * Wrap a data-preparation method so ours runs after the system's.
 *
 * A prototype patch rather than a hook because Foundry fires none during data
 * preparation. Failing to patch is reported once and leaves the system's
 * behaviour untouched, and a throw from our own pass is swallowed for the same
 * reason: a broken range adjustment must not take actor preparation down with it.
 */
function patchPreparation(
  documentClass: AnyObject | undefined,
  method: string,
  after: (document: AnyObject) => void,
): void {
  const prototype = documentClass?.["prototype"] as AnyObject | undefined;
  const original = prototype?.[method];
  if (typeof original !== "function") {
    console.warn(`${LOG_PREFIX} Reach: no ${method} to patch — ranges won't be adjusted.`);
    return;
  }

  prototype![method] = function (this: AnyObject, ...args: unknown[]): unknown {
    const result = original.apply(this, args);
    try {
      after(this);
    } catch (error) {
      console.warn(`${LOG_PREFIX} Reach: could not adjust ranges.`, error);
    }
    return result;
  };
}

/** Install the preparation patches. Called once during `init`. */
export function registerReach(): void {
  patchPreparation(CONFIG.Item?.documentClass, "prepareEmbeddedDocuments", (item) => {
    applyToDocument(item, reachActive() && hasReachFeature(item["actor"]));
  });

  patchPreparation(CONFIG.Actor?.documentClass, "prepareData", (actor) => {
    applyToDocument(actor, reachActive() && hasReachFeature(actor));
  });
}
