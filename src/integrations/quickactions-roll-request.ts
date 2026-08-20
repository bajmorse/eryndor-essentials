/**
 * Player-side controls on a roll the GM asked for, via **Daggerheart: Quick
 * Actions** (`daggerheart-quickactions`).
 *
 * That module's *Request Roll* window (Daggerheart menu → Request Roll) sends
 * players either a whispered chat card or, in Cinematic Mode, a centred prompt
 * window. Both carry the system's enriched `[[/dr …]]` button, and clicking it is
 * where two things go wrong for the player at the far end.
 *
 * ## 1. The cinematic prompt never closes
 *
 * Quick Actions closes it from a listener on `.cinematic-roll-container`
 * (`request_roll.js`, `CinematicRollPrompt#_onRender`) that waits for the click to
 * bubble up out of the button. It never does: the system wires every enriched
 * button through `enricherRenderSetup`, whose `clickWrapper` calls
 * `event.stopPropagation()` before the handler runs. So the prompt sits on screen
 * over the result. {@link SETTINGS.rollRequestClose} closes it from a **capture
 * phase** listener instead, which runs on the way *down* to the button and so is
 * never suppressed.
 *
 * ## 2. The roll skips everything the player would want to choose
 *
 * `renderDualityButton` resolves who is rolling through the system's
 * `getCommandTarget`, and for a non-GM that reads `game.user.character` and
 * nothing else — it ignores the selected token entirely. A player who drives
 * their character from the Tokens on Scene bar rather than a User assignment
 * therefore falls into the enricher's targetless branch, which hardcodes
 * `config.data = { experiences: {}, traits: {}, rules: {} }`: no experiences to
 * spend Hope on, no trait modifier, and no actor for the roll to belong to.
 *
 * {@link SETTINGS.rollRequestOptions} puts the choices on the request itself —
 * Advantage/Disadvantage and the character's Experiences, one Hope each — and
 * rolls with them directly. The system's own roll dialog is skipped, because the
 * card has already asked everything it would: a requested roll stays one click.
 *
 * Advantage the **GM** set in the request is shown but locked. The request is the
 * GM's ruling on the fiction ("you're flanking, take advantage"), not a default
 * the player is being offered.
 *
 * ## Everything here happens in the capture phase
 *
 * Both halves are clicks on someone else's markup, and both surfaces already have
 * a listener that would otherwise win:
 *
 * - The **system** wires the roll button from `renderHandlebarsApplication`,
 *   which fires *after* `render<PromptClass>` — `#callHooks` walks the
 *   inheritance chain derived-class first. So nothing done to the button during
 *   our own render hook survives; swapping in a fresh clone just hands the system
 *   a fresh clone to wire. {@link interceptRollButton} takes the click on the way
 *   down instead, where registration order cannot matter.
 * - **Quick Actions** has a bubbling close listener on `.cinematic-roll-container`
 *   which cannot tell one click from another. It has never actually fired — the
 *   system's `stopPropagation` sees to that — so every click this module adds
 *   inside that container is the first to reach it. Chips stop their own clicks
 *   ({@link chip}) and the intercepted roll click never gets past capture, so it
 *   stays as dormant as it has always been.
 *
 * ## Where the actor comes from
 *
 * Selected token first, then `game.user.character`, then a lone owned character.
 * Deliberately *not* the system's order: at this table tokens are hidden from
 * players and chosen from the Tokens on Scene bar (see `tokens/token-bar.ts`), so
 * the token a player is driving is the better answer, and often the only one.
 *
 * *Optional*, like every other integration here: with Quick Actions absent or
 * disabled nothing below hooks anything, and with either switch off that half of
 * the behaviour is Quick Actions' own again.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";

/* -------------------------------------------------------------------------- */
/*  Daggerheart: Quick Actions — borrowed internals. Verified against 0.6.3.    */
/*                                                                             */
/*  None of this is a published API. If roll requests stop growing controls     */
/*  after an update, re-read its `scripts/request_roll.js` and                  */
/*  `templates/cinematic-roll-prompt.hbs` and fix these HERE.                   */
/* -------------------------------------------------------------------------- */
const QUICK_ACTIONS = {
  /** Its module id, as registered with Foundry. */
  moduleId: "daggerheart-quickactions",
  /** The version these seams were read against. */
  verifiedVersion: "0.6.3",
  /**
   * Class name of its cinematic prompt window. ApplicationV2 fires
   * `render<ClassName>` for every class in the instance's inheritance chain, so
   * this is the hook suffix — and the module ships unminified, so the name is
   * stable.
   */
  promptClass: "CinematicRollPrompt",
  /** The element its prompt template wraps the enriched roll button in. */
  promptContainer: ".cinematic-roll-container",
  /**
   * Path fragment of the background image every chat card its `buildChatCard`
   * produces carries in an inline style. Paired with an enriched Duality button
   * it identifies a non-cinematic roll request, which is the only card of theirs
   * that has one.
   */
  cardBackground: "modules/daggerheart-quickactions/assets/chat-messages/",
} as const;

