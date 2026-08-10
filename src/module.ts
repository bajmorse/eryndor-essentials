/**
 * Eryndor: Essentials — module entry point.
 *
 * Wires the module into FoundryVTT's lifecycle hooks. Feature logic lives in
 * sibling modules under `src/`; this file only bootstraps.
 */
import { LOG_PREFIX, TEMPLATES } from "./constants.js";
import { registerHotbarPages } from "./hotbar/hotbar-pages.js";
import { registerSettings } from "./settings.js";
import { registerDragAnimation } from "./tokens/drag-animation.js";
import { registerInvisibleTokens } from "./tokens/invisible-tokens.js";

Hooks.once("init", async () => {
  console.log(`${LOG_PREFIX} Initializing.`);
  registerSettings();
  registerInvisibleTokens();
  registerDragAnimation();
  registerHotbarPages();
  await foundry.applications.handlebars.loadTemplates(Object.values(TEMPLATES));
});

Hooks.once("ready", () => {
  console.log(`${LOG_PREFIX} Ready (system: ${game.system.id} v${game.system.version}).`);
});
