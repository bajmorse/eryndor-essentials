/**
 * Registers the module's settings with Foundry. Must be called during the `init`
 * hook (settings cannot be registered later).
 *
 * **Every setting here is `config: false`.** Foundry would otherwise list them
 * flat under the module's category, and this module has enough of them that they
 * read better grouped. So the module's category contains only the buttons
 * registered at the bottom of this file, each opening a window that owns its
 * group — and a setting must never be both `config: true` and editable in a
 * window, or the same control appears twice.
 *
 * Menus are listed in registration order, which is why they are all together at
 * the end rather than next to the settings they edit.
 */
import { DaggerheartAutomationConfig } from "./apps/daggerheart-automation-config.js";
import { GeneralFeaturesConfig } from "./apps/general-features-config.js";
import { SessionLogConfig } from "./apps/session-log-config.js";
import { MENUS, MODULE_ID, SETTINGS } from "./constants.js";
import { HotbarPagesConfig } from "./hotbar/hotbar-pages-app.js";
import { DEFAULT_CONFIG, refreshHotbarPage } from "./hotbar/hotbar-pages.js";
import { reconcileHybridFormPortraits } from "./integrations/void-hybrid-form.js";
import { checkForSessionBoundary } from "./session-log/session-log-export.js";
import { CATEGORY_SETTING_KEYS } from "./session-log/session-log-store.js";

