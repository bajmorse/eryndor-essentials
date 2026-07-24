/** Shared, immutable identifiers for the module. */

export const MODULE_ID = "eryndor-essentials" as const;
export const MODULE_TITLE = "Eryndor: Essentials" as const;

/** Prefix used for all console logging so output is easy to filter. */
export const LOG_PREFIX = `${MODULE_TITLE} |` as const;

/** Localization key prefix — every user-facing string lives under this in lang/. */
export const I18N_PREFIX = "EE" as const;

/** Setting keys, kept in one place to avoid typos across the codebase. */
export const SETTINGS = {
  /** Whether the module's helpers are active for this client. */
  enabled: "enabled",
} as const;

/** Foundry template paths (served from the module root at runtime). */
export const TEMPLATES = {
  // Add template paths here as features are built, e.g.:
  // panel: `modules/${MODULE_ID}/templates/panel.hbs`,
} as const;

/** Our cross-client channel. Requires `"socket": true` in module.json. */
export const SOCKET_EVENT = `module.${MODULE_ID}` as const;
