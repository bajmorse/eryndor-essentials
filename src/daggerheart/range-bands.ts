/**
 * Range bands — "is this actor within Close range of that one?"
 *
 * Features phrased "within Close range" need the same answer the ruler, the
 * token-hover readout and the system's own range-dependent effects would give, so
 * this mirrors the system rather than inventing a measurement:
 *
 * - **Distance** comes from `Token#distanceTo`, which the Daggerheart system adds
 *   to the core Token class. It is edge-to-edge and elevation-aware, and it is
 *   what the system itself measures with.
 * - **Thresholds** come from the world's `VariantRules.rangeMeasurement` setting
 *   (the foot distance each band reaches), which a scene may override with its
 *   own via `scene.flags.daggerheart.rangeMeasurement`. The comparison below is
 *   the system's `ranges[r] >= distanceValue` from `getRangeLabels`, so an actor
 *   sitting exactly on a threshold is *inside* that band, same as everywhere else.
 *
 * Everything here returns null rather than guessing when it cannot measure — no
 * canvas, no token for one of the actors, unreadable thresholds. Theatre-of-mind
 * play hits that path constantly, and a feature that fired on an assumed distance
 * would be spending a player's resources on a range nobody checked.
 *
 * Deliberately *not* delegating to Maiyalis: Target Helper, which has the same
 * logic for its picker. That module is an optional integration here (see
 * `integrations/target-helper-survey.ts`), and a printed rule should not stop
 * working because a companion module is disabled.
 */

/** The system's id, which is also the settings namespace and the scene-flag scope. */
const DAGGERHEART_ID = "daggerheart";

/** World setting holding variant-rule data, including the range thresholds. */
const VARIANT_RULES_SETTING = "VariantRules";

/** Scene flag holding this scene's override of those thresholds. */
const SCENE_RANGE_FLAG = "rangeMeasurement";

/** Id from `CONFIG.DH.GENERAL.sceneRangeMeasurementSetting`: scene sets its own. */
const SCENE_CUSTOM = "custom";

/**
 * The bands with a defined upper threshold — the only ones a distance can be
 * tested against. `self` and `veryFar` have no cap in any world's settings.
 */
export type RangeBand = "melee" | "veryClose" | "close" | "far";

/** The world's range variant rule, or null if the setting isn't readable. */
function worldRangeMeasurement(): AnyObject | null {
  try {
    const variantRules = game.settings.get(DAGGERHEART_ID, VARIANT_RULES_SETTING) as AnyObject;
    return (variantRules?.["rangeMeasurement"] as AnyObject | undefined) ?? null;
  } catch {
    return null;
  }
}

/** This scene's override of that rule, if it has set one. */
function sceneRangeMeasurement(): AnyObject | null {
  const flags = canvas.scene?.["flags"] as AnyObject | undefined;
  return (flags?.[DAGGERHEART_ID]?.[SCENE_RANGE_FLAG] as AnyObject | undefined) ?? null;
}

/** Read the four thresholds off a settings-shaped object, or null if any is unusable. */
function readThresholds(source: AnyObject | null): Record<RangeBand, number> | null {
  if (!source) return null;

  const thresholds = {
    melee: Number(source["melee"]),
    veryClose: Number(source["veryClose"]),
    close: Number(source["close"]),
    far: Number(source["far"]),
  };
  // A scene's `custom` fields have no schema initial, so an unfilled one arrives
  // as null — which `Number()` would happily turn into a threshold of 0.
  return Object.values(thresholds).every((value) => Number.isFinite(value) && value > 0)
    ? thresholds
    : null;
}

/**
 * The thresholds in force here: the scene's when it declares `custom` ones, the
 * world's otherwise.
 *
 * The scene's other option, `disable`, is deliberately not handled — it only
 * changes whether distances are *displayed* as band names on this scene, not how
 * far Close reaches.
 */
function activeThresholds(): Record<RangeBand, number> | null {
  const scene = sceneRangeMeasurement();
  if (scene?.["setting"] === SCENE_CUSTOM) {
    const custom = readThresholds(scene);
    if (custom) return custom;
  }
  return readThresholds(worldRangeMeasurement());
}

/**
 * The token representing an actor on the active scene, or null.
 *
 * Matched on `actor.uuid` rather than id, because an unlinked token's actor is a
 * synthetic ActorDelta whose id is the *base* actor's — so two unlinked copies of
 * one statblock would both match the first token found.
 */
export function tokenForActor(actor: AnyObject | null | undefined): Token | null {
  if (!actor?.["uuid"]) return null;

  // The actor's own token first: an unlinked actor knows the token it belongs to,
  // and that is exact rather than a search.
  const own = (actor["token"] as TokenDocument | null | undefined)?.object;
  if (own) return own;

  const placeables = canvas.tokens?.placeables ?? [];
  return placeables.find((token) => token.actor?.["uuid"] === actor["uuid"]) ?? null;
}

/**
 * Measured distance between two actors' tokens in scene units, or null when there
 * is nothing to measure — no canvas, either actor untokened, or a gridless scene
 * reporting `Infinity` past its adjacency buffer.
 */
export function distanceBetweenActors(
  source: AnyObject | null | undefined,
  target: AnyObject | null | undefined,
): number | null {
  if (!canvas.ready) return null;

  const sourceToken = tokenForActor(source);
  const targetToken = tokenForActor(target);
  if (!sourceToken || !targetToken) return null;

  try {
    const distance = sourceToken.distanceTo(targetToken);
    return Number.isFinite(distance) ? distance : null;
  } catch {
    return null;
  }
}

/**
 * Is `distance` inside `band`? Null when the thresholds can't be read or there
 * was no distance to test, which callers treat as "don't fire" rather than as a
 * yes or a no.
 */
export function withinBand(distance: number | null, band: RangeBand): boolean | null {
  if (distance === null) return null;

  const thresholds = activeThresholds();
  if (!thresholds) return null;

  return distance <= thresholds[band];
}
