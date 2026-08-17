/**
 * Range surveys, via **Maiyalis: Target Helper** (`daggerheart-target-helper`).
 *
 * That module's targeting picker already knows how to list everything on the
 * scene with its distance from a given token, colour-coded by range band. It
 * publishes a read-only version of that window on its API, and this is the one
 * place here that calls it — so the **Tokens on Scene** bar can offer a "how far
 * is everything from this token" button without knowing anything about how the
 * window is built.
 *
 * *Optional*, like every other integration in this folder: with that module
 * absent or disabled, {@link surveysAvailable} is false, the bar renders no
 * button, and nothing else changes.
 */
import { LOG_PREFIX } from "../constants.js";

/** The Target Helper's module id. */
const TARGET_HELPER_ID = "daggerheart-target-helper";

/** The slice of its API this file uses. Its `src/api.ts` is the contract. */
interface TargetHelperApi {
  /** Opens the read-only survey for a token; false if it isn't on this scene. */
  openRangeSurvey(source: Token | string): boolean;
}

/** Its API, or null when the module isn't active (or is too old to publish one). */
function targetHelperApi(): TargetHelperApi | null {
  const module = game.modules.get(TARGET_HELPER_ID);
  if (module?.active !== true) return null;

  const api = module["api"] as Partial<TargetHelperApi> | undefined;
  return typeof api?.openRangeSurvey === "function" ? (api as TargetHelperApi) : null;
}

/**
 * Whether a survey can be opened at all. The bar asks before drawing the button:
 * a control that is present but does nothing is worse than no control.
 */
export function surveysAvailable(): boolean {
  return targetHelperApi() !== null;
}

/**
 * Open the survey for one token. Silent no-op when the module is gone — which is
 * reachable even after {@link surveysAvailable} said yes, since a GM can disable
 * a module in another tab.
 */
export function openRangeSurvey(tokenId: string): void {
  const api = targetHelperApi();
  if (!api) return;

  try {
    api.openRangeSurvey(tokenId);
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not open the range survey.`, error);
  }
}
