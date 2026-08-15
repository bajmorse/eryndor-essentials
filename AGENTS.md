# Maiyalis: Utility Suite — Agent guide

> This is the canonical instruction file for all coding agents. Update this
> file when shared guidance changes. `CLAUDE.md` imports it for Claude Code;
> Codex reads `AGENTS.md` directly. Do not duplicate shared instructions in
> agent-specific files.

A FoundryVTT **v14** module (requires the **Daggerheart** system) for the Eryndor
campaign. Written in TypeScript, compiled to `dist/module.js` (what `module.json`
loads).

## Features

- **Invisible-to-players tokens** (`src/tokens/invisible-tokens.ts`) — when the GM
  drops a token, it's flagged `flags.eryndor-essentials.invisibleToPlayers` and its
  art is not rendered on player clients, yet it stays fully targetable/interactive
  (we blank `mesh`/`border`/`nameplate`/etc. but never touch Foundry's `hidden`,
  `token.visible`, or the container `hitArea`). World setting `hideDmTokens` is the
  master switch; a GM-only token-HUD button toggles individual tokens.
- **Instant token drag** (`src/tokens/drag-animation.ts`) — world setting
  `disableDragAnimation` makes drag-and-dropped tokens snap to the destination
  instead of gliding at `CONFIG.Token.movement.defaultSpeed`. Implemented by
  setting `options.animate = false` from `preUpdateToken` when the update
  operation's `method` is `"dragging"`. Deliberately scoped to drag-drop only —
  keyboard movement, the HUD, paste/undo, and other modules' API moves still
  animate.
- **Per-actor hotbar pages** (`src/hotbar/hotbar-pages.ts`, `hotbar-pages-app.ts`) —
  selecting a token swaps the hotbar to the page assigned to its actor; anything
  unassigned (or an empty selection) falls back to a configurable default page.
  World setting `hotbarPageSwap` is the master switch; the assignments live in one
  world object setting `hotbarPages` (`{ defaultPage, applyToPlayers, pages }`)
  edited through the GM-only `hotbarPagesMenu` window. Driven off `controlToken` +
  `canvasReady`, debounced so the release/control pair one click produces yields a
  single page change. Assignments key on `token.document.actorId` (the *base*
  actor) — `token.actor.id` differs for unlinked tokens. Foundry's hotbar has
  exactly **5** pages: `Hotbar#changePage` throws outside 1–5.
