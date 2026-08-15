/**
 * Who is holding which cards — the bookkeeping behind the Deck Limit.
 *
 * Nothing is stored. The pool is recomputed from the world every time it's
 * asked for, so a card returns to the deck the moment its Item is deleted (or
 * its owner is), with no ledger to drift out of step with reality.
 *
 * **Card identity** is the hard part: a card on a sheet is a *copy* of the
 * compendium entry, with its own id. Foundry stamps the source UUID onto a copy
 * as `_stats.compendiumSource` when it's dragged out of a compendium
 * (`ClientDocument.fromDropData`), which is the strong link — but only one side
 * of the comparison ever has it. The compendium entry *is* the source, so its
 * own `compendiumSource` is empty, and a homebrew card authored in the world
 * never gets one at all. So a card is described by a {@link CardKey} holding
 * both a source UUID (where one exists) and a type+name fallback, and
 * {@link sameCard} compares whichever the two have in common.
 *
 * The fallback is deliberately blunt: two different homebrew cards sharing a
 * name count as one card, and renaming a card frees its copy. Both beat the
 * alternative, where every copy is unique and the limit never binds at all.
 */
import { MODULE_ID, SETTINGS } from "../constants.js";
import { cardTypeFor, poolFor } from "./deck-limit.js";

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
  /** Copies still in the deck. Never negative, even if the pool is over-drawn. */
  readonly free: number;
  /** Who has the held copies, for the message that explains the block. */
  readonly holders: readonly CardHolder[];
}

/** Enough of an Item (or of pre-create Item data) to identify the card. */
export interface CardSource {
  readonly type?: string;
  readonly name?: string;
  readonly _stats?: { readonly compendiumSource?: string | null } | null;
}

/** The two ways one card can be recognized. See this file's header. */
export interface CardKey {
  /** The Daggerheart Item type, which also decides the pool. */
  readonly itemType: string;
  /** Source UUID, when this side of the comparison has one. */
  readonly source: string | null;
  /** `type:name`, lowercased — always present, used when sources can't be. */
  readonly fallback: string;
}

/**
 * Describe a card. Null when it isn't a type the limit covers.
 *
 * `ownUuid` is for the entry as it sits *in* a compendium, where the document's
 * own UUID is what copies of it will point back to.
 */
export function cardKeyOf(
  source: CardSource | null | undefined,
  ownUuid?: string | null,
): CardKey | null {
  const itemType = source?.type;
  if (!source || !cardTypeFor(itemType)) return null;

  const stamped = source._stats?.compendiumSource;
  const uuid = ownUuid ?? (typeof stamped === "string" && stamped ? stamped : null);

  return {
    itemType: itemType as string,
    source: uuid,
    fallback: `${itemType}:${(source.name ?? "").trim().toLowerCase()}`,
  };
}

/**
 * Are these the same card? Uses the source UUIDs when both sides have one, and
 * falls back to type+name otherwise — so a compendium entry still matches the
 * copies made from it, and two homebrew cards still match each other.
 */
export function sameCard(a: CardKey, b: CardKey): boolean {
  if (a.source && b.source) return a.source === b.source;
  return a.fallback === b.fallback;
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
 */
export function availabilityOf(key: CardKey | null): CardAvailability | null {
  if (!key) return null;
  const pool = poolFor(key.itemType);
  if (pool === null) return null;

  const holders = findHolders(key);
  const held = holders.reduce((total, holder) => total + holder.count, 0);

  return { pool, held, free: Math.max(0, pool - held), holders };
}

/** "Kaelen, Sera (×2)" — the holder list as it appears in a dialog or tooltip. */
export function describeHolders(holders: readonly CardHolder[]): string {
  return holders
    .map((holder) =>
      holder.count > 1 ? `${holder.actorName} (×${holder.count})` : holder.actorName,
    )
    .join(", ");
}
