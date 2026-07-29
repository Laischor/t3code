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
  type DeckPaneLeaf,
  type DeckPaneNode,
} from "./paneTree";

function leaf(id: string, kind: DeckPaneLeaf["kind"] = "terminal"): DeckPaneLeaf {
  return kind === "terminal"
    ? { type: "leaf", id, kind, terminalId: `${id}-session` }
    : { type: "leaf", id, kind, tabId: null };
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
    expect(normalizePaneTree({ type: "leaf", id: "", kind: "terminal" })).toBeNull();
    expect(normalizePaneTree({ type: "split", id: "s", direction: "sideways" })).toBeNull();
  });

  it("keeps a valid leaf and defaults a browser tab id", () => {
    expect(normalizePaneTree({ type: "leaf", id: "a", kind: "browser" })).toEqual({
      type: "leaf",
      id: "a",
      kind: "browser",
      tabId: null,
    });
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
      children: [leaf("a"), { type: "leaf", id: "b" }],
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
