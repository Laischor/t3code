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
import { previewBridge } from "~/components/preview/previewBridge";
import { TerminalViewport } from "~/components/TerminalViewport";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { previewEnvironment } from "../state/preview";
import { primaryServerKeybindingsAtom } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { DeckPaneGrid } from "./DeckPaneGrid";
import { createPaneLeaf, createTab, selectThreadPaneState, useDeckStore } from "./deckStore";
import {
  activeTab,
  paneTabs,
  type DeckPaneLeaf,
  type DeckSplitDirection,
  type DeckTab,
} from "./paneTree";

// Lazily loaded exactly like ChatView does, so the preview surface stays in its
// own chunk instead of being pulled into the main bundle.
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
      if (kind === "browser") void openBrowserSession(tab);
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
      threadRef,
      worktreePath,
    ],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        <Button size="sm" variant="ghost" onClick={() => addTab("terminal")}>
          <PlusIcon className="size-3.5" />
          Terminal
        </Button>
        <Button size="sm" variant="ghost" onClick={() => addTab("browser")}>
          <Globe className="size-3.5" />
          Browser
        </Button>
        <div className="mx-1 h-4 w-px bg-border" />
        <Button
          size="sm"
          variant="ghost"
          title="Split right"
          onClick={() => splitPane("horizontal")}
        >
          <SquareSplitHorizontal className="size-3.5" />
        </Button>
        <Button size="sm" variant="ghost" title="Split down" onClick={() => splitPane("vertical")}>
          <SquareSplitVertical className="size-3.5" />
        </Button>
        <span className="ml-auto truncate text-xs text-muted-foreground" title={cwd}>
          {cwd}
        </span>
      </div>

      <div className="min-h-0 flex-1 p-1">
        {paneState.root ? (
          <DeckPaneGrid
            node={paneState.root}
            activePaneId={paneState.activePaneId}
            onActivatePane={activatePane}
            onResizeSplit={resizeSplit}
            renderPane={renderPane}
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
          title="New terminal tab"
          className="flex shrink-0 items-center px-2 hover:bg-accent/30"
          onClick={(event) => {
            event.stopPropagation();
            onAddTab("terminal");
          }}
        >
          <PlusIcon className="size-3" />
        </button>
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
                <BrowserTab tab={tab} threadRef={threadRef} visible={selected} />
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
}: {
  tab: DeckTab;
  threadRef: ScopedThreadRef;
  /**
   * CSS cannot hide an Electron `<webview>` — the guest composites in its own
   * layer, so `visibility: hidden` on an ancestor leaves it painted on top.
   * T3 parks inactive surfaces off-screen instead, driven by this flag.
   */
  visible: boolean;
}) {
  const previewTabId = tab.previewTabId ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">
        {previewTabId ? (
          <Suspense fallback={<PaneMessage>Loading browser…</PaneMessage>}>
            <PreviewPanel
              mode="embedded"
              threadRef={threadRef}
              tabId={previewTabId}
              visible={visible}
            />
          </Suspense>
        ) : (
          <PaneMessage>Opening browser…</PaneMessage>
        )}
      </div>
      {previewTabId ? (
        <button
          type="button"
          aria-label="Open DevTools"
          title="Open DevTools in a separate window"
          className="flex h-5 shrink-0 items-center justify-center gap-1 border-t text-[10px] text-muted-foreground hover:bg-accent"
          onClick={() => {
            void previewBridge?.openDevTools(previewTabId);
          }}
        >
          <Code2 className="size-3" />
          DevTools
        </button>
      ) : null}
    </div>
  );
}
