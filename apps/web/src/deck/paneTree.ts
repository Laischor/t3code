/**
 * Pure split-tree model for the Deck pane grid.
 *
 * T3's own `ThreadTerminalGroup` is a flat list of groups, which only expresses
 * one level of splitting. Deck puts panes on the main surface and mixes kinds,
 * so it needs an arbitrarily nested tree.
 *
 * Splits are n-ary rather than binary: splitting a pane whose parent already
 * runs in the same direction adds a sibling instead of nesting, which is what
 * terminal grids do in practice and keeps sizes easy to reason about.
 *
 * Everything here is pure so it can be tested without a store.
 */

export type DeckPaneKind = "terminal" | "browser";

export type DeckSplitDirection = "horizontal" | "vertical";

export interface DeckPaneLeaf {
  readonly type: "leaf";
  readonly id: string;
  readonly kind: DeckPaneKind;
  /** Terminal session id. Only set when `kind` is "terminal". */
  readonly terminalId?: string;
  /** Preview tab id. Only set when `kind` is "browser"; null until it opens. */
  readonly tabId?: string | null;
}

export interface DeckPaneSplit {
  readonly type: "split";
  readonly id: string;
  readonly direction: DeckSplitDirection;
  /** Always at least two entries after normalization. */
  readonly children: ReadonlyArray<DeckPaneNode>;
  /** Same length as `children`, each > 0, summing to 1. */
  readonly sizes: ReadonlyArray<number>;
}

export type DeckPaneNode = DeckPaneLeaf | DeckPaneSplit;

/** Smallest fraction a pane may shrink to before a drag stops. */
export const MIN_PANE_FRACTION = 0.05;

export function isSplit(node: DeckPaneNode): node is DeckPaneSplit {
  return node.type === "split";
}

export function isLeaf(node: DeckPaneNode): node is DeckPaneLeaf {
  return node.type === "leaf";
}

/**
 * Distributes `sizes` over `count` slots: invalid or missing entries fall back
 * to an equal share, then everything is scaled to sum to 1.
 */
export function normalizeSizes(
  sizes: ReadonlyArray<number> | undefined,
  count: number,
): ReadonlyArray<number> {
  if (count <= 0) return [];
  const equal = 1 / count;
  const raw: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = sizes?.[index];
    raw.push(typeof value === "number" && Number.isFinite(value) && value > 0 ? value : equal);
  }
  const total = raw.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return raw.map(() => equal);
  return raw.map((value) => value / total);
}

/** Depth-first leaves, left to right — the order panes appear on screen. */
export function paneLeaves(node: DeckPaneNode | null): ReadonlyArray<DeckPaneLeaf> {
  if (!node) return [];
  if (isLeaf(node)) return [node];
  return node.children.flatMap((child) => paneLeaves(child));
}

export function findPane(node: DeckPaneNode | null, paneId: string): DeckPaneNode | null {
  if (!node) return null;
  if (node.id === paneId) return node;
  if (isLeaf(node)) return null;
  for (const child of node.children) {
    const found = findPane(child, paneId);
    if (found) return found;
  }
  return null;
}

export function findLeaf(node: DeckPaneNode | null, paneId: string | null): DeckPaneLeaf | null {
  if (!paneId) return null;
  const found = findPane(node, paneId);
  return found && isLeaf(found) ? found : null;
}

export function findParentSplit(
  node: DeckPaneNode | null,
  paneId: string,
): DeckPaneSplit | null {
  if (!node || isLeaf(node)) return null;
  if (node.children.some((child) => child.id === paneId)) return node;
  for (const child of node.children) {
    const found = findParentSplit(child, paneId);
    if (found) return found;
  }
  return null;
}

function replaceNode(
  node: DeckPaneNode,
  targetId: string,
  next: DeckPaneNode,
): DeckPaneNode {
  if (node.id === targetId) return next;
  if (isLeaf(node)) return node;
  let changed = false;
  const children = node.children.map((child) => {
    const replaced = replaceNode(child, targetId, next);
    if (replaced !== child) changed = true;
    return replaced;
  });
  return changed ? { ...node, children } : node;
}

/**
 * Inserts `leaf` next to `targetId`.
 *
 * When the target's parent already splits along `direction`, the leaf becomes a
 * sibling and inherits half of the target's size. Otherwise the target is
 * wrapped in a new split.
 */
export function splitPane(
  root: DeckPaneNode | null,
  targetId: string | null,
  direction: DeckSplitDirection,
  leaf: DeckPaneLeaf,
  createSplitId: () => string,
): DeckPaneNode {
  if (!root) return leaf;

  const target = targetId ? findPane(root, targetId) : null;
  if (!target) {
    // No usable target: split the whole tree.
    return {
      type: "split",
      id: createSplitId(),
      direction,
      children: [root, leaf],
      sizes: [0.5, 0.5],
    };
  }

  const parent = findParentSplit(root, target.id);
  if (parent && parent.direction === direction) {
    const index = parent.children.findIndex((child) => child.id === target.id);
    const sizes = normalizeSizes(parent.sizes, parent.children.length);
    const share = (sizes[index] ?? 1 / parent.children.length) / 2;

    const nextChildren = [...parent.children];
    nextChildren.splice(index + 1, 0, leaf);
    const nextSizes = [...sizes];
    nextSizes.splice(index, 1, share, share);

    const nextParent: DeckPaneSplit = {
      ...parent,
      children: nextChildren,
      sizes: normalizeSizes(nextSizes, nextChildren.length),
    };
    return replaceNode(root, parent.id, nextParent);
  }

  const split: DeckPaneSplit = {
    type: "split",
    id: createSplitId(),
    direction,
    children: [target, leaf],
    sizes: [0.5, 0.5],
  };
  return replaceNode(root, target.id, split);
}

