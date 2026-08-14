/**
 * Hybrid Form portrait sync for **The Void (Unofficial)**.
 *
 * The Void transforms an Order of the Lycan character's placed tokens, but never
 * `actor.img` or `actor.prototypeToken` — so the tokens change and the character
 * sheet portrait stays human. This closes exactly that gap and nothing else.
 *
 * **Scope: the portrait only.** Token artwork is The Void's job and we do not
 * touch it, snapshot it, or revert it. If a token is left transformed, that is
 * between The Void and whatever toggled the form.
 *
 * ## What triggers it
 *
 * Any ActiveEffect appearing, changing, or disappearing on an Order of the Lycan
 * character, after which we ask The Void's own exported `isInHybridForm(actor)`
 * whether that actor is now transformed, and make the portrait agree.
 *
 * Asking rather than deciding for ourselves is the point. Earlier versions keyed
 * off The Void's private `hybridFormAppearance` flag (which only its sheet button
 * ever creates, so the ability and the status bar did nothing) and then off the
 * effect *names* (which are content in your world and may not match). Both were
 * guesses about state The Void already answers authoritatively — see
 * `void-shared.ts` for how `isOrderOfTheLycan`/`isInHybridForm` are resolved
 * (today, that's still a name scan; `window.Void` doesn't expose either yet).
 *
 * A short debounce lets a burst of effect changes settle into one decision, and
 * gives The Void time to finish applying token textures — which is where we would
 * rather read the artwork from.
 */
import { FLAGS, LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { actorOfEffect } from "../utils/actor-of-effect.js";
import {
  findFormEffects,
  isInHybridForm,
  isLycan,
  isWriter,
  voidActive,
  voidApi,
  VOID,
} from "./void-shared.js";

/**
 * The Void's **token** artwork, authored by hand in the Hybrid Form item's
 * description as `Set Token Image with {{{path/to/image.webp}}}`. Used only as a
 * fallback: token art and portrait art are frequently different files, and where
 * they are the same file this resolves to the *untransformed* portrait — which is
 * exactly the bug that made the sync silently do nothing. Verified against v1.2.9.
 */
const TOKEN_IMAGE_MARKER = /Set Token Image with\s*\{\{\{(.+?)\}\}\}/i;

/**
 * Our own marker, for the portrait specifically. Written in the Hybrid Form
 * item's description alongside The Void's, in the same style so there's only one
 * convention to remember:
 *
 * ```
 * Set Token Image with {{{uploads/tokens/zella-hybrid.png}}}
 * Set Portrait Image with {{{uploads/portraits/zella-hybrid.png}}}
 * ```
 *
 * Takes precedence over everything else. No `g` flag, so `exec` keeps no
 * `lastIndex` state between calls.
 */
const PORTRAIT_MARKER = /Set Portrait Image with\s*\{\{\{(.+?)\}\}\}/i;

/**
 * Wait this long after an effect changes before deciding anything.
 *
 * Entering the form flips several effects at once, which should collapse into one
 * sync. It also gives The Void time to apply the token textures it swaps *after*
 * enabling the effects, so the artwork is readable off a token by the time we look.
 */
const SETTLE_MS = 400;

/** What the actor looked like before the transformation. Stored on the actor. */
interface PortraitSnapshot {
  img: string;
  proto: string;
}

/* -------------------------------------------------------------------------- */
/*  Gates                                                                      */
/* -------------------------------------------------------------------------- */

function featureEnabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.voidHybridFormPortrait) === true;
}

function syncPrototype(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.voidHybridFormPrototype) === true;
}

/* -------------------------------------------------------------------------- */
/*  Reading the form state                                                     */
/* -------------------------------------------------------------------------- */

/** The enabled Hybrid Form effect, if any — the one that says which tier is active. */
function enabledFormEffect(actor: AnyObject): AnyObject | null {
  return findFormEffects(actor).find((effect) => effect["disabled"] !== true) ?? null;
}

/** Pull a marker's path out of one item's description. */
function markerIn(item: AnyObject | null | undefined, marker: RegExp): string | null {
  const description = item?.["system"]?.description;
  if (typeof description !== "string") return null;
  return marker.exec(description)?.[1]?.trim() ?? null;
}

