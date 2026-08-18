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
   * Make tokens flagged {@link FLAGS.invisibleToPlayers} completely inert on
   * player clients: no hover, no click, no drag, no box-select, and no moving
   * them with the arrow keys. A sub-option of {@link SETTINGS.hideDmTokens},
   * which is why the window greys it out while that is off.
   *
   * Targeting is deliberately *not* affected, and doesn't need to be:
   * `TokenLayer#setTargets` resolves ids and never consults visibility or
   * interactivity, and the Target Helper picks targets through its own UI rather
   * than by clicking the canvas. Distance automation reads token positions, which
   * is likewise untouched.
   */
  blockPlayerTokenInteraction: "blockPlayerTokenInteraction",
  /**
   * Master switch for the Tokens on Scene bar — a floating list of the tokens a
   * player owns on the current scene, so they can pick which one they're driving
   * without finding it on the canvas. World-scoped: at this table every token is
   * invisible to players (see {@link SETTINGS.hideDmTokens}), which is a
   * table-wide decision, and so is the answer to "can players still get back to
   * their character". Off by default — it puts a panel on every player's screen.
   */
  tokenBar: "tokenBar",
  /**
   * Whether the bar also stops a player's selection from emptying: releasing the
   * last controlled token immediately re-controls it. Separate from
   * {@link SETTINGS.tokenBar} only so the lock can be dropped mid-session without
   * taking the bar (the player's only way back) with it — the two are meant to
   * run together, which is why this is on by default and greyed out while the bar
   * is off.
   */
  tokenBarLockSelection: "tokenBarLockSelection",
  /**
   * Where this client has dragged the bar to: `{ left, top }` in pixels, or null
   * for "wherever the default puts it". **Client-scoped**, unlike everything else
   * here — it's one user's window layout, and a player must be able to write it.
   * Never shown in a settings window; the drag is its only editor.
   */
  tokenBarPosition: "tokenBarPosition",
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
   * Master switch for the **Reach** rule: an actor holding a feature called
   * "Reach" (the Giant ancestry's) uses anything with a Melee range at Very
   * Close instead. World-scoped like every other rule switch — one answer for
   * the whole table, or two clients would gate targeting differently. Off by
   * default, since it changes what a printed card says.
   */
  reachMeleeAsVeryClose: "reachMeleeAsVeryClose",
  /**
   * Master switch for automating **Fearless** (Infernis): offer to mark 2 Stress
   * and turn a roll with Fear into a roll with Hope, before the system has acted
   * on the Fear at all. See `daggerheart/fearless.ts`.
   *
   * World-scoped like every other rule switch — one answer for the whole table,
   * or two clients would resolve the same roll differently. **On** by default,
   * for the same reason as {@link SETTINGS.voidHybridFormStressRevert}: this is
   * the rule exactly as printed on the card, which nothing currently applies, and
   * it does nothing at all unless a player chooses it at the prompt.
   */
  fearlessFearToHope: "fearlessFearToHope",
  /**
   * Repoint a portrait raised by Ginzzzu's Portraits & NPC Dock when the actor's
   * artwork changes underneath it — something that module doesn't do for `img`.
   * World-scoped for consistency with the other feature switches, even though the
   * refresh itself is per-client DOM work.
   */
  refreshRaisedPortraits: "refreshRaisedPortraits",
  /**
   * Master switch for the Deck Limit — capping how many decks are in play at
   * once. World-scoped: it's a table-wide rule the GM sets, not a per-client
   * preference. Off by default, since it constrains something Daggerheart
   * itself leaves open.
   */
  deckLimitEnabled: "deckLimitEnabled",
  /**
   * How many decks {@link SETTINGS.deckLimitEnabled} allows. Meaningless while
   * that switch is off, which is why the window greys it out then. Defaults to
   * 1 and is held to at least 1 on save — a limit of zero would mean "no decks
   * at all", which is what turning the feature off is for.
   */
  deckLimitCount: "deckLimitCount",
  /**
   * Narrow the Deck Limit to characters that belong to a player, leaving the
   * GM's own character actors — pregens, test sheets, retired PCs — outside the
   * pool entirely: they neither consume copies nor get blocked. Off by default,
   * where every `character` actor in the world draws from the decks.
   */
  deckLimitPlayersOnly: "deckLimitPlayersOnly",
  /**
   * Copies of each Domain card one deck contains. This and its four siblings
   * below describe the *shape* of a deck rather than switching anything on, so
   * they're edited in a collapsed section under the switch above. See
   * `daggerheart/deck-limit.ts` for which Daggerheart Item type each one counts
   * and what a printed deck holds by default.
   */
  deckCopiesDomain: "deckCopiesDomain",
  /** Copies of each class card one deck contains. */
  deckCopiesClass: "deckCopiesClass",
  /** Copies of each subclass card one deck contains (one Item = all three tiers). */
  deckCopiesSubclass: "deckCopiesSubclass",
  /** Copies of each ancestry card one deck contains. */
  deckCopiesAncestry: "deckCopiesAncestry",
  /** Copies of each community card one deck contains — 2 in a printed deck. */
  deckCopiesCommunity: "deckCopiesCommunity",
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
  /**
   * Opens the Daggerheart Utilities window — the table's *own* house rules (how
   * many decks are in play), as opposed to
   * {@link MENUS.daggerheartAutomationMenu}, which automates rules the system
   * or a third-party module already states but leaves to the table to apply.
   * GM only.
   */
  daggerheartUtilitiesMenu: "daggerheartUtilitiesMenu",
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
  /**
   * Cards a user has picked in an open character-creation or level-up wizard but
   * not yet committed to a sheet — see `daggerheart/deck-holds.ts`. Stored on the
   * **User**, not an Actor: a player can always write their own User document
   * (`BaseUser.#canUpdate` lets `user.id === doc.id` through, and `flags` isn't a
   * restricted field), so a reservation reaches the whole table with no GM relay.
   *
   * Shape: `{ [applicationId]: { actorName: string, cards: string[] } }`, where
   * each card is the source UUID of a pending selection.
   */
  deckHolds: "deckHolds",
  /**
   * Marks an Item as granting an automated feature, naming the registry id it
   * should be matched as (`"fearless"`, …). See `daggerheart/feature-registry.ts`.
   *
   * The escape hatch for homebrew: a feature is normally recognised by the
   * compendium it came from, falling back to its printed name, and neither finds
   * a card the table wrote itself. Set this by hand on such an Item and it joins
   * the automation. Checked ahead of both other routes, so it also works to point
   * a renamed or reworded card at the rule it is meant to be.
   */
  featureId: "featureId",
} as const;

