/**
 * The **Tokens on Scene** bar — a floating list of the tokens a player owns on
 * the current scene, and the lock that stops their selection from emptying.
 *
 * Why it exists: at this table every token is invisible to players (see
 * `invisible-tokens.ts`), so a player cannot find their own token to click. They
 * *can* still deselect it — a click on bare ground, Escape, or picking a
 * non-interaction tool all release everything — and with nothing selected
 * `daggerheart-hud` falls back to `getPlayerCharacter()`, which is
 * `game.actors.filter(owner).find(type === "character")[0]`: the **first owned
 * character**, not `game.user.character`. A player who owns more than one sheet
 * therefore gets somebody else's HUD, with no visible token to click their way
 * back to. Hence two halves, both needed:
 *
 *   - the **lock** keeps the selection non-empty, so the fallback never runs;
 *   - the **bar** is the way back when something releases the selection anyway
 *     (the lock cannot re-control while a ruler is up — `Token#_canControl`
 *     refuses — and a token can be deleted out from under it).
 *
 * Players only. The GM can see and click every token already, and Foundry's
 * `canvas.tokens.ownedTokens` would hand them the whole scene.
 *
 * How it works (Foundry v14):
 *   - `canvas.tokens.ownedTokens` is Foundry's own
 *     `placeables.filter(t => t.actor && t.actor.isOwner)` — the exact list, so
 *     we don't re-derive ownership and get a different answer.
 *   - `controlToken` fires on select *and* deselect. As in `hotbar-pages.ts` we
 *     debounce and then read `canvas.tokens.controlled` rather than reason about
 *     which event we got: clicking token B while A is selected fires release(A)
 *     then control(B), and acting on the release alone would fight the click.
 *   - Re-controlling fires `controlToken` again, which re-enters the debounced
 *     pass — but by then the selection is non-empty, so it settles in one extra
 *     turn. A *failed* re-control fires no hook at all, so there is no loop
 *     either way.
 *   - `control({force: true})` skips `Token#isInteractable`, which is false
 *     whenever the active tool isn't an interaction tool. It does not bypass
 *     permissions: `_canControl` still runs, and still refuses while a ruler is
 *     measuring.
 *
 * Plain DOM rather than an ApplicationV2 window, following
 * `../../daggerheart-spotlight-tracker/src/ui/spotlight-bar.ts`: it is furniture
 * that floats over the canvas, and a framed window would come with a header,
 * close button and controls that all mean the wrong thing here.
 */
import { MODULE_ID, SETTINGS, TEMPLATES } from "../constants.js";

const BAR_ID = `${MODULE_ID}-token-bar`;

/** Keep the bar this far from the edges of the window, and from the sidebar. */
const MARGIN = 12;

/**
 * Extra gap between the bar's default spot and the left edge of the sidebar.
 *
 * Purely taste: hard against the sidebar the bar reads as part of it. This is
 * only ever the *opening* position — the moment a player drags the bar their own
 * `tokenBarPosition` wins and this stops applying to them.
 */
const DEFAULT_SIDEBAR_GAP = 120;

/**
 * How long after `canvasReady` to make the opening selection.
 *
 * This is deliberately later than it needs to be. `daggerheart-hud` hooks
 * `canvasReady` too and calls its own `createOrUpdateHUD()` on a **500 ms**
 * timer, unconditionally — it never checks whether a token is selected — so
 * selecting sooner than that would be silently overwritten by the very fallback
 * this feature exists to avoid. Selecting after it means our `controlToken`
 * lands last and the HUD shows the token the player is actually driving.
 *
 * Nothing breaks if that module is absent or changes its timing; the only cost
 * is that the opening selection is a beat late.
 */
const CANVAS_SETTLE_MS = 750;

/** The master on/off switch (world-scoped; only the GM can change it). */
function featureEnabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.tokenBar) === true;
}

/** Whether the selection lock is on. Meaningless without the bar, so gated on it. */
function lockEnabled(): boolean {
  return featureEnabled() && game.settings.get(MODULE_ID, SETTINGS.tokenBarLockSelection) === true;
}

/** Players only — see the header. */
function appliesToMe(): boolean {
  return featureEnabled() && game.user?.isGM !== true;
}

/* -------------------------------------------------------------------------- */
/*  Which tokens                                                              */
/* -------------------------------------------------------------------------- */

