/**
 * What makes two things "the same card" — the identity rule the whole Deck Limit
 * rests on. Its own module because both halves of the feature need it: the
 * census of cards on sheets (`deck-pool.ts`) and the reservations made in open
 * wizards (`deck-holds.ts`).
 *
 * A card on a sheet is a *copy* of the compendium entry, with its own id.
 * Foundry stamps the source UUID onto a copy as `_stats.compendiumSource` when
 * it's dragged out of a compendium (`ClientDocument.fromDropData`, and the
 * Daggerheart system's own `createEmbeddedItemData` does the same), which is the
 * strong link — but only ever on one side of a comparison. The compendium entry
 * *is* the source, so its own `compendiumSource` is empty, and a homebrew card
 * authored in the world never gets one at all.
 *
 * So a card is described by a {@link CardKey} carrying both a source UUID (where
 * one exists) and a type+name fallback, and {@link sameCard} compares whichever
 * the two sides have in common. The fallback is deliberately blunt: two
 * different homebrew cards sharing a name count as one card, and renaming a card
 * frees its copy. Both beat the alternative, where every copy is unique and the
 * limit never binds at all.
 */
import { cardTypeFor } from "./deck-limit.js";

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
 * `ownUuid` is for the entry as it sits *in* a compendium (or in the world),
 * where the document's own UUID is what copies of it will point back to.
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