export function registerSettings(): void {
  /* ---- General Features ------------------------------------------------- */

  // World-scoped: this is the GM's table-wide switch. Players can read it (so
  // their client knows to hide flagged tokens) but cannot change it.
  game.settings.register(MODULE_ID, SETTINGS.hideDmTokens, {
    name: "EE.Settings.HideDmTokens.Name",
    hint: "EE.Settings.HideDmTokens.Hint",
    scope: "world",
    config: false,
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
    config: false,
    type: Boolean,
    // Off by default — this changes Foundry's stock behavior.
    default: false,
    // No onChange: the setting is read at drop time, so the next drag picks it up.
  });

  // World-scoped to match the other feature switches. The work it gates is
  // per-client DOM, but the decision to do it at all belongs to the GM.
  game.settings.register(MODULE_ID, SETTINGS.refreshRaisedPortraits, {
    name: "EE.Settings.RefreshRaisedPortraits.Name",
    hint: "EE.Settings.RefreshRaisedPortraits.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    // On by default: it only fires when a portrait is raised *and* the artwork
    // behind it changed, which is a case where the stale image is simply wrong.
    default: true,
    // No onChange: read at refresh time, so the next change picks it up.
  });

  /* ---- Per-Token Hotbars ------------------------------------------------- */

  // World-scoped: the GM owns the actor→page assignments, and players read them
  // (so their client can honor the "apply to players" option). Edited from the
  // same window as the assignments it gates, since one is useless without the other.
  game.settings.register(MODULE_ID, SETTINGS.hotbarPageSwap, {
    name: "EE.Settings.HotbarPageSwap.Name",
    hint: "EE.Settings.HotbarPageSwap.Hint",
    scope: "world",
    config: false,
    type: Boolean,
    // Off by default — it moves the hotbar out from under the user, so it should
    // be something you opt into after setting up assignments.
    default: false,
    // Turning it on should take effect against the current selection, not the next.
    onChange: () => refreshHotbarPage(),
  });

  // The assignments themselves, edited as a whole rather than as a control.
  game.settings.register(MODULE_ID, SETTINGS.hotbarPages, {
    scope: "world",
    config: false,
    type: Object,
    default: DEFAULT_CONFIG,
    onChange: () => refreshHotbarPage(),
  });

  /* ---- Daggerheart Automation -------------------------------------------- */

  // World-scoped: only a GM can write actor documents, and the artwork this
  // changes is shared by the whole table.
  game.settings.register(MODULE_ID, SETTINGS.voidHybridFormPortrait, {
    scope: "world",
    config: false,
    type: Boolean,
    // Off by default — this is an opt-in integration with a third-party module,
    // and it rewrites character artwork.
    default: false,
    // Catch up immediately: enabling it mid-transformation should sync the
    // portrait, and disabling it should hand the original artwork back.
    onChange: () => void reconcileHybridFormPortraits(),
  });

  // Separate from the switch above because this one mutates persistent actor data
  // (the prototype token) rather than just the portrait that's displayed, so it's
  // off unless explicitly asked for.
  game.settings.register(MODULE_ID, SETTINGS.voidHybridFormPrototype, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    // No onChange: the value is read at transform time. Turning it off mid-form
    // is handled by the revert, which always restores from the snapshot.
  });

  // On by default — see SETTINGS.voidHybridFormStressRevert in constants.ts for why
  // this one doesn't follow the "third-party integration defaults off" pattern.
  game.settings.register(MODULE_ID, SETTINGS.voidHybridFormStressRevert, {
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    // No onChange: read live from the updateActor hook, so toggling it takes
    // effect on the next Stress change either way.
  });

  /* ---- Session Log -------------------------------------------------------- */

  // World-scoped: the log is one shared record of the session, not a per-client
  // preference. Off by default — nothing should be recorded until the GM opts in.
  game.settings.register(MODULE_ID, SETTINGS.sessionLogEnabled, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
    // No onChange: every event source reads this live.
  });

  // One toggle per log category (see session-log/session-log-store.ts), all
  // shaped the same: world-scoped, on by default once the master switch above
  // is on, and read live by each event source rather than needing an onChange.
  for (const key of CATEGORY_SETTING_KEYS) {
    game.settings.register(MODULE_ID, key, {
      scope: "world",
      config: false,
      type: Boolean,
      default: true,
    });
  }

  // The recorded entries themselves — a plain append-only list. Not edited
  // through this window; there's no viewer yet.
  game.settings.register(MODULE_ID, SETTINGS.sessionLogEntries, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    // Fires on every client whenever the log changes; checkForSessionBoundary
    // narrows to the GM's own client and only acts once a 12-hour gap has
    // actually opened up (see session-log-export.ts).
    onChange: (value: unknown) => checkForSessionBoundary(value),
  });

  /* ---- The buttons, in the order they should appear ----------------------- */
  //
  // `restricted: true` on all four keeps them GM-only, which matters because
  // every setting above is world-scoped and only a GM can write one.

  game.settings.registerMenu(MODULE_ID, MENUS.generalFeaturesMenu, {
    name: "EE.Settings.GeneralFeaturesMenu.Name",
    label: "EE.Settings.GeneralFeaturesMenu.Label",
    hint: "EE.Settings.GeneralFeaturesMenu.Hint",
    icon: "fa-solid fa-sliders",
    type: GeneralFeaturesConfig,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, MENUS.hotbarPagesMenu, {
    name: "EE.Settings.HotbarPagesMenu.Name",
    label: "EE.Settings.HotbarPagesMenu.Label",
    hint: "EE.Settings.HotbarPagesMenu.Hint",
    icon: "fa-solid fa-bars-staggered",
    type: HotbarPagesConfig,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, MENUS.daggerheartAutomationMenu, {
    name: "EE.Settings.DaggerheartAutomationMenu.Name",
    label: "EE.Settings.DaggerheartAutomationMenu.Label",
    hint: "EE.Settings.DaggerheartAutomationMenu.Hint",
    icon: "fa-solid fa-wand-magic-sparkles",
    type: DaggerheartAutomationConfig,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, MENUS.sessionLogMenu, {
    name: "EE.Settings.SessionLogMenu.Name",
    label: "EE.Settings.SessionLogMenu.Label",
    hint: "EE.Settings.SessionLogMenu.Hint",
    icon: "fa-solid fa-book",
    type: SessionLogConfig,
    restricted: true,
  });
}
