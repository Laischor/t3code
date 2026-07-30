import { describe, expect, it } from "vite-plus/test";

import { matchDeckShortcut, stepTabIndex, type DeckShortcutEvent } from "./deckShortcuts";

function event(key: string, modifiers: Partial<DeckShortcutEvent> = {}): DeckShortcutEvent {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
  };
}

describe("matchDeckShortcut", () => {
  it("opens tabs with cmd+t and cmd+shift+t", () => {
    expect(matchDeckShortcut(event("t", { metaKey: true }))).toBe("tab.newTerminal");
    expect(matchDeckShortcut(event("T", { metaKey: true, shiftKey: true }))).toBe("tab.newBrowser");
  });

  it("closes the active tab with cmd+w", () => {
    expect(matchDeckShortcut(event("w", { metaKey: true }))).toBe("tab.close");
    // Shift+cmd+w closes windows elsewhere; leave it alone.
    expect(matchDeckShortcut(event("w", { metaKey: true, shiftKey: true }))).toBeNull();
  });

  it("claims the palette and new-window shortcuts", () => {
    expect(matchDeckShortcut(event("k", { metaKey: true }))).toBe("palette.open");
    expect(matchDeckShortcut(event("n", { metaKey: true }))).toBe("window.new");
    // Shifted variants stay free for whatever else wants them.
    expect(matchDeckShortcut(event("k", { metaKey: true, shiftKey: true }))).toBeNull();
    expect(matchDeckShortcut(event("n", { metaKey: true, shiftKey: true }))).toBeNull();
  });

  it("cycles tabs with ctrl+tab", () => {
    expect(matchDeckShortcut(event("Tab", { ctrlKey: true }))).toBe("tab.next");
    expect(matchDeckShortcut(event("Tab", { ctrlKey: true, shiftKey: true }))).toBe("tab.previous");
  });

  it("cycles tabs with the cmd+shift+bracket alias", () => {
    expect(matchDeckShortcut(event("]", { metaKey: true, shiftKey: true }))).toBe("tab.next");
    expect(matchDeckShortcut(event("[", { metaKey: true, shiftKey: true }))).toBe("tab.previous");
    // Shift often reports the shifted character instead.
    expect(matchDeckShortcut(event("}", { metaKey: true, shiftKey: true }))).toBe("tab.next");
    expect(matchDeckShortcut(event("{", { metaKey: true, shiftKey: true }))).toBe("tab.previous");
  });

  it("ignores combinations that carry extra modifiers", () => {
    expect(matchDeckShortcut(event("t", { metaKey: true, altKey: true }))).toBeNull();
    expect(matchDeckShortcut(event("t", { metaKey: true, ctrlKey: true }))).toBeNull();
    expect(matchDeckShortcut(event("Tab", { ctrlKey: true, metaKey: true }))).toBeNull();
  });

  it("ignores plain keys, so typing in a terminal is untouched", () => {
    expect(matchDeckShortcut(event("t"))).toBeNull();
    expect(matchDeckShortcut(event("Tab"))).toBeNull();
    expect(matchDeckShortcut(event("]"))).toBeNull();
    expect(matchDeckShortcut(event("t", { ctrlKey: true }))).toBeNull();
  });
});

describe("stepTabIndex", () => {
  it("wraps around in both directions", () => {
    expect(stepTabIndex(3, 2, 1)).toBe(0);
    expect(stepTabIndex(3, 0, -1)).toBe(2);
    expect(stepTabIndex(3, 0, 1)).toBe(1);
  });

  it("does nothing with fewer than two tabs", () => {
    expect(stepTabIndex(1, 0, 1)).toBeNull();
    expect(stepTabIndex(0, 0, 1)).toBeNull();
  });

  it("treats an unknown current tab as the first", () => {
    expect(stepTabIndex(3, -1, 1)).toBe(1);
    expect(stepTabIndex(3, 99, -1)).toBe(2);
  });
});
