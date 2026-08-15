/**
 * Exporting the Session Log to a Journal Entry.
 *
 * One JournalEntry, **"Session Logs"** (found by name or created on first use),
 * filed in a journal-sidebar folder named after the module so our documents
 * don't sit loose among the world's own, with one page per session — named by
 * the session's date, content a plain chronological list of its entries.
 * Re-exporting a session that already has a page replaces that page's content
 * instead of duplicating it, so both the manual export button
 * (`session-log-config.ts`) and the automatic export below are safe to run more
 * than once for the same session.
 *
 * ## Automatic export
 * {@link checkForSessionBoundary} is wired to `sessionLogEntries`'s `onChange`
 * (see `settings.ts`), which fires on every connected client whenever the
 * setting changes — {@link isWriter} narrows that to the GM's own client. It
 * compares the two newest entries: if the gap between them crosses
 * `session-log-store.ts`'s {@link isSessionBoundary} threshold, the entry just
 * written is the first of a *new* session, which means everything before it is
 * a session that just ended — so that one gets exported. The session currently
 * in progress is never auto-exported; it only becomes eligible once its
 * successor's first entry arrives (or the GM exports it by hand).
 */
import { LOG_PREFIX } from "../constants.js";
import { escapeHtml } from "../utils/escape-html.js";
import { isWriter } from "../utils/is-writer.js";
import {
  groupIntoSessions,
  isSessionBoundary,
  type SessionLogCategory,
  type SessionLogEntry,
  type SessionLogSession,
} from "./session-log-store.js";

const JOURNAL_NAME = "Session Logs";
const FOLDER_NAME = "Utility Suite";

const CATEGORY_LABELS: Record<SessionLogCategory, string> = {
  rolls: "Rolls",
  resources: "Resources",
  status: "Status",
  combat: "Combat",
  scenes: "Scenes",
  flags: "GM Flag",
};

function formatTime(time: number): string {
  const d = new Date(time);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatEntry(entry: SessionLogEntry): string {
  const label = CATEGORY_LABELS[entry.category] ?? entry.category;
  return `<li><strong>[${formatTime(entry.time)}]</strong> <em>${label}</em> — ${escapeHtml(entry.text)}</li>`;
}

function formatSessionContent(session: SessionLogSession): string {
  return `<ul>\n${session.entries.map(formatEntry).join("\n")}\n</ul>`;
}

/**
 * The journal-sidebar folder our exports live in, found by name or created.
 *
 * Returns null rather than throwing if it can't be had: a missing folder means
 * the journal lands at the sidebar root, which is where it lived before this
 * existed — not a reason to lose a session's log.
 */
async function findOrCreateFolder(): Promise<AnyObject | null> {
  // Folders are per-document-type, so the name alone isn't unique — a world may
  // well have an "Utility Suite" folder for Actors or Scenes too.
  const existing = (game.folders as AnyObject | undefined)?.find(
    (folder: AnyObject) => folder["name"] === FOLDER_NAME && folder["type"] === "JournalEntry",
  );
  if (existing) return existing as AnyObject;

  try {
    return (await Folder.create({ name: FOLDER_NAME, type: "JournalEntry" })) ?? null;
  } catch (error: unknown) {
    console.warn(`${LOG_PREFIX} Could not create the "${FOLDER_NAME}" journal folder.`, error);
    return null;
  }
}

/** The "Session Logs" journal, found by name or created on first export. */
async function findOrCreateJournal(): Promise<AnyObject> {
  const folder = await findOrCreateFolder();
  const folderId = (folder?.["id"] as string | undefined) ?? null;

  const existing = (game.journal as AnyObject | undefined)?.find(
    (entry: AnyObject) => entry["name"] === JOURNAL_NAME,
  );
  if (existing) {
    // Worlds that exported before the folder existed keep their journal at the
    // sidebar root; file it away once. `folder` is a Folder document (or null),
    // so a non-null one means the GM has already filed it somewhere of their
    // own choosing — leave that alone.
    if (folderId && existing["folder"] == null) {
      await existing["update"]({ folder: folderId });
    }
    return existing as AnyObject;
  }

  const created = await JournalEntry.create({ name: JOURNAL_NAME, folder: folderId });
  if (!created) throw new Error(`Could not create the "${JOURNAL_NAME}" journal.`);
  return created;
}

/** Find the session's page by date, or create it. Updates in place if it already exists. */
async function writeSessionPage(journal: AnyObject, session: SessionLogSession): Promise<void> {
  const pages = journal["pages"] as AnyObject;
  const existing = pages?.find?.((page: AnyObject) => page["name"] === session.date);
  const content = formatSessionContent(session);

  if (existing) {
    await existing["update"]({ "text.content": content });
  } else {
    await journal["createEmbeddedDocuments"]("JournalEntryPage", [
      {
        name: session.date,
        type: "text",
        text: { content, format: CONST["JOURNAL_ENTRY_PAGE_FORMATS"]?.["HTML"] ?? 1 },
        sort: session.entries[0]?.time ?? 0,
      },
    ]);
  }
}

/** Export one session to its page in the "Session Logs" journal. */
export async function exportSessionToJournal(session: SessionLogSession): Promise<void> {
  if (session.entries.length === 0) return;
  const journal = await findOrCreateJournal();
  await writeSessionPage(journal, session);
  console.debug(
    `${LOG_PREFIX} Session Log exported "${session.date}" to the "${JOURNAL_NAME}" journal.`,
  );
}

/**
 * Called from `sessionLogEntries`'s `onChange` with the setting's new value.
 * See the header comment above for the boundary logic.
 */
export function checkForSessionBoundary(entries: unknown): void {
  if (!isWriter() || !Array.isArray(entries) || entries.length < 2) return;
  const list = entries as SessionLogEntry[];

  const newest = list[list.length - 1];
  const previous = list[list.length - 2];
  if (!newest || !previous || !isSessionBoundary(previous.time, newest.time)) return;

  const endedSessions = groupIntoSessions(list.slice(0, -1));
  const lastEndedSession = endedSessions[endedSessions.length - 1];
  if (!lastEndedSession) return;

  void exportSessionToJournal(lastEndedSession).catch((error: unknown) => {
    console.error(`${LOG_PREFIX} Automatic Session Log export failed.`, error);
  });
}
