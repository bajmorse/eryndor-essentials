/**
 * **I See It Coming** (Bone domain, SRD) — "When you're targeted by an attack
 * made from beyond Melee range, you can mark a Stress to roll a d4 and gain a
 * bonus to your Evasion equal to the result against the attack."
 *
 * The SRD ships this as a `domainCard` carrying one action, "Roll d4": a
 * `diceSet` roll that charges the Stress and rolls the die. It stops there.
 * Nothing compares the result to anything, so the table has to decide by hand
 * whether the attack still lands — and by the time the player can press it the
 * attack's chat card has already posted with a hit on it, the damage prompt may
 * already be open, and the walk-back is manual.
 *
 * Registered on the `adversaryAttack` window, which runs after the roll is
 * evaluated but before the chat card exists and before `TargetField.execute`
 * turns the total into `hitResult`s. See `adversary-attack.ts` for why that
 * ordering means nothing ever has to be undone.
 *
 * ## Why the bonus is applied to `target.evasion`
 *
 * Because that is the field every consumer independently agrees on.
 * `D20Roll.buildEvaluate` compares the total against
 * `config.roll.difficulty ?? target.difficulty ?? target.evasion`;
 * `TargetField.execute` and the chat message's own `_getCurrentTargets` both use
 * `target.difficulty || target.evasion`. The message in particular **recomputes
 * the hit on every render** rather than trusting a stored flag — so raising
 * Evasion is what makes the miss survive a page reload, and reach clients that
 * were never part of the exchange. Flipping `hit` alone would be cosmetic and
 * would come apart the first time someone refreshed.
 *
 * ## The three conditions, and why each is checked where it is
 *
 * - **"targeted by an attack"** — read as *hit* by one. The window only opens on
 *   a successful attack, and an Evasion bonus against an attack that already
 *   missed buys nothing but a spent Stress. Strictly the card lets you react to
 *   being targeted at all; offering only when it can change something is the
 *   same choice `blood-maledict.ts` makes, and it preserves the rule's real
 *   tension — you pay before knowing whether d4 will be enough.
 * - **"from beyond Melee range"** — `context.beyond("melee")`, which is *not*
 *   `!within("melee")`: an unmeasurable distance answers false to both, so the
 *   card declines rather than firing on a range nobody established.
 * - **Evasion has to be the number in play** — `context.evasionDecides`. An
 *   attack rolled against a fixed difficulty isn't looking at Evasion, and a
 *   bonus to it would be a Stress spent on nothing.
 *
 * Deliberately *not* checked: that the attacker is an adversary. The card says
 * "an attack", without qualification, unlike Blood Maledict's "an adversary" —
 * so an environment's attack triggers this too.
 */
import { LOG_PREFIX, MODULE_ID, SETTINGS } from "../constants.js";
import type { AdversaryAttackContext } from "./adversary-attack.js";
import { registerFeature } from "./feature-registry.js";
import { rollVisibility } from "./roll-pipeline.js";

/** The SRD Item this comes from — matched ahead of the printed name. */
const I_SEE_IT_COMING_SOURCE = "Compendium.daggerheart.domains.Item.Kp6RejHGimnuoBom";

/** What the card rolls for the bonus. */
const BONUS_FORMULA = "1d4";

/**
 * Priority 20: this *rewrites the outcome* (it can turn the hit into a miss), so
 * it belongs in the rewriter band ahead of anything that merely reacts, which
 * starts at 50. Behind Blood Maledict's 10 only for tidiness — that one records a
 * request and the reroll happens after the loop, re-evaluating against whatever
 * Evasion this left behind either way.
 */
const REWRITE_PRIORITY = 20;

/**
 * Post the d4 so the table can see what the Stress bought.
 *
 * A real Roll message rather than a notification: it animates through Dice So
 * Nice on its own, the total is verifiable afterwards, and it lands just above
 * the attack card the window is still holding — which reads in the right order,
 * a reaction resolving before the attack's outcome is announced.
 *
 * Whispered exactly as far as the attack itself will be. This runs on the
 * *attacker's* client (adversaries roll on the GM's), so a blind or private
 * attack roll would otherwise have its reaction announced to a table that cannot
 * see the attack.
 *
 * Failure is swallowed: the Stress is already spent and the Evasion already
 * raised, and losing the announcement must not cost the player the effect.
 */
async function announce(
  context: AdversaryAttackContext,
  roll: Roll,
  before: number,
): Promise<void> {
  try {
    const { whisper, blind } = rollVisibility(context.config);

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: context.actor }),
      flavor: game.i18n.format("EE.Features.ISeeItComing.Flavor", {
        before,
        after: before + roll.total,
      }),
      // Omitted rather than passed as null: core reads the presence of the field.
      ...(whisper ? { whisper } : {}),
      blind,
    });
  } catch (error) {
    console.warn(`${LOG_PREFIX} I See It Coming: could not post the d4.`, error);
  }
}

export function registerISeeItComing(): void {
  registerFeature<AdversaryAttackContext>({
    id: "iSeeItComing",
    window: "adversaryAttack",
    priority: REWRITE_PRIORITY,
    optional: true,
    match: {
      compendiumSources: [I_SEE_IT_COMING_SOURCE],
      names: ["I See It Coming"],
      // The registry defaults to `feature` Items; this is the first card in it
      // that a character holds as a domain card rather than a granted feature.
      itemTypes: ["domainCard"],
    },
    labelKey: "EE.Features.ISeeItComing.Label",
    hintKey: "EE.Features.ISeeItComing.Hint",
    cost: [{ key: "stress", value: 1 }],

    enabled: () => game.settings.get(MODULE_ID, SETTINGS.iSeeItComingEvasion) === true,

    when: (context) => context.isHitTarget && context.beyond("melee") && context.evasionDecides,

    apply: async (context) => {
      const roll = await new Roll(BONUS_FORMULA).evaluate();
      if (roll.total <= 0) return;

      // The Evasion the player is about to improve, read before the change so the
      // announcement can print both halves of it.
      const before = Number(context.actor["system"]?.["evasion"] ?? 0);

      context.raiseEvasion(roll.total);
      await announce(context, roll, before);
    },
  });
}
