/**
 * The one dialog every feature window uses to ask "which of these do you want?".
 *
 * Kept generic and separate from any particular window because consolidating the
 * question is half the reason the registry exists (see `feature-registry.ts`):
 * three Fear-reactive features must produce one dialog, not three.
 *
 * Two shapes, because a single offer does not deserve a checklist:
 * - one offer  — a plain two-button question, the common case at low levels.
 * - several    — a checkbox per offer, all pre-ticked, and one Apply.
 *
 * Dismissing the dialog (Escape, the close button, the timeout) means "none",
 * never "all": every caller is mid-pipeline holding something back, so the safe
 * answer is always to let the unmodified outcome through.
 *
 * ## Why it takes plain data
 *
 * {@link PromptOffer} is deliberately flat, localized and JSON-safe rather than
 * the registry's `FeatureOffer` (which carries live Item and Actor documents).
 * The client that raises this dialog is not always the client that owns the
 * feature — a reaction to a GM-rolled adversary attack is decided by the player
 * whose Hope it costs — so the whole question has to survive a trip over a
 * socket. See `feature-ask.ts`.
 */
import { LOG_PREFIX } from "../constants.js";
import { escapeHtml } from "../utils/escape-html.js";

/**
 * How long a prompt waits before answering "none" for the player.
 *
 * The window that raised it is holding up the roll — no chat card, no resource
 * updates, nothing — for the whole table, so an unattended client cannot be
 * allowed to stall play indefinitely. Long enough to read three lines and
 * decide, short enough that nobody wonders whether the roll broke.
 */
export const PROMPT_TIMEOUT_MS = 30_000;

/** One offer, as the dialog needs it: localized, flat and serializable. */
export interface PromptOffer {
  /** The feature id, which is also the checkbox name and the answer's value. */
  id: string;
  /** Localized feature name. */
  label: string;
  /** Localized explanatory line, if the feature has one. */
  hint?: string;
  /** The granting Item's name, so the player can see which card this came from. */
  itemName: string;
}

/** One side of a {@link PromptHeadline} — who did it, or who it was done to. */
export interface PromptParty {
  /** Display name. */
  name: string;
  /** Portrait path. Falls back to Foundry's own placeholder when absent. */
  img?: string;
}

/**
 * The "what just happened" banner: two portraits with the verdict between them.
 *
 * A window supplies this only when the event really is one party acting on
 * another *and* there is exactly one of each — otherwise {@link
 * PromptRequest.intro} carries the sentence instead. Two circles cannot honestly
 * show an attack that hit three people, and inventing a "+2" badge for it would
 * be a worse lie than a sentence that just lists them.
 */
export interface PromptHeadline {
  /** Left-hand party: whoever acted. */
  source: PromptParty;
  /** Right-hand party: whoever it landed on. */
  target: PromptParty;
  /**
   * Localized verdict — "Hit", "Critical".
   *
   * Deliberately no accompanying number. What a reacting player needs is whether
   * the attack landed; the total it landed with changes nothing they can decide,
   * and printing it hands out a figure the chat card may be about to withhold.
   */
  verdict: string;
}

/** Everything needed to raise the dialog, and nothing that can't cross a socket. */
export interface PromptRequest {
  title: string;
  /**
   * The event as a sentence. Always supplied: it is what renders when there is
   * no {@link headline}, and it is the form that survives any shape of event.
   */
  intro: string;
  /** The banner form of the same information, when the event fits it. */
  headline?: PromptHeadline;
  offers: PromptOffer[];
}

/**
 * Foundry's own stand-in portrait, used when a party has no image. A core asset,
 * so it is present in every install without this module shipping one.
 */
const PLACEHOLDER_PORTRAIT = "icons/svg/mystery-man.svg";

/** One party: a round portrait with the name beneath it. */
function renderParty(party: PromptParty): string {
  return `<div class="ee-feature-party">
    <img class="ee-feature-portrait" src="${escapeHtml(
      party.img || PLACEHOLDER_PORTRAIT,
    )}" alt="" draggable="false">
    <span class="ee-feature-party-name">${escapeHtml(party.name)}</span>
  </div>`;
}

/**
 * The banner: acting party, verdict, receiving party.
 *
 * The names sit *under* the portraits rather than beside them, which keeps the
 * verdict optically centred however long the two names are — a "Minor Treant"
 * against a "Zella Ironstone" would otherwise push it well off to one side.
 */
function renderHeadline(headline: PromptHeadline): string {
  return `<div class="ee-feature-headline">
    ${renderParty(headline.source)}
    <div class="ee-feature-verdict">
      <span class="ee-feature-verdict-label">${escapeHtml(headline.verdict)}</span>
    </div>
    ${renderParty(headline.target)}
  </div>`;
}

