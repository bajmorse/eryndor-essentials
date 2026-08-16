/**
 * Showing the Deck Limit in the card picker, so a player sees what's gone before
 * they reach for it.
 *
 * Daggerheart keeps one shared `ItemBrowser` instance (`ui.compendiumBrowser`)
 * and re-opens it with presets for every card-picking flow — character creation,
 * level-up, and the plain compendium browser all funnel through it. So this one
 * pass covers every picker in the system.
 *
 * Two things make it awkward, and both are handled the same way. The browser
 * fills `.item-list` from `loadItems()`, which resolves *after* the render hook
 * fires; and it refills the same element on every search, filter, sort, and
 * folder change without re-rendering the part. A `MutationObserver` on that
 * element covers all of it — one observer per list, re-marking whenever the rows
 * are replaced.
 *
 * Exhausted rows are dimmed and made undraggable rather than removed, per the
 * house rule this implements: you can see the card is in the deck, you can see
 * who has it, you just can't take it. The block itself belongs to
 * `deck-limit-guard.ts` — nothing here is load-bearing, and if the system
 * restyles its browser the worst case is that the greying quietly stops.
 */
import { LOG_PREFIX, MODULE_ID } from "../constants.js";
import { cardKeyOf, type CardSource } from "./deck-card-key.js";
import { collectHolds, describeHolds } from "./deck-holds.js";
import { deckLimitActive } from "./deck-limit.js";
import { availabilityOf, describeHolders } from "./deck-pool.js";

/** Marks rows this module touched, so its tooltip is only removed by its owner. */
const MARKER = "eeDeckExhausted";

/** Dim (or un-dim) every row in one rendering of the list. */
function markRows(list: HTMLElement): void {
  const active = deckLimitActive();
  // Read the world's reservations once for the whole list, not once per row.
  const holds = active ? collectHolds() : [];

  for (const row of list.querySelectorAll<HTMLElement>(".item-container[data-item-uuid]")) {
    const uuid = row.dataset["itemUuid"];

    // The browser has these documents loaded, so this resolves; if it ever
    // returns an index stub instead, `type` and `name` are still enough for the
    // name fallback in cardKeyOf. `strict: false` because the only case that
    // would otherwise throw — a UUID pointing inside a compendium document — is
    // one we'd rather skip than crash the whole pass on.
    const entry = uuid ? (fromUuidSync(uuid, { strict: false }) as CardSource | null) : null;
    const availability = active ? availabilityOf(cardKeyOf(entry, uuid), { holds }) : null;

    // Three states, and the order matters: a card whose copies are genuinely on
    // sheets is *gone*, even if someone also has it reserved. Only a card that
    // would otherwise be free reads as merely spoken for.
    const gone = availability !== null && availability.freeIgnoringHolds <= 0;
    const reserved = !gone && availability !== null && availability.free <= 0;

    row.classList.toggle("ee-deck-exhausted", gone);
    row.classList.toggle("ee-deck-on-hold", reserved);

    if (gone || reserved) {
      row.dataset[MARKER] = "1";
      row.setAttribute("draggable", "false");
      row.dataset["tooltip"] = gone
        ? availability.holders.length
          ? game.i18n.format("EE.DeckLimit.TooltipHeld", {
              holders: describeHolders(availability.holders),
            })
          : game.i18n.localize("EE.DeckLimit.TooltipNone")
        : game.i18n.format("EE.DeckLimit.TooltipOnHold", {
            holders: describeHolds(availability.onHold),
          });
    } else if (row.dataset[MARKER]) {
      // Only undo what we did — the system may own tooltips on other rows.
      delete row.dataset[MARKER];
      row.setAttribute("draggable", "true");
      delete row.dataset["tooltip"];
    }
  }
}

/** Install the picker greying. Called once during `init`. */
export function registerDeckLimitBrowser(): void {
  Hooks.on("renderItemBrowser", (_app: AnyObject, html: AnyObject) => {
    const root: HTMLElement | null = html instanceof HTMLElement ? html : (html?.[0] ?? null);
    const list = root?.querySelector<HTMLElement>(".item-list");
    if (!list) {
      console.warn(`${LOG_PREFIX} Deck Limit: no .item-list in the card browser — not greying it.`);
      return;
    }

    // The rows aren't in yet on this pass — loadItems() fills them in later, and
    // the observer picks that up along with every later refill.
    markRows(list);

    if (list.dataset["eeDeckObserved"]) return;
    list.dataset["eeDeckObserved"] = "1";

    // childList only: marking rows touches attributes, so observing those too
    // would have each pass retrigger the next.
    new MutationObserver(() => markRows(list)).observe(list, { childList: true });
  });

  // Holds live in User flags, so someone else picking a card in their wizard
  // arrives as a User update. Re-mark an open browser so "on hold" appears (and
  // clears) while it's in front of you, rather than on next open.
  Hooks.on("updateUser", (_user: AnyObject, changes: AnyObject) => {
    if (!changes?.["flags"]?.[MODULE_ID]) return;
    const list = (ui["compendiumBrowser"] as AnyObject)?.["element"]?.querySelector?.(".item-list");
    if (list instanceof HTMLElement) markRows(list);
  });
}