/** The system's enriched Duality button — what both surfaces are built around. */
const DUALITY_BUTTON = ".duality-roll-button";

/**
 * Marks a container this module has already rebuilt, so a re-render is
 * idempotent. Written as a `data-*` dataset key (`data-ee-roll-request`).
 */
const ENHANCED_ATTR = "eeRollRequest";

/** Hope spent per Experience applied, per the core rules. */
const HOPE_PER_EXPERIENCE = 1;

/* -------------------------------------------------------------------------- */
/*  Reading the request                                                        */
/* -------------------------------------------------------------------------- */

/** What the GM asked for, read off the enriched button's dataset. */
interface RollRequest {
  /** Trait key (`agility`, …), or null for a bare Duality roll. */
  trait: string | null;
  /** Difficulty to beat, or null when the GM left it blank. */
  difficulty: number | null;
  /** 1 advantage, -1 disadvantage, 0 neither — the GM's setting, if any. */
  advantage: number;
  /** Whether that setting came from the GM, and so is not the player's to change. */
  locked: boolean;
  /** A reaction roll gains no Hope and no Fear. */
  reaction: boolean;
  /** Whether the GM ticked "grant resources" — off by default in their window. */
  grantResources: boolean;
  /** Chat card title, as the system composed it. */
  title: string;
  /** Header line under that title. */
  label: string;
}

/**
 * Read the request off the button the system enriched.
 *
 * The dataset is the same one `renderDualityButton` reads, so this asks the
 * system's own markup rather than re-parsing the `/dr` command behind it —
 * whatever the enricher understood is what the button says.
 *
 * `data-advantage` carries the *signed* state (`1` / `-1`), which is how a GM
 * setting is told from an absent one: `getDualityMessage` only emits it when the
 * request named advantage or disadvantage.
 */
function readRequest(button: HTMLElement): RollRequest {
  const data = button.dataset;

  const advantage = Number(data["advantage"]);
  const locked = advantage === 1 || advantage === -1;

  const difficulty = Number(data["difficulty"]);
  const hasDifficulty = data["difficulty"] !== undefined && Number.isFinite(difficulty);

  return {
    trait: data["trait"]?.toLowerCase() || null,
    difficulty: hasDifficulty ? difficulty : null,
    advantage: locked ? advantage : 0,
    locked,
    reaction: data["reaction"] === "true",
    // Their window leaves this unticked, and the system reads it as a bare
    // presence check — so an absent attribute means "no Hope or Fear from this
    // roll", which is the ordinary case for a requested roll.
    grantResources: Boolean(data["grantResources"]),
    title: data["title"] ?? "",
    label: data["label"] ?? "",
  };
}

/* -------------------------------------------------------------------------- */
/*  Resolving who rolls                                                        */
/* -------------------------------------------------------------------------- */

/** One of the character's Experiences, as offered on the card. */
interface Experience {
  id: string;
  name: string;
  value: number;
  description: string;
}

/**
 * The character this client should roll as, or null when that can't be answered.
 *
 * See the file header for why the selected token outranks `game.user.character`.
 * A GM is refused outright: their own Request Roll window never sends them the
 * cinematic prompt, and a GM with a token selected is not the player being asked.
 */
