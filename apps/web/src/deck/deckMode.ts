/**
 * Deck replaces the chat surface with the pane grid, so pane mode is the
 * default rather than something to detect.
 *
 * `?deck=0` keeps upstream chat reachable for debugging and for comparing
 * behaviour against stock T3.
 */

export function isDeckMode(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return new URL(window.location.href).searchParams.get("deck") !== "0";
  } catch {
    return true;
  }
}
