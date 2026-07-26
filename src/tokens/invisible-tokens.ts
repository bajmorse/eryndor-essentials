/**
 * Invisible-to-players tokens.
 *
 * When the GM drops a token onto a scene (and the feature is enabled), the token
 * is flagged so that on *player* clients its art is not rendered — yet the token
 * stays fully interactive: players can still hover, target, and act on it. Only
 * the GM sees the actual token.
 *
 * How the "invisible but interactive" trick works (Foundry v14):
 *   - A token's sprite (`token.mesh`) lives in the primary canvas group, and its
 *     border/nameplate/bars/etc. are children of the token container. We blank all
 *     of those on player clients.
 *   - We deliberately do NOT touch Foundry's `hidden` flag, `token.visible`, or the
 *     container's `hitArea`/interaction. The token placeable stays visible and
 *     interactive to Foundry, so hover, the Target tool, and targeting keys all
 *     keep working — the player just can't see it.
 *   - The target reticle (`targetPips`/`targetArrows`) is blanked too, so targeting
 *     the token (e.g. via the target-helper module) doesn't reveal its position on
 *     a player's screen. Only the *visual* is hidden; the underlying target data
 *     (`game.user.targets`) is untouched, so targeting still works.
 *
 * The per-token FLAGS.invisibleToPlayers flag is the source of truth for which
 * tokens are affected; SETTINGS.hideDmTokens is the GM's master on/off switch.
 */
import { FLAGS, MODULE_ID, SETTINGS } from "../constants.js";

/** The master on/off switch (world-scoped; only the GM can change it). */
function featureEnabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.hideDmTokens) === true;
}

/** Whether a token is flagged invisible-to-players. */
export function isInvisibleToPlayers(doc: TokenDocument): boolean {
  return doc.getFlag(MODULE_ID, FLAGS.invisibleToPlayers) === true;
}

/**
 * Blank a token's art on the local client if it should be hidden from this user.
 * No-op for the GM and when the feature is off. Called from `refreshToken`, i.e.
 * *after* Foundry has recomputed the token's visuals, so the values set here win
 * until the next refresh. When a token is un-flagged (or the feature turned off),
 * this becomes a no-op and Foundry's own refresh restores the art.
 */
function applyPlayerVisibility(token: Token): void {
  if (game.user?.isGM) return;
  if (!featureEnabled()) return;
  if (!isInvisibleToPlayers(token.document)) return;

  // Hide everything that would give the token away — including the target reticle,
  // which otherwise draws around the token when it's targeted. The token container
  // itself is left interactive/targetable; only its visuals are blanked.
  if (token.mesh) token.mesh.visible = false;
  token.border.visible = false;
  token.nameplate.visible = false;
  token.bars.visible = false;
  token.tooltip.visible = false;
  token.effects.visible = false;
  token.targetPips.visible = false;
  token.targetArrows.visible = false;
  if (token.levelIndicator) token.levelIndicator.visible = false;
}

/** Force a token to re-run its visibility/state refresh (and our hook with it). */
function refreshToken(token: Token): void {
  token.renderFlags.set({ refreshState: true });
}

/** GM-only: add a toggle button to the token HUD to hide/reveal from players. */
function onRenderTokenHUD(hud: AnyObject, element: HTMLElement): void {
  if (!game.user?.isGM) return;
  // The per-token control is meaningless while the master switch is off.
  if (!featureEnabled()) return;

  const doc = hud.document as TokenDocument | undefined;
  const column = element.querySelector<HTMLElement>(".col.right");
  if (!doc || !column) return;

  const label = game.i18n.localize("EE.InvisibleTokens.HudToggle");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon ee-invisible-toggle";
  button.classList.toggle("active", isInvisibleToPlayers(doc));
  button.setAttribute("aria-label", label);
  button.setAttribute("data-tooltip", label);
  button.innerHTML = `<i class="fa-solid fa-low-vision"></i>`;

  // Own click listener rather than the ApplicationV2 `actions` map, which has
  // proven unreliable in this build (see CLAUDE.md).
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const next = !isInvisibleToPlayers(doc);
    await doc.setFlag(MODULE_ID, FLAGS.invisibleToPlayers, next);
    button.classList.toggle("active", next);
  });

  column.appendChild(button);
}

/**
 * Install the feature's hooks. Called once during `init`.
 */
export function registerInvisibleTokens(): void {
  // 1. Auto-flag tokens the GM drops while the feature is enabled. `preCreateToken`
  //    runs only on the creating client, so this fires exactly once, on the GM.
  Hooks.on("preCreateToken", (doc: TokenDocument) => {
    if (!game.user?.isGM) return;
    if (!featureEnabled()) return;
    doc.updateSource({ flags: { [MODULE_ID]: { [FLAGS.invisibleToPlayers]: true } } });
  });

  // 2. On every token refresh, blank the art on player clients for flagged tokens.
  Hooks.on("refreshToken", (token: Token) => applyPlayerVisibility(token));

  // 3. When the flag changes (e.g. the GM toggles it from the HUD), force an
  //    immediate refresh so the change shows on every client without a reload.
  Hooks.on("updateToken", (doc: TokenDocument, changed: AnyObject) => {
    const flagPath = `flags.${MODULE_ID}`;
    if (foundry.utils.hasProperty(changed, flagPath) && doc.object) {
      refreshToken(doc.object);
    }
  });

  // 4. GM-only HUD toggle to hide/reveal an individual token from players.
  Hooks.on("renderTokenHUD", (hud: AnyObject, element: HTMLElement) =>
    onRenderTokenHUD(hud, element),
  );
}
