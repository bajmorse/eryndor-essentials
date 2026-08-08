/**
 * Registers the module's settings with Foundry. Must be called during the `init`
 * hook (settings cannot be registered later).
 */
import { MODULE_ID, SETTINGS } from "./constants.js";

export function registerSettings(): void {
  // World-scoped: this is the GM's table-wide switch. Players can read it (so
  // their client knows to hide flagged tokens) but cannot change it.
  game.settings.register(MODULE_ID, SETTINGS.hideDmTokens, {
    name: "EE.Settings.HideDmTokens.Name",
    hint: "EE.Settings.HideDmTokens.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    // Toggling the master switch takes effect immediately: re-refresh every token
    // on the canvas so players' art hides (on) or comes back (off) without a reload.
    onChange: () => {
      for (const token of canvas.tokens?.placeables ?? []) {
        token.renderFlags.set({ refreshState: true });
      }
    },
  });

  // World-scoped: skipping the movement animation is an update option that reaches
  // every client, so this can't meaningfully be a per-user preference.
  game.settings.register(MODULE_ID, SETTINGS.disableDragAnimation, {
    name: "EE.Settings.DisableDragAnimation.Name",
    hint: "EE.Settings.DisableDragAnimation.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    // Off by default — this changes Foundry's stock behavior.
    default: false,
    // No onChange: the setting is read at drop time, so the next drag picks it up.
  });
}
