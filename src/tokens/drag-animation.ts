/**
 * Instant token drag-and-drop.
 *
 * Foundry animates a token's movement at a fixed speed
 * (`CONFIG.Token.movement.defaultSpeed`, 6 grid spaces per second), so dropping a
 * token across a large map means waiting several seconds for it to glide there.
 * With this feature enabled, a dragged token snaps to its destination instead.
 *
 * How it works (Foundry v14):
 *   - A drag-drop issues a Token update whose *operation options* carry
 *     `method: "dragging"` (see `Token#_prepareDragLeftDropUpdates`). That's how we
 *     tell a drag apart from keyboard movement, the token HUD, paste, undo, or an
 *     API call from another module — none of which we touch.
 *   - `preUpdateToken` runs before Foundry finalizes the operation, and the
 *     `options` object it hands us *is* the operation: the client database backend
 *     re-assigns it afterwards precisely so hooks can amend it. Setting
 *     `options.animate = false` there is the same switch Foundry itself uses to
 *     un-animate movement (e.g. when undoing a move).
 *   - Because the option travels with the update to every client, the drop lands
 *     instantly for everyone — which is why the setting is world-scoped rather
 *     than a per-user preference it couldn't actually honor.
 *   - The hook only fires on the client that initiated the update, so this runs
 *     once, on whoever did the dragging.
 */
import { MODULE_ID, SETTINGS } from "../constants.js";

/** The on/off switch (world-scoped; only the GM can change it). */
function featureEnabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.disableDragAnimation) === true;
}

/**
 * Install the feature's hooks. Called once during `init`.
 */
export function registerDragAnimation(): void {
  Hooks.on("preUpdateToken", (_doc: TokenDocument, _changed: AnyObject, options: AnyObject) => {
    if (!featureEnabled()) return;
    // Only drag-drops. Leave keyboard movement and every other mover alone.
    if (options.method !== "dragging") return;
    options.animate = false;
  });
}