function rollingActor(): AnyObject | null {
  if (game.user?.isGM !== false) return null;

  for (const token of canvas.tokens?.controlled ?? []) {
    const actor = token.actor;
    if (actor?.["type"] === "character" && actor["isOwner"] === true) return actor;
  }

  const assigned = game.user?.["character"] as AnyObject | null | undefined;
  if (assigned?.["type"] === "character") return assigned;

  const owned = (game.actors?.contents ?? []).filter(
    (actor) => actor["type"] === "character" && actor["isOwner"] === true,
  );
  return owned.length === 1 ? (owned[0] as AnyObject) : null;
}

/** The character's Experiences, in sheet order. Empty for an actor that has none. */
function experiencesOf(actor: AnyObject): Experience[] {
  const raw = (actor["system"]?.["experiences"] ?? {}) as Record<string, AnyObject>;
  return Object.entries(raw)
    .filter(([, experience]) => typeof experience?.["name"] === "string" && experience["name"])
    .map(([id, experience]) => ({
      id,
      name: String(experience["name"]),
      value: Number(experience["value"]) || 0,
      description: String(experience["description"] ?? ""),
    }));
}

/** How much Hope the character has to spend right now. */
function hopeAvailable(actor: AnyObject): number {
  const value = Number(actor["system"]?.["resources"]?.["hope"]?.["value"]);
  return Number.isFinite(value) ? value : 0;
}

/* -------------------------------------------------------------------------- */
/*  Making the roll                                                            */
/* -------------------------------------------------------------------------- */

/** What the player chose on the card. */
interface RollChoices {
  /** 1, -1 or 0 — the GM's value when locked, otherwise the player's. */
  advantage: number;
  /** Ids of the Experiences being applied, one Hope each. */
  experiences: string[];
}

/**
 * Roll the request, with the player's choices already applied.
 *
 * Mirrors the system's own `enrichedDualityRoll` (`getDualityMessage`'s click
 * path) with three deliberate differences:
 *
 * - the actor comes from {@link rollingActor}, so the roll has a character
 *   behind it — traits, Experiences and resources all included;
 * - `dialog.configure` is false, because the card already asked everything the
 *   roll dialog would; and
 * - the Hope for each Experience is actually charged. The system's enricher path
 *   builds `config.costs` in its dialog and then never spends them — it calls
 *   `resourceUpdates.updateResources()` without folding the costs in, the step
 *   the character sheet's own `#rollAttribute` does do. Charging it here rather
 *   than through `CostField` keeps this off an API that expects an Action
 *   context, which a requested roll has none of.
 *
 * Returns whether the roll actually happened — a `daggerheart.preRoll` listener
 * can still cancel it, and a cancelled roll must leave the card as it was.
 */
async function rollRequest(
  actor: AnyObject,
  request: RollRequest,
  choices: RollChoices,
): Promise<boolean> {
  const config: AnyObject = {
    // No modifier keys: the choices came off the card, and an `event` carrying
    // shift/alt/ctrl is exactly what `D20Roll.applyKeybindings` would read them
    // back out of.
    event: {},
    title: request.title,
    headerTitle: request.label,
    actionType: request.reaction ? "reaction" : null,
    roll: {
      trait: request.trait,
      difficulty: request.difficulty ?? undefined,
      advantage: choices.advantage,
    },
    // The system's own reading of a request without "grant resources": no Hope
    // on a Hope result, no Fear on a Fear one, and no feature triggers.
    skips: {
      resources: !request.grantResources,
      triggers: !request.grantResources,
    },
    type: "trait",
    hasRoll: true,
    dialog: { configure: false },
    // Read in `D20Roll#configureModifiers`, which runs from the roll's
    // constructor — so this has to be on the config before `build` is called.
    experiences: choices.experiences,
  };

  const result = (await actor["diceRoll"](config)) as AnyObject | undefined;
  if (!result) return false;

  const hope = choices.experiences.length * HOPE_PER_EXPERIENCE;
  if (hope > 0) {
    result["resourceUpdates"]?.addResources([{ key: "hope", value: -hope, enabled: true }]);
  }
  await result["resourceUpdates"]?.updateResources();
  return true;
}

