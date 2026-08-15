/**
 * Deck Limit — treat the table's card pool as physical decks.
 *
 * Playing in person, you can only hand out the cards you actually own: if one
 * Domain card is in someone's loadout, nobody else can hold that same card until
 * it comes back. Foundry has no such constraint, so this feature reintroduces
 * it, scaled by how many physical decks the table has (`deckLimitCount`).
 *
 * This file owns the *shape* of a deck — which card types it contains and how
 * many copies of each. Only the configuration exists so far; nothing enforces a
 * limit yet.
 *
 * The copies-per-deck defaults describe one printed Daggerheart deck. They're
 * settings rather than constants because homebrew and proxy-printed cards are
 * common, and a table with two Community-card sheets shouldn't have to lie about
 * owning two whole decks.
 */
import { MODULE_ID, SETTINGS } from "../constants.js";

/** Decks in play when the limit is on but has never been configured. */
export const DEFAULT_DECK_LIMIT = 1 as const;

/** One kind of card a deck contains. */
export interface DeckCardType {
  /**
   * The Daggerheart Item type this counts, straight from the system's
   * `documentTypes.Item` (verified against the installed system: `ancestry`,
   * `community`, `class`, `subclass`, `feature`, `domainCard`, …).
   */
  readonly itemType: string;
  /** Setting key holding how many copies of each such card one deck contains. */
  readonly settingKey: string;
  /** Copies of each card in one printed deck. */
  readonly copies: number;
  /** Localization key for the field's label. */
  readonly label: string;
}

/**
 * The card types a deck is made of, in the order they're listed in the window.
 *
 * A `subclass` is one Item in this system even though it's three physical cards
 * (Foundation, Specialization, and Mastery live on it as `foundationFeatures` /
 * `specializationFeatures` / `masteryFeatures`, gated by `featureState`), so one
 * copy of the Item is one copy of the whole set — there's no way to hold the
 * Foundation card without the others.
 *
 * `feature`, `loot`, `consumable`, `weapon`, and `armor` are deliberately absent:
 * they aren't cards in the deck this limit is about.
 */
export const DECK_CARD_TYPES: readonly DeckCardType[] = [
  {
    itemType: "domainCard",
    settingKey: SETTINGS.deckCopiesDomain,
    copies: 1,
    label: "EE.Utilities.Copies.Domain",
  },
  {
    itemType: "class",
    settingKey: SETTINGS.deckCopiesClass,
    copies: 1,
    label: "EE.Utilities.Copies.Class",
  },
  {
    itemType: "subclass",
    settingKey: SETTINGS.deckCopiesSubclass,
    copies: 1,
    label: "EE.Utilities.Copies.Subclass",
  },
  {
    itemType: "ancestry",
    settingKey: SETTINGS.deckCopiesAncestry,
    copies: 1,
    label: "EE.Utilities.Copies.Ancestry",
  },
  {
    // The one type a printed deck doubles up on.
    itemType: "community",
    settingKey: SETTINGS.deckCopiesCommunity,
    copies: 2,
    label: "EE.Utilities.Copies.Community",
  },
] as const;

/** Just the setting keys, for registration and for the window's save list. */
export const COPY_SETTING_KEYS: readonly string[] = DECK_CARD_TYPES.map((t) => t.settingKey);

/** Is the limit switched on? Every caller checks this before doing anything. */
export function deckLimitActive(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.deckLimitEnabled) === true;
}

/** The deck entry for a Daggerheart Item type, or undefined if it isn't a card. */
export function cardTypeFor(itemType: string | undefined): DeckCardType | undefined {
  if (!itemType) return undefined;
  return DECK_CARD_TYPES.find((cardType) => cardType.itemType === itemType);
}

/**
 * How many copies of any one card of this type the table owns: copies per deck
 * times decks in play. Zero means none are available — either the deck holds
 * none of that type, or there are no decks.
 *
 * Returns `null` for a type the limit doesn't cover, which callers treat as
 * "unlimited" rather than "none".
 */
export function poolFor(itemType: string | undefined): number | null {
  const cardType = cardTypeFor(itemType);
  if (!cardType) return null;

  const copies = Number(game.settings.get(MODULE_ID, cardType.settingKey));
  const decks = Number(game.settings.get(MODULE_ID, SETTINGS.deckLimitCount));
  if (!Number.isFinite(copies) || !Number.isFinite(decks)) return null;

  return Math.max(0, Math.floor(copies) * Math.floor(decks));
}
