/**
 * The Session Log's manual "flag this" control.
 *
 * Everything else in the Session Log is inferred from game state — this is the
 * one input the GM drives directly, for moments automation can't see (a good
 * roleplay beat, a decision point). Appears as a button prepended to Foundry's
 * chat sidebar control bar (`#chat-controls`, alongside the roll-mode picker),
 * since that's where the GM's attention already is during play.
 *
 * GM-only, and only added once the master switch and the "flags" category are
 * both on — there is nothing for it to do otherwise, and a button that silently
 * does nothing is worse than not being there. `#chat-controls` is a long-stable
 * Foundry id; if a future core update renames it, this degrades to a console
 * warning rather than a hard failure.
 */
import { LOG_PREFIX } from "../constants.js";
import { categoryEnabled, recordSessionLogEvent } from "./session-log-store.js";

async function promptAndFlag(): Promise<void> {
  const { DialogV2 } = foundry.applications.api;
  let note: string | null;
  try {
    note = (await DialogV2.prompt({
      window: { title: game.i18n.localize("EE.SessionLog.FlagPromptTitle") },
      content: `
        <div class="form-group">
          <label>${game.i18n.localize("EE.SessionLog.FlagPromptLabel")}</label>
          <div class="form-fields">
            <input type="text" name="note" autofocus>
          </div>
        </div>`,
      ok: {
        label: game.i18n.localize("EE.SessionLog.FlagPromptSubmit"),
        callback: (_event: Event, button: AnyObject) =>
          (button?.form?.elements?.namedItem?.("note") as HTMLInputElement | null)?.value ?? "",
      },
    })) as string | null;
  } catch {
    return; // Dismissed via Escape/close — nothing to record.
  }
  if (note === null) return;

  const text = note.trim();
  await recordSessionLogEvent("flags", text ? `GM flag: ${text}` : "GM flag.");
  ui.notifications?.info(game.i18n.localize("EE.SessionLog.Flagged"));
}

function buildButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ee-session-log-flag";
  const label = game.i18n.localize("EE.SessionLog.FlagButton");
  button.setAttribute("aria-label", label);
  button.setAttribute("data-tooltip", label);
  button.innerHTML = `<i class="fa-solid fa-flag"></i>`;

  // Own click listener rather than the ApplicationV2 `actions` map, which has
  // proven unreliable in this Foundry build (see CLAUDE.md) — and this button
  // isn't even inside one of our own ApplicationV2 windows.
  button.addEventListener("click", (event) => {
    event.preventDefault();
    void promptAndFlag();
  });

  return button;
}

/** Install the flag button. Called once during `init`. */
export function registerSessionLogFlagButton(): void {
  Hooks.on("renderChatLog", (_app: AnyObject, html: AnyObject) => {
    if (!game.user?.isGM || !categoryEnabled("flags")) return;

    const root: HTMLElement | null = html instanceof HTMLElement ? html : (html?.[0] ?? null);
    const controls = root?.querySelector<HTMLElement>("#chat-controls");
    if (!controls) {
      console.warn(
        `${LOG_PREFIX} Could not find #chat-controls — the Session Log flag button was not added.`,
      );
      return;
    }

    if (controls.querySelector(".ee-session-log-flag")) return; // Already added on a prior render.
    controls.prepend(buildButton());
  });
}