/* -------------------------------------------------------------------------- */
/*  The controls                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A chip button: one toggle, styled to sit under the request.
 *
 * Every chip stops its own click. Quick Actions' cinematic prompt has a bubbling
 * "close the window" listener on the container these can end up inside, and it
 * cannot tell a chip from the roll button — without this, picking an Experience
 * closes the prompt instead of picking an Experience. (That listener has never
 * fired in its intended case, because the system stops the roll button's click
 * before it gets there; ours are the first clicks ever to reach it.)
 */
function chip(label: string, tooltip: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ee-roll-request-chip";
  // `textContent`, not markup: an Experience's name is player-authored text.
  button.textContent = label;
  if (tooltip) button.dataset["tooltip"] = tooltip;

  button.addEventListener("click", (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });

  return button;
}

/**
 * Build the Advantage/Disadvantage row and the Experience row, and wire them to
 * `choices`. Returns null when there is nothing worth showing — an actor with no
 * Experiences whose advantage the GM already fixed has no choice left to make,
 * and an empty panel is worse than none.
 */
function buildControls(
  actor: AnyObject,
  request: RollRequest,
  choices: RollChoices,
): HTMLElement | null {
  const experiences = experiencesOf(actor);
  if (request.locked && experiences.length === 0) return null;

  const root = document.createElement("div");
  root.className = "ee-roll-request-options";

  /* --- Advantage / Disadvantage ------------------------------------------ */
  const modifiers = document.createElement("div");
  modifiers.className = "ee-roll-request-row";

  const lockedHint = game.i18n.localize("EE.RollRequest.LockedByGm");
  const states: readonly (readonly [number, string])[] = [
    [1, "EE.RollRequest.Advantage"],
    [-1, "EE.RollRequest.Disadvantage"],
  ] as const;

  const modifierChips = states.map(([state, key]) => {
    const button = chip(game.i18n.localize(key), request.locked ? lockedHint : "", () => {
      // Advantage and disadvantage cancel out, so this is one three-state
      // control rather than two switches: picking one clears the other, and
      // picking the current one returns to neither.
      choices.advantage = choices.advantage === state ? 0 : state;
      for (const other of modifierChips) {
        other.button.classList.toggle("selected", choices.advantage === other.state);
      }
    });
    button.classList.toggle("selected", choices.advantage === state);
    if (request.locked) {
      button.disabled = true;
      button.classList.add("locked");
    }
    modifiers.append(button);
    return { state, button };
  });
  root.append(modifiers);

  /* --- Experiences -------------------------------------------------------- */
  if (experiences.length > 0) {
    const row = document.createElement("div");
    row.className = "ee-roll-request-row";

    const cost = document.createElement("p");
    cost.className = "ee-roll-request-cost hint";

    const experienceChips = experiences.map((experience) => {
      const sign = experience.value >= 0 ? "+" : "";
      const button = chip(
        `${experience.name} ${sign}${experience.value}`,
        experience.description,
        () => {
          const index = choices.experiences.indexOf(experience.id);
          if (index > -1) choices.experiences.splice(index, 1);
          else choices.experiences.push(experience.id);
          refresh();
        },
      );
      row.append(button);
      return { experience, button };
    });

    /**
     * Re-derive the row from `choices`: what is selected, what is still
     * affordable, and what the whole thing will cost. Called after every toggle
     * rather than tracked incrementally, so the Hope arithmetic has one home.
     */
    const refresh = (): void => {
      const spent = choices.experiences.length * HOPE_PER_EXPERIENCE;
      const hope = hopeAvailable(actor);

      for (const { experience, button } of experienceChips) {
        const selected = choices.experiences.includes(experience.id);
        button.classList.toggle("selected", selected);
        // An unselected Experience the character can no longer pay for is
        // disabled rather than hidden — the player should see what they are out
        // of Hope for.
        button.disabled = !selected && spent + HOPE_PER_EXPERIENCE > hope;
      }

      cost.textContent =
        spent > 0
          ? game.i18n.format("EE.RollRequest.HopeSpend", { spent, hope })
          : game.i18n.format("EE.RollRequest.HopeAvailable", { hope });
    };

    refresh();
    root.append(row, cost);
  }

  return root;
}

