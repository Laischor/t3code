import { describe, expect, it } from "vite-plus/test";

import { deckTerminalIdsInUse, tabSessionTarget } from "./deckTabSessions";

describe("tabSessionTarget", () => {
  it("targets the terminal session a terminal tab attached with", () => {
    expect(tabSessionTarget({ id: "term-tab", kind: "terminal", terminalId: "term-2" })).toEqual({
      kind: "terminal",
      terminalId: "term-2",
    });
  });

  it("falls back to the tab id when no terminal id was assigned", () => {
    expect(tabSessionTarget({ id: "term-tab", kind: "terminal" })).toEqual({
      kind: "terminal",
      terminalId: "term-tab",
    });
  });

  it("targets the preview session of a browser tab", () => {
    expect(tabSessionTarget({ id: "web-tab", kind: "browser", previewTabId: "tab_a" })).toEqual({
      kind: "browser",
      previewTabId: "tab_a",
    });
  });

  it("targets the SQL session of a sql tab, keyed by the tab id", () => {
    expect(tabSessionTarget({ id: "sql-tab", kind: "sql" })).toEqual({
      kind: "sql",
      sessionId: "sql-tab",
    });
  });

  it("has nothing to close for a browser tab whose session never opened", () => {
    expect(tabSessionTarget({ id: "web-tab", kind: "browser", previewTabId: null })).toBeNull();
  });
});

describe("deckTerminalIdsInUse", () => {
  it("reserves the ids of sessions the deck has no tab for", () => {
    expect(
      deckTerminalIdsInUse(
        [{ id: "a", kind: "terminal", terminalId: "term-1" }],
        ["term-1", "term-2", "term-4"],
      ),
    ).toEqual(["term-1", "term-2", "term-4"]);
  });

  it("keeps tab ids the server does not know about yet", () => {
    expect(
      deckTerminalIdsInUse(
        [
          { id: "a", kind: "terminal", terminalId: "term-1" },
          { id: "b", kind: "terminal", terminalId: "term-2" },
        ],
        ["term-1"],
      ),
    ).toEqual(["term-1", "term-2"]);
  });

  it("reserves the fallback id of a tab that never got a terminal id", () => {
    expect(deckTerminalIdsInUse([{ id: "seeded-tab", kind: "terminal" }], [])).toEqual([
      "seeded-tab",
    ]);
  });

  it("ignores browser tabs", () => {
    expect(
      deckTerminalIdsInUse([{ id: "web", kind: "browser", previewTabId: "tab_a" }], ["term-3"]),
    ).toEqual(["term-3"]);
  });
});
