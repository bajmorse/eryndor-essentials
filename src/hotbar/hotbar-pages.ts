/**
 * Per-actor hotbar pages.
 *
 * The GM assigns actors to hotbar pages; selecting a token on the canvas swaps
 * the hotbar to that actor's page. Selecting anything unassigned — or deselecting
 * everything — falls back to the configured default page.
 *
 * How it works (Foundry v14):
 *   - `controlToken` fires on select *and* deselect, on the client doing the
 *     selecting. Rather than reason about which event we got, we debounce and then
 *     read `canvas.tokens.controlled` — clicking token B while A is selected fires
 *     release(A) then control(B), and without the debounce the bar would flip to
 *     the default page and back again in one frame.
 *   - `canvas.tokens.controlled` is insertion-ordered (a Map's values), so the
 *     last entry is the most recently selected token. We walk it backwards so the
 *     token you just clicked wins when several are selected.
 *   - The actor is read from `token.document.actorId`, which is always the *base*
 *     Actor's id — unlinked tokens carry an ActorDelta whose synthetic actor has a
 *     different id, so `token.actor.id` would not match what the config window saved.
 *   - Foundry's hotbar has exactly 5 pages: `Hotbar#changePage` throws outside
 *     1–5, hence {@link MAX_PAGE}.
 *
 * The assignments live in one world-scoped object setting rather than a setting
 * per actor, because the list is edited as a whole in `HotbarPagesConfig`.
 */
import { MODULE_ID, SETTINGS } from "../constants.js";

/** Lowest hotbar page number Foundry accepts. */
export const MIN_PAGE = 1;
/** Highest hotbar page number Foundry accepts (`Hotbar#changePage` throws above this). */
export const MAX_PAGE = 5;
/** Sentinel for "no page" — used by the default to mean "leave the hotbar alone". */
export const NO_PAGE = 0;

/** The shape stored in `SETTINGS.hotbarPages`. */
export interface HotbarPagesConfigData {
  /** Page to show when nothing assigned is selected. {@link NO_PAGE} = leave as-is. */
  defaultPage: number;
  /** Whether non-GM clients also swap pages. Off by default: a player's hotbar is their own. */
  applyToPlayers: boolean;
  /** Actor id → hotbar page. Keyed by *base* actor id (see `TokenDocument#actorId`). */
  pages: Record<string, number>;
}

/** The setting's default value, also used as the fallback when stored data is junk. */
export const DEFAULT_CONFIG: HotbarPagesConfigData = {
  defaultPage: NO_PAGE,
  applyToPlayers: false,
  pages: {},
};

/** `[1, 2, 3, 4, 5]` — the pages a user can pick from. */
export function pageNumbers(): number[] {
  return Array.from({ length: MAX_PAGE - MIN_PAGE + 1 }, (_, i) => MIN_PAGE + i);
}

/** Whether `value` is a page number Foundry's hotbar will accept. */
export function isPage(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= MIN_PAGE && (value as number) <= MAX_PAGE;
}

/** The master on/off switch (world-scoped; only the GM can change it). */
export function featureEnabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.hotbarPageSwap) === true;
}

/**
 * Read the stored assignments, discarding anything that no longer makes sense
 * (a page number out of range, a non-object payload) so a hand-edited or
 * downgraded setting can't break selection.
 */
export function getConfig(): HotbarPagesConfigData {
  const raw = game.settings.get(MODULE_ID, SETTINGS.hotbarPages);
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CONFIG, pages: {} };
  const stored = raw as Partial<HotbarPagesConfigData>;

  const pages: Record<string, number> = {};
  if (stored.pages && typeof stored.pages === "object") {
    for (const [actorId, page] of Object.entries(stored.pages)) {
      const n = Number(page);
      if (actorId && isPage(n)) pages[actorId] = n;
    }
  }

  const defaultPage = Number(stored.defaultPage);
  return {
    defaultPage: isPage(defaultPage) ? defaultPage : NO_PAGE,
    applyToPlayers: stored.applyToPlayers === true,
    pages,
  };
}

/** Persist the assignments. World-scoped, so this only succeeds for a GM. */
export async function saveConfig(config: HotbarPagesConfigData): Promise<void> {
  await game.settings.set(MODULE_ID, SETTINGS.hotbarPages, config);
}

/**
 * Which page the current selection calls for, or `null` to leave the hotbar
 * where it is (feature off, this client opted out, or no assignment and no default).
 */
function resolvePage(): number | null {
  if (!featureEnabled()) return null;
  const config = getConfig();
  if (!game.user?.isGM && !config.applyToPlayers) return null;

  // Most recently selected token wins — `controlled` is insertion-ordered.
  const controlled = canvas.tokens?.controlled ?? [];
  for (let i = controlled.length - 1; i >= 0; i--) {
    const actorId = controlled[i]?.document?.actorId;
    if (!actorId) continue;
    const page = config.pages[actorId];
    if (isPage(page)) return page;
  }

  return config.defaultPage === NO_PAGE ? null : config.defaultPage;
}

/** Swap the hotbar if the current selection asks for a different page. */
function applyPage(): void {
  const page = resolvePage();
  if (page === null) return;
  const hotbar = ui.hotbar;
  // `changePage` re-renders unconditionally, so skip the no-op case.
  if (!hotbar || hotbar.page === page) return;
  void hotbar.changePage(page);
}

/**
 * Coalesce the release+control pair a single click produces into one page change.
 * A zero delay is enough: both hooks fire synchronously within the same task.
 *
 * Built during `init` rather than at import time so evaluating this module never
 * depends on the `foundry` global already existing.
 */
let scheduleApply: () => void = applyPage;

/**
 * Install the feature's hooks. Called once during `init`.
 */
export function registerHotbarPages(): void {
  scheduleApply = foundry.utils.debounce(applyPage, 0) as () => void;

  // Selecting or deselecting a token re-evaluates which page should be showing.
  Hooks.on("controlToken", () => scheduleApply());

  // Changing scenes clears the selection, which should drop us back to the
  // default page rather than leaving the previous scene's page up.
  Hooks.on("canvasReady", () => scheduleApply());
}

/** Re-evaluate after the GM edits the assignments (fired from the setting's `onChange`). */
export function refreshHotbarPage(): void {
  scheduleApply();
}
