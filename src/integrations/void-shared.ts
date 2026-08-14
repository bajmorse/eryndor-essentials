/**
 * Shared detection helpers for **The Void (Unofficial)** integrations.
 *
 * Both `void-hybrid-form.ts` (portrait sync) and `void-hybrid-form-stress.ts`
 * (ending the form when Stress is full) need to answer the same two questions —
 * "is this actor an Order of the Lycan?" and "is it transformed right now?" — and
 * both prefer asking The Void itself over guessing. Kept in one place so the two
 * features can never disagree about either answer.
 *
 * **The fallback below is what actually runs today.** `window.Void` (its
 * `features.js`, `Object.assign`'d onto the global) currently exposes only
 * `HybridForm()`, `WarlockFavor`, `DomainCards`, and `ComboStrikes` — not
 * `isOrderOfTheLycan` or `isInHybridForm`, despite both being ordinary (non `_`
 * prefixed) exports of its `hybrid-form.js`. `voidApi()` below is future-proofing
 * for the day it does; until then every call falls through to the name scan, which
 * mirrors Void's own `isInHybridForm` exactly: some effect named one of
 * {@link VOID.formEffectNames}, enabled. Verified against v1.2.9 — if Void starts
 * exporting these, `voidApi()` picks them up with no other change needed.
 */
import { isWriter } from "../utils/is-writer.js";

/** Re-exported so existing `import { isWriter } from "./void-shared.js"` call sites don't need to change. */
export { isWriter };

/* -------------------------------------------------------------------------- */
/*  The Void (Unofficial). Verified against v1.2.9.                            */
/*                                                                             */
/*  The rest of this block is internal detail used only as a fallback — if     */
/*  Hybrid Form detection stops working after an update, re-read its           */
/*  `scripts/hybrid-form.js` and fix the strings HERE.                         */
/* -------------------------------------------------------------------------- */
export const VOID = {
  /** Its module id, as registered with Foundry. */
  moduleId: "the-void-unofficial",
  /** Effect names, used only if `window.Void.isInHybridForm` is unavailable. */
  formEffectNames: ["Hybrid Form", "Hybrid Form - Feral", "Hybrid Form - Apex Hunter"],
} as const;

/** The two questions we ask The Void, both exported on `window.Void` — see the header note above. */
interface VoidApi {
  isOrderOfTheLycan(actor: AnyObject): boolean;
  isInHybridForm(actor: AnyObject): boolean;
}

export function voidActive(): boolean {
  return game.modules.get(VOID.moduleId)?.active === true;
}

/** The Void's public API, or `null` if this build doesn't expose it. */
export function voidApi(): VoidApi | null {
  const api = (globalThis as { Void?: Partial<VoidApi> }).Void;
  return typeof api?.isInHybridForm === "function" ? (api as VoidApi) : null;
}

/** Every effect matching The Void's names, across the actor and its items. */
export function findFormEffects(actor: AnyObject): AnyObject[] {
  const names = VOID.formEffectNames as readonly string[];
  const found: AnyObject[] = [];
  const collections = [
    actor["effects"],
    ...((actor["items"] ?? []) as AnyObject[]).map((item) => item["effects"]),
  ];
  for (const collection of collections) {
    for (const effect of (collection ?? []) as Iterable<AnyObject>) {
      if (names.includes(String(effect?.["name"] ?? ""))) found.push(effect);
    }
  }
  return found;
}

/** Could this actor possibly be in Hybrid Form? Cheap filter before doing work. */
export function isLycan(actor: AnyObject): boolean {
  const api = voidApi();
  if (typeof api?.isOrderOfTheLycan === "function") {
    try {
      return api.isOrderOfTheLycan(actor) === true;
    } catch {
      /* fall through to the name scan */
    }
  }
  return findFormEffects(actor).length > 0;
}

/**
 * Is this actor transformed right now?
 *
 * Delegated to The Void wherever possible so we can never disagree with it. The
 * fallback mirrors what its `isInHybridForm` does — some matching effect enabled.
 */
export function isInHybridForm(actor: AnyObject): boolean {
  const api = voidApi();
  if (api) {
    try {
      return api.isInHybridForm(actor) === true;
    } catch {
      /* fall through to the name scan */
    }
  }
  return findFormEffects(actor).some((effect) => effect["disabled"] !== true);
}