/** The id of this user's assigned character, if they have one. */
function assignedActorId(): string | null {
  const character = game.user?.["character"] as AnyObject | null | undefined;
  return (character?.["id"] as string | undefined) ?? null;
}

/**
 * Every token on this scene the user owns, assigned character first and the rest
 * by name — so the row a player wants is the one nearest the top, and the order
 * doesn't shuffle when a companion is added.
 *
 * Compares against `document.actorId`, the *base* actor id: `token.actor.id`
 * differs for an unlinked token, whose actor is a synthetic ActorDelta (the same
 * trap documented in `hotbar-pages.ts`).
 */
function ownedTokens(): Token[] {
  const tokens = [...(canvas.tokens?.ownedTokens ?? [])];
  const assigned = assignedActorId();
  return tokens.sort((a, b) => {
    const aAssigned = assigned !== null && a.document.actorId === assigned;
    const bAssigned = assigned !== null && b.document.actorId === assigned;
    if (aAssigned !== bAssigned) return aAssigned ? -1 : 1;
    return displayName(a).localeCompare(displayName(b));
  });
}

/**
 * What to call a token. The **actor's** name, because a player character's token
 * is routinely left on a generic prototype name like "Character" — the same rule
 * `spotlight-bar.ts` follows, and for the same reason.
 */
function displayName(token: Token): string {
  return (token.actor?.["name"] as string | undefined) ?? token.document.name ?? "";
}

/**
 * The token to fall back to when there's no better answer: the assigned
 * character's, else the first owned one. Null when the player owns nothing here.
 */
