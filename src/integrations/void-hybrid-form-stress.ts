/**
 * Ends Hybrid Form automatically when an Order of the Lycan character's Stress
 * fills up, for **The Void (Unofficial)**.
 *
 * The Void's own "Beast Within" mechanic (`onPreUpdateActor` in its
 * `hybrid-form.js`) marks Stress whenever the character gains Hope while
 * transformed — correct, and left entirely alone here. What it does not do is
 * revert the form once Stress has nowhere left to go: the character is left
 * transformed and full of Stress. This closes exactly that gap and nothing else —
 * any update that leaves an Order of the Lycan character's Stress at its max while
 * transformed reverts them to human form, the same way clicking the sheet's wolf
 * button would.
 *
 * ## Why this reaches into Void's internal module
 *
 * `window.Void` only exposes `HybridForm()` — the macro entry point, which
 * resolves "the acting user's own selected token or assigned character"
 * (`resolveCharacterActor()`) and cannot be pointed at an arbitrary actor, which is
 * exactly what a hook reacting to *any* actor's Stress needs. Reverting the form is
 * also more than flipping the gameplay Active Effect off: Void's
 * `_applyHybridFormAppearance` swaps the token's art/scale back and removes its
 * Hybrid Form light effect, using flags private to its own module
 * (`HYBRID_FORM_TOKEN_SNAPSHOT_FLAG`, `HYBRID_FORM_APPEARANCE_FLAG`). Disabling the
 * gameplay effect ourselves — the way the read-only portrait sync's fallback
 * detects the form — would leave the token looking like a wolf forever. So this
 * dynamically imports Void's own `scripts/hybrid-form.js` for its exported
 * `toggleHybridForm(actor)`, the exact function the wolf button calls, rather than
 * reimplementing its revert.
 *
 * **Verified against v1.2.9.** If this stops working after a Void update, re-read
 * `scripts/hybrid-form.js` for whether `toggleHybridForm` moved, was renamed, or
 * changed signature.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import { escapeHtml } from "../utils/escape-html.js";
import { isInHybridForm, isLycan, isWriter, VOID, voidActive } from "./void-shared.js";

interface VoidHybridFormModule {
  toggleHybridForm(actor: AnyObject): Promise<void>;
}

function featureEnabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.voidHybridFormStressRevert) === true;
}

/** Void's internal Hybrid Form module, imported once on first use and cached. */
let modulePromise: Promise<VoidHybridFormModule> | null = null;

function loadVoidHybridFormModule(): Promise<VoidHybridFormModule> {
  modulePromise ??= import(
    /* @vite-ignore */ foundry.utils.getRoute(`modules/${VOID.moduleId}/scripts/hybrid-form.js`)
  ) as Promise<VoidHybridFormModule>;
  return modulePromise;
}

function stressIsFull(actor: AnyObject): boolean {
  const stress = actor["system"]?.resources?.stress;
  return (
    typeof stress?.value === "number" &&
    typeof stress?.max === "number" &&
    stress.value >= stress.max
  );
}

/**
 * Actors currently being reverted, so a burst of Stress-full updates can't call
 * `toggleHybridForm` twice on the same actor before the first call's effect
 * update lands and `isInHybridForm` starts reporting false.
 */
const inFlight = new Set<string>();

async function endHybridForm(actor: AnyObject): Promise<void> {
  const actorId = String(actor["id"] ?? "");
  if (inFlight.has(actorId)) return;
  inFlight.add(actorId);

  try {
    const voidModule = await loadVoidHybridFormModule();
    if (typeof voidModule.toggleHybridForm !== "function") {
      console.error(
        `${LOG_PREFIX} The Void's hybrid-form.js no longer exports "toggleHybridForm" — ` +
          `"${actor["name"]}" was left in Hybrid Form despite full Stress. The Void may have updated; see void-hybrid-form-stress.ts.`,
      );
      return;
    }

    // Re-check: something else (a manual click, another update) may have already
    // reverted the form while the module import above was in flight.
    if (!isInHybridForm(actor)) return;

    await voidModule.toggleHybridForm(actor);
    console.debug(`${LOG_PREFIX} "${actor["name"]}" reverted from Hybrid Form: Stress is full.`);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><em>Stress fills the last of ${escapeHtml(actor["name"])}'s reserve — the Beast Within can no longer be held, and Hybrid Form ends.</em></p>`,
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} Could not revert "${actor["name"]}" from Hybrid Form.`, error);
  } finally {
    inFlight.delete(actorId);
  }
}

/** Install the integration's hook. Called once during `init`; no-op without The Void. */
export function registerVoidHybridFormStressEnd(): void {
  if (!voidActive()) return;

  Hooks.on("updateActor", (actor: AnyObject) => {
    if (!isWriter() || !featureEnabled()) return;
    if (actor["type"] !== "character" || !isLycan(actor)) return;
    if (!stressIsFull(actor) || !isInHybridForm(actor)) return;
    void endHybridForm(actor);
  });
}
