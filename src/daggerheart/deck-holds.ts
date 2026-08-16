/**
 * Cards claimed but not yet taken — the "on hold" half of the Deck Limit.
 *
 * Character creation and level-up are wizards: you choose cards over several
 * minutes and nothing lands on the sheet until you finish. Tables level up
 * together, so without this two players spend that time picking the same last
 * copy and only the faster one gets it. A hold is a card someone has selected in
 * an open wizard — visible to everyone, and released the moment the wizard is
 * finished or closed.
 *
 * **Transport is a User flag**, not a socket and not a world setting. A player
 * can always update their own User document (`BaseUser.#canUpdate` permits
 * `user.id === doc.id`, and `flags` isn't restricted), and every client already
 * receives User documents — so writing one flag broadcasts the reservation with
 * no GM in the middle and no message protocol to keep in sync.
 *
 * Holds are *soft state* that must never outlive the wizard that made them.
 * Three things clear them: closing the wizard, finishing it, and loading the
 * world (`releaseOwnHolds` on `ready`, which mops up after a crash or reload).
 * As a fourth backstop, holds from users who aren't connected are ignored on
 * read, so a hold can never permanently strand a card.
 */
import { FLAGS, LOG_PREFIX, MODULE_ID } from "../constants.js";
import { cardKeyOf, sameCard, type CardKey, type CardSource } from "./deck-card-key.js";

/** One user's claim on one card. */
export interface DeckHold {
  readonly userId: string;
  readonly userName: string;
  /** The character being built or levelled, for the "on hold by" message. */
  readonly actorName: string;
  readonly key: CardKey;
}

/** The flag's shape: one entry per open wizard, keyed by its application id. */
type HoldFlag = Record<string, { actorName?: string; cards?: string[] }>;

function readFlag(user: AnyObject): HoldFlag {
  const flag = user["getFlag"]?.(MODULE_ID, FLAGS.deckHolds);
  return flag && typeof flag === "object" ? (flag as HoldFlag) : {};
}

/**
 * Every live hold in the world.
 *
 * Deliberately skips disconnected users: their wizard can't still be open, and
 * a flag left behind by a browser crash would otherwise hold a card forever.
 */
export function collectHolds(): DeckHold[] {
  const holds: DeckHold[] = [];

  for (const user of (game.users?.contents ?? []) as AnyObject[]) {
    if (!user["active"]) continue;

    for (const entry of Object.values(readFlag(user))) {
      for (const uuid of entry?.cards ?? []) {
        // The wizard stores a source UUID; resolving it gives the type and name
        // the fallback identity needs. `strict: false` so an odd UUID is skipped
        // rather than throwing mid-pass.
        const source = fromUuidSync(uuid, { strict: false }) as CardSource | null;
        const key = cardKeyOf(source, uuid);
        if (!key) continue;

        holds.push({
          userId: String(user["id"] ?? ""),
          userName: String(user["name"] ?? "?"),
          actorName: String(entry?.actorName ?? ""),
          key,
        });
      }
    }
  }

  return holds;
}

/**
 * The holds competing for one card. `excludeUserId` drops a user's own claims,
 * which is what lets a wizard commit the cards it reserved.
 */
export function holdsOn(
  holds: readonly DeckHold[],
  key: CardKey,
  excludeUserId?: string,
): DeckHold[] {
  return holds.filter(
    (hold) => hold.userId !== excludeUserId && sameCard(hold.key, key),
  );
}

/** "Alice (Kaelen)" — who is sitting on the card, and for whom. */
export function describeHolds(holds: readonly DeckHold[]): string {
  return holds
    .map((hold) => (hold.actorName ? `${hold.userName} (${hold.actorName})` : hold.userName))
    .join(", ");
}

/** Do these two lists hold the same cards, ignoring order? */
function sameCards(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
}

/**
 * Writes run one at a time.
 *
 * Every write is read-modify-write on a flag that holds *all* of this user's
 * wizards, and the wizards re-render fast enough to overlap two of them. Without
 * this, the second write could be built on the flag the first one replaced,
 * silently resurrecting a released hold.
 */
let writes: Promise<unknown> = Promise.resolve();

function serialize(task: () => Promise<unknown>): Promise<unknown> {
  writes = writes.then(task, task).catch((error: unknown) => {
    console.warn(`${LOG_PREFIX} Deck Limit: could not update card holds.`, error);
  });
  return writes;
}

/**
 * Publish the cards one open wizard is sitting on, replacing whatever it had
 * reserved before. A no-op when nothing changed — these wizards re-render on
 * every keystroke, and each write is a replicated document update.
 */
export async function publishHolds(
  appId: string,
  actorName: string,
  cards: readonly string[],
): Promise<void> {
  await serialize(async () => {
    const user = game.user;
    if (!user) return;

    const current = readFlag(user);
    const existing = current[appId];
    if (existing && existing.actorName === actorName && sameCards(existing.cards ?? [], cards)) {
      return;
    }

    if (!cards.length) {
      if (!(appId in current)) return;
      await writeRemaining(user, current, appId);
      return;
    }

    await user["setFlag"]?.(MODULE_ID, FLAGS.deckHolds, {
      ...current,
      [appId]: { actorName, cards: [...cards] },
    });
  });
}

/** Drop one wizard's holds. Called when it closes, however it closes. */
export async function releaseHolds(appId: string): Promise<void> {
  await serialize(async () => {
    const user = game.user;
    if (!user) return;

    const current = readFlag(user);
    if (!(appId in current)) return;

    await writeRemaining(user, current, appId);
  });
}

/** Write the flag back without one wizard's entry, clearing it if that's the last. */
async function writeRemaining(user: AnyObject, current: HoldFlag, appId: string): Promise<void> {
  const remaining = { ...current };
  delete remaining[appId];

  if (Object.keys(remaining).length === 0) await user["unsetFlag"]?.(MODULE_ID, FLAGS.deckHolds);
  else await user["setFlag"]?.(MODULE_ID, FLAGS.deckHolds, remaining);
}

/**
 * Drop every hold this user owns. Runs at `ready` to clear anything a crash or
 * a mid-wizard reload left behind — by then no wizard of ours is open, so
 * whatever is in the flag is stale by definition.
 */
export async function releaseOwnHolds(): Promise<void> {
  await serialize(async () => {
    const user = game.user;
    if (!user) return;
    if (Object.keys(readFlag(user)).length === 0) return;
    await user["unsetFlag"]?.(MODULE_ID, FLAGS.deckHolds);
  });
}
