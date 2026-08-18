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

/** Everything needed to raise the dialog, and nothing that can't cross a socket. */
export interface PromptRequest {
  title: string;
  intro: string;
  offers: PromptOffer[];
}

/** One row of the dialog: what the feature is, and which card it came from. */
function describeOffer(offer: PromptOffer): string {
  return `<strong>${escapeHtml(offer.label)}</strong> <span class="hint">(${escapeHtml(
    offer.itemName,
  )})</span>${offer.hint ? `<p class="hint">${escapeHtml(offer.hint)}</p>` : ""}`;
}

/**
 * Race the dialog against a timer, closing it if the timer wins.
 *
 * `DialogV2.wait` hands us the instance through its `render` callback, which is
 * the documented way to get at it — so the timeout can close the dialog rather
 * than leaving a live one on screen whose answer would be ignored. `rejectClose:
 * false` makes dismissal resolve `null` instead of throwing.
 */
async function waitWithTimeout(config: AnyObject): Promise<unknown> {
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
  const { title, intro, offers } = request;
  if (offers.length === 0) return new Set();

  const chosen = new Set<string>();
  const introHtml = `<p>${escapeHtml(intro)}</p>`;

  if (offers.length === 1) {
    const only = offers[0]!;
    const answer = await waitWithTimeout({
      window: { title },
      content: `${introHtml}<p>${describeOffer(only)}</p>`,
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