/** Foundry template paths (served from the module root at runtime). */
export const TEMPLATES = {
  /** The actor→hotbar-page assignment window (settings menu). */
  hotbarPages: `modules/${MODULE_ID}/templates/hotbar-pages.hbs`,
  /** Body of the (untabbed) General Features window. */
  generalFeatures: `modules/${MODULE_ID}/templates/general-features.hbs`,
  /** Contents of the floating Tokens on Scene bar. */
  tokenBar: `modules/${MODULE_ID}/templates/token-bar.hbs`,
  /** "General" tab of the Daggerheart Automation window. */
  automationGeneral: `modules/${MODULE_ID}/templates/daggerheart-automation-general.hbs`,
  /** "The Void" tab of the Daggerheart Automation window. */
  automationVoid: `modules/${MODULE_ID}/templates/daggerheart-automation-void.hbs`,
  /** Body of the (untabbed) Daggerheart Utilities window. */
  daggerheartUtilities: `modules/${MODULE_ID}/templates/daggerheart-utilities.hbs`,
  /** Save/Cancel bar, shared by every settings window here. */
  configFooter: `modules/${MODULE_ID}/templates/config-footer.hbs`,
  /** Body of the (untabbed) Session Log window. */
  sessionLog: `modules/${MODULE_ID}/templates/session-log.hbs`,
} as const;

/** Our cross-client channel. Requires `"socket": true` in module.json. */
export const SOCKET_EVENT = `module.${MODULE_ID}` as const;
