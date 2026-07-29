/**
 * Per-thread pane layout for the Deck main surface.
 *
 * Scoped and persisted the same way as `terminalUiStateStore`, but holding a
 * split tree (see `paneTree.ts`) instead of a flat group list, because Deck
 * mixes terminal and browser panes at arbitrary nesting.
 */

import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { type ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../lib/storage";
import {
  closePane,
  findLeaf,
  isLeaf,
  nextActivePaneId,
  normalizePaneTree,
  paneLeaves,
  setSplitSizes,
  splitPane,
  type DeckPaneKind,
  type DeckPaneLeaf,
  type DeckPaneNode,
  type DeckSplitDirection,
} from "./paneTree";

const DECK_PANE_STORAGE_KEY = "deck:panes:v1";

export interface ThreadDeckState {
  readonly root: DeckPaneNode | null;
  readonly activePaneId: string | null;
}

const DEFAULT_THREAD_DECK_STATE: ThreadDeckState = Object.freeze({
  root: null,
  activePaneId: null,
});

interface PersistedDeckStoreState {
  paneStateByThreadKey?: Record<string, ThreadDeckState>;
}

export function migratePersistedDeckStoreState(
  persistedState: unknown,
  _version: number,
): PersistedDeckStoreState {
  if (!persistedState || typeof persistedState !== "object") {
    return { paneStateByThreadKey: {} };
  }
  const candidate = persistedState as PersistedDeckStoreState;
  const entries = Object.entries(candidate.paneStateByThreadKey ?? {})
    .filter(([threadKey]) => parseScopedThreadKey(threadKey))
    .map(([threadKey, state]) => [threadKey, normalizeThreadPaneState(state)] as const)
    .filter(([, state]) => state.root !== null);

  return { paneStateByThreadKey: Object.fromEntries(entries) };
}

function normalizeThreadPaneState(state: unknown): ThreadDeckState {
  if (!state || typeof state !== "object") return DEFAULT_THREAD_DECK_STATE;
  const candidate = state as Partial<ThreadDeckState>;
  const root = normalizePaneTree(candidate.root);
  if (!root) return DEFAULT_THREAD_DECK_STATE;

  const activePaneId =
    typeof candidate.activePaneId === "string" && findLeaf(root, candidate.activePaneId)
      ? candidate.activePaneId
      : (paneLeaves(root)[0]?.id ?? null);

  return { root, activePaneId };
}

function isDefaultThreadPaneState(state: ThreadDeckState): boolean {
  return state.root === null;
}

export function selectThreadPaneState(
  paneStateByThreadKey: Record<string, ThreadDeckState>,
  threadRef: ScopedThreadRef | null | undefined,
): ThreadDeckState {
  if (!threadRef || threadRef.threadId.length === 0) {
    return DEFAULT_THREAD_DECK_STATE;
  }
  return paneStateByThreadKey[scopedThreadKey(threadRef)] ?? DEFAULT_THREAD_DECK_STATE;
}

export function selectActivePaneLeaf(state: ThreadDeckState): DeckPaneLeaf | null {
  return findLeaf(state.root, state.activePaneId) ?? (paneLeaves(state.root)[0] ?? null);
}

function updatePaneStateByThreadKey(
  paneStateByThreadKey: Record<string, ThreadDeckState>,
  threadRef: ScopedThreadRef,
  updater: (state: ThreadDeckState) => ThreadDeckState,
): Record<string, ThreadDeckState> {
  if (threadRef.threadId.length === 0) return paneStateByThreadKey;

  const threadKey = scopedThreadKey(threadRef);
  const current = selectThreadPaneState(paneStateByThreadKey, threadRef);
  const next = updater(current);
  if (next === current) return paneStateByThreadKey;

  if (isDefaultThreadPaneState(next)) {
    if (paneStateByThreadKey[threadKey] === undefined) return paneStateByThreadKey;
    const { [threadKey]: _removed, ...rest } = paneStateByThreadKey;
    return rest;
  }

  return { ...paneStateByThreadKey, [threadKey]: next };
}

let paneIdCounter = 0;

/** Ids only need to be unique within a persisted tree, not across sessions. */
function createPaneId(prefix: string): string {
  paneIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${paneIdCounter.toString(36)}`;
}

export function createPaneLeaf(input: {
  readonly kind: DeckPaneKind;
  readonly terminalId?: string;
  readonly tabId?: string | null;
}): DeckPaneLeaf {
  return {
    type: "leaf",
    id: createPaneId(input.kind === "terminal" ? "term" : "web"),
    kind: input.kind,
    ...(input.kind === "terminal" && input.terminalId !== undefined
      ? { terminalId: input.terminalId }
      : {}),
    ...(input.kind === "browser" ? { tabId: input.tabId ?? null } : {}),
  };
}

interface DeckStoreState {
  paneStateByThreadKey: Record<string, ThreadDeckState>;
  /** Seeds an empty thread with its first pane. No-op once a root exists. */
  ensureRootPane: (threadRef: ScopedThreadRef, leaf: DeckPaneLeaf) => void;
  /** Splits the active pane (or `targetPaneId`) and focuses the new one. */
  addPane: (
    threadRef: ScopedThreadRef,
    leaf: DeckPaneLeaf,
    direction: DeckSplitDirection,
    targetPaneId?: string | null,
  ) => void;
  closePane: (threadRef: ScopedThreadRef, paneId: string) => void;
  setActivePane: (threadRef: ScopedThreadRef, paneId: string) => void;
  setSplitSizes: (
    threadRef: ScopedThreadRef,
    splitId: string,
    sizes: ReadonlyArray<number>,
  ) => void;
  /** Attaches the backing session id once the terminal/preview has opened. */
  attachPaneSession: (
    threadRef: ScopedThreadRef,
    paneId: string,
    session: { readonly terminalId?: string; readonly tabId?: string | null },
  ) => void;
  clearPaneState: (threadRef: ScopedThreadRef) => void;
  removeOrphanedPaneStates: (activeThreadKeys: Set<string>) => void;
}

export const useDeckStore = create<DeckStoreState>()(
  persist(
    (set) => {
      const update = (
        threadRef: ScopedThreadRef,
        updater: (state: ThreadDeckState) => ThreadDeckState,
      ) => {
        set((state) => {
          const next = updatePaneStateByThreadKey(
            state.paneStateByThreadKey,
            threadRef,
            updater,
          );
          return next === state.paneStateByThreadKey ? state : { paneStateByThreadKey: next };
        });
      };

      return {
        paneStateByThreadKey: {},

        ensureRootPane: (threadRef, leaf) =>
          update(threadRef, (state) =>
            state.root ? state : { root: leaf, activePaneId: leaf.id },
          ),

        addPane: (threadRef, leaf, direction, targetPaneId) =>
          update(threadRef, (state) => {
            const target = targetPaneId ?? state.activePaneId;
            const root = splitPane(state.root, target, direction, leaf, () =>
              createPaneId("split"),
            );
            return { root, activePaneId: leaf.id };
          }),

        closePane: (threadRef, paneId) =>
          update(threadRef, (state) => {
            if (!state.root || !findLeaf(state.root, paneId)) return state;
            const root = closePane(state.root, paneId);
            return {
              root,
              activePaneId: nextActivePaneId(state.root, root, paneId, state.activePaneId),
            };
          }),

        setActivePane: (threadRef, paneId) =>
          update(threadRef, (state) =>
            state.activePaneId === paneId || !findLeaf(state.root, paneId)
              ? state
              : { ...state, activePaneId: paneId },
          ),

        setSplitSizes: (threadRef, splitId, sizes) =>
          update(threadRef, (state) => {
            const root = setSplitSizes(state.root, splitId, sizes);
            return root === state.root ? state : { ...state, root };
          }),

        attachPaneSession: (threadRef, paneId, session) =>
          update(threadRef, (state) => {
            const leaf = findLeaf(state.root, paneId);
            if (!leaf) return state;
            const next: DeckPaneLeaf = {
              ...leaf,
              ...(session.terminalId !== undefined ? { terminalId: session.terminalId } : {}),
              ...(session.tabId !== undefined ? { tabId: session.tabId } : {}),
            };
            if (next.terminalId === leaf.terminalId && next.tabId === leaf.tabId) {
              return state;
            }
            return { ...state, root: replaceLeaf(state.root, paneId, next) };
          }),

        clearPaneState: (threadRef) =>
          update(threadRef, () => DEFAULT_THREAD_DECK_STATE),

        removeOrphanedPaneStates: (activeThreadKeys) =>
          set((state) => {
            const orphaned = Object.keys(state.paneStateByThreadKey).filter(
              (key) => !activeThreadKeys.has(key),
            );
            if (orphaned.length === 0) return state;
            const paneStateByThreadKey = { ...state.paneStateByThreadKey };
            for (const key of orphaned) {
              delete paneStateByThreadKey[key];
            }
            return { paneStateByThreadKey };
          }),
      };
    },
    {
      name: DECK_PANE_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      migrate: migratePersistedDeckStoreState,
      partialize: (state) => ({ paneStateByThreadKey: state.paneStateByThreadKey }),
    },
  ),
);

function replaceLeaf(
  node: DeckPaneNode | null,
  paneId: string,
  next: DeckPaneLeaf,
): DeckPaneNode | null {
  if (!node) return null;
  if (node.id === paneId) return next;
  if (isLeaf(node)) return node;
  let changed = false;
  const children = node.children.map((child) => {
    const replaced = replaceLeaf(child, paneId, next);
    if (replaced && replaced !== child) changed = true;
    return replaced ?? child;
  });
  return changed ? { ...node, children } : node;
}
