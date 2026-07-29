/**
 * Windows per project.
 *
 * A window is one main view: its own pane layout, its own terminals, its own
 * browser tabs. It is identified by a thread id, because everything a window
 * needs is already scoped that way — `deckStore` keys layouts by thread, the
 * terminal RPC keys sessions and history by `threadId\0terminalId`, and preview
 * sessions are opened per thread.
 *
 * Nothing registers that id as a chat thread. The server's terminal manager
 * treats `threadId` as an opaque key, so a window works without ever becoming a
 * thread in T3's inbox.
 */

import { type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../lib/storage";
import { newThreadId } from "../lib/utils";

const DECK_WINDOW_STORAGE_KEY = "deck:windows:v1";

export interface DeckWindow {
  /** Doubles as the thread id everything else is scoped by. */
  readonly id: ThreadId;
  readonly name: string;
  readonly createdAt: string;
}

export interface DeckProjectRef {
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
}

/** NUL cannot appear in an environment or project id, so keys never collide. */
const PROJECT_KEY_SEPARATOR = "\u0000";

export function deckProjectKey(ref: DeckProjectRef): string {
  return `${ref.environmentId}${PROJECT_KEY_SEPARATOR}${ref.projectId}`;
}

export function parseDeckProjectKey(key: string): DeckProjectRef | null {
  const index = key.indexOf(PROJECT_KEY_SEPARATOR);
  if (index < 0) return null;
  return {
    environmentId: key.slice(0, index) as EnvironmentId,
    projectId: key.slice(index + PROJECT_KEY_SEPARATOR.length),
  };
}

function normalizeWindows(value: unknown): DeckWindow[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const windows: DeckWindow[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Partial<DeckWindow>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    windows.push({
      id: id as ThreadId,
      name:
        typeof candidate.name === "string" && candidate.name.trim().length > 0
          ? candidate.name
          : "Window",
      createdAt:
        typeof candidate.createdAt === "string" ? candidate.createdAt : new Date().toISOString(),
    });
  }
  return windows;
}

interface PersistedDeckWindowState {
  windowsByProjectKey?: Record<string, DeckWindow[]>;
}

export function migratePersistedDeckWindowState(
  persistedState: unknown,
  _version: number,
): PersistedDeckWindowState {
  if (!persistedState || typeof persistedState !== "object") {
    return { windowsByProjectKey: {} };
  }
  const candidate = persistedState as PersistedDeckWindowState;
  const entries = Object.entries(candidate.windowsByProjectKey ?? {})
    .map(([key, windows]) => [key, normalizeWindows(windows)] as const)
    .filter(([, windows]) => windows.length > 0);
  return { windowsByProjectKey: Object.fromEntries(entries) };
}

/** Numbers a new window after the highest "Window N" already in use. */
export function nextWindowName(existing: ReadonlyArray<DeckWindow>): string {
  let highest = 0;
  for (const window of existing) {
    const match = /^Window (\d+)$/.exec(window.name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `Window ${highest + 1}`;
}

export function selectProjectWindows(
  windowsByProjectKey: Record<string, ReadonlyArray<DeckWindow>>,
  ref: DeckProjectRef | null | undefined,
): ReadonlyArray<DeckWindow> {
  if (!ref) return [];
  return windowsByProjectKey[deckProjectKey(ref)] ?? [];
}

/** The project a window belongs to, for routes that only know the window id. */
export function findWindowProject(
  windowsByProjectKey: Record<string, ReadonlyArray<DeckWindow>>,
  windowId: string,
): { projectKey: string; window: DeckWindow } | null {
  for (const [projectKey, windows] of Object.entries(windowsByProjectKey)) {
    const window = windows.find((entry) => entry.id === windowId);
    if (window) return { projectKey, window };
  }
  return null;
}

interface DeckWindowStoreState {
  windowsByProjectKey: Record<string, DeckWindow[]>;
  /** Creates a window and returns it, so the caller can navigate to it. */
  createWindow: (ref: DeckProjectRef, name?: string) => DeckWindow;
  renameWindow: (ref: DeckProjectRef, windowId: string, name: string) => void;
  closeWindow: (ref: DeckProjectRef, windowId: string) => void;
  reorderWindow: (ref: DeckProjectRef, windowId: string, toIndex: number) => void;
}

export const useDeckWindowStore = create<DeckWindowStoreState>()(
  persist(
    (set, get) => ({
      windowsByProjectKey: {},

      createWindow: (ref, name) => {
        const key = deckProjectKey(ref);
        const existing = get().windowsByProjectKey[key] ?? [];
        const window: DeckWindow = {
          id: newThreadId(),
          name: name?.trim() || nextWindowName(existing),
          createdAt: new Date().toISOString(),
        };
        set((state) => ({
          windowsByProjectKey: {
            ...state.windowsByProjectKey,
            [key]: [...(state.windowsByProjectKey[key] ?? []), window],
          },
        }));
        return window;
      },

      renameWindow: (ref, windowId, name) => {
        const trimmed = name.trim();
        if (trimmed.length === 0) return;
        const key = deckProjectKey(ref);
        set((state) => {
          const windows = state.windowsByProjectKey[key];
          if (!windows) return state;
          let changed = false;
          const next = windows.map((window) => {
            if (window.id !== windowId || window.name === trimmed) return window;
            changed = true;
            return { ...window, name: trimmed };
          });
          return changed
            ? { windowsByProjectKey: { ...state.windowsByProjectKey, [key]: next } }
            : state;
        });
      },

      closeWindow: (ref, windowId) => {
        const key = deckProjectKey(ref);
        set((state) => {
          const windows = state.windowsByProjectKey[key];
          if (!windows) return state;
          const next = windows.filter((window) => window.id !== windowId);
          if (next.length === windows.length) return state;
          if (next.length === 0) {
            const { [key]: _removed, ...rest } = state.windowsByProjectKey;
            return { windowsByProjectKey: rest };
          }
          return { windowsByProjectKey: { ...state.windowsByProjectKey, [key]: next } };
        });
      },

      reorderWindow: (ref, windowId, toIndex) => {
        const key = deckProjectKey(ref);
        set((state) => {
          const windows = state.windowsByProjectKey[key];
          if (!windows) return state;
          const from = windows.findIndex((window) => window.id === windowId);
          if (from < 0) return state;
          const clamped = Math.min(Math.max(toIndex, 0), windows.length - 1);
          if (clamped === from) return state;
          const next = [...windows];
          const [moved] = next.splice(from, 1);
          if (!moved) return state;
          next.splice(clamped, 0, moved);
          return { windowsByProjectKey: { ...state.windowsByProjectKey, [key]: next } };
        });
      },
    }),
    {
      name: DECK_WINDOW_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      migrate: migratePersistedDeckWindowState,
      partialize: (state) => ({ windowsByProjectKey: state.windowsByProjectKey }),
    },
  ),
);
