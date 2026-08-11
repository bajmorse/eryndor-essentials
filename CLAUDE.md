# Eryndor: Essentials — Claude guide

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
- **Hybrid Form portrait sync** (`src/integrations/void-hybrid-form.ts`) —
  *optional* integration with **The Void (Unofficial)** (`the-void-unofficial`).
  That module transforms an Order of the Lycan's tokens but never `actor.img` or
  `actor.prototypeToken`, so the sheet portrait stays human. **Scope is the
  portrait only** — token artwork is Void's job and we never touch, snapshot, or
  revert it. Trigger: *any* ActiveEffect create/update/delete on an actor, after
  which we ask Void's exported `window.Void.isInHybridForm(actor)` and make the
  portrait agree; `isOrderOfTheLycan` filters out every other actor first. The
  effect usually lives on the subclass *item* and transfers, so `effect.parent`
  is an Item and the actor is one level up. Debounced by `SETTLE_MS` so a burst
  of effect changes is one decision. The portrait artwork comes from **our own**
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
  match). Both were replaced by asking Void directly. World settings
  `voidHybridFormPortrait` / `voidHybridFormPrototype`; gated on
  `game.modules.get(...)?.active`, never a hard dependency.
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
  tokens/              per-feature modules, each exports a register…() called from init
  apps/                ApplicationV2 windows not owned by a single feature
  integrations/        optional third-party module hookups (runtime-gated, never required)
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
  in Foundry's settings list holds only three buttons (General Features,
  Per-Token Hotbars, Daggerheart Automation), each opening a window that owns its
  group. A new setting belongs in one of those windows, not in the flat list; a
  setting must never be both `config: true` and window-edited or the same control
  appears twice. Menus render in registration order, which is why they are all
  registered together at the end of `settings.ts`.
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
- Sibling modules **Eryndor: Target Helper** (`../daggerheart-target-helper`) and
  **Campaign Story Decks** (`../foundry-story-deck`) use the same toolchain and are
  good references for patterns — ApplicationV2 windows, delegated-click dispatch,
  GM-authoritative world-setting sync over sockets, and the Docker build setup are
  all worked out there.
```
