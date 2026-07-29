import { describe, expect, it } from "vite-plus/test";

import {
  closePane,
  findLeaf,
  findParentSplit,
  isSplit,
  nextActivePaneId,
  normalizePaneTree,
  normalizeSizes,
  paneLeaves,
  setSplitSizes,
  splitPane,
  addTab,
  activeTab,
  closeTab,
  findPaneForTab,
  findTab,
  moveTabToPane,
  paneTabs,
  reorderTab,
  setActiveTab,
  updateTab,
  type DeckPaneLeaf,
  type DeckPaneNode,
  type DeckTab,
  type DeckTabKind,
} from "./paneTree";

function tab(id: string, kind: DeckTabKind = "terminal"): DeckTab {
  return kind === "terminal"
    ? { id, kind, terminalId: `${id}-session` }
    : { id, kind, previewTabId: null };
}

/** A pane holding one tab, named `<id>-tab`. */
function leaf(id: string, kind: DeckTabKind = "terminal"): DeckPaneLeaf {
  const only = tab(`${id}-tab`, kind);
  return { type: "leaf", id, tabs: [only], activeTabId: only.id };
}

function splitIds(): () => string {
  let index = 0;
  return () => {
    index += 1;
    return `split-${index}`;
  };
}

function sizesOf(node: DeckPaneNode | null): ReadonlyArray<number> {
  return node && isSplit(node) ? node.sizes : [];
}