/**
 * Put the controls on one enriched roll button and take the roll over from the
 * system. Returns false — leaving the container untouched — when there is no
 * button, or no character this client could roll as.
 *
 * ## Why a capture-phase interceptor rather than a new button
 *
 * The obvious move is to replace the button with `cloneNode(true)`: same markup,
 * no listeners, system handler gone. It loses a race. `#callHooks` walks
 * `inheritanceChain()` **derived class first**, so `render<PromptClass>` fires
 * before `renderHandlebarsApplication` — and `renderHandlebarsApplication` is the
 * hook the system's `enricherRenderSetup` is on. Whatever button is in the DOM
 * when *that* runs is the one it wires, clone included.
 *
 * So the click is intercepted on the way *down* instead. A capture listener on an
 * ancestor runs before the target's own listeners in every case, and
 * `stopPropagation` there means the event never reaches the button at all —
 * neither the system's handler (and with it `getCommandTarget`, the targetless
 * branch and the roll dialog) nor Quick Actions' own container listener. No
 * ordering assumption left to break.
 *
 * `anchor` is the element the controls are inserted before; null puts them just
 * above the button. `onRolled` runs once the roll has actually been made, and is
 * where each surface does whatever it does afterwards (the prompt closes; the
 * card greys itself out).
 */
function interceptRollButton(
  container: HTMLElement,
  anchor: HTMLElement | null,
  onRolled: () => void,
): boolean {
  const button = container.querySelector<HTMLElement>(DUALITY_BUTTON);
  if (!button) return false;

  const actor = rollingActor();
  if (!actor) return false;

  const request = readRequest(button);
  const choices: RollChoices = { advantage: request.advantage, experiences: [] };

  const controls = buildControls(actor, request, choices);
  if (controls) (anchor ?? button.parentElement ?? button).before(controls);

  container.addEventListener(
    "click",
    (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest?.(DUALITY_BUTTON)) return;

      event.preventDefault();
      event.stopPropagation();

      // A disabled <button> dispatches no click at all, so this only catches a
      // second click that arrives while the first roll is still in flight.
      if (button.hasAttribute("disabled")) return;
      button.setAttribute("disabled", "disabled");

      void (async () => {
        let rolled = false;
        try {
          rolled = await rollRequest(actor, request, choices);
        } catch (error) {
          console.warn(`${LOG_PREFIX} Roll request: the roll failed.`, error);
        }

        if (!rolled) {
          button.removeAttribute("disabled");
          return;
        }

        controls?.classList.add("ee-roll-request-spent");
        for (const control of controls?.querySelectorAll("button") ?? []) {
          control.disabled = true;
        }
        onRolled();
      })();
    },
    { capture: true },
  );

  return true;
}

/* -------------------------------------------------------------------------- */
/*  Wiring                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Whether Quick Actions is installed and enabled in this world. Exported so the
 * General Features window can say why its two switches currently do nothing,
 * rather than offering controls with no effect.
 */
export function quickActionsAvailable(): boolean {
  return game.modules.get(QUICK_ACTIONS.moduleId)?.active === true;
}

/** Read a switch without caring whether it has ever been written. */
function enabled(key: string): boolean {
  return game.settings.get(MODULE_ID, key) === true;
}

/**
 * One loud line if Quick Actions has moved on from the version these seams were
 * read against. Everything here reaches into module internals with no stability
 * guarantee, and a silently unhelpful roll request at the table is worse than a
 * warning in the console.
 */
function warnOnVersionDrift(): void {
  const version = String(game.modules.get(QUICK_ACTIONS.moduleId)?.["version"] ?? "");
  if (!version || version === QUICK_ACTIONS.verifiedVersion) return;

  console.warn(
    `${LOG_PREFIX} Roll request: verified against Quick Actions ` +
      `${QUICK_ACTIONS.verifiedVersion}, running ${version}. ` +
      `Re-check request_roll.js if roll requests misbehave.`,
  );
}

