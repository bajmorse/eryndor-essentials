/**
 * **Fearless** (Infernis ancestry) — "When you roll with Fear, you can mark 2
 * Stress to change it into a roll with Hope instead."
 *
 * The SRD compendium ships this as a `feature` Item carrying one action, and that
 * action does exactly one thing: charge 2 Stress. It has no effects and no
 * triggers, so nothing converts the result — the player pays the Stress and the
 * table then has to treat a posted Fear roll as Hope by hand, including walking
 * back the Fear the GM has already gained.
 *
 * Registered on the `dualityOutcome` window, which runs before the system has
 * acted on the result at all: see `duality-outcome.ts` for why that ordering is
 * the whole point.
 *
 * The +1 Hope is deliberately *not* applied here. Converting the result is
 * enough — the system's own `addDualityResourceUpdates` runs afterwards, reads
 * the rewritten result, and grants the Hope (and withholds the Fear) itself. The
 * only thing this feature owes is the 2 Stress, which the registry charges from
 * {@link AutomatedFeature.cost}.
 */
import { MODULE_ID, SETTINGS } from "../constants.js";
import type { DualityOutcomeContext } from "./duality-outcome.js";
import { registerFeature } from "./feature-registry.js";

/** The SRD Item this comes from — matched ahead of the printed name. */
const FEARLESS_SOURCE = "Compendium.daggerheart.ancestries.Item.IlWvn5kCqCBMuUJn";

/**
 * Priority 10: Fearless *rewrites* the outcome, so it has to sort ahead of
 * anything that merely reacts to one. Reactive features belong at 50+.
 */
const REWRITE_PRIORITY = 10;

export function registerFearless(): void {
  registerFeature<DualityOutcomeContext>({
    id: "fearless",
    window: "dualityOutcome",
    priority: REWRITE_PRIORITY,
    optional: true,
    match: {
      compendiumSources: [FEARLESS_SOURCE],
      names: ["Fearless"],
    },
    labelKey: "EE.Features.Fearless.Label",
    hintKey: "EE.Features.Fearless.Hint",
    cost: [{ key: "stress", value: 2 }],

    enabled: () => game.settings.get(MODULE_ID, SETTINGS.fearlessFearToHope) === true,

    // Only a Fear result converts. A critical leaves `duality` at 0 and is
    // excluded by the same check — there is nothing there to improve.
    when: (context) => context.duality === -1,

    apply: (context) => context.setDuality(1),
  });
}
