/**
 * The **Daggerheart Automation** window — rules that are already written down
 * somewhere (in the system, on a card, or in a third-party module) but that
 * nothing applies for you.
 *
 * Two tabs: "General" for the ones we automate directly, and "The Void" for the
 * hookups into that module. Adding another is a new `PARTS` entry and a new
 * `TABS` entry, not a restructure.
 */
import { MODULE_ID, SETTINGS, TEMPLATES } from "../constants.js";
import { ConfigWindow } from "./config-window.js";

/** The Void (Unofficial)'s module id — only used here to report its status. */
const VOID_MODULE_ID = "the-void-unofficial";

/** The tab group id. One group, so ApplicationV2 injects `tabs` into the context. */
const TAB_GROUP = "automation";

export class DaggerheartAutomationConfig extends ConfigWindow {
  static override DEFAULT_OPTIONS: AnyObject = {
    id: `${MODULE_ID}-daggerheart-automation`,
    window: {
      title: "EE.Automation.Title",
      icon: "fa-solid fa-wand-magic-sparkles",
    },
  };

  static TABS: AnyObject = {
    [TAB_GROUP]: {
      tabs: [
        { id: "general", icon: "fa-solid fa-sliders", label: "EE.Automation.Tabs.General" },
        { id: "void", icon: "fa-solid fa-moon", label: "EE.Automation.Tabs.Void" },
      ],
      initial: "general",
    },
  };

  // Declaration order is DOM order: the nav, then each tab's section, then the
  // footer — which sits outside the tabs, so one Save/Cancel bar covers them all.
  static PARTS = {
    // Core's own nav markup, so the tabs look like every other Foundry window.
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    general: { template: TEMPLATES.automationGeneral },
    void: { template: TEMPLATES.automationVoid },
    footer: { template: TEMPLATES.configFooter },
  };

  protected override settingKeys = [
    SETTINGS.reachMeleeAsVeryClose,
    SETTINGS.fearlessFearToHope,
    SETTINGS.bloodMaledictReroll,
    SETTINGS.crimsonRiteEnchant,
    SETTINGS.voidHybridFormPortrait,
    SETTINGS.voidHybridFormPrototype,
    SETTINGS.voidHybridFormStressRevert,
  ] as const;

  async _prepareContext(options: AnyObject): Promise<AnyObject> {
    const context = (await super._prepareContext?.(options)) ?? {};
    const voidModule = game.modules.get(VOID_MODULE_ID);

    return {
      ...context,
      // Handlebars here has no `eq` helper (see CLAUDE.md), so the status line is
      // picked with a precomputed boolean.
      voidActive: voidModule?.active === true,
      voidVersion: String(voidModule?.["version"] ?? ""),
      reach: DaggerheartAutomationConfig.flag(SETTINGS.reachMeleeAsVeryClose),
      fearless: DaggerheartAutomationConfig.flag(SETTINGS.fearlessFearToHope),
      bloodMaledict: DaggerheartAutomationConfig.flag(SETTINGS.bloodMaledictReroll),
      crimsonRite: DaggerheartAutomationConfig.flag(SETTINGS.crimsonRiteEnchant),
      portrait: DaggerheartAutomationConfig.flag(SETTINGS.voidHybridFormPortrait),
      prototype: DaggerheartAutomationConfig.flag(SETTINGS.voidHybridFormPrototype),
      stressRevert: DaggerheartAutomationConfig.flag(SETTINGS.voidHybridFormStressRevert),
    };
  }

  /** Grey out the prototype option whenever the master switch above it is off. */
  protected override refreshControls(root: HTMLElement): void {
    const master = root.querySelector<HTMLInputElement>(
      `input[name='${SETTINGS.voidHybridFormPortrait}']`,
    );
    const dependent = root.querySelector<HTMLInputElement>(
      `input[name='${SETTINGS.voidHybridFormPrototype}']`,
    );
    if (master && dependent) dependent.disabled = !master.checked;
  }
}
