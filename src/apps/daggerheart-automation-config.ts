/**
 * The **Daggerheart Automation** window — integrations with Daggerheart-specific
 * third-party modules.
 *
 * Tabbed with a single tab today ("The Void Automations"). The nav is here from
 * the start so adding the next module's automation is a new `PARTS` entry and a
 * new `TABS` entry, not a restructure.
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
      tabs: [{ id: "void", icon: "fa-solid fa-moon", label: "EE.Automation.Tabs.Void" }],
      initial: "void",
    },
  };

  static PARTS = {
    // Core's own nav markup, so the tabs look like every other Foundry window.
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    void: { template: TEMPLATES.automationVoid },
    // Outside the tabs: one Save/Cancel bar for the whole window.
    footer: { template: TEMPLATES.configFooter },
  };

  protected override settingKeys = [
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
