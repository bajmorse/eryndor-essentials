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
  art is not rendered on player clients (we blank `mesh`/`border`/`nameplate`/etc.
  but never touch Foundry's `hidden` or `token.visible` — those would take the
  token out of the scene, and we only want it unseen). World setting
  `hideDmTokens` is the master switch; a GM-only token-HUD button toggles
  individual tokens.
  - *Inert tokens* (`blockPlayerTokenInteraction`, **on** by default, greyed out
    while `hideDmTokens` is off). The token is also removed from the pointer-event
    system on player clients: `token.eventMode = "none"`, set from the same
    `refreshToken` hook that blanks the art. Without it an unseen token still
    answers the mouse — hover tooltips off bare ground, click-select and drag of
    something invisible, and getting swept up in a box-select. `"none"` rather
    than `interactive = false` so PIXI skips the object *and its children*.
    - **Box-select falls out for free**, and this is the right way to do it:
      `PlaceablesLayer#controllableObjects()` yields only placeables that are
      `visible && renderable && interactive`, so a marquee (and `controlAll`,
      the select-all keybinding) never sees these tokens. An earlier attempt
      patched `selectObjects` to block the gesture; it was reverted — it left the
      marquee drawing and doing nothing, which reads as broken.
    - Safe to re-set every refresh, and self-undoing: `PlaceableObject#
      _refreshState` re-derives `eventMode = isInteractable ? "static" : "none"`,
      which is what hands interactivity back when the setting is turned off, the
      same way the blanked artwork returns.
    - A `preUpdateToken` backstop cancels player-initiated `x`/`y`/`elevation`/
      `rotation` changes to a flagged token. Inertness closes the pointer routes
      but not the keyboard, and `token-bar.ts` deliberately keeps something
      controlled at all times — arrow keys would otherwise silently move a token
      the GM placed, corrupting the distance automation the tokens exist for.
      `preUpdate*` fires only on the initiating client, so testing `game.user`
      is the same as testing who moved it.
  - **Targeting is unaffected, and that is load-bearing** — it's the reason the
    tokens are on the board at all, along with distance measurement.
    `TokenLayer#setTargets` resolves ids and consults neither visibility nor
    interactivity, and `daggerheart-target-helper` picks targets through its own
    UI (`canvas.tokens.setTargets(...)`), never by clicking the canvas. The target
    reticle (`targetPips`/`targetArrows`) is blanked so a target doesn't reveal
    its position, but `game.user.targets` is untouched.
  - The Tokens on Scene bar is unaffected too, and becomes the player's only way
    to select: it calls `control({force: true})`, which skips the
    `isInteractable` check, and `Token#_canControl` never consults the event mode.
- **Instant token drag** (`src/tokens/drag-animation.ts`) — world setting
  `disableDragAnimation` makes drag-and-dropped tokens snap to the destination
  instead of gliding at `CONFIG.Token.movement.defaultSpeed`. Implemented by
  setting `options.animate = false` from `preUpdateToken` when the update
  operation's `method` is `"dragging"`. Deliberately scoped to drag-drop only —
  keyboard movement, the HUD, paste/undo, and other modules' API moves still
  animate.