/**
 * The cinematic prompt: rebuild its button, and close the window once the roll
 * is made.
 *
 * The close listener is in the **capture** phase because the system's own
 * handler calls `stopPropagation` — see the file header. It is installed only
 * when this module did *not* take the button over: when it did, the close is
 * driven from the roll completing instead, which is a truer "after the roll" than
 * any timer hung off the click.
 */
function registerCinematicPrompt(): void {
  Hooks.on(
    `render${QUICK_ACTIONS.promptClass}`,
    (app: AnyObject, element: HTMLElement | JQuery) => {
      try {
        const root: HTMLElement | null =
          element instanceof HTMLElement ? element : (element?.[0] ?? null);
        const container = root?.querySelector<HTMLElement>(QUICK_ACTIONS.promptContainer);
        if (!container || container.dataset[ENHANCED_ATTR]) return;
        container.dataset[ENHANCED_ATTR] = "1";

        const close = (): void => {
          if (!enabled(SETTINGS.rollRequestClose)) return;
          // A short delay so the roll's own handler has finished and the dice
          // are on their way before the window goes — the same beat Quick
          // Actions intended with its own (unreachable) listener.
          setTimeout(() => void app["close"]?.(), 100);
        };

        // The controls are anchored *before* the container, so they land as a
        // sibling in the prompt's flex column rather than inside the box the
        // roll button owns — and out of reach of Quick Actions' own listener on
        // that container.
        if (
          enabled(SETTINGS.rollRequestOptions) &&
          interceptRollButton(container, container, close)
        ) {
          return;
        }

        container.addEventListener("click", close, { capture: true });
      } catch (error) {
        console.warn(`${LOG_PREFIX} Roll request: could not enhance the cinematic prompt.`, error);
      }
    },
  );
}

/**
 * The whispered chat card, for a request sent with Cinematic Mode off.
 *
 * Identified by structure rather than a flag: the card is another module's, and
 * a `preCreate` hook stamping our own flag onto it would only work for requests
 * sent after this feature was switched on. A Quick Actions card carries its
 * background image in an inline style, and a roll request is the only one of
 * theirs that also holds an enriched Duality button.
 *
 * The controls are DOM only and are not written back anywhere, so a chat re-render
 * (an edit, a reflow, reopening the log) rebuilds them unselected. Nothing is lost
 * — a roll already made is its own chat message.
 */
function registerChatCard(): void {
  Hooks.on("renderChatMessageHTML", (_message: AnyObject, html: HTMLElement) => {
    try {
      if (!enabled(SETTINGS.rollRequestOptions)) return;

      const content = html?.querySelector?.<HTMLElement>(".chat-card .card-content");
      if (!content || content.dataset[ENHANCED_ATTR]) return;
      if (!content.getAttribute("style")?.includes(QUICK_ACTIONS.cardBackground)) return;
      if (!content.querySelector(DUALITY_BUTTON)) return;
      content.dataset[ENHANCED_ATTR] = "1";

      // Nothing to do afterwards but let the card show it has been used — the
      // controls are already greyed out by the time this runs, and the roll's
      // own chat message is the result. No anchor: the card has no wrapper worth
      // sitting outside, so the controls go directly above the button.
      interceptRollButton(content, null, () =>
        content.classList.add("ee-roll-request-spent"),
      );
    } catch (error) {
      console.warn(`${LOG_PREFIX} Roll request: could not enhance the chat card.`, error);
    }
  });
}

/**
 * Install both halves. Called once during `init`; hooks nothing at all unless
 * Quick Actions is active, and each hook re-reads its own switch on every fire
 * so either can be turned off mid-session.
 */
export function registerQuickActionsRollRequest(): void {
  Hooks.once("ready", () => {
    if (!quickActionsAvailable()) return;
    warnOnVersionDrift();
    registerCinematicPrompt();
    registerChatCard();
  });
}
