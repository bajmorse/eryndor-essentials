/** Shared, immutable identifiers for the module. */

export const MODULE_ID = "eryndor-essentials" as const;
export const MODULE_TITLE = "Maiyalis: Utility Suite" as const;

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
  /**
   * Master switch for swapping the hotbar page to match the selected token's
   * actor. World-scoped so the GM owns the whole feature.
   */
  hotbarPageSwap: "hotbarPageSwap",
  /**
   * The actor→page assignments behind {@link SETTINGS.hotbarPageSwap}, edited
   * through the {@link SETTINGS.hotbarPagesMenu} window rather than the settings
   * list. Shape: `{ defaultPage: number, applyToPlayers: boolean,
   * pages: Record<actorId, number> }`.
   */
  hotbarPages: "hotbarPages",
  /**
   * Master switch for syncing the actor *portrait* to The Void (Unofficial)'s
   * Hybrid Form transformation. World-scoped because only a GM can write actor
   * documents, and because the artwork it changes is shared by the whole table.
   * Not shown in Foundry's settings list — the Daggerheart Automation tab of
   * {@link MENUS.daggerheartAutomationMenu} is its only editor.
   */
  voidHybridFormPortrait: "voidHybridFormPortrait",
  /**
   * Whether {@link SETTINGS.voidHybridFormPortrait} also rewrites the actor's
   * *prototype token*, so a token dragged out mid-transformation arrives in
   * Hybrid Form. World-scoped for the same reason, and separate because this one
   * mutates persistent actor data rather than just the displayed portrait.
   */
  voidHybridFormPrototype: "voidHybridFormPrototype",
  /**
   * Master switch for ending Hybrid Form when an Order of the Lycan character's
   * Stress fills up — the counterpart to The Void's own "gain Hope while
   * transformed, mark Stress" rule, which never reverts the form once Stress has
   * nowhere left to go. World-scoped for the same reason as the rest of this
   * group: only a GM can write actor documents. On by default, unlike the two
   * settings above — this isn't optional artwork, it's the form ending the way
   * the rule says it should; leaving it off would leave that already-incorrect
   * behavior in place.
   */
  voidHybridFormStressRevert: "voidHybridFormStressRevert",
  /**
   * Repoint a portrait raised by Ginzzzu's Portraits & NPC Dock when the actor's
   * artwork changes underneath it — something that module doesn't do for `img`.
   * World-scoped for consistency with the other feature switches, even though the
   * refresh itself is per-client DOM work.
   */
  refreshRaisedPortraits: "refreshRaisedPortraits",
  /**
   * Master switch for the Session Log — recording what happens at the table so
   * it can later be combined with the Discord voice transcript and fed to an LLM
   * to draft session notes. World-scoped: the log is one shared record for the
   * whole table, not a per-client preference. Off by default — nothing should be
   * recorded until the GM opts in.
   */
  sessionLogEnabled: "sessionLogEnabled",
  /** Log category switch: dice rolls (Duality/Fate results). See `session-log/session-log-store.ts`. */
  sessionLogRolls: "sessionLogRolls",
  /** Log category switch: Hit Point/Stress/Armor/Hope changes. */
  sessionLogResources: "sessionLogResources",
  /** Log category switch: effects gained/lost, and a character going down. */
  sessionLogStatus: "sessionLogStatus",
  /** Log category switch: combat beginning and ending. */
  sessionLogCombat: "sessionLogCombat",
  /** Log category switch: activating a different scene. */
  sessionLogScenes: "sessionLogScenes",
  /** Log category switch: the manual GM "flag this" button. */
  sessionLogFlags: "sessionLogFlags",
  /**
   * The recorded entries themselves — a plain append-only array (see
   * `SessionLogEntry` in `session-log/session-log-store.ts`). Not edited through
   * a settings window; there's no viewer yet.
   */
  sessionLogEntries: "sessionLogEntries",
} as const;

/** Settings-menu keys (buttons that open a config window instead of a control). */
export const MENUS = {
  /**
   * Opens the tabbed module window on its General Features tab. GM only.
   *
   * Registered first, because Foundry lists a namespace's menus in registration
   * order and this is the one a GM wants most often.
   */
  generalFeaturesMenu: "generalFeaturesMenu",
  /** Opens the actor→hotbar-page assignment window. GM only. */
  hotbarPagesMenu: "hotbarPagesMenu",
  /**
   * Opens the tabbed module window on its Daggerheart Automation tab. GM only —
   * everything it edits is world-scoped.
   */
  daggerheartAutomationMenu: "daggerheartAutomationMenu",
  /** Opens the Session Log window. GM only. */
  sessionLogMenu: "sessionLogMenu",
} as const;

/** Document flag keys stored under `flags.eryndor-essentials.*`. */
export const FLAGS = {
  /**
   * Marks a token that should be invisible to players (but still targetable and
   * interactive). Set automatically when the GM drops a token, or by hand from
   * the token HUD.
   */
  invisibleToPlayers: "invisibleToPlayers",
  /**
   * What an actor's portrait (and prototype token art) looked like *before* The
   * Void put it into Hybrid Form: `{ img, proto }`. Present only while
   * transformed — its absence is how we know there is nothing to revert.
   *
   * Deliberately stored on the Actor rather than read back off a token, so the
   * revert still works when no token of that actor is placed on any scene.
   */
  hybridFormPortrait: "hybridFormPortrait",
} as const;

/** Foundry template paths (served from the module root at runtime). */
export const TEMPLATES = {
  /** The actor→hotbar-page assignment window (settings menu). */
  hotbarPages: `modules/${MODULE_ID}/templates/hotbar-pages.hbs`,
  /** Body of the (untabbed) General Features window. */
  generalFeatures: `modules/${MODULE_ID}/templates/general-features.hbs`,
  /** "The Void Automations" tab of the Daggerheart Automation window. */
  automationVoid: `modules/${MODULE_ID}/templates/daggerheart-automation-void.hbs`,
  /** Save/Cancel bar, shared by both windows. */
  configFooter: `modules/${MODULE_ID}/templates/config-footer.hbs`,
  /** Body of the (untabbed) Session Log window. */
  sessionLog: `modules/${MODULE_ID}/templates/session-log.hbs`,
} as const;

/** Our cross-client channel. Requires `"socket": true` in module.json. */
export const SOCKET_EVENT = `module.${MODULE_ID}` as const;
