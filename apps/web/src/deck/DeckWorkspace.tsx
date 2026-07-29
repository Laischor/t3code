/**
 * Deck's main surface: a split grid of panes, each holding a stack of terminal
 * and browser tabs, in place of the chat view.
 *
 * Both tab kinds are T3's own — terminals attach through the environment's
 * terminal RPC (so SSH/WSL/cloud environments work, not just local), and
 * browser tabs are the desktop preview surface. Deck contributes the layout.
 */

import { useAtomValue } from "@effect/atom-react";
import { type ScopedThreadRef } from "@t3tools/contracts";
import { getTerminalLabel, nextTerminalId } from "@t3tools/shared/terminalLabels";
import {
  ChevronDownIcon,
  Code2,
  Globe,
  PlusIcon,
  SquareSplitHorizontal,
  SquareSplitVertical,
  TerminalSquare,
  XIcon,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { openPreviewSession } from "~/components/preview/openPreviewSession";
import { TerminalViewport } from "~/components/TerminalViewport";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { cn } from "~/lib/utils";
import { previewEnvironment } from "../state/preview";
import { primaryServerKeybindingsAtom } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { DeckDevToolsSlot } from "./DeckDevToolsSlot";
import { DeckPaneGrid } from "./DeckPaneGrid";
import { createPaneLeaf, createTab, selectThreadPaneState, useDeckStore } from "./deckStore";
import { matchDeckShortcut, stepTabIndex } from "./deckShortcuts";
import {
  activeTab,
  findLeaf,
  paneLeaves,
  paneTabs,
  type DeckPaneLeaf,
  type DeckSplitDirection,
  type DeckTab,
} from "./paneTree";

// Lazily loaded exactly like ChatView does, so the preview surface stays in its
// own chunk instead of being pulled into the main bundle.
const DEVTOOLS_DEFAULT_HEIGHT = 320;
const DEVTOOLS_MIN_HEIGHT = 120;

const PreviewPanel = lazy(() =>
  import("~/components/preview/PreviewPanel").then((module) => ({
    default: module.PreviewPanel,
  })),
);

export interface DeckWorkspaceProps {
  threadRef: ScopedThreadRef;
  cwd: string;
  worktreePath?: string | null;
  runtimeEnv?: Record<string, string>;
}

export function DeckWorkspace({ threadRef, cwd, worktreePath, runtimeEnv }: DeckWorkspaceProps) {
  const paneState = useDeckStore((store) =>
    selectThreadPaneState(store.paneStateByThreadKey, threadRef),
  );
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const [focusRequestId, setFocusRequestId] = useState(0);
  // The browser tab that should open with its URL bar focused, cleared once it
  // has been handled so switching back later does not steal focus again.
  const [pendingUrlFocusTabId, setPendingUrlFocusTabId] = useState<string | null>(null);

  const usedTerminalIds = useMemo(
    () =>
      paneTabs(paneState.root).flatMap((tab) =>
        tab.kind === "terminal" && tab.terminalId ? [tab.terminalId] : [],
      ),
    [paneState.root],
  );

  // Seed the thread with a single terminal the first time it is opened.
  const bootstrappedRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${threadRef.environmentId}/${threadRef.threadId}`;
    if (paneState.root !== null) {
      bootstrappedRef.current = key;
      return;
    }
    if (bootstrappedRef.current === key) return;
    bootstrappedRef.current = key;
    useDeckStore
      .getState()
      .ensureRootPane(
        threadRef,
        createPaneLeaf(createTab({ kind: "terminal", terminalId: nextTerminalId([]) })),
      );
  }, [paneState.root, threadRef]);

  const targetPaneId = paneState.activePaneId;

  /** Opens a preview session and writes its id back onto the tab. */
  const openBrowserSession = useCallback(
    async (tab: DeckTab) => {
      const result = await openPreviewSession({ openPreview, threadRef });
      if (result._tag === "Failure") return;
      useDeckStore
        .getState()
        .attachTabSession(threadRef, tab.id, { previewTabId: result.value.tabId });
    },
    [openPreview, threadRef],
  );

  const addTab = useCallback(
    (kind: DeckTab["kind"], paneId?: string) => {
      const pane = paneId ?? targetPaneId;
      if (!pane) return;
      const tab =
        kind === "terminal"
          ? createTab({ kind, terminalId: nextTerminalId(usedTerminalIds) })
          : createTab({ kind, previewTabId: null });
      useDeckStore.getState().addTab(threadRef, pane, tab);
      setFocusRequestId((value) => value + 1);
      if (kind === "browser") {
        setPendingUrlFocusTabId(tab.id);
        void openBrowserSession(tab);
      }
    },
    [openBrowserSession, targetPaneId, threadRef, usedTerminalIds],
  );

  const splitPane = useCallback(
    (direction: DeckSplitDirection) => {
      const leaf = createPaneLeaf(
        createTab({ kind: "terminal", terminalId: nextTerminalId(usedTerminalIds) }),
      );
      useDeckStore.getState().addPane(threadRef, leaf, direction);
      setFocusRequestId((value) => value + 1);
    },
    [threadRef, usedTerminalIds],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      useDeckStore.getState().closeTab(threadRef, tabId);
    },
    [threadRef],
  );

  const activateTab = useCallback(
    (paneId: string, tabId: string) => {
      useDeckStore.getState().setActiveTab(threadRef, paneId, tabId);
      setFocusRequestId((value) => value + 1);
    },
    [threadRef],
  );

  const activatePane = useCallback(
    (paneId: string) => {
      useDeckStore.getState().setActivePane(threadRef, paneId);
      setFocusRequestId((value) => value + 1);
    },
    [threadRef],
  );

  const resizeSplit = useCallback(
    (splitId: string, sizes: ReadonlyArray<number>) => {
      useDeckStore.getState().setSplitSizes(threadRef, splitId, sizes);
    },
    [threadRef],
  );

  const cycleTab = useCallback(
    (direction: 1 | -1) => {
      const state = useDeckStore.getState();
      const current = selectThreadPaneState(state.paneStateByThreadKey, threadRef);
      const pane = findLeaf(current.root, current.activePaneId);
      if (!pane) return;
      const index = pane.tabs.findIndex((entry) => entry.id === pane.activeTabId);
      const next = stepTabIndex(pane.tabs.length, index, direction);
      if (next === null) return;
      const target = pane.tabs[next];
      if (target) activateTab(pane.id, target.id);
    },
    [activateTab, threadRef],
  );

  // Capture phase: xterm claims keys on the terminal element, and a bubbling
  // listener would never see them.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = matchDeckShortcut(event);
      if (!shortcut) return;
      event.preventDefault();
      event.stopPropagation();
      switch (shortcut) {
        case "tab.newTerminal":
          addTab("terminal");
          break;
        case "tab.newBrowser":
          addTab("browser");
          break;
        case "tab.next":
          cycleTab(1);
          break;
        case "tab.previous":
          cycleTab(-1);
          break;
        case "tab.close": {
          const state = useDeckStore.getState();
          const current = selectThreadPaneState(state.paneStateByThreadKey, threadRef);
          const pane = findLeaf(current.root, current.activePaneId);
          const active = pane ? activeTab(pane) : null;
          if (active) closeTab(active.id);
          break;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [addTab, closeTab, cycleTab, threadRef]);

  // Depth-first order puts the top-left pane first: the only one the macOS
  // traffic lights can reach once the sidebar is collapsed.
  const leaves = useMemo(() => paneLeaves(paneState.root), [paneState.root]);
  const firstPaneId = leaves[0]?.id ?? null;

  const renderPane = useCallback(
    (leaf: DeckPaneLeaf, isActive: boolean) => (
      <PaneTabs
        leaf={leaf}
        isActive={isActive}
        threadRef={threadRef}
        cwd={cwd}
        {...(worktreePath !== undefined ? { worktreePath } : {})}
        {...(runtimeEnv !== undefined ? { runtimeEnv } : {})}
        keybindings={keybindings}
        focusRequestId={focusRequestId}
        onSelectTab={(tabId) => activateTab(leaf.id, tabId)}
        onCloseTab={closeTab}
        onAddTab={(kind) => addTab(kind, leaf.id)}
        onSplit={splitPane}
        pendingUrlFocusTabId={pendingUrlFocusTabId}
        onUrlFocused={() => setPendingUrlFocusTabId(null)}
        insetForTitlebar={leaf.id === firstPaneId}
      />
    ),
    [
      activateTab,
      addTab,
      closeTab,
      cwd,
      focusRequestId,
      keybindings,
      runtimeEnv,
      firstPaneId,
      pendingUrlFocusTabId,
      splitPane,
      threadRef,
      worktreePath,
    ],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 p-1">
        {paneState.root ? (
          <DeckPaneGrid
            node={paneState.root}
            activePaneId={paneState.activePaneId}
            onActivatePane={activatePane}
            onResizeSplit={resizeSplit}
            renderPane={renderPane}
            hideActiveBorder={leaves.length <= 1}
          />
        ) : (
          <PaneMessage>Opening terminal…</PaneMessage>
        )}
      </div>
    </div>
  );
}

function PaneMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function tabTitle(tab: DeckTab): string {
  return tab.kind === "terminal" ? getTerminalLabel(tab.terminalId ?? tab.id) : "Browser";
}

interface PaneTabsProps {
  leaf: DeckPaneLeaf;
  isActive: boolean;
  threadRef: ScopedThreadRef;
  cwd: string;
  worktreePath?: string | null;
  runtimeEnv?: Record<string, string>;
  keybindings: React.ComponentProps<typeof TerminalViewport>["keybindings"];
  focusRequestId: number;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onAddTab: (kind: DeckTab["kind"]) => void;
  onSplit: (direction: DeckSplitDirection) => void;
  /** Tab that should open with its URL bar focused, if it is in this pane. */
  pendingUrlFocusTabId: string | null;
  onUrlFocused: () => void;
  /** Leaves room for the window controls when the sidebar is collapsed. */
  insetForTitlebar: boolean;
}

function PaneTabs({
  leaf,
  isActive,
  threadRef,
  cwd,
  worktreePath,
  runtimeEnv,
  keybindings,
  focusRequestId,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onSplit,
  pendingUrlFocusTabId,
  onUrlFocused,
  insetForTitlebar,
}: PaneTabsProps) {
  const current = activeTab(leaf);

  return (
    <>
      <div
        className={cn(
          "flex h-7 shrink-0 items-stretch gap-px overflow-x-auto border-b text-xs",
          isActive ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {insetForTitlebar ? (
          // Doubles as somewhere to grab the window, which the tab strip
          // otherwise leaves nowhere for.
          <div
            aria-hidden
            className="drag-region hidden shrink-0 [[data-sidebar-state=collapsed]_&]:block [[data-sidebar-state=collapsed]_&]:w-[var(--workspace-titlebar-content-left)]"
          />
        ) : null}
        {leaf.tabs.map((tab) => {
          const selected = tab.id === current?.id;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={selected}
              onPointerDown={() => onSelectTab(tab.id)}
              className={cn(
                "group flex min-w-0 shrink-0 cursor-default items-center gap-1 border-r px-2",
                selected ? "bg-accent/60" : "hover:bg-accent/30",
              )}
            >
              {tab.kind === "terminal" ? (
                <TerminalSquare className="size-3 shrink-0 opacity-60" />
              ) : (
                <Globe className="size-3 shrink-0 opacity-60" />
              )}
              <span className="truncate">{tabTitle(tab)}</span>
              <button
                type="button"
                aria-label={`Close ${tabTitle(tab)}`}
                className="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                <XIcon className="size-3" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          aria-label="New terminal tab"
          title="New terminal tab (⌘T)"
          className="flex shrink-0 items-center pl-2 pr-1 hover:bg-accent/30"
          onClick={(event) => {
            event.stopPropagation();
            onAddTab("terminal");
          }}
        >
          <PlusIcon className="size-3" />
        </button>
        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                aria-label="New tab of another kind"
                title="New tab of another kind"
                className="flex shrink-0 items-center pr-2 text-muted-foreground hover:bg-accent/30 hover:text-foreground"
              />
            }
          >
            <ChevronDownIcon className="size-3" />
          </MenuTrigger>
          <MenuPopup align="start" sideOffset={4} className="min-w-44">
            <MenuItem onClick={() => onAddTab("terminal")}>
              <TerminalSquare className="size-3.5" />
              Terminal
              <span className="ml-auto text-xs text-muted-foreground">⌘T</span>
            </MenuItem>
            <MenuItem onClick={() => onAddTab("browser")}>
              <Globe className="size-3.5" />
              Browser
              <span className="ml-auto text-xs text-muted-foreground">⇧⌘T</span>
            </MenuItem>
          </MenuPopup>
        </Menu>

        {/* Splitting acts on this pane, so it belongs to this strip. */}
        <div className="ml-auto flex shrink-0 items-center gap-px pr-1">
          <button
            type="button"
            aria-label="Split right"
            title="Split right"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              onSplit("horizontal");
            }}
          >
            <SquareSplitHorizontal className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Split down"
            title="Split down"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              onSplit("vertical");
            }}
          >
            <SquareSplitVertical className="size-3.5" />
          </button>
        </div>
      </div>

      {/*
        Every tab stays mounted; unmounting a terminal drops its scrollback and
        xterm state, and unmounting a <webview> tears down the page entirely.
        `invisible` rather than `hidden` so panes keep their measured size and
        terminals do not have to refit on every switch. Browser tabs additionally
        get an explicit `visible` flag, because CSS does not hide their guest.
      */}
      <div className="relative min-h-0 flex-1">
        {leaf.tabs.map((tab) => {
          const selected = tab.id === current?.id;
          return (
            <div
              key={tab.id}
              className={cn(
                "absolute inset-0 flex min-h-0 flex-col",
                selected ? "" : "invisible pointer-events-none",
              )}
            >
              {tab.kind === "terminal" ? (
                <TerminalTab
                  tab={tab}
                  isActive={isActive && selected}
                  threadRef={threadRef}
                  cwd={cwd}
                  {...(worktreePath !== undefined ? { worktreePath } : {})}
                  {...(runtimeEnv !== undefined ? { runtimeEnv } : {})}
                  keybindings={keybindings}
                  focusRequestId={focusRequestId}
                  onExited={() => onCloseTab(tab.id)}
                />
              ) : (
                <BrowserTab
                  tab={tab}
                  threadRef={threadRef}
                  visible={selected}
                  autoFocusUrl={tab.id === pendingUrlFocusTabId}
                  onUrlFocused={onUrlFocused}
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function TerminalTab({
  tab,
  isActive,
  threadRef,
  cwd,
  worktreePath,
  runtimeEnv,
  keybindings,
  focusRequestId,
  onExited,
}: {
  tab: DeckTab;
  isActive: boolean;
  threadRef: ScopedThreadRef;
  cwd: string;
  worktreePath?: string | null;
  runtimeEnv?: Record<string, string>;
  keybindings: React.ComponentProps<typeof TerminalViewport>["keybindings"];
  focusRequestId: number;
  onExited: () => void;
}) {
  const terminalId = tab.terminalId ?? tab.id;
  return (
    <div className="min-h-0 flex-1">
      <TerminalViewport
        threadRef={threadRef}
        threadId={threadRef.threadId}
        terminalId={terminalId}
        terminalLabel={getTerminalLabel(terminalId)}
        cwd={cwd}
        {...(worktreePath !== undefined ? { worktreePath } : {})}
        {...(runtimeEnv !== undefined ? { runtimeEnv } : {})}
        onSessionExited={onExited}
        // Deck has no composer to attach terminal context to.
        onAddTerminalContext={() => {}}
        focusRequestId={focusRequestId}
        autoFocus={isActive}
        keybindings={keybindings}
      />
    </div>
  );
}

function BrowserTab({
  tab,
  threadRef,
  visible,
  autoFocusUrl,
  onUrlFocused,
}: {
  tab: DeckTab;
  threadRef: ScopedThreadRef;
  /** True for a freshly opened tab, so it starts in the URL bar. */
  autoFocusUrl: boolean;
  onUrlFocused: () => void;
  /**
   * CSS cannot hide an Electron `<webview>` — the guest composites in its own
   * layer, so `visibility: hidden` on an ancestor leaves it painted on top.
   * T3 parks inactive surfaces off-screen instead, driven by this flag, and the
   * docked DevTools view does the same.
   */
  visible: boolean;
}) {
  const previewTabId = tab.previewTabId ?? null;
  const [focusUrlNonce, setFocusUrlNonce] = useState<number | undefined>(undefined);
  const [devToolsHeight, setDevToolsHeight] = useState(0);

  // Only once the session exists, since the URL bar is disabled until then.
  useEffect(() => {
    if (!autoFocusUrl || !previewTabId) return;
    setFocusUrlNonce((value) => (value ?? 0) + 1);
    onUrlFocused();
  }, [autoFocusUrl, onUrlFocused, previewTabId]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const devToolsOpen = devToolsHeight > 0;

  const devToolsHeightRef = useRef(devToolsHeight);
  useEffect(() => {
    devToolsHeightRef.current = devToolsHeight;
  }, [devToolsHeight]);

  const startDevToolsDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const body = bodyRef.current;
    if (!body || event.button !== 0) return;
    event.preventDefault();
    const bodyHeight = body.getBoundingClientRect().height;
    const startY = event.clientY;
    const startHeight = devToolsHeightRef.current;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      const next = startHeight - (moveEvent.clientY - startY);
      setDevToolsHeight(Math.min(Math.max(next, DEVTOOLS_MIN_HEIGHT), bodyHeight - 80));
    };
    const onUp = () => {
      target.releasePointerCapture(event.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }, []);

  return (
    <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">
        {previewTabId ? (
          <Suspense fallback={<PaneMessage>Loading browser…</PaneMessage>}>
            <PreviewPanel
              mode="embedded"
              threadRef={threadRef}
              tabId={previewTabId}
              visible={visible}
              focusUrlNonce={focusUrlNonce}
            />
          </Suspense>
        ) : (
          <PaneMessage>Opening browser…</PaneMessage>
        )}
      </div>
      {previewTabId ? (
        <>
          {devToolsOpen ? (
            <>
              <div
                role="separator"
                aria-orientation="horizontal"
                onPointerDown={startDevToolsDrag}
                className="group flex h-1.5 shrink-0 cursor-row-resize items-center justify-center"
              >
                <div className="h-[2px] w-8 rounded-full bg-border/70 group-hover:bg-primary/60" />
              </div>
              <div className="shrink-0 border-t" style={{ height: devToolsHeight }}>
                <DeckDevToolsSlot threadRef={threadRef} tabId={previewTabId} visible={visible} />
              </div>
            </>
          ) : null}
          <button
            type="button"
            aria-label={devToolsOpen ? "Hide DevTools" : "Show DevTools"}
            aria-pressed={devToolsOpen}
            title={devToolsOpen ? "Hide DevTools" : "Show DevTools"}
            className={cn(
              "flex h-5 shrink-0 items-center justify-center gap-1 border-t text-[10px] text-muted-foreground hover:bg-accent",
              devToolsOpen && "bg-accent/60",
            )}
            onClick={() => setDevToolsHeight(devToolsOpen ? 0 : DEVTOOLS_DEFAULT_HEIGHT)}
          >
            <Code2 className="size-3" />
            DevTools
          </button>
        </>
      ) : null}
    </div>
  );
}