- **Tokens on Scene bar** (`src/tokens/token-bar.ts`) — the companion to the
  invisible-token feature above. Because players never see a token, they cannot
  click one — but they *can* still deselect (bare ground, Escape, or picking a
  non-interaction tool, which makes `TokenLayer#_onActivate` call `releaseAll`),
  and with nothing selected **`daggerheart-hud` falls back to the wrong
  character**: its `getPlayerCharacter()` returns
  `game.actors.filter(type === "character" && isOwner)[0]` and **never consults
  `game.user.character`**, so a player who owns two sheets gets somebody else's
  HUD with no visible token to click their way back to. Two halves, both needed:
  a **lock** that re-controls the last token whenever a player's selection
  empties, and a **floating bar** listing the tokens they own on the scene, which
  is the way back when the lock can't re-select (`Token#_canControl` refuses
  while a ruler is measuring; a token can also be deleted). World settings
  `tokenBar` (off by default) and `tokenBarLockSelection` (on, greyed out in the
  window while the bar is off — same `refreshControls` pattern as the Deck Limit
  fields). **Players only**; the GM can click tokens already, and
  `canvas.tokens.ownedTokens` would hand them the whole scene. Notes:
  - The roster is Foundry's own `canvas.tokens.ownedTokens`
    (`placeables.filter(t => t.actor && t.actor.isOwner)`) rather than a
    re-derived filter, sorted assigned-character-first. Rows are keyed and sorted
    on `document.actorId` (the *base* actor — same unlinked-token trap as
    `hotbar-pages.ts`) and labelled with the **actor's** name, since a PC's token
    is routinely left on a generic prototype name.
  - `controlToken` is debounced to 0 and the pass then reads
    `canvas.tokens.controlled`, exactly as `hotbar-pages.ts` does — acting on the
    release event alone would fight the release+control pair one click produces.
    Re-controlling re-enters the pass but settles in one extra turn (the
    selection is non-empty by then); a *failed* re-control fires no hook, so
    there's no loop either way.
  - `control({force: true})` skips `Token#isInteractable` (false whenever the
    active tool isn't an interaction tool). It does **not** bypass permissions —
    `_canControl` still runs.
  - **`CANVAS_SETTLE_MS` (750 ms) is load-bearing and deliberately later than it
    looks.** `daggerheart-hud` also hooks `canvasReady` and calls its own
    `createOrUpdateHUD()` on a **500 ms** timer *unconditionally* — it never
    checks whether a token is selected — so an opening selection made sooner is
    silently overwritten by the very fallback this feature exists to avoid.
    Re-asserting instead of waiting doesn't work: `PlaceableObject#control`
    returns early when the token is already controlled and fires no hook.
  - Each row carries a **crosshair button** opening the Target Helper's *range
    survey* for that token — a read-only list of what's on the scene and how far
    away it is, colour-coded by range band, targeting nothing. Routed through
    `src/integrations/target-helper-survey.ts`, and drawn **only when that
    module answers** (`surveysAvailable()`), since a control that's present but
    inert is worse than no control. It's a sibling `<button>` of the row button
    rather than nested — a `<button>` inside a `<button>` is invalid HTML and
    browsers unnest it — which is why the delegated listener checks
    `[data-ee-survey]` before `[data-ee-token]`.
  - Plain DOM appended to the **body**, not an ApplicationV2 window, following
    `../daggerheart-spotlight-tracker/src/ui/spotlight-bar.ts` (where a
    standalone window was built and removed as too heavy). Dragged by its header
    via pointer capture; the position is the module's **only client-scoped
    setting** (`tokenBarPosition`) — it's one user's window layout, and a player
    has to be able to write it, which world scope would forbid. Clamped back into
    the viewport on create, drag-end and window resize.
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
- **Range survey hookup** (`src/integrations/target-helper-survey.ts`) — *optional*
  integration with the sibling module **Maiyalis: Target Helper**
  (`daggerheart-target-helper`), whose `game.modules.get(…).api.openRangeSurvey`
  opens a read-only window listing everything on the scene with its distance from
  a given token. The only caller is the Tokens on Scene bar above. Gated twice:
  `surveysAvailable()` decides whether the button is drawn at all, and
  `openRangeSurvey` re-checks on click, since a GM can disable a module in
  another tab between the two.
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
- **Reach** (`src/daggerheart/reach.ts`) — the Giant ancestry's secondary feature
  ("Treat any weapon, ability, spell, or other feature that has a Melee range as
  though it had a Very Close range") is prose on a `feature` Item that the system
  enforces nowhere. World setting `reachMeleeAsVeryClose`, off by default, edited
  on the **General** tab of `daggerheartAutomationMenu`. An actor grants it by
  holding a `feature` Item named "Reach" (case-insensitive) — that's how the
  ancestry's feature is embedded on the character, and it's what the system's own
  `sheetLists` filters on. Deliberately *not* matched on other item types: a
  weapon someone named "Reach" shouldn't turn the rule on.
  - The change is made to the **derived** `range` of every Action the actor can
    use, never to stored data. Consumers all read the prepared value — the
    weapon/action tooltips (`templates/ui/tooltip/*.hbs`), the inventory rows, and
    `daggerheart-target-helper`'s `isWithinRange`, which is what actually stops a
    Very Close token being picked as a target for a Melee attack — while the
    action config sheet edits `source.range`, so the GM still sees the printed
    range. Nothing is written to the database, so the rule un-applies itself.
  - **Two hook points, because the system prepares actions in two places.**
    `Item#prepareEmbeddedDocuments` (Daggerheart overrides it to call
    `prepareData()` on each action) covers `system.actions` plus a weapon's base
    `system.attack`; `Actor#prepareData` covers the actor's *own*
    `system.attack` — a character's unarmed strike, an adversary's statblock
    attack — which lives on the actor, not on an item, and is where `melee` is the
    schema default. `system.attack` is **not** in the `system.actions`
    collection; the system's own code concatenates the two everywhere it wants
    both.
  - Prototype patches, because **Foundry fires no hook during data preparation**.
    Installed during `init`: the system assigns `CONFIG.Actor.documentClass` /
    `CONFIG.Item.documentClass` at script load (before any `init` hook) and no
    document is constructed until `setup`, so the patch is in place for the first
    preparation and there is nothing to catch up on at load.
  - The adjustment is **idempotent in both directions**, and has to be:
    `Actor#prepareData` calls `Item#prepareData`, which does *not* re-initialize
    `system` from source, so a one-way write would stick forever. The undo is
    narrow on purpose — it reverts a `veryClose` only when `action._source.range`
    is `melee`, so an action genuinely printed as Very Close is never touched.
    `reconcileReach` (the setting's `onChange`) exists only for the toggle
    changing mid-session, where documents are already prepared and already on
    screen and nothing would otherwise re-prepare them.
- **Feature automation** (`src/daggerheart/feature-registry.ts`,
  `feature-prompt.ts`, `feature-ask.ts`, `roll-pipeline.ts`, `range-bands.ts`,
  `duality-outcome.ts`, `adversary-attack.ts`) — the framework behind Daggerheart
  features phrased *"when X happens, you can pay Y to change the outcome"*. Read
  this before automating another one: the second feature of a kind should be a
  registry entry, not a new interception.
  - **Why a framework and not a hook per feature.** Three structural walls. (1)
    Every interception the system offers is a `Hooks.call`, so a listener **cannot
    await** a player's answer — anything with a choice must be driven from a
    wrapped `async` method. (2) Foundry fires hooks in registration order across
    the whole install, so nothing arbitrates between two features on the same
    event; Fearless rewriting a Fear result *must* run before anything reacting to
    one, which `priority` expresses and independent listeners cannot. (3) One
    dialog per feature is unusable — three Fear-reactive features would mean three
    prompts in arbitrary order.
  - **The shape.** An interception point ("window") builds a context, asks
    `offersFor(window, context)` who is interested, prompts **once** via
    `chooseOffers`, and applies the answers in `priority` order. A feature is data
    plus `when`/`apply`. Non-optional features apply silently before the prompt is
    raised, so the question describes the situation actually being decided.
  - **Matching an Item** — flag, then compendium, then name, in that order.
    `flags.eryndor-essentials.featureId` naming the registry id is the escape
    hatch for homebrew and renamed cards; `_stats.compendiumSource` is the robust
    route for SRD content (survives renames, and a dragged copy still matches);
    the printed name is the last resort. Re-derived per event, never cached — the
    same reasoning as `reach.ts`.
  - **Costs.** `FeatureCost.value` is always the printed magnitude ("mark 2
    Stress" is `2`); direction is the resource's business. Daggerheart has two
    kinds and they move opposite ways — a **reversed** resource (Stress, Hit
    Points, Armor) counts marks used, so paying it *raises* the stored value
    toward `max`, while a normal one (Hope) counts what you hold. Every resource
    carries `isReversed`, and the system's own `CostField` branches on exactly
    that, so `resourceUpdatesFor` mirrors it rather than hardcoding per resource.
    Affordability is all-or-nothing: the system clamps on write, so 5-of-6 Stress
    asked to mark 2 would silently mark 1 and still get the benefit.
  - **The `dualityOutcome` window.** `DualityRoll.buildPost` (system **2.7.2**;
    a version mismatch logs a warning) runs four things in order: DSN presets →
    `super.buildPost` (system hooks, then **the chat message is created**) →
    `dualityUpdate` (Fear countdowns, then queues the GM's +1 Fear) →
    `handleTriggers` (the `fearRoll` trigger, gated on the result still being
    Fear). All four read **`config.roll.result.duality`**, not the roll's getters —
    so rewriting that field ahead of them means the Fear was never gained,
    countdowns never advanced, and other features' `fearRoll` triggers **never
    fired**. There is no equivalent "undo" afterwards.
  - **One patch, on `DHRoll.buildPost`, not `DualityRoll.buildPost` — and the one
    level matters.** `roll-pipeline.ts` owns the single wrapper; windows register
    into it with `registerRollWindow({id, matches, run})` and `installRollPipeline()`
    is called **last** in `module.ts` (registration order is execution order).
    `super.buildPost` resolves past `D20Roll` (which defines no `buildPost` — the
    chain is `Roll → BaseRoll → DHRoll → D20Roll → DualityRoll`) to `DHRoll`, so
    patching there lands a window *between* steps 1 and 2: after the Hope/Fear
    dice presets are stamped, before anything reads the result. It is also why a
    plain adversary `D20Roll` arrives here directly. Every window's `matches` has
    to gate on the roll type because `DHRoll` is the base all of them inherit.
    Classes come from `CONFIG.Dice.daggerheart`, assigned at script load — unlike
    `game.system.api`, which the system only fills inside its own `init`. A `run`
    that returns a Roll **replaces** the one the rest of `buildPost` posts and acts
    on; returning nothing keeps it. A throw from any window is swallowed, so a
    broken feature degrades to an ordinary roll rather than eating the chat card.
  - **The system destroys `config.roll.type` before any window sees it — use
    `rollTypeOf(config)`.** `RollField.prepareConfig` sets it to the action's roll
    type (`attack`, `spellcast`, `trait`, `diceSet`), but `D20Roll.buildEvaluate`
    then does `data.type = config.actionType`, where `actionType` is an unrelated
    taxonomy (`action` | `reaction`, from `CONFIG.DH.ITEM.actionTypes`, initial
    `'action'`). So from `buildPost` onward nothing on the config says what kind
    of roll this was, and a `matches` gating on `config.roll.type === 'attack'`
    silently never fires — no error, no prompt, which is exactly how it presented.
    `roll-pipeline.ts` captures the real type at `daggerheart.preRoll` (the first
    line of `buildConfigure`; `config.hooks` always ends in `''`, which produces
    the unsuffixed hook name) and parks it on `config.eeRollType` — on the config
    itself, because `DHRoll.buildEvaluate` **replaces `config.roll` wholesale**
    with `{...roll.options.roll, total, formula, dice}`. `rollTypeOf` returns null
    rather than falling back to the live field, since after evaluation that field
    answers a different question with the same confidence.
  - **The 3D dice are rolled early, by hand.** Dice So Nice animates off the *chat
    message*, which these windows are holding back — so without this the player
    would be asked to react to a result they had not watched arrive. `showDiceEarly`
    calls `game.dice3d.showForRoll(roll, game.user, true)` and awaits it, but only
    when a prompt is actually going to be raised; a roll that offers nothing keeps
    the system's ordinary timing. This is only correct from `DHRoll.buildPost`,
    because step 1 has by then stamped the presets that make the manual animation
    match the automatic one. Two follow-ups: `roll.options.eeDiceShown` is set and
    a `preCreateChatMessage` hook turns it into `flags.dice-so-nice.skip` (DSN's
    `shouldInterceptMessage` bails on that flag) so the dice don't roll twice, and
    `config.mute = true` stops the message replaying the dice sound — the same
    thing `DamageRoll.buildPost` does when it has rolled dice itself. Verified
    against Dice So Nice **6.2.9**. All of it no-ops when DSN isn't installed, and
    `showForRoll` resolving `false` (blind roll, or its visibility setting) leaves
    both the flag and the sound alone. The dice are shown **only to whoever the
    chat card will reach**: `rollVisibility(config)` asks core's
    `ChatMessage.applyMode` what `config.selectedMessageMode` means in
    `whisper`/`blind` terms — the same mode `DHRoll.toMessage` passes to
    `ChatMessage.create` — and those go to `showForRoll`'s 4th and 5th arguments,
    exactly as the system's own `DamageRoll.buildPost` does. Without that, a GM's
    private roll animates for the whole table and then posts a card only the GM
    can read. Note a roll's visibility is **not** ours to choose: it is one
    message built from one config, so a replaced roll inherits whatever the
    original had, and `core.messageMode` (the chat roll-mode dropdown) is what
    decides it. A window that **replaces** the roll must
    call `clearEarlyDice(config)` first: the dice the table watched belong to the
    discarded roll, and the replacement's have never been seen.
  - **Flipping the result** is done with a persisted marker, not by swapping dice.
    `withHope`/`withFear` are getters comparing the two dice totals with no setter,
    the chat card renders from the *Roll object* (`roll.totalLabel` in the system's
    `roll-part.hbs`), and the Roll is rebuilt from its serialized form on reload —
    so an instance-level override would vanish for every other client. Instead
    `roll.options.eeDualityOverride` (dot-free on purpose: Foundry's object helpers
    treat a dot as a path) round-trips through `toJSON`, and the two getters are
    patched at `init` to honour it. `totalLabel` and `isCritical` follow for free.
    The patch is installed **unconditionally**, whatever the settings say — a
    message converted last session still has to render as Hope today.
  - **Paying** folds into `config.resourceUpdates`, so the cost, the suppressed
    Fear and the gained Hope land as a single actor write. Every path that builds
    a duality roll (`Actor#diceRoll`, `DHBaseAction#use`) flushes that map once the
    roll returns.
  - **The prompt's banner.** A window may pass `headline` alongside `intro`: two
    round portraits with the verdict ("Hit", "Critical") between them, rendered by
    `feature-prompt.ts` and styled under `.ee-feature-prompt` in `styles/module.css`.
    Supply it only when the event really is one party acting on **exactly one**
    other — `adversary-attack.ts` falls back to the `intro` sentence when an
    attack hit several targets, because two circles cannot honestly show three
    people. Portraits come from `actor.img` (and `config.targets[].img`, which the
    system already stamps with `token.actor.img`) rather than token textures,
    since a top-down marker reads as nothing masked into a circle; a missing one
    falls back to core's `icons/svg/mystery-man.svg`. Everything in
    `PromptRequest` stays flat, localized and JSON-safe — it has to cross a socket.
    **No roll totals in a prompt.** Neither the banner nor the `intro` sentence
    names the number: whether the attack landed is what a reacting player decides
    on, the total changes nothing they can do about it, and the chat card may be
    about to withhold it (see the visibility note above). Keep new windows to the
    same line.
  - Dismissal, Escape and the 30s timeout all mean "leave the roll alone" — every
    caller is mid-pipeline holding something back, so the safe answer is always to
    let the unmodified outcome through.
  - **The `adversaryAttack` window** (`adversary-attack.ts`) — reactions to an
    adversary landing a hit. Differs from `dualityOutcome` in three ways that
    shape the code: the reacting character **is not the roller** (so the window
    enumerates candidate characters and builds a context each, rather than one),
    the client holding the pipeline open **is not the client that decides** (see
    the socket bullet below), and the outcome is changed by **replacing the roll**
    rather than editing a field. An adversary rolls a plain `D20Roll` (`Actor#rollClass`
    returns `DualityRoll` only for `character`/`companion`), which has no
    `buildPost`, so these arrive at the pipeline directly — before the chat card,
    before `TargetField.execute` (order 20) turns `config.roll.total` into each
    target's `hitResult`, and before the damage that follows. Candidates come from
    `canvas.tokens.placeables` filtered to `type === "character"`, deduped by actor
    uuid and **sorted by name** so the ask order is stable. They are asked **one at
    a time, stopping at the first acceptance** — once the attack is being rerolled
    there is nothing left to react to, and charging two players for one reroll
    would be worse.
  - **Rerolling means rebuilding, not re-rolling.** On a d20 roll disadvantage is
    not a die to subtract but a second d20 with `kl`, so the formula itself has to
    change. Set `config.roll.advantage = -1`, then `rollClass.createRollInstance(config)`
    and `rollClass.buildEvaluate(...)`. Feeding the evaluated formula back through
    the constructor is safe because `D20Roll.createBaseDice` **throws away
    everything except the leading die** and `configureModifiers` re-derives the
    bonuses from `config.roll.baseModifiers` plus the roll's active effects — the
    modifiers come back by recomputation, never by string surgery. This works at
    all because **`roll.options` *is* the config object**: `createRollInstance`
    passes `config` straight through and core `Roll` does `this.options = options`
    (a reference, `mergeObject` being `inplace` by default). That is also why
    anything stashed on `roll.options` has to be cleared through `config`.
  - **Asking someone else** (`feature-ask.ts`). Foundry has no request/response
    over its socket, so this adds one: a correlation id, a map of waiting
    promises, and a timeout. `responderFor(actor)` picks the active non-GM owner,
    preferring the player who has it assigned as their character, and falls back
    to *this* client (which makes `askUser` skip the socket entirely). The asker
    waits `PROMPT_TIMEOUT_MS + 5s` so the remote dialog's own timeout wins the
    race in every normal case. **Nothing off the socket is trusted**: the answer
    is a list of feature ids, re-checked against the offers the asking client
    built, so a malformed or stale reply can only ever mean *fewer* features fire.
    Costs are charged by the asking client too, keeping the whole transaction on
    one machine — a player disconnecting between "yes" and the reroll cannot leave
    their Hope spent on nothing. The asker also raises a notification naming who
    it is waiting on, because its own roll is visibly frozen until the reply lands.
    `PromptOffer` is flat, localized and JSON-safe for exactly this reason;
    localization happens on the *asking* side.
  - **Range** (`range-bands.ts`). `Token#distanceTo` is the **Daggerheart system's**
    addition to the core Token class (edge-to-edge, elevation-aware) and is what
    the system measures with, so anything checking range has to go through it to
    agree with the ruler and the token-hover readout. Thresholds come from the
    world's `VariantRules.rangeMeasurement`, which a scene may override via
    `scene.flags.daggerheart.rangeMeasurement` when its `setting` is `custom`
    (`disable` only changes *display*, not reach). The comparison is the system's
    own `distance <= threshold`, so sitting exactly on a threshold is **inside**
    the band. Everything returns null rather than guessing when it cannot measure,
    and callers treat null as "don't fire" — a reaction costing 3 Hope must not go
    off on an assumed distance. Deliberately **not** delegating to Maiyalis: Target
    Helper, which has the same logic for its picker: that module is an optional
    integration here, and a printed rule shouldn't stop working when it's disabled.
  - **Two deliberate silences** in `adversaryAttack`: an unmeasurable range (no
    canvas, either actor untokened) and an undeterminable success. `config.roll.success`
    is only populated when the attack had targets or a set difficulty, so a GM who
    rolls with nothing targeted and eyeballs it against Evasion gets no prompt.
  - **Paying when the feature isn't the roller's.** `config.resourceUpdates` is a
    `ResourceUpdateMap` bound to the **rolling** actor, so the adversary window
    cannot use it — folding a player's Hope into it would charge the adversary. It
    calls `actor.modifyResource(...)` directly and **awaits** it, which is why
    `payCost` returns `void | Promise<void>` and `applyOffer` is async: a failed
    write aborts the window before the outcome changes, rather than after.
- **Fearless** (`src/daggerheart/fearless.ts`) — the Infernis ancestry's "When you
  roll with Fear, you can mark 2 Stress to change it into a roll with Hope
  instead." The SRD ships it as a `feature` Item whose single action only charges
  the Stress: no effects, no triggers, nothing converts the result. World setting
  `fearlessFearToHope`, **on** by default (it is the printed rule, and it acts only
  on the player's own answer), on the **General** tab of `daggerheartAutomationMenu`.
  Registered on `dualityOutcome` at priority 10 — rewriters sort ahead of reactors,
  which belong at 50+. The +1 Hope is deliberately *not* applied here: the system's
  own `addDualityResourceUpdates` runs afterwards, reads the rewritten result, and
  grants it. The only thing owed is the 2 Stress.
- **Blood Maledict** (`src/daggerheart/blood-maledict.ts`) — the Blood Hunter's
  (*Void for Daggerheart*) "Spend 3 Hope when an adversary succeeds on an attack
  roll within Close range to make them reroll with disadvantage."
  `Compendium.the-void-unofficial.classes.Item.gugHbXBWP24CFTJZ`, a `feature` Item
  whose single action only charges the Hope — no effects, no triggers, nothing
  forces the reroll. World setting `bloodMaledictReroll`, **on** by default, on the
  **General** tab of `daggerheartAutomationMenu`. Registered on `adversaryAttack`
  at priority 10 (it replaces the roll, so it sorts ahead of readers). *"Within
  Close range"* is read as **the adversary being within Close of you**, which is
  the standard reaction shape and the only reading that can be checked — the
  attack's own range band isn't recorded on the roll. It therefore also fires when
  the adversary hits *someone else* nearby, which is what the card says: it is
  conditioned on an adversary succeeding, not on you being the target. The
  `attacker.type === "adversary"` check lives in the feature, not the window — the
  window only knows "a non-Duality attack roll", and *adversary* is this card's
  wording. Both ends of the table need the module enabled: the prompt is raised on
  the GM's client and shown on the owner's.
- **Crimson Rite** (`src/daggerheart/crimson-rite.ts`) — the Blood Hunter's
  (*Void for Daggerheart*) "Mark a Hit Point to enchant one of your active weapons
  … until the end of your next rest or you use this feature again … an extra 1d4
  magic damage", scaling to 4d4.
  `Compendium.the-void-unofficial.classes.Item.otb0ThXWuqQzzWho`. World setting
  `crimsonRiteEnchant`, **on** by default, on the **General** tab of
  `daggerheartAutomationMenu`. **Not a roll window** — it is the first feature here
  activated by an *action* and delivered as a standing ActiveEffect, so it hooks
  the system directly and is registered after `installRollPipeline()`. Read this
  entry before automating another feature of that shape.
  - **The Void's four shipped "Crimson Rite: Tier N" effects do nothing**, and the
    reason generalizes: `DamageRoll.applyBaseBonus` pulls type bonuses **per damage
    part, keyed on that part's own types** (`options.damageTypes?.forEach(t =>
    getBonus(\`${type}.${t}\`))`). They write to
    `system.bonuses.damage.magical.dice`, and an ordinary weapon's part is
    `type: ["physical"]` — so the bucket is never consulted and enabling one is a
    silent no-op. (They also write `"+2d4"`; `formatModifier` supplies its own
    operator, and the system's own `sharp` armour feature writes an unsigned
    `"1d4"`. Copy `sharp`, not the Void.)
  - **Weapon scoping is native — use it.** `system.bonuses.damage.primaryWeapon` /
    `secondaryWeapon` are gated on the damage roll's source item *being* the
    equipped weapon in that slot (`options.source.item === this.data[slot]?.id`),
    which is the only per-weapon damage scoping the system offers. A character has
    exactly two weapon slots, so "one of your active weapons" is always a
    primary-or-secondary choice. The bonus also shows up in the damage dialog as a
    toggleable "Weapon Bonus". `getActionRelevantEffects` feeds it from
    `actor.allApplicableEffects()`, so an effect created straight onto the actor
    qualifies.
  - **Rest expiry is native too.** `system.duration.type` accepts the ids in
    `CONFIG.DH.EFFECTS.activeEffectDurations`; the system's `expireActiveEffects`
    runs on both rests and `refreshIsAllowed` expires a **`shortRest`** duration on
    *either* kind — so `shortRest` is "until the end of your next rest", while
    `longRest` would survive a short one. Gated on the world's
    `Automation.autoExpireActiveEffects`, which is why the module warns when that
    is off rather than silently granting a permanent rite.
  - **Bonus dice can never be their own damage part.** `Actor#takeDamage` runs the
    main damage through `convertDamageToThreshold`, and Daggerheart thresholds work
    on the **total** — two parts would be converted twice and mark the wrong number
    of Hit Points. Anything adding damage to an existing attack has to join that
    attack's formula, and therefore inherits its damage types. This is the one real
    constraint on the whole class of "deals an extra Nd… of *some other* type"
    features; do not try to model them as separate parts.
  - Consequently the only code this needs is a `daggerheart.preRoll` listener
    adding `magical` to the enchanted weapon's `config.damageFormula.damageTypes`
    (that hook fires for damage rolls too — `DamageRoll` inherits `buildConfigure`
    and adds no hook suffix). The weapon's *base* damage becomes magic as well,
    which is a deviation in the character's favour: `getResistanceStatus` requires
    resistance to **all** of a part's types before it counts.
  - **The two halves are anchored differently** — dice to the slot, damage type to
    the weapon — so an `updateItem`/`deleteItem` guard ends the rite when the
    enchanted weapon leaves its slot, rather than letting them come apart. Any
    manually-enabled Void tier effect is disabled on activation, since giving the
    weapon a `magical` type is exactly the condition that would wake it up and
    stack it on top.
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
  collapsed-by-default `<details>`. That window is the home for the *table's own
  house rules*, as opposed to `daggerheartAutomationMenu`, which automates rules
  the system or a third-party module already states but leaves to the table to
  apply.
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
  - *Holds* (`deck-holds.ts`, `deck-limit-wizard.ts`): character creation and
    level-up are wizards — cards are chosen minutes before any Item exists, and
    tables level up simultaneously, so selections are published as **holds** that
    count against the pool like a held copy but read differently in the UI.
    Transport is a **User flag** (`FLAGS.deckHolds`), because a player may always
    update their own User document (`BaseUser.#canUpdate` permits
    `user.id === doc.id`; `flags` isn't restricted) and User documents replicate
    to every client — so no socket protocol and no GM relay. Holds are cleared on
    wizard close, on `ready` (`releaseOwnHolds`, mopping up after a crash), and
    are ignored on read for users who aren't `active`, so a card can never be
    stranded. Writes are serialized through one promise chain: the flag holds
    *all* of a user's wizards, and these apps re-render fast enough
    (`submitOnChange`) for two read-modify-writes to overlap. Selections are found
    by **walking** `app.setup` (creation) / `app.levelup.toObject()` (level-up)
    rather than by reading known paths — the paths are the system's business, the
    convention is stabler. Two things about that walk are load-bearing, and
    getting either wrong makes it silently find nothing:
    - It reads `sourceUuid`/`uuid`/`itemUuid` by **property access, never
      `Object.entries`**. Character creation assigns live Item *documents*
      (`this.setup.class = item` in its `_onDrop`), and `uuid` on a Document is a
      prototype getter, invisible to enumeration. Level-up stores plain
      `{uuid, itemUuid}` objects. Property access reads both. `sourceUuid` is
      preferred — it's the system's own getter, resolving a copy back through
      `duplicateSource`/`compendiumSource` to the compendium entry.
    - It stops at any node that names a card, and never descends into a Document
      (`documentName` present), whose graph reaches the whole world.

    `Actor.…` UUIDs are skipped (already-created cards, which the census counts),
    as are cards already on the wizard's own actor — a level-up model is seeded
    from previous level-ups, and reserving those would take a copy from everyone
    else twice. Reading a hold resolves its UUID with `fromUuidSync`, which is
    safe on any client: pack indexes are seeded from world data at load and
    Item's `compendiumIndexFields` include `type` and `name`.
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
    rows touches attributes, so watching those would self-retrigger), plus an
    `updateUser` hook so someone else's hold appears while the browser is open.
    Three states, checked in this order: **gone** (`freeIgnoringHolds <= 0`,
    dimmed grey — copies are actually on sheets), **on hold** (`free <= 0`, amber
    dashed outline — merely reserved), available. Both restricted states set
    `draggable="false"`; nothing is ever removed from the list.
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
