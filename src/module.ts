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
import { registerAdversaryAttack } from "./daggerheart/adversary-attack.js";
import { registerBloodMaledict } from "./daggerheart/blood-maledict.js";
import { registerBloodSpike } from "./daggerheart/blood-spike.js";
import { registerCrimsonRite } from "./daggerheart/crimson-rite.js";
import { registerDualityOutcome } from "./daggerheart/duality-outcome.js";
import { registerFearless } from "./daggerheart/fearless.js";
import { registerFeatureAsk } from "./daggerheart/feature-ask.js";
import { registerHoldThemOff } from "./daggerheart/hold-them-off.js";
import { registerISeeItComing } from "./daggerheart/i-see-it-coming.js";
import { registerReach } from "./daggerheart/reach.js";
import { installRollPipeline } from "./daggerheart/roll-pipeline.js";
import { registerHotbarPages } from "./hotbar/hotbar-pages.js";
import { registerGinzzzuPortraits } from "./integrations/ginzzzu-portraits.js";
import { registerQuickActionsRollRequest } from "./integrations/quickactions-roll-request.js";
import { registerVoidHybridForm } from "./integrations/void-hybrid-form.js";
import { registerVoidHybridFormStressEnd } from "./integrations/void-hybrid-form-stress.js";
import { registerSessionLog } from "./session-log/session-log-events.js";
import { registerSessionLogFlagButton } from "./session-log/session-log-flag-button.js";
import { registerSettingsGroups } from "./settings-groups.js";
import { registerSettings } from "./settings.js";
import { registerDragAnimation } from "./tokens/drag-animation.js";
import { registerInvisibleTokens } from "./tokens/invisible-tokens.js";
import { registerTokenBar } from "./tokens/token-bar.js";

Hooks.once("init", async () => {
  console.log(`${LOG_PREFIX} Initializing.`);
  registerSettings();
  registerSettingsGroups();
  registerInvisibleTokens();
  registerTokenBar();
  registerDragAnimation();
  registerHotbarPages();
  registerSessionLog();
  registerSessionLogFlagButton();
  registerDeckLimitGuard();
  registerDeckLimitBrowser();
  registerDeckLimitWizard();
  // Patches the system's data preparation, so it has to be in place before any
  // document is constructed — `init` is the last hook that guarantees that.
  registerReach();
  // Feature automation: every window declares itself, then every feature
  // registers into one, and only then is the system's roll pipeline patched —
  // `installRollPipeline` runs the windows in registration order, so it has to
  // come last. All of it before the first roll, and `init` is the earliest point
  // the system's roll classes are reachable.
  registerFeatureAsk();
  registerDualityOutcome();
  registerAdversaryAttack();
  // Its own window rather than a registry feature — one card's rule, not a
  // reaction anything else could join. After `registerDualityOutcome` because
  // both can fire on the same roll, and the one that rewrites the Hope/Fear
  // result should settle before the one that only reads whether it hit.
  registerBloodSpike();
  registerFearless();
  registerBloodMaledict();
  registerISeeItComing();
  // Its own window too — one class feature's rule, and one that adds targets to a
  // roll rather than reacting to one. Last of the windows, which costs nothing: a
  // weapon attack is neither a spellcast nor an adversary's roll, so no other
  // window is looking at it.
  registerHoldThemOff();
  installRollPipeline();
  // Not a roll window: Crimson Rite is activated by an action and delivered as a
  // standing ActiveEffect, so it hooks the system directly and takes no part in
  // the pipeline's ordering.
  registerCrimsonRite();
  // Third-party integrations: each hooks nothing unless its module is active.
  registerVoidHybridForm();
  registerVoidHybridFormStressEnd();
  registerGinzzzuPortraits();
  registerQuickActionsRollRequest();
  await foundry.applications.handlebars.loadTemplates(Object.values(TEMPLATES));
});

Hooks.once("ready", () => {
  console.log(`${LOG_PREFIX} Ready (system: ${game.system.id} v${game.system.version}).`);
  // No wizard of ours can be open this early, so any Deck Limit hold still on
  // this user is left over from a crash or a mid-wizard reload.
  void releaseOwnHolds();
});