function preferredToken(): Token | null {
  const tokens = ownedTokens();
  const assigned = assignedActorId();
  if (assigned !== null) {
    const own = tokens.find((token) => token.document.actorId === assigned);
    if (own) return own;
  }
  return tokens[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Selecting                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The last token this client had selected, so the lock can put back exactly what
 * was released rather than always snapping to the assigned character — a player
 * who deliberately switched to their companion should stay on it.
 *
 * Cleared on `canvasReady`: token ids are scene-bound, and a stale one would
 * either miss or (worse) match a different token on the new scene.
 */
let lastControlledId: string | null = null;

/** Select one token, releasing the rest. Returns whether Foundry allowed it. */
function selectToken(token: Token): boolean {
  return token.control({ releaseOthers: true, force: true });
}

/**
 * Put the selection back after it emptied. No-op unless the lock is on, and
 * silent when Foundry refuses — a ruler being up is a legitimate reason to have
 * nothing selected, and the next pass (or the bar) picks it up again.
 */
function restoreSelection(): void {
  if (!lockEnabled() || !appliesToMe()) return;

  const remembered = lastControlledId ? (canvas.tokens?.get(lastControlledId) ?? null) : null;
  // The remembered token can have been deleted, or had its ownership taken away,
  // since it was selected — `ownedTokens` is the check for both.
  const owned = ownedTokens();
  const token = (remembered && owned.includes(remembered) ? remembered : null) ?? preferredToken();
  if (!token) return;

  selectToken(token);
}

/**
 * One pass over the selection, run after it has settled: remember what's
 * selected, or put something back if nothing is.
 */
function onSelectionSettled(): void {
  if (!canvas.ready) return;

  const controlled = canvas.tokens?.controlled ?? [];
  if (controlled.length > 0) {
    // Insertion-ordered, so the last entry is the most recently selected.
    lastControlledId = controlled[controlled.length - 1]?.id ?? lastControlledId;
  } else {
    restoreSelection();
  }

  void renderBar();
}

/**
 * Coalesce the release+control pair one click produces into a single pass, the
 * same way `hotbar-pages.ts` does. Built during `init` so evaluating this module
 * never depends on the `foundry` global already existing.
 */
let scheduleSelectionPass: () => void = onSelectionSettled;

/* -------------------------------------------------------------------------- */
/*  Position                                                                  */
/* -------------------------------------------------------------------------- */

/** Where this client has dragged the bar, in viewport pixels. */
interface BarPosition {
  left: number;
  top: number;
}

/** Read the saved position, ignoring anything that isn't a usable pair of numbers. */
function readPosition(): BarPosition | null {
  const raw = game.settings.get(MODULE_ID, SETTINGS.tokenBarPosition);
  if (!raw || typeof raw !== "object") return null;
  const { left, top } = raw as Partial<BarPosition>;
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { left: left as number, top: top as number };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Pull the bar back inside the viewport from wherever it currently is, so a bar
 * dragged to the corner of a large monitor is still reachable on a small one.
 */
function clampIntoView(root: HTMLElement): void {
  const maxLeft = Math.max(MARGIN, window.innerWidth - (root.offsetWidth || 200) - MARGIN);
  const maxTop = Math.max(MARGIN, window.innerHeight - (root.offsetHeight || 80) - MARGIN);
  root.style.left = `${clamp(root.offsetLeft, MARGIN, maxLeft)}px`;
  root.style.top = `${clamp(root.offsetTop, MARGIN, maxTop)}px`;
}

/**
 * Put the bar where the user dragged it, or bottom-right of the canvas area the
 * first time.
 *
 * The sidebar's width is *measured* rather than assumed — core's 300px isn't a
 * constant a UI module (crlngn-ui is installed here) will necessarily respect.
 */
function place(root: HTMLElement): void {
  const saved = readPosition();
  if (saved) {
    root.style.left = `${saved.left}px`;
    root.style.top = `${saved.top}px`;
  } else {
    const sidebarWidth = document.getElementById("sidebar")?.offsetWidth ?? 0;
    const width = root.offsetWidth || 200;
    const height = root.offsetHeight || 80;
    root.style.left = `${window.innerWidth - width - sidebarWidth - DEFAULT_SIDEBAR_GAP}px`;
    root.style.top = `${window.innerHeight - height - MARGIN}px`;
  }
  clampIntoView(root);
}

/** Persist wherever the drag left it. Client-scoped, so a player may write it. */
function savePosition(root: HTMLElement): void {
  void game.settings.set(MODULE_ID, SETTINGS.tokenBarPosition, {
    left: root.offsetLeft,
    top: root.offsetTop,
  });
}

/* -------------------------------------------------------------------------- */
/*  The element                                                               */
/* -------------------------------------------------------------------------- */

async function buildContext(): Promise<AnyObject> {
  const tokens = ownedTokens();
  return {
    title: game.i18n.localize("EE.TokenBar.Title"),
    dragTooltip: game.i18n.localize("EE.TokenBar.DragTooltip"),
    tokens: tokens.map((token) => ({
      id: token.id,
      name: displayName(token),
      // The actor portrait, not the token art: the token is the thing the player
      // can't see, and the portrait is what they know the character by.
      img:
        (token.actor?.["img"] as string | undefined) ||
        token.document.texture?.src ||
        "icons/svg/mystery-man.svg",
      controlled: token.controlled === true,
    })),
  };
}

/**
 * Bind the listeners that outlive a re-render. One delegated `click` for the
 * rows and one delegated `pointerdown` for the drag handle, both on the root,
 * whose contents are replaced wholesale on every render (and following the
 * delegated-dispatch pattern the rest of this module uses — see CLAUDE.md).
 */
function bind(root: HTMLElement): void {
  if (root.dataset["eeBound"]) return;
  root.dataset["eeBound"] = "1";

  root.addEventListener("click", (event: Event) => {
    const row = (event.target as HTMLElement | null)?.closest?.(
      "[data-ee-token]",
    ) as HTMLElement | null;
    if (!row || !root.contains(row)) return;

    const token = canvas.tokens?.get(row.dataset["eeToken"] ?? "");
    if (!token) return;
    if (!selectToken(token)) {
      // Almost always a ruler or a non-interaction tool holding the layer. Worth
      // saying out loud: from the player's side the click simply did nothing.
      ui.notifications?.warn(game.i18n.localize("EE.TokenBar.SelectRefused"));
    }
  });

  root.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 0) return;
    const handle = (event.target as HTMLElement | null)?.closest?.(
      "[data-ee-drag]",
    ) as HTMLElement | null;
    if (!handle || !root.contains(handle)) return;

    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = root.offsetLeft;
    const startTop = root.offsetTop;

    // Pointer capture keeps the move/up events coming even when the cursor
    // outruns the bar or crosses the canvas. Captured on the *root*, not the
    // handle: the handle is part of the innerHTML a re-render replaces, and a
    // capture held by a discarded element would strand the drag half-done.
    root.setPointerCapture(event.pointerId);

    const onMove = (move: PointerEvent): void => {
      root.style.left = `${startLeft + move.clientX - startX}px`;
      root.style.top = `${startTop + move.clientY - startY}px`;
    };

    const onUp = (): void => {
      root.releasePointerCapture(event.pointerId);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      // Clamp before saving, so what's stored is somewhere the bar can actually
      // be — otherwise an off-screen drop would be re-clamped on every load.
      clampIntoView(root);
      savePosition(root);
    };

    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerup", onUp);
    root.addEventListener("pointercancel", onUp);
  });
}