/**
 * The Hybrid Form *portrait* artwork, or `null` if we can't find it.
 *
 * Deliberately never derived from a token. An earlier version read the
 * transformed token's `texture.src`, which is wrong twice over: it depends on
 * whether The Void has applied the texture yet, and where token art and portrait
 * art are the same file it resolves to the untransformed portrait — leaving the
 * sync to apply the image the actor already had, silently.
 */
function resolveImage(actor: AnyObject): string | null {
  const items = [...((actor["items"] ?? []) as Iterable<AnyObject>)];

  // 1. Our own portrait marker, wherever it is authored.
  for (const item of items) {
    const path = markerIn(item, PORTRAIT_MARKER);
    if (path) return path;
  }

  // 2. The Void's token marker, read from the item that owns the *enabled* effect
  //    — the same item it reads itself, rather than whichever item we hit first.
  const owner = enabledFormEffect(actor)?.["parent"];
  if (owner?.documentName === "Item") {
    const path = markerIn(owner, TOKEN_IMAGE_MARKER);
    if (path) return path;
  }

  // 3. Any item's token marker, for a setup where the effect sits on the actor.
  for (const item of items) {
    const path = markerIn(item, TOKEN_IMAGE_MARKER);
    if (path) return path;
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/*  The only two things this module does                                       */
/* -------------------------------------------------------------------------- */

/**
 * Point the portrait at the Hybrid Form artwork, snapshotting what was there.
 *
 * The snapshot goes on the *actor*, never derived by reading a token, so the way
 * back survives with no tokens placed. Re-running while already transformed
 * re-syncs a changed image but leaves the original snapshot alone.
 */
async function applyPortrait(actor: AnyObject, image: string): Promise<void> {
  const update: AnyObject = {};
  const previous = actor["getFlag"](MODULE_ID, FLAGS.hybridFormPortrait) as
    | PortraitSnapshot
    | undefined;

  if (!previous) {
    // Refuse to record the transformed artwork as the way back. Snapshotting it
    // would make the situation permanent, because every future revert would
    // "restore" the very image it is trying to undo.
    if (actor["img"] === image) {
      console.warn(
        `${LOG_PREFIX} "${actor["name"]}" is in Hybrid Form, but the resolved artwork (${image}) ` +
          `is already the portrait and there is nothing saved to restore. Either the ` +
          `"Set Portrait Image with {{{…}}}" marker points at the untransformed art, or an ` +
          `earlier transformation left the portrait behind — set it back to the base art while ` +
          `out of the form.`,
      );
      return;
    }

    update[`flags.${MODULE_ID}.${FLAGS.hybridFormPortrait}`] = {
      img: actor["img"],
      proto: actor["prototypeToken"]?.texture?.src,
    };
  }

  if (actor["img"] !== image) update["img"] = image;
  if (syncPrototype() && actor["prototypeToken"]?.texture?.src !== image) {
    update["prototypeToken.texture.src"] = image;
  }

  if (foundry.utils.isEmpty(update)) return;
  await actor["update"](update);
  // Routine, so `debug` — visible under the console's Verbose level when this
  // needs tracing, and silent during play. Anything actionable is a `warn`.
  console.debug(`${LOG_PREFIX} Hybrid Form portrait applied to "${actor["name"]}".`);
}

/**
 * Put the portrait and prototype token back.
 *
 * Deliberately not gated on the feature setting: switching the feature off while
 * someone is transformed still owes them their artwork back. The flag is cleared
 * with `unsetFlag` after the restore rather than folded into the same update, so
 * this doesn't bet on `-=key` versus `foundry.data.operators.ForcedDeletion`.
 */
async function restorePortrait(actor: AnyObject): Promise<void> {
  const previous = actor["getFlag"](MODULE_ID, FLAGS.hybridFormPortrait) as
    | PortraitSnapshot
    | undefined;
  if (!previous) return;

  const update: AnyObject = {};
  if (typeof previous.img === "string" && actor["img"] !== previous.img) {
    update["img"] = previous.img;
  }
  // Restored whatever the prototype-sync setting now says: turning it off
  // mid-transformation must not strand the prototype token on Hybrid Form art.
  if (
    typeof previous.proto === "string" &&
    actor["prototypeToken"]?.texture?.src !== previous.proto
  ) {
    update["prototypeToken.texture.src"] = previous.proto;
  }

  if (!foundry.utils.isEmpty(update)) await actor["update"](update);
  await actor["unsetFlag"](MODULE_ID, FLAGS.hybridFormPortrait);
  console.debug(`${LOG_PREFIX} Hybrid Form portrait restored on "${actor["name"]}".`);
}

/**
 * Actors with a sync in flight, by id.
 *
 * Two overlapping syncs would both see "no snapshot yet" and both write one, the
 * second recording the artwork the first had just applied — poisoning the way
 * back. Effects arrive in bursts, so this is cheap insurance.
 */
const inFlight = new Set<string>();

/** Make one actor's portrait agree with whether it is currently transformed. */
async function syncActor(actor: AnyObject): Promise<void> {
  if (!isWriter()) return;

  const actorId = String(actor["id"] ?? "");
  if (inFlight.has(actorId)) return;
  inFlight.add(actorId);

  try {
    if (!isInHybridForm(actor)) {
      await restorePortrait(actor);
      return;
    }

    if (!featureEnabled()) return;

    const image = resolveImage(actor);
    if (!image) {
      console.warn(
        `${LOG_PREFIX} "${actor["name"]}" is in Hybrid Form but no portrait artwork could be ` +
          `resolved. Add "Set Portrait Image with {{{path/to/image.png}}}" to the Hybrid Form ` +
          `item's description.`,
      );
      return;
    }

    await applyPortrait(actor, image);
  } finally {
    inFlight.delete(actorId);
  }
}

/* -------------------------------------------------------------------------- */
/*  Scheduling                                                                 */
/* -------------------------------------------------------------------------- */

/** Actors whose effects changed and haven't been reconciled yet. */
const pending = new Set<AnyObject>();

/** Built during `init` so importing this module never needs the `foundry` global. */
let flushPending: () => void = () => {};

function runPending(): void {
  const actors = [...pending];
  pending.clear();
  for (const actor of actors) {
    void syncActor(actor).catch((error: unknown) => {
      // Cosmetic: never throw into another module's hook chain.
      console.error(`${LOG_PREFIX} Hybrid Form portrait sync failed for "${actor["name"]}".`, error);
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Registration                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Re-check every world actor. Run at `ready` and whenever the feature is toggled,
 * so enabling it mid-transformation catches up and disabling it hands the artwork
 * back. Only walks `game.actors` — an unlinked token's synthetic actor isn't in
 * there, and is reconciled by its own effect hooks instead.
 */
export async function reconcileHybridFormPortraits(): Promise<void> {
  if (!voidActive() || !isWriter()) return;

  for (const actor of game.actors?.contents ?? []) {
    const relevant = isLycan(actor) || Boolean(actor["getFlag"]?.(MODULE_ID, FLAGS.hybridFormPortrait));
    if (!relevant) continue;
    try {
      await syncActor(actor);
    } catch (error) {
      console.error(`${LOG_PREFIX} Could not reconcile "${actor["name"]}".`, error);
    }
  }
}

/** Install the integration's hooks. Called once during `init`; no-op without The Void. */
export function registerVoidHybridForm(): void {
  if (!voidActive()) return;

  flushPending = foundry.utils.debounce(runPending, SETTLE_MS) as () => void;

  // Deliberately unfiltered by effect name: whatever changed, we re-ask The Void
  // whether this actor is transformed. `isLycan` keeps the cost off every other
  // actor in the world.
  for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
    Hooks.on(hook, (effect: AnyObject) => {
      const actor = actorOfEffect(effect);
      if (!actor || !isLycan(actor)) return;
      pending.add(actor);
      flushPending();
    });
  }

  Hooks.once("ready", () => {
    // Kept for bug reports: which Void version, and whether we're reading its
    // state through the public API or falling back to matching effect names.
    const version = game.modules.get(VOID.moduleId)?.["version"];
    const api = voidApi() ? "public API" : "effect-name fallback";
    console.debug(
      `${LOG_PREFIX} The Void (Unofficial) v${version} detected — portrait sync via ${api}.`,
    );
    if (!game.users?.activeGM) {
      console.warn(`${LOG_PREFIX} No GM connected — Hybrid Form portraits will not be synced.`);
    }
    void reconcileHybridFormPortraits();
  });
}