- **Void (Unofficial) shared detection** (`src/integrations/void-shared.ts`) —
  `voidActive`, `isWriter`, `isLycan`/`isOrderOfTheLycan`, and
  `isInHybridForm`, shared by both Void integrations below so they can never
  disagree. Prefers asking Void itself via `voidApi()` (`window.Void`), but **as
  of v1.2.9 that only exposes `HybridForm()`, `WarlockFavor`, `DomainCards`, and
  `ComboStrikes`** (see its `features.js`) — not `isOrderOfTheLycan` or
  `isInHybridForm`, despite both being ordinary exports of its `hybrid-form.js`.
  So in practice every call falls through today to the name-scan fallback, which
  mirrors Void's own `isInHybridForm`: some effect named `Hybrid Form` / `Hybrid
  Form - Feral` / `Hybrid Form - Apex Hunter`, enabled. `voidApi()` exists so a
  future Void version that *does* export these is picked up with no code change.
- **Hybrid Form portrait sync** (`src/integrations/void-hybrid-form.ts`) —
  *optional* integration with **The Void (Unofficial)** (`the-void-unofficial`).
  That module transforms an Order of the Lycan's tokens but never `actor.img` or
  `actor.prototypeToken`, so the sheet portrait stays human. **Scope is the
  portrait only** — token artwork is Void's job and we never touch, snapshot, or
  revert it. Trigger: *any* ActiveEffect create/update/delete on an actor, after
  which we ask `void-shared.ts`'s `isInHybridForm(actor)` and make the portrait
  agree; `isLycan` filters out every other actor first. The effect usually lives
  on the subclass *item* and transfers, so `effect.parent` is an Item and the
  actor is one level up. Debounced by `SETTLE_MS` so a burst of effect changes is
  one decision. The portrait artwork comes from **our own**
  `Set Portrait Image with {{{…}}}` marker in the item description — *never* from
  a token. Deriving it from the transformed token's `texture.src` or from Void's
  `Set Token Image with {{{…}}}` marker is a dead end: it depends on whether Void
  has applied the texture yet, and when token art and portrait art are the same
  file it resolves to the *untransformed* portrait, so the apply is a silent
  no-op. Snapshot goes on the **actor**
  (`flags.eryndor-essentials.hybridFormPortrait`) so the revert survives with no
  tokens placed. **Two dead ends, do not revisit**: keying off Void's private
  `hybridFormAppearance` flag (only `toggleHybridForm` creates it, so the ability
  and status bar never fire), and matching effect *names* (world content, may not
  match). Both were replaced by asking Void directly (see the shared-detection
  entry above for why the "asking" today still bottoms out at a name scan). World
  settings `voidHybridFormPortrait` / `voidHybridFormPrototype`; gated on
  `game.modules.get(...)?.active`, never a hard dependency.
- **Hybrid Form ends at max Stress** (`src/integrations/void-hybrid-form-stress.ts`)
  — *optional* integration with The Void (Unofficial), completing its own "Beast
  Within" rule: gaining Hope while in Hybrid Form marks Stress (Void's
  `onPreUpdateActor`, left untouched), but Void never reverts the form once
  Stress is full. Trigger: `updateActor` on any Order of the Lycan character
  whose Stress is now at max while transformed. Reverting is more than disabling
  the gameplay effect — Void's `_applyHybridFormAppearance` also swaps the
  token's art/scale back and removes its Hybrid Form light effect, using flags
  private to its module, so disabling the effect ourselves would leave the token
  looking like a wolf forever. Since `window.Void` doesn't expose a
  targetable-actor toggle (only `HybridForm()`, which resolves the *acting
  user's* selected token/character), this dynamically imports Void's own
  `scripts/hybrid-form.js` for its exported `toggleHybridForm(actor)` — the exact
  function the wolf button calls — via
  `foundry.utils.getRoute("modules/the-void-unofficial/scripts/hybrid-form.js")`.
  The dynamic `import()` needs `/* @vite-ignore */`: `vite.config.ts` sets
  `inlineDynamicImports: true` for the single-file build, and without the
  comment Vite tries (and fails, since the path is a runtime string, not
  resolvable at build time) to analyze it. **Verified against v1.2.9** — re-read
  `scripts/hybrid-form.js` if this stops working after a Void update. World
  setting `voidHybridFormStressRevert`, **on by default** (unlike the portrait
  settings above) — this isn't optional artwork, it's a rule Void already half-
  implements; leaving it off leaves that half-implementation in place.
- **Raised-portrait refresh** (`src/integrations/ginzzzu-portraits.ts`) — *optional*
  integration with **Ginzzzu's Portraits & NPC Dock** (`ginzzzu-portraits`). Its
  own `updateActor` handler live-swaps a raised portrait's image, but only for six
  of its flags — **`img` is not one of them**, even though `actor.img` is the first
  entry in its `actorImagePaths` default. So any change to `actor.img` (ours or
  anyone's) leaves stale art on screen. We set the `<img>` src directly rather than
  lowering/re-raising, which would cost two replicated flag writes and flicker.
  Skips actors with an active emotion or a custom portrait image — there `actor.img`
  is legitimately not what's shown. World setting `refreshRaisedPortraits` (default
  **on**). Portraits are **local DOM** built from a replicated flag, so unlike the
  Hybrid Form writer this runs on *every* client.
- **Deck Limit** (`src/daggerheart/deck-limit.ts`, settings only so far) — models
  the table's card pool as physical decks: a card in one character's hands isn't
  available to anyone else. World settings `deckLimitEnabled` (off by default)
  and `deckLimitCount` (default 1, minimum 1), plus one copies-per-deck count per
  card type — `DECK_CARD_TYPES` maps each to a Daggerheart Item type
  (`domainCard`, `class`, `subclass`, `ancestry`, `community`) and to what a
  printed deck holds (1 each, **2 for `community`**). Pool for a type is
  `copies × deckLimitCount`. A `subclass` is a single Item even though it's three
  physical cards — Foundation/Specialization/Mastery are `foundationFeatures` /
  `specializationFeatures` / `masteryFeatures` on it, gated by `featureState` —
  so one copy is the whole set. Edited in the `daggerheartUtilitiesMenu` window
  (`src/apps/daggerheart-utilities-config.ts`), the copies fields in a
  collapsed-by-default `<details>`. That window is the home for Daggerheart
  *table rules we implement ourselves*, as opposed to `daggerheartAutomationMenu`,
  which is only third-party module hookups.
  - *Counting* (`deck-pool.ts`): nothing is stored — the pool is recomputed from
    the world on every question, so deleting a card (or its owner) returns it to
    the deck with no ledger to drift. Only `character` actors hold cards; vault
    and loadout both count. `drawsFromDeck()` is the single answer to "is this
    sheet in the pool", used by the census *and* the guard so they can't disagree
    — with `deckLimitPlayersOnly` on it narrows to actors a non-GM user has
    assigned as their character or owns (GMs are skipped first, since a GM tests
    as OWNER on everything). **Card identity is the subtle part.** A copy carries
    `_stats.compendiumSource` (stamped by `ClientDocument.fromDropData`, and by
    the system's own `createEmbeddedItemData`), but the compendium entry *is* the
    source and so has none, and homebrew never gets one — so a `CardKey` holds
    both a source UUID and a `type:name` fallback, and `sameCard` compares
    whichever the two sides have in common. The fallback is blunt on purpose:
    same-named homebrew cards count as one, renaming frees a copy.
  - *Enforcement* (`deck-limit-guard.ts`): `preCreateItem` is the choke point —
    every route onto a sheet (drag, character creation, level-up, other modules)
    ends in an embedded Item create. `preCreate` hooks are **synchronous**, so
    both paths cancel with `return false` and *then* open a dialog: a player gets
    a dead end naming the holders, a GM gets a confirm whose yes re-issues the
    create with the `eryndor-essentialsDeckLimitBypass` option, which the hook
    waves through. The GM's card therefore lands a moment after the click.
    Advisory, not a security boundary — it runs on the initiating client.
  - *Greying* (`deck-limit-browser.ts`): the system keeps **one** shared
    `ui.compendiumBrowser` (`ItemBrowser`) and re-opens it with presets for every
    picking flow, so one pass covers them all. `loadItems()` fills `.item-list`
    after the render hook and refills it on every search/filter/sort without
    re-rendering the part — hence a `MutationObserver` (childList only; marking
    rows touches attributes, so watching those would self-retrigger). Exhausted
    rows are dimmed and `draggable="false"`, never removed.
  - **Known gap**: items created *as part of* an Actor creation (duplicating or
    importing a character) never fire `preCreateItem`, so they bypass the limit.
- **Session Log** (`src/session-log/`) — records what happens at the table as
  plain-text lines, meant to be combined with the Discord voice transcript
  (Craig) afterward and fed to an LLM to draft session notes. No viewer yet —
  entries just accumulate in the world-scoped `sessionLogEntries` array setting.
  "Session" isn't tracked at write time — `groupIntoSessions` splits the flat
  entry list wherever the gap between two consecutive entries exceeds
  `SESSION_GAP_MS` (12 hours), not by calendar day, so a session that runs past
  midnight (or survives a server restart mid-session) doesn't get split; each
  resulting session is labeled with its first entry's local calendar date.
  Master switch `sessionLogEnabled`, plus one on-by-default category switch each
  for `rolls`, `resources`, `status`, `combat`, `scenes`, `flags`
  (`session-log-store.ts`'s `CATEGORY_SETTING_KEYS`), edited in the
  `sessionLogMenu` window. All writing goes through `recordSessionLogEvent`,
  which is the only place that checks both switches and picks the one client
  that persists (`utils/is-writer.ts`'s `isWriter`, `activeGM` — extracted out
  of `void-shared.ts`, which re-exports it so its own call sites didn't need to
  change). Event sources (`session-log-events.ts`):
  - *Rolls*: `createChatMessage`, filtered to Daggerheart's `dualityRoll` /
    `fateRoll` / `adversaryRoll` message types, reading `message.rolls[0]`'s
    `.total` / `.totalLabel` ("Hope" / "Fear" / "Critical Success" /
    "Guaranteed Critical Success"). Deliberately doesn't resolve hit/miss or a
    target — not a roll property, and the resources line below tells that part
    of the story. Damage/healing *roll* messages are skipped in favor of what
    was actually applied. **Verified against the Daggerheart system v2.7.2
    bundle** (`build/daggerheart.js`, searched for `messageType` and
    `getHooks`) — re-check there if this stops matching after a system update.
  - *Resources*: `preUpdateActor` snapshots
    `system.resources.{hitPoints,stress,armor,hope}`, `updateActor` diffs
    against it. Deliberately **not** built on Daggerheart's own
    `daggerheart.postTakeDamage`/`postTakeHealing` hooks — those are
    function-local `Hooks.call`s inside `Actor#takeDamage`/`takeHealing`, so
    they only fire on whichever client called the method (e.g. a player
    self-marking their own Hit Points), never broadcast the way `updateActor`
    is. GM Fear is a world-level pool, not a per-actor resource, and its
    storage in the installed v2.7.2 system couldn't be pinned down from the
    minified bundle — out of scope for now. "Down" (Hit Points fully marked) is
    logged under `status` off the same snapshot.
  - *Status*: `createActiveEffect`/`deleteActiveEffect`, actor resolved via
    `utils/actor-of-effect.ts` (extracted out of `void-hybrid-form.ts`, same
    "usually on the item, walk up one level" logic). Logs every effect
    gained/lost, not just conditions — can get chatty; that's what its category
    toggle is for.
  - *Combat*: Daggerheart's own unprefixed `combatStart` hook
    (`Hooks.callAll("combatStart", combat)`) for the start — stronger signal
    than "a Combat document was created." `deleteCombat` for the end, skipped
    if the round never advanced past 0.
  - *Scenes*: `updateScene` filtered to `changes.active === true` — a GM
    *activating* a scene, not a per-client view change.
  - *Flags*: `session-log-flag-button.ts` prepends a button to Foundry's
    `#chat-controls` bar (`renderChatLog`) opening a `DialogV2.prompt` for
    optional free text. GM-only; shown only once master + the `flags` category
    are both on.
  Export to a Journal Entry (`session-log-export.ts`): one JournalEntry named
  "Session Logs", filed in a journal-sidebar folder named "Utility Suite" (found
  by name *and* `type === "JournalEntry"` — folder names are only unique within a
  document type; falls back to the sidebar root if the folder can't be created).
  One page per session named by its date, plain-text content
  built with `escapeHtml` since entry text can embed player/GM-authored names.
  Re-exporting a session updates its existing page rather than duplicating it.
  A journal left at the root by an older version is moved into the folder on the
  next export, but one the GM has filed somewhere themselves is left alone.
  Two triggers: the Session Log window's "Export Current Log" button always
  exports whatever `groupIntoSessions` puts last (finished or still in
  progress), and `sessionLogEntries`'s `onChange` (wired in `settings.ts`) calls
  `checkForSessionBoundary` on every change — narrowed to the GM's own client
  via `isWriter`, it compares the two newest entries and, if the gap between
  them crosses `session-log-store.ts`'s `isSessionBoundary` threshold, exports
  everything before the new entry as the session that just ended. The
  in-progress session is never auto-exported on its own; only its successor's
  first entry triggers it (or a manual export).

## Build — read this first

**Node.js is NOT installed on the host, and Python isn't either.** The build runs
in Docker. Do not run `npm` / `node` / `tsc` / `vite` directly on the host — they
won't exist.

```
docker compose run --rm build     # one-off type-check + build (tsc --noEmit && vite build)
docker compose up watch           # rebuild dist/module.js on every save
```

- First run installs deps into a **named Docker volume** (`eryndor-essentials-node-modules`),
  not the host — Vite ships platform-specific binaries that a Windows `node_modules`
  can't run in the Linux container. `package-lock.json` still persists to the host.
- The host `node_modules/` folder is an empty mount-point artifact; ignore it.
- **Never add a `restart:` policy** to `docker-compose.yml` (keep `restart: "no"`).
  These are manual, developer-invoked containers. Don't change Docker Desktop settings.
- To validate JSON without Node, use PowerShell: `Get-Content -Raw file.json | ConvertFrom-Json`.

### Hot reload

While a world runs, Foundry live-applies (no refresh): `styles/module.css`,
`templates/*.hbs`, `lang/*.json`. **JavaScript is not hot-swapped** — after `watch`
rebuilds `dist/module.js`, **press F5** in the browser.

## Layout

```
src/
  module.ts            entry point — Hooks.once("init"|"ready")
  constants.ts         MODULE_ID, MODULE_TITLE, LOG_PREFIX, SETTINGS, FLAGS, TEMPLATES
  settings.ts          game.settings registration (called from init)
  settings-groups.ts   headings between our buttons in core's settings list
  tokens/              per-feature modules, each exports a register…() called from init
  apps/                ApplicationV2 windows not owned by a single feature
  daggerheart/         Daggerheart table rules we implement ourselves (cf. integrations/)
  integrations/        optional third-party module hookups (runtime-gated, never required)
  session-log/         Session Log store, event sources, and the chat flag button
  utils/               small stateless helpers with no feature of their own (e.g. escape-html.ts)
  types/foundry.d.ts   minimal ambient Foundry type shim
dist/module.js         build output (git-ignored)
module.json            manifest — esmodules -> dist/module.js
styles/ templates/ lang/ packs/   served from the repo root as-is
```

## Conventions

- **One id, one title.** `MODULE_ID = "eryndor-essentials"` and `MODULE_TITLE`
  live in `constants.ts`. `LOG_PREFIX` derives from the title; log with
  `` console.log(`${LOG_PREFIX} …`) ``. Reserve `log` for once-per-session
  lifecycle lines. Routine per-action tracing goes to `console.debug` (the
  console's Verbose level) so it's there when something needs diagnosing and
  silent during play; `warn` is for anything the GM can act on.
- **Settings**: add a key to `SETTINGS` in `constants.ts`, register it in
  `settings.ts`, which is called during the `init` hook (settings can't be
  registered later). **Every setting is `config: false`** — the module's category
  in Foundry's settings list holds only buttons (General Features, Per-Token
  Hotbars, Daggerheart Automation, Daggerheart Utilities, Session Log), each
  opening a window that owns its group. A new setting belongs in one of those
  windows, not in the flat list; a setting must never be both `config: true` and
  window-edited or the same control appears twice. Menus render in registration
  order, which is why they are all registered together at the end of
  `settings.ts`. A window lists its boolean keys in `settingKeys` and its numeric
  ones in `numberSettingKeys`; `ConfigWindow#onSave` reads each back off the
  input whose `name` is the key, holding numbers to the field's own `min`/`max`
  since nothing here goes through form submission (which is what would otherwise
  enforce them).
- **Templates**: add the path to `TEMPLATES` in `constants.ts`; they're preloaded
  via `loadTemplates(Object.values(TEMPLATES))` in `init`.
- **Types**: there's no full Foundry type package — `src/types/foundry.d.ts` is a
  deliberately minimal shim. When you touch a new Foundry global, **add it to the
  shim** rather than reaching for `any` everywhere. (Swap in `fvtt-types` later if
  the surface grows large.)
- **Localization**: every user-facing string lives in `lang/en.json` under the
  `EE.` prefix — `game.i18n.localize("EE.…")` in TS, `{{localize "EE.…"}}` in
  templates. Don't hardcode display strings.

## Foundry gotchas (apply when you build the features)

- **ApplicationV2 UI**: the built-in `actions` click dispatch has proven
  unreliable in this Foundry build. Prefer one delegated click listener attached
  in `_onRender` that reads a `data-*` attribute via `closest()`.
- **Handlebars**: no `{{else if}}` and no `eq` helper here — precompute booleans
  in `_prepareContext` and use nested `{{#if}}`/`{{else}}`.
- **Module settings get exactly one flat category.** `SettingsConfig` extends
  `CategoryBrowser` and `_categorizeEntry` maps a namespace to a single category —
  there is no native sub-tab. Each group of settings gets its own `ApplicationV2`
  instead — `src/apps/config-window.ts` is the shared base, and a tabbed one adds
  `static TABS` (see `src/apps/daggerheart-automation-config.ts`). The tab markup
  contract, which
  `Application#changeTab` queries for: a `.tabs` nav holding `[data-group][data-tab]`
  links, and content sections with `class="tab"` plus the same two attributes.
  Visibility is core's — `.tab[data-tab]:not(.active)` hides, and the `standard-form`
  class on the window supplies `.tab.active { display: flex }` — so don't write
  tab CSS. Settings that live in such a window register `config: false`, or they
  show up in both places.
  Within that one flat category the buttons are grouped *presentationally* by
  `src/settings-groups.ts`: on `renderSettingsConfig` it finds
  `section[data-category="eryndor-essentials"]`, locates each menu's row by its
  `button[data-key="<namespace>.<key>"]` (core's
  `templates/settings/config-category.hbs`), and wraps each contiguous run in a
  `div.ee-settings-group` headed by core's `h3.divider`. Two consequences:
  registration order in `settings.ts` *is* DOM order, so a group's menus must be
  registered contiguously; and core's search filter (`CategoryBrowser`'s
  `_onSearchFilter`, debounced 200ms) sets `hidden` on non-matching `.form-group`
  rows while knowing nothing about our headings — which is why the wrapper hides
  itself via `:not(:has(> .form-group:not([hidden])))` in `styles/module.css`
  rather than any JS trying to race that debounce.
