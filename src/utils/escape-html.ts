/**
 * Escape a string for safe interpolation into HTML.
 *
 * Used at every boundary where module-generated markup embeds a Foundry document
 * name (actor, item, …) — those are player- or GM-authored text, not our own.
 */
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as Record<
        string,
        string
      >)[c] ?? c,
  );
}
