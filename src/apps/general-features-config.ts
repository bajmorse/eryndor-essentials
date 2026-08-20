/**
 * The **General Features** window — the module's own quality-of-life behaviour:
 * how tokens look and move, and how the windows other modules put in front of a
 * player behave.
 *
 * Untabbed on purpose: it is one short list of switches. A few of them close a
 * gap in an optional third-party module (raised portraits, roll requests) rather
 * than being strictly first-party — what keeps them here rather than in
 * `daggerheart-automation-config.ts` is that none of them automate a *rule*.
 * That window is for what a printed card says; this one is for how the table's
 * interface behaves.
 */
import { MODULE_ID, SETTINGS, TEMPLATES } from "../constants.js";
import { quickActionsAvailable } from "../integrations/quickactions-roll-request.js";
import { ConfigWindow } from "./config-window.js";

/**
 * `[master, dependent]` pairs: the second control is greyed out while the first
 * is unchecked, because it only modifies what the first switches on.
 *
 *   - Making hidden tokens untouchable only applies to tokens `hideDmTokens` has
 *     hidden.
 *   - The selection lock is what makes an empty selection impossible, and the bar
 *     is the player's only way back when it can't re-select (a ruler up, a token
 *     deleted) — so the lock without the bar is the trap this all exists to fix.
 */
const DEPENDENCIES: readonly (readonly [string, string])[] = [
  [SETTINGS.hideDmTokens, SETTINGS.blockPlayerTokenInteraction],
  [SETTINGS.tokenBar, SETTINGS.tokenBarLockSelection],
] as const;

/**
 * Switches that only mean anything while Daggerheart: Quick Actions is active —
 * both act on windows that module puts in front of a player.
 */
const QUICK_ACTIONS_SETTINGS: readonly string[] = [
  SETTINGS.rollRequestClose,
  SETTINGS.rollRequestOptions,
] as const;

export class GeneralFeaturesConfig extends ConfigWindow {
  static override DEFAULT_OPTIONS: AnyObject = {
    id: `${MODULE_ID}-general-features`,
    window: {
      title: "EE.GeneralFeatures.Title",
      icon: "fa-solid fa-sliders",
    },
  };

  static PARTS = {
    main: { template: TEMPLATES.generalFeatures },
    footer: { template: TEMPLATES.configFooter },
  };

  protected override settingKeys = [
    SETTINGS.hideDmTokens,
    SETTINGS.blockPlayerTokenInteraction,
    SETTINGS.disableDragAnimation,
    SETTINGS.tokenBar,
    SETTINGS.tokenBarLockSelection,
    SETTINGS.refreshRaisedPortraits,
    SETTINGS.rollRequestClose,
    SETTINGS.rollRequestOptions,
  ] as const;

  async _prepareContext(options: AnyObject): Promise<AnyObject> {
    const context = (await super._prepareContext?.(options)) ?? {};
    return {
      ...context,
      version: String(game.modules.get(MODULE_ID)?.["version"] ?? "?"),
      hideDmTokens: GeneralFeaturesConfig.flag(SETTINGS.hideDmTokens),
      blockPlayerTokenInteraction: GeneralFeaturesConfig.flag(SETTINGS.blockPlayerTokenInteraction),
      disableDragAnimation: GeneralFeaturesConfig.flag(SETTINGS.disableDragAnimation),
      tokenBar: GeneralFeaturesConfig.flag(SETTINGS.tokenBar),
      tokenBarLockSelection: GeneralFeaturesConfig.flag(SETTINGS.tokenBarLockSelection),
      refreshRaisedPortraits: GeneralFeaturesConfig.flag(SETTINGS.refreshRaisedPortraits),
      rollRequestClose: GeneralFeaturesConfig.flag(SETTINGS.rollRequestClose),
      rollRequestOptions: GeneralFeaturesConfig.flag(SETTINGS.rollRequestOptions),
      quickActionsActive: quickActionsAvailable(),
    };
  }

  /**
   * The selection lock only means anything alongside the bar — it is what makes
   * an empty selection impossible, and the bar is the player's only way back
   * when it can't re-select (a ruler up, a token deleted). Same greying pattern
   * as `DaggerheartUtilitiesConfig`.
   */
  protected override refreshControls(root: HTMLElement): void {
    for (const [masterKey, dependentKey] of DEPENDENCIES) {
      const master = root.querySelector<HTMLInputElement>(`input[name='${masterKey}']`);
      const dependent = root.querySelector<HTMLInputElement>(`input[name='${dependentKey}']`);
      if (master && dependent) dependent.disabled = !master.checked;
    }

    // Both roll-request switches act on another module's windows, so with that
    // module gone there is nothing for them to act on. Greyed rather than hidden,
    // and paired with the warning line in the template, so the GM can see the
    // feature exists and what it is waiting for. The stored values are untouched
    // — a disabled checkbox keeps its state, so Save reads back what it had.
    if (!quickActionsAvailable()) {
      for (const key of QUICK_ACTIONS_SETTINGS) {
        const input = root.querySelector<HTMLInputElement>(`input[name='${key}']`);
        if (input) input.disabled = true;
      }
    }
  }
}