/**
 * Removes a pane. Freed space goes to its siblings proportionally, and a split
 * left with a single child collapses into that child.
 */
export function closePane(
  root: DeckPaneNode | null,
  paneId: string,
): DeckPaneNode | null {
  if (!root) return null;
  if (root.id === paneId) return null;
  if (isLeaf(root)) return root;

  const index = root.children.findIndex((child) => child.id === paneId);
  if (index >= 0) {
    const children = root.children.filter((_, childIndex) => childIndex !== index);
    if (children.length === 0) return null;
    if (children.length === 1) return children[0] ?? null;
    const sizes = normalizeSizes(root.sizes, root.children.length).filter(
      (_, sizeIndex) => sizeIndex !== index,
    );
    return { ...root, children, sizes: normalizeSizes(sizes, children.length) };
  }

  let changed = false;
  const children: DeckPaneNode[] = [];
  const sizes: number[] = [];
  const currentSizes = normalizeSizes(root.sizes, root.children.length);
  root.children.forEach((child, childIndex) => {
    const next = closePane(child, paneId);
    if (next !== child) changed = true;
    if (next) {
      children.push(next);
      sizes.push(currentSizes[childIndex] ?? 0);
    }
  });
  if (!changed) return root;
  if (children.length === 0) return null;
  if (children.length === 1) return children[0] ?? null;
  return { ...root, children, sizes: normalizeSizes(sizes, children.length) };
}

/** Applies new divider fractions to one split. */
export function setSplitSizes(
  root: DeckPaneNode | null,
  splitId: string,
  sizes: ReadonlyArray<number>,
): DeckPaneNode | null {
  if (!root) return null;
  const target = findPane(root, splitId);
  if (!target || !isSplit(target)) return root;
  const clamped = sizes.map((size) => Math.max(MIN_PANE_FRACTION, size));
  const next: DeckPaneSplit = {
    ...target,
    sizes: normalizeSizes(clamped, target.children.length),
  };
  return replaceNode(root, splitId, next);
}

/**
 * Picks the pane to focus after `closedPaneId` disappears: the neighbour that
 * took its place, else the first remaining leaf.
 */
export function nextActivePaneId(
  previousRoot: DeckPaneNode | null,
  nextRoot: DeckPaneNode | null,
  closedPaneId: string,
  activePaneId: string | null,
): string | null {
  const leaves = paneLeaves(nextRoot);
  if (leaves.length === 0) return null;
  if (activePaneId && activePaneId !== closedPaneId && findLeaf(nextRoot, activePaneId)) {
    return activePaneId;
  }

  const previousLeaves = paneLeaves(previousRoot);
  const closedIndex = previousLeaves.findIndex((leaf) => leaf.id === closedPaneId);
  if (closedIndex >= 0) {
    const candidates = [previousLeaves[closedIndex + 1], previousLeaves[closedIndex - 1]];
    for (const candidate of candidates) {
      if (candidate && findLeaf(nextRoot, candidate.id)) return candidate.id;
    }
  }
  return leaves[0]?.id ?? null;
}

/**
 * Repairs a tree coming out of persisted storage: drops malformed nodes and
 * duplicate ids, collapses degenerate splits, and rebuilds sizes.
 */
export function normalizePaneTree(
  node: unknown,
  seenIds: Set<string> = new Set(),
): DeckPaneNode | null {
  if (!node || typeof node !== "object") return null;
  const candidate = node as Partial<DeckPaneSplit> & Partial<DeckPaneLeaf>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  if (id.length === 0 || seenIds.has(id)) return null;

  if (candidate.type === "leaf") {
    if (candidate.kind !== "terminal" && candidate.kind !== "browser") return null;
    seenIds.add(id);
    const leaf: DeckPaneLeaf = {
      type: "leaf",
      id,
      kind: candidate.kind,
      ...(candidate.kind === "terminal" && typeof candidate.terminalId === "string"
        ? { terminalId: candidate.terminalId }
        : {}),
      ...(candidate.kind === "browser"
        ? { tabId: typeof candidate.tabId === "string" ? candidate.tabId : null }
        : {}),
    };
    return leaf;
  }

  if (candidate.type !== "split") return null;
  if (candidate.direction !== "horizontal" && candidate.direction !== "vertical") return null;
  if (!Array.isArray(candidate.children)) return null;

  // Reserve the split id only once its children are known to be usable.
  const children: DeckPaneNode[] = [];
  const sizes: number[] = [];
  const rawSizes = normalizeSizes(
    Array.isArray(candidate.sizes) ? candidate.sizes : undefined,
    candidate.children.length,
  );
  candidate.children.forEach((child, index) => {
    const normalized = normalizePaneTree(child, seenIds);
    if (normalized) {
      children.push(normalized);
      sizes.push(rawSizes[index] ?? 0);
    }
  });

  if (children.length === 0) return null;
  if (children.length === 1) return children[0] ?? null;
  seenIds.add(id);
  return {
    type: "split",
    id,
    direction: candidate.direction,
    children,
    sizes: normalizeSizes(sizes, children.length),
  };
}
