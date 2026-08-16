/**
 * The **General Features** window — the module's own behaviour, all of it
 * first-party and none of it tied to a particular system or third-party module.
 *
 * Untabbed on purpose: it is one short list of switches. Daggerheart-specific
 * integrations live in their own window (`daggerheart-automation-config.ts`).
 */
import { MODULE_ID, SETTINGS, TEMPLATES } from "../constants.js";
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
  }
}
