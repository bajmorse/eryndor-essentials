/**
 * Keep a raised portrait in sync with the actor's artwork.
 *
 * **Ginzzzu's Portraits & NPC Dock** (`ginzzzu-portraits`) shows a large portrait
 * for an actor, resolving the image through its own precedence rules — an active
 * emotion's image, then a configured custom portrait image, then the "base" image,
 * which by default is `actor.img` (its `actorImagePaths` setting defaults to
 * `"img, system.image, system.img, system.details.biography.portrait"`).
 *
 * It live-swaps that image from an `updateActor` hook, but only when one of six
 * of its own flags is in the diff — emotion, custom emotions, both height
 * multipliers, custom image, breathing multiplier. **`img` is not among them.**
 * So changing `actor.img` while a portrait is raised updates nothing, no matter
 * what did the changing. That's an upstream gap; this closes it.
 *
 * It matters here because the Hybrid Form integration
 * ({@link file://./void-hybrid-form.ts}) changes exactly that field — but nothing
 * about this is specific to Hybrid Form, so it reacts to any `img` change.
 *
 * ## Why this touches their DOM
 *
 * Their public API (`globalThis.GinzzzuPortraits`) has no "refresh this portrait"
 * entry, and the routine that would do it is module-private. The alternative is
 * lowering and re-raising the portrait, which works — their raise path re-resolves
 * the image — but costs two replicated flag writes and flickers. Writing the one
 * `<img>` element is instant, needs no round-trip, and no-ops harmlessly if their
 * markup ever changes.
 *
 * Portraits are **local DOM**: each client opens its own from the replicated
 * `portraitShown` flag. So this runs on *every* client, not just the GM — unlike
 * the actor write in the Hybrid Form integration, which must have a single author.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";

/* -------------------------------------------------------------------------- */
/*  Ginzzzu's Portraits & NPC Dock — borrowed internals. Verified against 2.1.1. */
/*                                                                             */
/*  The flag paths are public-ish (documented by behaviour); the markup is not. */
/*  If portraits stop refreshing after an update, re-read its                   */
/*  `scripts/features/portraits.js` and fix these HERE.                         */
/* -------------------------------------------------------------------------- */
const PORTRAITS = {
  /** Its module id, as registered with Foundry. */
  moduleId: "ginzzzu-portraits",
  /** Container it appends every raised portrait to. */
  layerId: "ginzzzu-portrait-layer",
  /** One raised portrait; carries `data-actor-id`. */
  wrapperClass: "ginzzzu-portrait-wrapper",
  /** The `<img>` inside that wrapper. */
  imageClass: "ginzzzu-portrait",
  /**
   * Flags that make `actor.img` *not* what the portrait is showing. When either
   * is set we leave the portrait alone rather than second-guessing their
   * precedence rules.
   */
  customImageFlag: "flags.ginzzzu-portraits.portraitCustomImage",
  emotionFlag: "flags.ginzzzu-portraits.portraitEmotion",
} as const;

/** Whether Ginzzzu's Portraits is installed and enabled in this world. */
function portraitsActive(): boolean {
  return game.modules.get(PORTRAITS.moduleId)?.active === true;
}

function featureEnabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.refreshRaisedPortraits) === true;
}

/** Absolute form of a possibly-relative path, for comparing against `img.src`. */
function resolveUrl(src: string): string {
  try {
    return new URL(src, document.baseURI).href;
  } catch {
    return src;
  }
}

/**
 * Point this actor's raised portrait at `image`, if it is showing the base art.
 *
 * Silently does nothing when the portrait isn't raised on this client, which is
 * the common case — the check is a single `querySelector`.
 */
function refreshRaisedPortrait(actor: AnyObject, image: string): void {
  if (!featureEnabled()) return;

  // Their precedence, not ours: with an emotion or a custom portrait image set,
  // the portrait is *correctly* showing something other than `actor.img`.
  if (foundry.utils.getProperty(actor, PORTRAITS.customImageFlag)) return;
  if (foundry.utils.getProperty(actor, PORTRAITS.emotionFlag)) return;

  const actorId = String(actor["id"] ?? "");
  if (!actorId) return;

  const layer = document.getElementById(PORTRAITS.layerId);
  const wrapper = layer?.querySelector<HTMLElement>(
    `.${PORTRAITS.wrapperClass}[data-actor-id="${CSS.escape(actorId)}"]`,
  );
  const img = wrapper?.querySelector<HTMLImageElement>(`img.${PORTRAITS.imageClass}`);
  if (!wrapper || !img) return;

  const next = resolveUrl(image);
  if (img.src === next) return;

  // They keep the raw (unresolved) path on both datasets and compare against it
  // when deciding whether a later change is a no-op — so all three move together.
  img.src = next;
  img.dataset["src"] = image;
  wrapper.dataset["src"] = image;
}

/** Install the hook. Called once during `init`; no-op without Ginzzzu's Portraits. */
export function registerGinzzzuPortraits(): void {
  if (!portraitsActive()) return;

  Hooks.on("updateActor", (actor: AnyObject, changed: AnyObject) => {
    const image = changed?.["img"];
    if (typeof image !== "string" || !image) return;
    try {
      refreshRaisedPortrait(actor, image);
    } catch (error) {
      // Cosmetic: never throw into another module's hook chain.
      console.warn(`${LOG_PREFIX} Could not refresh the raised portrait.`, error);
    }
  });
}
