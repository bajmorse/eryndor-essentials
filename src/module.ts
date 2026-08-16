/**
 * Maiyalis: Utility Suite — module entry point.
 *
 * Wires the module into FoundryVTT's lifecycle hooks. Feature logic lives in
 * sibling modules under `src/`; this file only bootstraps.
 */
import { LOG_PREFIX, TEMPLATES } from "./constants.js";
import { releaseOwnHolds } from "./daggerheart/deck-holds.js";
import { registerDeckLimitBrowser } from "./daggerheart/deck-limit-browser.js";
import { registerDeckLimitGuard } from "./daggerheart/deck-limit-guard.js";
import { registerDeckLimitWizard } from "./daggerheart/deck-limit-wizard.js";
import { registerHotbarPages } from "./hotbar/hotbar-pages.js";
import { registerGinzzzuPortraits } from "./integrations/ginzzzu-portraits.js";
import { registerVoidHybridForm } from "./integrations/void-hybrid-form.js";
import { registerVoidHybridFormStressEnd } from "./integrations/void-hybrid-form-stress.js";
import { registerSessionLog } from "./session-log/session-log-events.js";
import { registerSessionLogFlagButton } from "./session-log/session-log-flag-button.js";
import { registerSettingsGroups } from "./settings-groups.js";
import { registerSettings } from "./settings.js";
import { registerDragAnimation } from "./tokens/drag-animation.js";
import { registerInvisibleTokens } from "./tokens/invisible-tokens.js";

Hooks.once("init", async () => {
  console.log(`${LOG_PREFIX} Initializing.`);
  registerSettings();
  registerSettingsGroups();
  registerInvisibleTokens();
  registerDragAnimation();
  registerHotbarPages();
  registerSessionLog();
  registerSessionLogFlagButton();
  registerDeckLimitGuard();
  registerDeckLimitBrowser();
  registerDeckLimitWizard();
  // Third-party integrations: each hooks nothing unless its module is active.
  registerVoidHybridForm();
  registerVoidHybridFormStressEnd();
  registerGinzzzuPortraits();
  await foundry.applications.handlebars.loadTemplates(Object.values(TEMPLATES));
});

Hooks.once("ready", () => {
  console.log(`${LOG_PREFIX} Ready (system: ${game.system.id} v${game.system.version}).`);
  // No wizard of ours can be open this early, so any Deck Limit hold still on
  // this user is left over from a crash or a mid-wizard reload.
  void releaseOwnHolds();
});