describe("normalizeSizes", () => {
  it("returns an equal distribution when sizes are missing", () => {
    expect(normalizeSizes(undefined, 4)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it("scales arbitrary weights to sum to 1", () => {
    const sizes = normalizeSizes([1, 3], 2);
    expect(sizes).toEqual([0.25, 0.75]);
  });

  it("replaces invalid entries with an equal share", () => {
    const sizes = normalizeSizes([Number.NaN, -1, 0.5], 3);
    expect(sizes.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(sizes.every((value) => value > 0)).toBe(true);
  });

  it("handles an empty tree", () => {
    expect(normalizeSizes([1], 0)).toEqual([]);
  });
});

describe("splitPane", () => {
  it("uses the leaf as the root when the tree is empty", () => {
    const root = splitPane(null, null, "horizontal", leaf("a"), splitIds());
    expect(root).toEqual(leaf("a"));
  });

  it("wraps the target in a new split", () => {
    const root = splitPane(leaf("a"), "a", "horizontal", leaf("b"), splitIds());
    expect(isSplit(root)).toBe(true);
    expect(paneLeaves(root).map((pane) => pane.id)).toEqual(["a", "b"]);
    expect(sizesOf(root)).toEqual([0.5, 0.5]);
  });

  it("adds a sibling instead of nesting when the parent runs the same direction", () => {
    const next = splitIds();
    let root = splitPane(leaf("a"), "a", "horizontal", leaf("b"), next);
    root = splitPane(root, "b", "horizontal", leaf("c"), next);

    expect(isSplit(root) && root.children.length).toBe(3);
    expect(paneLeaves(root).map((pane) => pane.id)).toEqual(["a", "b", "c"]);
    // "b" gave up half of its share to "c"; "a" is untouched.
    expect(sizesOf(root)).toEqual([0.5, 0.25, 0.25]);
  });

  it("nests when the direction differs from the parent", () => {
    const next = splitIds();
    let root = splitPane(leaf("a"), "a", "horizontal", leaf("b"), next);
    root = splitPane(root, "b", "vertical", leaf("c"), next);

    expect(isSplit(root) && root.children.length).toBe(2);
    const parent = findParentSplit(root, "c");
    expect(parent?.direction).toBe("vertical");
    expect(paneLeaves(root).map((pane) => pane.id)).toEqual(["a", "b", "c"]);
  });

  it("splits the whole tree when the target is unknown", () => {
    const root = splitPane(leaf("a"), "missing", "vertical", leaf("b"), splitIds());
    expect(isSplit(root)).toBe(true);
    expect(paneLeaves(root).map((pane) => pane.id)).toEqual(["a", "b"]);
  });

  it("keeps sizes summing to 1 across repeated splits", () => {
    const next = splitIds();
    let root: DeckPaneNode = leaf("a");
    for (const id of ["b", "c", "d", "e"]) {
      root = splitPane(root, "a", "horizontal", leaf(id), next);
    }
    expect(sizesOf(root).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  });
});

describe("closePane", () => {
  it("returns null when the only pane closes", () => {
    expect(closePane(leaf("a"), "a")).toBeNull();
  });

  it("collapses a split that is left with one child", () => {
    const root = splitPane(leaf("a"), "a", "horizontal", leaf("b"), splitIds());
    const next = closePane(root, "b");
    expect(next).toEqual(leaf("a"));
  });

  it("redistributes the freed space across remaining siblings", () => {
    const next = splitIds();
    let root = splitPane(leaf("a"), "a", "horizontal", leaf("b"), next);
    root = splitPane(root, "b", "horizontal", leaf("c"), next);

    const closed = closePane(root, "a");
    expect(paneLeaves(closed).map((pane) => pane.id)).toEqual(["b", "c"]);
    expect(sizesOf(closed).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(sizesOf(closed)).toEqual([0.5, 0.5]);
  });

  it("collapses nested splits from the inside out", () => {
    const next = splitIds();
    let root = splitPane(leaf("a"), "a", "horizontal", leaf("b"), next);
    root = splitPane(root, "b", "vertical", leaf("c"), next);

    const closed = closePane(root, "c");
    expect(closed).toEqual(splitPane(leaf("a"), "a", "horizontal", leaf("b"), splitIds()));
  });

  it("leaves the tree alone for an unknown pane", () => {
    const root = splitPane(leaf("a"), "a", "horizontal", leaf("b"), splitIds());
    expect(closePane(root, "missing")).toBe(root);
  });
});

describe("setSplitSizes", () => {
  it("normalizes and clamps dragged sizes", () => {
    const root = splitPane(leaf("a"), "a", "horizontal", leaf("b"), splitIds());
    const splitId = isSplit(root) ? root.id : "";
    const next = setSplitSizes(root, splitId, [0, 1]);
    const sizes = sizesOf(next);
    expect(sizes[0]).toBeGreaterThan(0);
    expect(sizes.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  });

  it("ignores a leaf id", () => {
    const root = splitPane(leaf("a"), "a", "horizontal", leaf("b"), splitIds());
    expect(setSplitSizes(root, "a", [0.9, 0.1])).toBe(root);
  });
});

describe("nextActivePaneId", () => {
  it("keeps the active pane when it survives", () => {
    const next = splitIds();
    let root = splitPane(leaf("a"), "a", "horizontal", leaf("b"), next);
    root = splitPane(root, "b", "horizontal", leaf("c"), next);
    const closed = closePane(root, "c");
    expect(nextActivePaneId(root, closed, "c", "a")).toBe("a");
  });

  it("falls back to the pane after the closed one", () => {
    const next = splitIds();
    let root = splitPane(leaf("a"), "a", "horizontal", leaf("b"), next);
    root = splitPane(root, "b", "horizontal", leaf("c"), next);
    const closed = closePane(root, "b");
    expect(nextActivePaneId(root, closed, "b", "b")).toBe("c");
  });

  it("falls back to the previous pane when the closed one was last", () => {
    const next = splitIds();
    let root = splitPane(leaf("a"), "a", "horizontal", leaf("b"), next);
    root = splitPane(root, "b", "horizontal", leaf("c"), next);
    const closed = closePane(root, "c");
    expect(nextActivePaneId(root, closed, "c", "c")).toBe("b");
  });

  it("returns null once the last pane closes", () => {
    expect(nextActivePaneId(leaf("a"), null, "a", "a")).toBeNull();
  });
});

describe("normalizePaneTree", () => {
  it("rejects malformed nodes", () => {
    expect(normalizePaneTree(null)).toBeNull();
    expect(normalizePaneTree({ type: "leaf", id: "a" })).toBeNull();
    expect(normalizePaneTree({ type: "leaf", id: "", tabs: [tab("t1")] })).toBeNull();
    expect(normalizePaneTree({ type: "split", id: "s", direction: "sideways" })).toBeNull();
  });

  it("keeps a valid leaf and defaults a browser preview id", () => {
    expect(
      normalizePaneTree({
        type: "leaf",
        id: "a",
        tabs: [{ id: "a-tab", kind: "browser" }],
        activeTabId: "a-tab",
      }),
    ).toEqual({
      type: "leaf",
      id: "a",
      tabs: [{ id: "a-tab", kind: "browser", previewTabId: null }],
      activeTabId: "a-tab",
    });
  });

  it("drops a leaf whose tabs are all unusable", () => {
    expect(normalizePaneTree({ type: "leaf", id: "a", tabs: [{ id: "x" }] })).toBeNull();
    expect(normalizePaneTree({ type: "leaf", id: "a", tabs: [] })).toBeNull();
  });

  it("falls back to the first tab when activeTabId is stale", () => {
    const normalized = normalizePaneTree({
      type: "leaf",
      id: "a",
      tabs: [tab("t1"), tab("t2")],
      activeTabId: "gone",
    });
    expect(normalized && !isSplit(normalized) ? normalized.activeTabId : null).toBe("t1");
  });

  it("drops duplicate ids", () => {
    const normalized = normalizePaneTree({
      type: "split",
      id: "s1",
      direction: "horizontal",
      sizes: [0.5, 0.5],
      children: [leaf("a"), leaf("a")],
    });
    expect(normalized).toEqual(leaf("a"));
  });

  it("collapses a split down to its single usable child", () => {
    const normalized = normalizePaneTree({
      type: "split",
      id: "s1",
      direction: "horizontal",
      sizes: [0.5, 0.5],
      children: [leaf("a"), { type: "leaf", id: "b", tabs: [] }],
    });
    expect(normalized).toEqual(leaf("a"));
  });

  it("rebuilds missing sizes", () => {
    const normalized = normalizePaneTree({
      type: "split",
      id: "s1",
      direction: "vertical",
      children: [leaf("a"), leaf("b"), leaf("c")],
    });
    expect(sizesOf(normalized).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(paneLeaves(normalized).map((pane) => pane.id)).toEqual(["a", "b", "c"]);
  });

  it("round-trips a tree built by splitPane", () => {
    const next = splitIds();
    let root = splitPane(leaf("a"), "a", "horizontal", leaf("b"), next);
    root = splitPane(root, "b", "vertical", leaf("c", "browser"), next);
    expect(normalizePaneTree(JSON.parse(JSON.stringify(root)))).toEqual(root);
  });
});

describe("lookups", () => {
  it("finds leaves and their parent split", () => {
    const next = splitIds();
    let root = splitPane(leaf("a"), "a", "horizontal", leaf("b"), next);
    root = splitPane(root, "b", "vertical", leaf("c"), next);

    expect(findLeaf(root, "c")?.id).toBe("c");
    expect(findLeaf(root, "missing")).toBeNull();
    expect(findLeaf(root, null)).toBeNull();
    expect(findParentSplit(root, "c")?.direction).toBe("vertical");
    expect(findParentSplit(root, root.id)).toBeNull();
  });
});

describe("tabs", () => {
  it("appends a tab and focuses it", () => {
    const root = addTab(leaf("a"), "a", tab("extra"));
    const pane = findLeaf(root, "a");
    expect(pane?.tabs.map((t) => t.id)).toEqual(["a-tab", "extra"]);
    expect(pane?.activeTabId).toBe("extra");
  });

  it("lists tabs across panes in pane order", () => {
    const root = splitPane(leaf("a"), "a", "horizontal", leaf("b"), splitIds());
    expect(paneTabs(root).map((t) => t.id)).toEqual(["a-tab", "b-tab"]);
  });

  it("finds a tab and the pane holding it", () => {
    const root = addTab(leaf("a"), "a", tab("extra"));
    expect(findTab(root, "extra")?.id).toBe("extra");
    expect(findPaneForTab(root, "extra")?.id).toBe("a");
    expect(findTab(root, "missing")).toBeNull();
  });

  it("closing a middle tab focuses the one that slid into place", () => {
    let root: DeckPaneNode | null = leaf("a");
    root = addTab(root, "a", tab("t2"));
    root = addTab(root, "a", tab("t3"));
    root = setActiveTab(root, "a", "t2");

    root = closeTab(root, "t2");
    const pane = findLeaf(root, "a");
    expect(pane?.tabs.map((t) => t.id)).toEqual(["a-tab", "t3"]);
    expect(pane?.activeTabId).toBe("t3");
  });

  it("closing the last tab focuses the new last one", () => {
    let root: DeckPaneNode | null = leaf("a");
    root = addTab(root, "a", tab("t2"));
    root = closeTab(root, "t2");
    expect(findLeaf(root, "a")?.activeTabId).toBe("a-tab");
  });

  it("closing a tab other than the active one keeps focus", () => {
    let root: DeckPaneNode | null = leaf("a");
    root = addTab(root, "a", tab("t2"));
    root = setActiveTab(root, "a", "t2");
    root = closeTab(root, "a-tab");
    expect(findLeaf(root, "a")?.activeTabId).toBe("t2");
  });

  it("closing the only tab in a pane closes the pane", () => {
    const root = splitPane(leaf("a"), "a", "horizontal", leaf("b"), splitIds());
    const closed = closeTab(root, "b-tab");
    expect(closed).toEqual(leaf("a"));
  });

  it("closing the only tab of the only pane empties the tree", () => {
    expect(closeTab(leaf("a"), "a-tab")).toBeNull();
  });

  it("ignores an unknown tab", () => {
    const root = leaf("a");
    expect(closeTab(root, "missing")).toBe(root);
    expect(setActiveTab(root, "a", "missing")).toBe(root);
  });

  it("activeTab falls back to the first tab when the id is stale", () => {
    const pane: DeckPaneLeaf = { type: "leaf", id: "a", tabs: [tab("t1")], activeTabId: "gone" };
    expect(activeTab(pane)?.id).toBe("t1");
  });

  it("reorders tabs within a pane", () => {
    let root: DeckPaneNode | null = leaf("a");
    root = addTab(root, "a", tab("t2"));
    root = addTab(root, "a", tab("t3"));

    root = reorderTab(root, "t3", 0);
    expect(findLeaf(root, "a")?.tabs.map((t) => t.id)).toEqual(["t3", "a-tab", "t2"]);
  });

  it("clamps a reorder target and ignores a no-op", () => {
    let root: DeckPaneNode | null = leaf("a");
    root = addTab(root, "a", tab("t2"));

    const moved = reorderTab(root, "a-tab", 99);
    expect(findLeaf(moved, "a")?.tabs.map((t) => t.id)).toEqual(["t2", "a-tab"]);
    expect(reorderTab(moved, "a-tab", 1)).toBe(moved);
    expect(reorderTab(moved, "missing", 0)).toBe(moved);
  });

  it("keeps a renamed title through persistence", () => {
    const named = { ...tab("t1"), title: "logs" };
    const normalized = normalizePaneTree({
      type: "leaf",
      id: "a",
      tabs: [named],
      activeTabId: "t1",
    });
    expect(findTab(normalized, "t1")?.title).toBe("logs");
  });

  it("drops a blank title rather than storing it", () => {
    const normalized = normalizePaneTree({
      type: "leaf",
      id: "a",
      tabs: [{ id: "t1", kind: "terminal", title: "   " }],
      activeTabId: "t1",
    });
    expect(findTab(normalized, "t1")?.title).toBeUndefined();
  });

  it("moves a tab into another pane and focuses it there", () => {
    let root: DeckPaneNode | null = splitPane(leaf("a"), "a", "horizontal", leaf("b"), splitIds());
    root = addTab(root, "a", tab("extra"));

    root = moveTabToPane(root, "extra", "b", 0);
    expect(findLeaf(root, "a")?.tabs.map((t) => t.id)).toEqual(["a-tab"]);
    const target = findLeaf(root, "b");
    expect(target?.tabs.map((t) => t.id)).toEqual(["extra", "b-tab"]);
    expect(target?.activeTabId).toBe("extra");
  });

  it("closes a source pane emptied by the move", () => {
    const root = splitPane(leaf("a"), "a", "horizontal", leaf("b"), splitIds());
    const moved = moveTabToPane(root, "a-tab", "b", 1);
    expect(isSplit(moved!)).toBe(false);
    expect(findLeaf(moved, "b")?.tabs.map((t) => t.id)).toEqual(["b-tab", "a-tab"]);
  });

  it("falls back to a plain reorder within the same pane", () => {
    let root: DeckPaneNode | null = leaf("a");
    root = addTab(root, "a", tab("t2"));
    root = moveTabToPane(root, "t2", "a", 0);
    expect(findLeaf(root, "a")?.tabs.map((t) => t.id)).toEqual(["t2", "a-tab"]);
  });

  it("ignores an unknown tab or pane", () => {
    const root = splitPane(leaf("a"), "a", "horizontal", leaf("b"), splitIds());
    expect(moveTabToPane(root, "missing", "b", 0)).toBe(root);
    expect(moveTabToPane(root, "a-tab", "missing", 0)).toBe(root);
  });

  it("clamps the target index", () => {
    const root = splitPane(leaf("a"), "a", "horizontal", leaf("b"), splitIds());
    const moved = moveTabToPane(root, "a-tab", "b", 99);
    expect(findLeaf(moved, "b")?.tabs.map((t) => t.id)).toEqual(["b-tab", "a-tab"]);
  });

  it("updates a tab in place", () => {
    const root = updateTab(leaf("a", "browser"), "a-tab", (t) => ({ ...t, previewTabId: "srv-1" }));
    expect(findTab(root, "a-tab")?.previewTabId).toBe("srv-1");
  });

  it("returns the same tree when an update changes nothing", () => {
    const root = leaf("a");
    expect(updateTab(root, "a-tab", (t) => t)).toBe(root);
  });
});
