/**
 * The actor an ActiveEffect belongs to, or `null`.
 *
 * An effect normally lives on its originating item and transfers, so
 * `effect.parent` is an Item and the actor is one level further up. It can also
 * sit directly on the actor, which is what the Effects tab produces.
 */
export function actorOfEffect(effect: AnyObject | null | undefined): AnyObject | null {
  const parent = effect?.["parent"];
  if (!parent) return null;
  if (parent.documentName === "Actor") return parent;
  if (parent.documentName === "Item" && parent.parent?.documentName === "Actor") {
    return parent.parent;
  }
  return null;
}
