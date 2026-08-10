/**
 * Registers the module's settings with Foundry. Must be called during the `init`
 * hook (settings cannot be registered later).
 */
import { MENUS, MODULE_ID, SETTINGS } from "./constants.js";
import { HotbarPagesConfig } from "./hotbar/hotbar-pages-app.js";
import { DEFAULT_CONFIG, refreshHotbarPage } from "./hotbar/hotbar-pages.js";

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

  // World-scoped: the GM owns the actor→page assignments, and players read them
  // (so their client can honor the "apply to players" option).
  game.settings.register(MODULE_ID, SETTINGS.hotbarPageSwap, {
    name: "EE.Settings.HotbarPageSwap.Name",
    hint: "EE.Settings.HotbarPageSwap.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    // Off by default — it moves the hotbar out from under the user, so it should
    // be something you opt into after setting up assignments.
    default: false,
    // Turning it on should take effect against the current selection, not the next.
    onChange: () => refreshHotbarPage(),
  });

  // The assignments themselves. Not shown in the settings list — the menu below
  // opens a window that edits them as a whole.
  game.settings.register(MODULE_ID, SETTINGS.hotbarPages, {
    scope: "world",
    config: false,
    type: Object,
    default: DEFAULT_CONFIG,
    onChange: () => refreshHotbarPage(),
  });

  // The button that opens that window. `restricted: true` keeps it GM-only, which
  // matters because only a GM can write a world-scoped setting.
  game.settings.registerMenu(MODULE_ID, MENUS.hotbarPagesMenu, {
    name: "EE.Settings.HotbarPagesMenu.Name",
    label: "EE.Settings.HotbarPagesMenu.Label",
    hint: "EE.Settings.HotbarPagesMenu.Hint",
    icon: "fa-solid fa-bars-staggered",
    type: HotbarPagesConfig,
    restricted: true,
  });
}
