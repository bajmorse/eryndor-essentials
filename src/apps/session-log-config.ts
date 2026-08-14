/**
 * The **Session Log** window — records what happens during a session so it can
 * later be combined with the Discord voice transcript (Craig) and fed to an LLM
 * to draft session notes.
 *
 * Untabbed: a master switch, one checkbox per log category (see
 * `session-log/session-log-store.ts` for what each category actually records),
 * and an Export button. The category checkboxes are greyed out whenever the
 * master switch is off, the same dependent-control pattern
 * `DaggerheartAutomationConfig` uses for its prototype-token option.
 *
 * The Export button always exports the *most recent* session (whatever
 * `groupIntoSessions` puts last), finished or still in progress — the same
 * session `session-log-export.ts`'s automatic export would eventually reach on
 * its own, just on demand rather than waiting for the next session's first
 * entry to trigger it.
 */
import { MODULE_ID, SETTINGS, TEMPLATES } from "../constants.js";
import { exportSessionToJournal } from "../session-log/session-log-export.js";
import { CATEGORY_SETTING_KEYS, getEntries, groupIntoSessions } from "../session-log/session-log-store.js";
import { ConfigWindow } from "./config-window.js";

export class SessionLogConfig extends ConfigWindow {
  static override DEFAULT_OPTIONS: AnyObject = {
    id: `${MODULE_ID}-session-log`,
    window: {
      title: "EE.SessionLog.Title",
      icon: "fa-solid fa-book",
    },
  };

  static PARTS = {
    main: { template: TEMPLATES.sessionLog },
    footer: { template: TEMPLATES.configFooter },
  };

  protected override settingKeys = [SETTINGS.sessionLogEnabled, ...CATEGORY_SETTING_KEYS] as const;

  async _prepareContext(options: AnyObject): Promise<AnyObject> {
    const context = (await super._prepareContext?.(options)) ?? {};
    return {
      ...context,
      sessionLogEnabled: SessionLogConfig.flag(SETTINGS.sessionLogEnabled),
      sessionLogRolls: SessionLogConfig.flag(SETTINGS.sessionLogRolls),
      sessionLogResources: SessionLogConfig.flag(SETTINGS.sessionLogResources),
      sessionLogStatus: SessionLogConfig.flag(SETTINGS.sessionLogStatus),
      sessionLogCombat: SessionLogConfig.flag(SETTINGS.sessionLogCombat),
      sessionLogScenes: SessionLogConfig.flag(SETTINGS.sessionLogScenes),
      sessionLogFlags: SessionLogConfig.flag(SETTINGS.sessionLogFlags),
    };
  }

  /** Grey out every category checkbox whenever the master switch above them is off. */
  protected override refreshControls(root: HTMLElement): void {
    const master = root.querySelector<HTMLInputElement>(
      `input[name='${SETTINGS.sessionLogEnabled}']`,
    );
    if (!master) return;
    for (const key of CATEGORY_SETTING_KEYS) {
      const input = root.querySelector<HTMLInputElement>(`input[name='${key}']`);
      if (input) input.disabled = !master.checked;
    }
  }

  protected override onAction(action: string, _element: HTMLElement): void {
    if (action === "export") void this.exportCurrentSession();
  }

  private async exportCurrentSession(): Promise<void> {
    const sessions = groupIntoSessions(getEntries());
    const session = sessions[sessions.length - 1];
    if (!session) {
      ui.notifications?.warn(game.i18n.localize("EE.SessionLog.ExportEmpty"));
      return;
    }

    await exportSessionToJournal(session);
    ui.notifications?.info(game.i18n.localize("EE.SessionLog.Exported"));
  }
}
