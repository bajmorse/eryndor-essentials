/**
 * Registers the module's settings with Foundry. Must be called during the `init`
 * hook (settings cannot be registered later).
 */
import { MODULE_ID, SETTINGS } from "./constants.js";

export function registerSettings(): void {
  game.settings.register(MODULE_ID, SETTINGS.enabled, {
    name: "EE.Settings.Enabled.Name",
    hint: "EE.Settings.Enabled.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });
}