- **Hand-edited JSON** (`lang/`, `packs/`): save **UTF-8 without a BOM**. Foundry's
  loader chokes on a BOM, and PowerShell's `Set-Content -Encoding utf8` adds one —
  use `[System.IO.File]::WriteAllText(path, text, (New-Object System.Text.UTF8Encoding($false)))`.
- **Update options are shared state**: the `options` object handed to a
  `preUpdate<Type>` hook *is* the database operation — the client backend
  re-assigns it after the hooks run, so mutating it there is supported, and the
  result travels to every client with the update. That's how one user's drag can
  un-animate for the whole table.
- **World state**: only GMs can write world-scoped settings; all clients can read.
  Player→GM coordination goes over `game.socket` — enabled via `"socket": true`
  in `module.json`. Use the `SOCKET_EVENT` channel (`module.eryndor-essentials`).

## Dev environment

- A directory **junction** links this repo into Foundry:
  `%LOCALAPPDATA%\FoundryVTT\Data\modules\eryndor-essentials` → the repo root.
  Foundry serves the built `dist/module.js` and the root assets directly.
- Sibling modules **Maiyalis: Target Helper** (`../daggerheart-target-helper`) and
  **Campaign Story Decks** (`../foundry-narrative-tools`) use the same toolchain and are
  good references for patterns — ApplicationV2 windows, delegated-click dispatch,
  GM-authoritative world-setting sync over sockets, and the Docker build setup are
  all worked out there.
```