/** Rebuild the bar in place, creating and positioning it the first time. */
export async function renderBar(): Promise<void> {
  const existing = document.getElementById(BAR_ID);

  // Nothing to offer is the same as the feature being off: a player who owns no
  // token on this scene has nothing to select, and an empty strip is just noise.
  if (!appliesToMe() || !canvas.ready || ownedTokens().length === 0) {
    existing?.remove();
    return;
  }

  const html = await foundry.applications.handlebars.renderTemplate(
    TEMPLATES.tokenBar,
    await buildContext(),
  );

  let root = existing;
  const isNew = !root;
  if (!root) {
    root = document.createElement("aside");
    root.id = BAR_ID;
    root.classList.add(MODULE_ID, "ee-token-bar");
    // The body, deliberately, rather than Foundry's `#interface`. The bar is
    // `position: fixed`, and a `transform`/`filter` on any ancestor would
    // silently re-base that on the ancestor instead of the viewport — which a UI
    // module is entitled to add (crlngn-ui, installed here, restyles this chrome
    // heavily). At the body there is no ancestor to be surprised by, and the
    // z-index below still places it in core's own UI layer.
    document.body.append(root);
  }

  root.innerHTML = html;
  bind(root);
  // Only on creation: re-placing on every render would yank the bar back from
  // wherever a drag-in-progress has it, and the drag saves its own position.
  if (isNew) place(root);
}

/* -------------------------------------------------------------------------- */
/*  Wiring                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Install the feature's hooks. Called once during `init`.
 */
export function registerTokenBar(): void {
  scheduleSelectionPass = foundry.utils.debounce(onSelectionSettled, 0) as () => void;

  // Selecting or deselecting: re-evaluate the lock and repaint the highlight.
  Hooks.on("controlToken", () => scheduleSelectionPass());

  // A new scene is a new set of tokens and a new set of ids. Draw the bar at
  // once, but leave the opening selection until the canvas (and daggerheart-hud)
  // have settled — see CANVAS_SETTLE_MS.
  Hooks.on("canvasReady", () => {
    lastControlledId = null;
    void renderBar();
    window.setTimeout(() => scheduleSelectionPass(), CANVAS_SETTLE_MS);
  });

  // The roster follows tokens being placed, removed, renamed or re-actored.
  Hooks.on("createToken", () => scheduleSelectionPass());
  Hooks.on("deleteToken", () => scheduleSelectionPass());
  Hooks.on("updateToken", (_doc: TokenDocument, changes: AnyObject) => {
    // Ignore movement: updateToken fires continuously while a token is dragged.
    if (!("name" in changes) && !("actorId" in changes) && !("texture" in changes)) return;
    void renderBar();
  });

  Hooks.on("updateActor", (_actor: AnyObject, changes: AnyObject) => {
    // Ownership granted or revoked can empty the roster (or fill it), so that
    // one goes through the full pass; a rename or a new portrait only changes
    // what the rows say.
    if ("ownership" in changes) scheduleSelectionPass();
    else if ("name" in changes || "img" in changes) void renderBar();
  });

  // Switching to a non-interaction tool releases every token
  // (`TokenLayer#_onActivate`), and `_canControl` refuses to re-control while a
  // ruler is up — so the lock gets another chance when the tools change back.
  Hooks.on("renderSceneControls", () => scheduleSelectionPass());

  // The bar is positioned in viewport pixels, so a resized window can strand it.
  // Clamp rather than re-place: the player put it where they wanted it, and the
  // nearest reachable spot is less surprising than snapping back to the default.
  window.addEventListener("resize", () => {
    const root = document.getElementById(BAR_ID);
    if (root) clampIntoView(root);
  });
}

/** Re-draw and re-evaluate after the GM flips one of the switches. */
export function refreshTokenBar(): void {
  void renderBar();
  scheduleSelectionPass();
}
