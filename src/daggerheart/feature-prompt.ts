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
 */
import { escapeHtml } from "../utils/escape-html.js";
import type { FeatureContextBase, FeatureOffer } from "./feature-registry.js";

/**
 * How long a prompt waits before answering "none" for the player.
 *
 * The window that raised it is holding up the roll — no chat card, no resource
 * updates, nothing — for the whole table, so an unattended client cannot be
 * allowed to stall play indefinitely. Long enough to read three lines and
 * decide, short enough that nobody wonders whether the roll broke.
 */
const PROMPT_TIMEOUT_MS = 30_000;

/** One row of the dialog: what the feature is, and what it costs. */
function describeOffer<C extends FeatureContextBase>(offer: FeatureOffer<C>): string {
  const label = game.i18n.localize(offer.feature.labelKey);
  const hint = offer.feature.hintKey ? game.i18n.localize(offer.feature.hintKey) : "";
  const item = escapeHtml(String(offer.item["name"] ?? label));

  return `<strong>${escapeHtml(label)}</strong> <span class="hint">(${item})</span>${
    hint ? `<p class="hint">${escapeHtml(hint)}</p>` : ""
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
 * Ask which of `offers` to use. Returns the ids the player accepted, in the
 * order they were offered (which is the registry's priority order).
 *
 * Callers pass only *optional* offers; a feature that is not a choice should be
 * applied without asking.
 */
export async function chooseOffers<C extends FeatureContextBase>(
  title: string,
  intro: string,
  offers: readonly FeatureOffer<C>[],
): Promise<Set<string>> {
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

    if (answer === "use") chosen.add(only.feature.id);
    return chosen;
  }

  // Several: a checkbox each, pre-ticked, read back off the submitting button's
  // form. `button.form.elements` is the documented way into a DialogV2's content.
  const rows = offers
    .map(
      (offer) =>
        `<label class="ee-feature-offer"><input type="checkbox" name="${escapeHtml(
          offer.feature.id,
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
            .filter((offer) => form?.elements?.[offer.feature.id]?.checked === true)
            .map((offer) => offer.feature.id);
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
