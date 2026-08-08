/** Shared, immutable identifiers for the module. */

export const MODULE_ID = "eryndor-essentials" as const;
export const MODULE_TITLE = "Eryndor: Essentials" as const;

/** Prefix used for all console logging so output is easy to filter. */
export const LOG_PREFIX = `${MODULE_TITLE} |` as const;

/** Localization key prefix — every user-facing string lives under this in lang/. */
export const I18N_PREFIX = "EE" as const;

/** Setting keys, kept in one place to avoid typos across the codebase. */
export const SETTINGS = {
  /**
   * Master switch for the "hide DM-dropped tokens" feature. World-scoped so the
   * GM owns it and players can't turn it off to reveal hidden tokens.
   */
  hideDmTokens: "hideDmTokens",
  /**
   * Make drag-and-dropped token movement instant instead of animated. World-scoped
   * because the update option that skips the animation travels to every client, so
   * one user's drag is un-animated for the whole table either way.
   */
  disableDragAnimation: "disableDragAnimation",
} as const;

/** Document flag keys stored under `flags.eryndor-essentials.*`. */
export const FLAGS = {
  /**
   * Marks a token that should be invisible to players (but still targetable and
   * interactive). Set automatically when the GM drops a token, or by hand from
   * the token HUD.
   */
  invisibleToPlayers: "invisibleToPlayers",
} as const;

/** Foundry template paths (served from the module root at runtime). */
export const TEMPLATES = {
  // Add template paths here as features are built, e.g.:
  // panel: `modules/${MODULE_ID}/templates/panel.hbs`,
} as const;

/** Our cross-client channel. Requires `"socket": true` in module.json. */
export const SOCKET_EVENT = `module.${MODULE_ID}` as const;