/**
 * One row of the dialog: what the feature is, and which card it came from.
 *
 * The card's name is shown only when it differs from the feature's label — for
 * most features they are the same string, and "Blood Maledict (Blood Maledict)"
 * is noise. It earns its place when a homebrew rewrite has been flagged into an
 * SRD feature's automation and the two names genuinely diverge.
 */
function describeOffer(offer: PromptOffer): string {
  const source =
    offer.itemName && offer.itemName !== offer.label
      ? ` <span class="hint">(${escapeHtml(offer.itemName)})</span>`
      : "";

  return `<strong>${escapeHtml(offer.label)}</strong>${source}${
    offer.hint ? `<p class="hint">${escapeHtml(offer.hint)}</p>` : ""
  }`;
}

/**
 * Race the dialog against a timer, closing it if the timer wins.
 *
 * `DialogV2.wait` hands us the instance through its `render` callback, which is
 * the documented way to get at it — so the timeout can close the dialog rather
 * than leaving a live one on screen whose answer would be ignored. `rejectClose:
 * false` makes dismissal resolve `null` instead of throwing.
 */
async function waitWithTimeout(
  config: AnyObject,
  onRender?: (root: HTMLElement) => void,
): Promise<unknown> {
  let dialog: AnyObject | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      // Closing resolves the dialog's own promise too; the race has already been
      // decided, so that result is simply discarded.
      try {
        void dialog?.["close"]?.();
      } catch {
        /* Already gone. Nothing to do. */
      }
      resolve(null);
    }, PROMPT_TIMEOUT_MS);
  });

  const { DialogV2 } = foundry.applications.api;
  const answered = DialogV2.wait({
    ...config,
    rejectClose: false,
    render: (_event: Event, instance: AnyObject) => {
      dialog = instance;
      // A dialog whose content needs live behaviour (see `chooseUpTo`) wires it
      // here, on the same callback, rather than through a second one the caller
      // would have to remember not to pass — `render` is spread away above.
      try {
        const root = instance?.["element"] as HTMLElement | undefined;
        if (root && onRender) onRender(root);
      } catch (error) {
        // The dialog is already on screen and answerable; losing a nicety in it
        // must not cost the player the question.
        console.warn(`${LOG_PREFIX} Feature prompt: could not wire up the dialog.`, error);
      }
    },
  }).catch(() => null);

  try {
    return await Promise.race([answered, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Ask which of `request.offers` to use, on *this* client. Returns the ids the
 * player accepted.
 *
 * Callers pass only *optional* offers; a feature that is not a choice should be
 * applied without asking.
 */
export async function chooseOffers(request: PromptRequest): Promise<Set<string>> {
  const { title, intro, headline, offers } = request;
  if (offers.length === 0) return new Set();

  const chosen = new Set<string>();
  const introHtml = headline ? renderHeadline(headline) : `<p>${escapeHtml(intro)}</p>`;
  // Scopes the stylesheet, and keeps the banner's rules from reaching any other
  // dialog that happens to use the same element names.
  const classes = ["ee-feature-prompt"];

  if (offers.length === 1) {
    const only = offers[0]!;
    const answer = await waitWithTimeout({
      classes,
      window: { title },
      content: `${introHtml}<p class="ee-feature-offer-single">${describeOffer(only)}</p>`,
      buttons: [
        {
          action: "use",
          label: game.i18n.localize("EE.Features.PromptUse"),
          default: true,
        },
        { action: "skip", label: game.i18n.localize("EE.Features.PromptSkip") },
      ],
    });

    if (answer === "use") chosen.add(only.id);
    return chosen;
  }

  // Several: a checkbox each, pre-ticked, read back off the submitting button's
  // form. `button.form.elements` is the documented way into a DialogV2's content.
  const rows = offers
    .map(
      (offer) =>
        `<label class="ee-feature-offer"><input type="checkbox" name="${escapeHtml(
          offer.id,
        )}" checked> ${describeOffer(offer)}</label>`,
    )
    .join("");

  const answer = await waitWithTimeout({
    classes,
    window: { title },
    content: `${introHtml}<div class="ee-feature-offers">${rows}</div>`,
    buttons: [
      {
        action: "apply",
        label: game.i18n.localize("EE.Features.PromptApply"),
        default: true,
        callback: (_event: Event, button: AnyObject) => {
          const form = button?.["form"];
          const picked = offers
            .filter((offer) => form?.elements?.[offer.id]?.checked === true)
            .map((offer) => offer.id);
          return { picked };
        },
      },
      { action: "skip", label: game.i18n.localize("EE.Features.PromptSkip") },
    ],
  });

  const picked = (answer as AnyObject | null)?.["picked"];
  if (Array.isArray(picked)) for (const id of picked) chosen.add(String(id));
  return chosen;
}

/**
 * One candidate in a {@link chooseUpTo} prompt: a party with an id to answer
 * with, and an optional line of context under the name.
 */
export interface PromptChoice extends PromptParty {
  /** What the answer identifies this choice by — a token id, in practice. */
  id: string;
  /** Localized supporting line — how far away this one is, and so on. */
  detail?: string;
}

/** Everything needed to raise a {@link chooseUpTo} prompt. */
export interface ChoiceRequest {
  title: string;
  /** The situation as a sentence, including what the choice will cost. */
  intro: string;
  choices: PromptChoice[];
  /** How many may be taken. The dialog enforces it rather than trimming after. */
  max: number;
  /** Localized confirm button — it should name the price, not just say "OK". */
  confirmLabel: string;
  /**
   * Localized decline button. Required rather than falling back to the shared
   * `EE.Features.PromptSkip`: that one reads "leave the roll alone", which is
   * right for a feature that would have *rewritten* a roll and wrong here, where
   * declining just means the attack goes at whoever it already went at. Word it
   * as the counterpart of {@link confirmLabel}, not as a cancel.
   */
  declineLabel: string;
}

/**
 * Pick up to `max` of `request.choices`. Returns the ids taken, in the order
 * they were offered; empty for "none", which is what dismissal and the timeout
 * both mean.
 *
 * ## Why this isn't {@link chooseOffers}
 *
 * That one asks *which of your features do you want to use* — a fixed, pre-ticked
 * list where taking everything is the usual answer. This asks *which of these
 * people*, where nothing is a default, the list is whoever happens to be standing
 * nearby, and there is a hard limit the rule sets. Same house style, opposite
 * defaults; folding them together would mean a function whose every argument
 * flipped some behaviour.
 *
 * Unlike `chooseOffers` there is no special case for a single choice: the
 * checkbox is what says "you are choosing people, and you may choose none",
 * which a two-button "Use it / Skip" would quietly turn back into a yes/no.
 */
export async function chooseUpTo(request: ChoiceRequest): Promise<string[]> {
  const { title, intro, choices, max, confirmLabel, declineLabel } = request;
  if (choices.length === 0 || max <= 0) return [];

  const rows = choices
    .map(
      (choice) =>
        `<label class="ee-feature-choice">
          <input type="checkbox" name="${escapeHtml(choice.id)}">
          <img class="ee-feature-portrait" src="${escapeHtml(
            choice.img || PLACEHOLDER_PORTRAIT,
          )}" alt="" draggable="false">
          <span class="ee-feature-choice-name">${escapeHtml(choice.name)}</span>
          ${choice.detail ? `<span class="hint">${escapeHtml(choice.detail)}</span>` : ""}
        </label>`,
    )
    .join("");

  const answer = await waitWithTimeout(
    {
      classes: ["ee-feature-prompt"],
      window: { title },
      content: `<p>${escapeHtml(intro)}</p><div class="ee-feature-choices">${rows}</div>`,
      buttons: [
        {
          action: "confirm",
          label: confirmLabel,
          default: true,
          callback: (_event: Event, button: AnyObject) => {
            const form = button?.["form"];
            // Re-capped here as well as in the UI: the limiter below is a
            // convenience on one client's DOM, and this is the answer everything
            // downstream acts on.
            const picked = choices
              .filter((choice) => form?.elements?.[choice.id]?.checked === true)
              .slice(0, max)
              .map((choice) => choice.id);
            return { picked };
          },
        },
        { action: "skip", label: declineLabel },
      ],
    },
    (root) => limitSelection(root, max),
  );

  const picked = (answer as AnyObject | null)?.["picked"];
  return Array.isArray(picked) ? picked.map(String) : [];
}

/**
 * Stop the player ticking more than `max` boxes, by disabling the unticked ones
 * once the limit is reached.
 *
 * Disabling rather than silently dropping the extras: "choose two" should feel
 * like a limit while you are choosing, not like a surprise when you confirm. A
 * disabled checkbox is still in `form.elements` and still reports `checked`, so
 * the callback above reads the same answer either way.
 */
function limitSelection(root: HTMLElement, max: number): void {
  const boxes = Array.from(
    root.querySelectorAll<HTMLInputElement>('.ee-feature-choice input[type="checkbox"]'),
  );

  const sync = (): void => {
    const taken = boxes.filter((box) => box.checked).length;
    for (const box of boxes) box.disabled = !box.checked && taken >= max;
  };

  for (const box of boxes) box.addEventListener("change", sync);
  sync();
}
