/**
 * The **General Features** window — the module's own behaviour, all of it
 * first-party and none of it tied to a particular system or third-party module.
 *
 * Untabbed on purpose: it is one short list of switches. Daggerheart-specific
 * integrations live in their own window (`daggerheart-automation-config.ts`).
 */
import { MODULE_ID, SETTINGS, TEMPLATES } from "../constants.js";
import { ConfigWindow } from "./config-window.js";

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
    SETTINGS.disableDragAnimation,
    SETTINGS.refreshRaisedPortraits,
  ] as const;

  async _prepareContext(options: AnyObject): Promise<AnyObject> {
    const context = (await super._prepareContext?.(options)) ?? {};
    return {
      ...context,
      version: String(game.modules.get(MODULE_ID)?.["version"] ?? "?"),
      hideDmTokens: GeneralFeaturesConfig.flag(SETTINGS.hideDmTokens),
      disableDragAnimation: GeneralFeaturesConfig.flag(SETTINGS.disableDragAnimation),
      refreshRaisedPortraits: GeneralFeaturesConfig.flag(SETTINGS.refreshRaisedPortraits),
    };
  }
}
