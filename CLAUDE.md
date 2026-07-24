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
  types/foundry.d.ts   minimal ambient Foundry type shim
dist/module.js         build output (git-ignored)
module.json            manifest — esmodules -> dist/module.js
styles/ templates/ lang/ packs/   served from the repo root as-is
```

## Conventions

- **One id, one title.** `MODULE_ID = "eryndor-essentials"` and `MODULE_TITLE`
  live in `constants.ts`. `LOG_PREFIX` derives from the title; log with
  `` console.log(`${LOG_PREFIX} …`) ``.
- **Settings**: add a key to `SETTINGS` in `constants.ts`, register it in
  `settings.ts`, which is called during the `init` hook (settings can't be
  registered later).
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
- **Hand-edited JSON** (`lang/`, `packs/`): save **UTF-8 without a BOM**. Foundry's
  loader chokes on a BOM, and PowerShell's `Set-Content -Encoding utf8` adds one —
  use `[System.IO.File]::WriteAllText(path, text, (New-Object System.Text.UTF8Encoding($false)))`.
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
