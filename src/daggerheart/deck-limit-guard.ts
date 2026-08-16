/**
 * Deck Limit enforcement.
 *
 * `preCreateItem` is the choke point: every route a card can take onto a sheet —
 * dragged from a compendium, picked during character creation, granted at
 * level-up, pasted, or created by another module — ends in an embedded Item
 * being created on an Actor. Blocking here means the UI work elsewhere
 * (`deck-limit-browser.ts`) is only ever a courtesy, never the thing standing
 * between a player and a card they shouldn't have.
 *
 * **Why the dialogs are fired off rather than awaited**: `preCreate` hooks are
 * synchronous — returning `false` is the only way to stop a creation, and there
 * is no opportunity to await an answer first. So both paths cancel the creation
 * immediately and then talk to the user:
 * - A player gets a dead end explaining who has the card.
 * - A GM gets a confirmation, and answering yes re-issues the same creation with
 *   {@link BYPASS} set, which this hook waves through.
 *
 * The practical effect for the GM is that the card lands a moment after the
 * click rather than on it. That is worth the ability to say yes at all.
 *
 * Enforcement runs on whichever client initiated the creation, which is where
 * `preCreate` hooks fire. It is a house rule, not a security boundary: every
 * world Actor is replicated to every client, so the count is honest, but a
 * determined player with the console open could still create the Item directly.
 */
import { LOG_PREFIX, MODULE_ID } from "../constants.js";
import { cardKeyOf, type CardSource } from "./deck-card-key.js";
import { collectHolds, describeHolds } from "./deck-holds.js";
import { deckLimitActive } from "./deck-limit.js";
import {
  availabilityOf,
  describeHolders,
  drawsFromDeck,
  type CardAvailability,
} from "./deck-pool.js";

/**
 * Creation option that means "this one has already been through the dialog".
 * Namespaced because the options object travels with the operation.
 */
const BYPASS = `${MODULE_ID}DeckLimitBypass`;

/**
 * Is this creation happening on a sheet the limit governs? `drawsFromDeck` is
 * the same test the census uses, so a character whose cards aren't counted can
 * never be blocked for taking one.
 */
function isGovernedSheet(parent: AnyObject | null | undefined): boolean {
  return parent?.["documentName"] === "Actor" && drawsFromDeck(parent);
}

/**
 * Who has the copies, in one line. A card can be blocked because it's on
 * sheets, because it's reserved in someone's open wizard, or both — and "Alice
 * has it picked in her level-up" is a different message from "Kaelen is holding
 * it", because the first one might free up in a minute.
 */
function describeWhy(availability: CardAvailability): string {
  const parts: string[] = [];
  if (availability.holders.length) {
    parts.push(
      game.i18n.format("EE.DeckLimit.HeldBy", { holders: describeHolders(availability.holders) }),
    );
  }
  if (availability.onHold.length) {
    parts.push(
      game.i18n.format("EE.DeckLimit.OnHoldBy", { holders: describeHolds(availability.onHold) }),
    );
  }
  return parts.length ? parts.join(" ") : game.i18n.localize("EE.DeckLimit.HeldByNobody");
}

/** Tell a player they can't have it, and who to ask. */
async function reportUnavailable(name: string, availability: CardAvailability): Promise<void> {
  const { DialogV2 } = foundry.applications.api;
  const held = describeWhy(availability);

  await DialogV2.prompt({
    window: { title: game.i18n.localize("EE.DeckLimit.BlockedTitle") },
    content: `
      <p>${game.i18n.format("EE.DeckLimit.BlockedBody", { name, pool: availability.pool })}</p>
      <p>${held}</p>
      <p class="hint">${game.i18n.localize("EE.DeckLimit.BlockedAsk")}</p>`,
    ok: { label: game.i18n.localize("EE.DeckLimit.BlockedDismiss") },
  }).catch(() => undefined); // Dismissed with Escape — nothing to do either way.
}

/**
 * Ask the GM whether to exceed the limit, and create the card if they say yes.
 *
 * Re-issuing rather than resuming is what the synchronous hook forces, so this
 * rebuilds the creation from the data the hook was handed.
 */
async function confirmAndCreate(
  data: AnyObject,
  parent: AnyObject,
  name: string,
  availability: CardAvailability,
): Promise<void> {
  const { DialogV2 } = foundry.applications.api;
  const held = describeWhy(availability);

  let confirmed = false;
  try {
    confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize("EE.DeckLimit.ExceedTitle") },
      content: `
        <p>${game.i18n.format("EE.DeckLimit.ExceedBody", { name, pool: availability.pool })}</p>
        <p>${held}</p>
        <p class="hint">${game.i18n.localize("EE.DeckLimit.ExceedHint")}</p>`,
      yes: { label: game.i18n.localize("EE.DeckLimit.ExceedConfirm") },
      no: { label: game.i18n.localize("EE.DeckLimit.ExceedCancel") },
    });
  } catch {
    return; // Dismissed — treat as "no".
  }
  if (!confirmed) return;

  try {
    await Item.create(data, { parent, [BYPASS]: true });
  } catch (error) {
    console.warn(`${LOG_PREFIX} Deck Limit: re-creating "${name}" after confirmation failed.`, error);
  }
}

/** Install the Deck Limit guard. Called once during `init`. */
export function registerDeckLimitGuard(): void {
  Hooks.on(
    "preCreateItem",
    (document: AnyObject, data: AnyObject, options: AnyObject): boolean | void => {
      if (!deckLimitActive()) return;
      if (options?.[BYPASS]) return; // Already answered for.

      // `parent` is the Actor for an embedded creation, and absent for a
      // world/compendium Item — which is the deck itself, not a hand.
      const parent = (document["parent"] ?? options?.["parent"]) as AnyObject | null;
      if (!isGovernedSheet(parent)) return;

      // Read the identity off the document rather than the raw data: Foundry has
      // already merged defaults and stamped `_stats.compendiumSource` by now.
      // Ignore this user's *own* holds. A wizard reserves its picks while it's
      // open and only releases them once it closes, which is after it creates
      // them — so counting them here would have every wizard block itself.
      const availability = availabilityOf(cardKeyOf(document as CardSource), {
        holds: collectHolds(),
        ignoreHoldsFrom: game.user?.id,
      });
      if (!availability) return; // Not a card type the limit covers.
      if (availability.free > 0) return;

      const name = String(document["name"] ?? data?.["name"] ?? "");
      console.debug(
        `${LOG_PREFIX} Deck Limit: blocking "${name}" — ${availability.held}/${availability.pool} in play.`,
      );

      // Deliberately not awaited: the hook must return synchronously to cancel.
      if (game.user?.isGM) {
        void confirmAndCreate(document.toObject(), parent as AnyObject, name, availability);
      } else {
        void reportUnavailable(name, availability);
      }

      return false;
    },
  );
}
