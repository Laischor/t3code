/**
 * Deck's own keyboard shortcuts.
 *
 * Kept separate from T3's keybinding config, which is server-resolved and would
 * mean changing contracts and server settings for a fork-local feature.
 *
 * Pure matchers so the mapping can be tested without a DOM.
 */

export type DeckShortcut =
  | "tab.newTerminal"
  | "tab.newBrowser"
  | "tab.next"
  | "tab.previous"
  | "tab.close"
  | "palette.open"
  | "window.new";

export interface DeckShortcutEvent {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * Cmd+Tab belongs to macOS, so tab cycling uses Ctrl+Tab — the binding Chrome,
 * Safari and VS Code all use — with Cmd+Shift+brackets as the macOS-flavoured
 * alias.
 */
export function matchDeckShortcut(event: DeckShortcutEvent): DeckShortcut | null {
  const key = event.key.toLowerCase();

  if (event.metaKey && !event.ctrlKey && !event.altKey) {
    if (key === "t") {
      return event.shiftKey ? "tab.newBrowser" : "tab.newTerminal";
    }
    if (key === "w" && !event.shiftKey) return "tab.close";
    // T3 binds these to its own palette and thread creation; in deck mode they
    // mean windows, and the capture-phase listener claims them first.
    if (key === "k" && !event.shiftKey) return "palette.open";
    if (key === "n" && !event.shiftKey) return "window.new";
    if (event.shiftKey && (key === "]" || key === "}")) return "tab.next";
    if (event.shiftKey && (key === "[" || key === "{")) return "tab.previous";
  }

  if (event.ctrlKey && !event.metaKey && !event.altKey && key === "tab") {
    return event.shiftKey ? "tab.previous" : "tab.next";
  }

  return null;
}

/** Steps through tabs with wrap-around. Returns null when there is nothing to do. */
export function stepTabIndex(count: number, current: number, direction: 1 | -1): number | null {
  if (count <= 1) return null;
  const safeCurrent = current < 0 || current >= count ? 0 : current;
  return (safeCurrent + direction + count) % count;
}
