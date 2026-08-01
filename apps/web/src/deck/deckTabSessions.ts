/**
 * What a closing tab has to take down with it.
 *
 * A Deck tab owns a server-side session — a PTY or a preview — and the layout
 * store knows nothing about either. Closing a tab without closing its session
 * leaves the process running under a `term-N` id the next tab will reuse, so it
 * reattaches to the old output; an already exited session reattaches exited and
 * the new tab closes itself as it opens.
 */

import type { DeckTab } from "./paneTree";

/**
 * Every `term-N` id that must not be handed to a new tab.
 *
 * The deck's own tabs are not the whole picture: the thread's terminals are also
 * created from the chat view and from mobile, and a pane the deck dropped
 * without closing its tab leaves a session behind too. Allocating from the tabs
 * alone hands a new tab an id some live session already owns — the tab attaches
 * to that session's output, and closing the tab kills a terminal its owner is
 * still typing into, which then fails every write with
 * `Unknown terminal thread`.
 */
export function deckTerminalIdsInUse(
  tabs: ReadonlyArray<DeckTab>,
  serverTerminalIds: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const tabTerminalIds = tabs.flatMap((tab) =>
    tab.kind === "terminal" ? [tabSessionTerminalId(tab)] : [],
  );
  return [...new Set([...tabTerminalIds, ...serverTerminalIds])];
}

/** Tabs seeded before an id was assigned attach with their own id. */
function tabSessionTerminalId(tab: DeckTab): string {
  return tab.terminalId ?? tab.id;
}

export type DeckTabSessionTarget =
  | { readonly kind: "terminal"; readonly terminalId: string }
  | { readonly kind: "browser"; readonly previewTabId: string }
  | { readonly kind: "sql"; readonly sessionId: string };

export function tabSessionTarget(tab: DeckTab): DeckTabSessionTarget | null {
  if (tab.kind === "terminal") {
    return { kind: "terminal", terminalId: tabSessionTerminalId(tab) };
  }
  // SQL sessions are keyed by the tab id itself.
  if (tab.kind === "sql") {
    return { kind: "sql", sessionId: tab.id };
  }
  // A browser tab whose session never opened has nothing to close.
  return tab.previewTabId ? { kind: "browser", previewTabId: tab.previewTabId } : null;
}
