/**
 * The Session Log's storage and settings gate.
 *
 * A log entry is a single plain-text line plus a category and a timestamp —
 * deliberately unstructured beyond that, since the point is to feed an LLM
 * alongside the Discord voice transcript to draft session notes, not to drive
 * any UI of our own (there is no viewer yet — entries live in one world-scoped
 * Array setting for now). Nothing here builds log text; that's
 * `session-log-events.ts` and `session-log-flag-button.ts`.
 *
 * Every write goes through {@link recordSessionLogEvent}, the one place that
 * checks the master switch, the per-category switch, and picks the single
 * client that should actually persist the entry.
 */
import { MODULE_ID, SETTINGS } from "../constants.js";
import { isWriter } from "../utils/is-writer.js";

/** One line in the log. */
export interface SessionLogEntry {
  /** `Date.now()` when the event was recorded. */
  time: number;
  category: SessionLogCategory;
  /** Plain text — no HTML, ready to hand to an LLM as-is. */
  text: string;
}

export type SessionLogCategory = "rolls" | "resources" | "status" | "combat" | "scenes" | "flags";

/** Setting key for each category's on/off switch, in the order they list in the settings window. */
const CATEGORY_SETTINGS: Record<SessionLogCategory, string> = {
  rolls: SETTINGS.sessionLogRolls,
  resources: SETTINGS.sessionLogResources,
  status: SETTINGS.sessionLogStatus,
  combat: SETTINGS.sessionLogCombat,
  scenes: SETTINGS.sessionLogScenes,
  flags: SETTINGS.sessionLogFlags,
};

/** The category setting keys, in display order — shared by `settings.ts` and `SessionLogConfig`. */
export const CATEGORY_SETTING_KEYS: readonly string[] = Object.values(CATEGORY_SETTINGS);

/** The master switch. */
export function masterEnabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.sessionLogEnabled) === true;
}

/** Whether a specific category should be recorded right now (master switch included). */
export function categoryEnabled(category: SessionLogCategory): boolean {
  return masterEnabled() && game.settings.get(MODULE_ID, CATEGORY_SETTINGS[category]) === true;
}

/**
 * Append one line to the log, if the master switch and this category's switch
 * are both on. Silently does nothing otherwise — callers only need a cheap
 * {@link masterEnabled} check before building text, not a full gate.
 *
 * Only {@link isWriter}'s client actually persists — event hooks fire on every
 * connected client, but the world setting can only be written once per event.
 */
export async function recordSessionLogEvent(
  category: SessionLogCategory,
  text: string,
): Promise<void> {
  if (!isWriter() || !categoryEnabled(category)) return;
  const entries = [...getEntries(), { time: Date.now(), category, text }];
  await game.settings.set(MODULE_ID, SETTINGS.sessionLogEntries, entries);
}

/** The log as recorded so far. There's no viewer yet — this is here for when there is one. */
export function getEntries(): SessionLogEntry[] {
  const raw = game.settings.get(MODULE_ID, SETTINGS.sessionLogEntries);
  return Array.isArray(raw) ? (raw as SessionLogEntry[]) : [];
}

/**
 * A gap this long between two consecutive entries means whatever comes after it
 * is a new session, not a continuation of the last one. Long enough that a
 * mid-session server restart (or a dinner break) doesn't split a session in
 * two; short enough that next week's game doesn't get merged into this one.
 */
const SESSION_GAP_MS = 12 * 60 * 60 * 1000;

/**
 * Whether the gap between two consecutive entries' times is long enough that
 * whatever comes after it belongs to a new session. Shared by
 * {@link groupIntoSessions} and `session-log-export.ts`'s automatic-export
 * boundary check, so the threshold only lives in one place.
 */
export function isSessionBoundary(previousTime: number, nextTime: number): boolean {
  return nextTime - previousTime > SESSION_GAP_MS;
}

/** One real-world session's worth of consecutive entries. */
export interface SessionLogSession {
  /** Calendar date of the session's first entry, in the recording client's local time — e.g. `"2026-08-13"`. */
  date: string;
  entries: SessionLogEntry[];
}

/** `time`'s local calendar date as `YYYY-MM-DD`. */
function localDate(time: number): string {
  const d = new Date(time);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Split the log into sessions by activity gap rather than by calendar day —
 * see {@link isSessionBoundary}. A pure derivation over whatever
 * {@link getEntries} returns; nothing about "session" is tracked at write time.
 */
export function groupIntoSessions(entries: SessionLogEntry[]): SessionLogSession[] {
  const sorted = [...entries].sort((a, b) => a.time - b.time);
  const sessions: SessionLogSession[] = [];

  for (const entry of sorted) {
    const current = sessions[sessions.length - 1];
    const previousEntry = current?.entries[current.entries.length - 1];
    if (!current || !previousEntry || isSessionBoundary(previousEntry.time, entry.time)) {
      sessions.push({ date: localDate(entry.time), entries: [entry] });
    } else {
      current.entries.push(entry);
    }
  }

  return sessions;
}
