/**
 * Who is holding which cards — the census behind the Deck Limit.
 *
 * Nothing is stored. The pool is recomputed from the world every time it's
 * asked for, so a card returns to the deck the moment its Item is deleted (or
 * its owner is), with no ledger to drift out of step with reality.
 *
 * Two things take a card out of the deck: a copy sitting on a character sheet
 * (counted here) and a copy claimed in someone's open wizard (`deck-holds.ts`).
 * {@link availabilityOf} is where they meet. What makes two copies the same card
 * lives in `deck-card-key.ts`.
 */
import { MODULE_ID, SETTINGS } from "../constants.js";
import { cardKeyOf, sameCard, type CardKey, type CardSource } from "./deck-card-key.js";
import { holdsOn, type DeckHold } from "./deck-holds.js";
import { poolFor } from "./deck-limit.js";

export type { CardKey, CardSource } from "./deck-card-key.js";

/** A character holding at least one copy of a card. */
export interface CardHolder {
  readonly actorName: string;
  /** Copies on this one sheet — a character can end up holding two. */
  readonly count: number;
}

/** What the pool looks like for one card right now. */
export interface CardAvailability {
  /** Copies the table owns: copies per deck × decks. */
  readonly pool: number;
  /** Copies currently on a character sheet. */
  readonly held: number;
  /** Who has the held copies, for the message that explains the block. */
  readonly holders: readonly CardHolder[];
  /**
   * Copies claimed in someone's open wizard but not yet on a sheet. Counted
   * against the pool like a held copy — the difference is only in what the
   * player is told, since a hold can still evaporate.
   */
  readonly onHold: readonly DeckHold[];
  /**
   * Copies left once holds are ignored. Zero means the card is genuinely gone,
   * as opposed to merely spoken for.
   */
  readonly freeIgnoringHolds: number;
  /** Copies actually available to take. Never negative. */
  readonly free: number;
}

/**
 * Does this actor belong to a player? True when a non-GM user has it as their
 * assigned character *or* owns it outright — tables set these up differently,
 * and a player's second sheet is holding real cards either way.
 *
 * GMs are filtered out first because a GM tests as OWNER on everything, which
 * would make the check meaningless.
 */
function isPlayerCharacter(actor: AnyObject): boolean {
  for (const user of (game.users?.contents ?? []) as AnyObject[]) {
    if (user["isGM"]) continue;
    if (user["character"]?.["id"] === actor["id"]) return true;
    if (actor["testUserPermission"]?.(user, "OWNER") === true) return true;
  }
  return false;
}

/**
 * Does this actor draw cards from the table's decks? The one place that answers
 * it, so counting and enforcement can't disagree about whose cards are in play.
 *
 * Only `character` actors: an adversary or an NPC holding a Domain card isn't
 * drawing from the table's decks, and neither is a companion. Narrowed further
 * to player-owned characters when `deckLimitPlayersOnly` is on.
 */
export function drawsFromDeck(actor: AnyObject | null | undefined): boolean {
  if (!actor || actor["type"] !== "character") return false;
  if (game.settings.get(MODULE_ID, SETTINGS.deckLimitPlayersOnly) !== true) return true;
  return isPlayerCharacter(actor);
}

/** Every actor whose cards count against the pool. */
function characters(): AnyObject[] {
  return (game.actors?.contents ?? []).filter(drawsFromDeck);
}

/** Count the copies of a card currently on character sheets. */
export function findHolders(key: CardKey): CardHolder[] {
  const holders: CardHolder[] = [];

  for (const actor of characters()) {
    let count = 0;
    for (const item of (actor["items"] ?? []) as Iterable<AnyObject>) {
      // Cheap reject first: most of a sheet's items aren't cards at all.
      if (item["type"] !== key.itemType) continue;
      const held = cardKeyOf(item as CardSource);
      if (held && sameCard(held, key)) count++;
    }
    if (count > 0) holders.push({ actorName: String(actor["name"] ?? "?"), count });
  }

  return holders;
}

/**
 * How many copies of this card are left in the deck. Returns null when the card
 * isn't a type the limit covers — an unlimited thing, not an exhausted one.
 *
 * `holds` is passed in rather than gathered here so a caller checking many cards
 * at once (the browser, marking a whole list) reads the world's holds once.
 * `ignoreHoldsFrom` drops one user's own claims, which is what lets a wizard
 * commit the cards it reserved.
 */
export function availabilityOf(
  key: CardKey | null,
  options: { holds?: readonly DeckHold[]; ignoreHoldsFrom?: string } = {},
): CardAvailability | null {
  if (!key) return null;
  const pool = poolFor(key.itemType);
  if (pool === null) return null;

  const holders = findHolders(key);
  const held = holders.reduce((total, holder) => total + holder.count, 0);
  const freeIgnoringHolds = Math.max(0, pool - held);

  const onHold = holdsOn(options.holds ?? [], key, options.ignoreHoldsFrom);

  return {
    pool,
    held,
    holders,
    onHold,
    freeIgnoringHolds,
    free: Math.max(0, freeIgnoringHolds - onHold.length),
  };
}

/** "Kaelen, Sera (×2)" — the holder list as it appears in a dialog or tooltip. */
export function describeHolders(holders: readonly CardHolder[]): string {
  return holders
    .map((holder) =>
      holder.count > 1 ? `${holder.actorName} (×${holder.count})` : holder.actorName,
    )
    .join(", ");
}
