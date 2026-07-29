/**
 * Deck's main surface: a split grid of terminal and browser panes in place of
 * the chat view.
 *
 * Both pane kinds are T3's own — terminals attach through the environment's
 * terminal RPC (so SSH/WSL/cloud environments work, not just local), and
 * browser panes are the desktop preview surface. Deck contributes the layout.
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
  XIcon,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { openPreviewSession } from "~/components/preview/openPreviewSession";
import { TerminalViewport } from "~/components/TerminalViewport";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { previewEnvironment } from "../state/preview";
import { primaryServerKeybindingsAtom } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { DeckDevToolsPane } from "./DeckDevToolsPane";
import { DeckPaneGrid } from "./DeckPaneGrid";
import {
  createPaneLeaf,
  selectThreadPaneState,
  useDeckStore,
} from "./deckStore";
import { paneLeaves, type DeckPaneLeaf, type DeckSplitDirection } from "./paneTree";

// Lazily loaded exactly like ChatView does, so the preview surface stays in its
// own chunk instead of being pulled into the main bundle.
const PreviewPanel = lazy(() =>
  import("~/components/preview/PreviewPanel").then((module) => ({
    default: module.PreviewPanel,
  })),
);

const DEVTOOLS_DEFAULT_HEIGHT = 280;
const DEVTOOLS_MIN_HEIGHT = 120;

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

  const leaves = useMemo(() => paneLeaves(paneState.root), [paneState.root]);
  const usedTerminalIds = useMemo(
    () =>
      leaves.flatMap((leaf) => (leaf.kind === "terminal" && leaf.terminalId ? [leaf.terminalId] : [])),
    [leaves],
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
        createPaneLeaf({ kind: "terminal", terminalId: nextTerminalId([]) }),
      );
  }, [paneState.root, threadRef]);

  const addTerminalPane = useCallback(
    (direction: DeckSplitDirection) => {
      const leaf = createPaneLeaf({
        kind: "terminal",
        terminalId: nextTerminalId(usedTerminalIds),
      });
      useDeckStore.getState().addPane(threadRef, leaf, direction);
      setFocusRequestId((value) => value + 1);
    },
    [threadRef, usedTerminalIds],
  );

  const addBrowserPane = useCallback(
    async (direction: DeckSplitDirection) => {
      // The pane appears immediately; the tab id lands once the session opens.
      const leaf = createPaneLeaf({ kind: "browser", tabId: null });
      useDeckStore.getState().addPane(threadRef, leaf, direction);

      const result = await openPreviewSession({ openPreview, threadRef });
      if (result._tag === "Failure") return;
      useDeckStore
        .getState()
        .attachPaneSession(threadRef, leaf.id, { tabId: result.value.tabId });
    },
    [openPreview, threadRef],
  );

  const closePane = useCallback(
    (paneId: string) => {
      useDeckStore.getState().closePane(threadRef, paneId);
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
    (leaf: DeckPaneLeaf, isActive: boolean) =>
      leaf.kind === "terminal" ? (
        <TerminalPane
          leaf={leaf}
          isActive={isActive}
          threadRef={threadRef}
          cwd={cwd}
          {...(worktreePath !== undefined ? { worktreePath } : {})}
          {...(runtimeEnv !== undefined ? { runtimeEnv } : {})}
          keybindings={keybindings}
          focusRequestId={focusRequestId}
          onClose={() => closePane(leaf.id)}
        />
      ) : (
        <BrowserPane leaf={leaf} threadRef={threadRef} onClose={() => closePane(leaf.id)} />
      ),
    [closePane, cwd, focusRequestId, keybindings, runtimeEnv, threadRef, worktreePath],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        <Button size="sm" variant="ghost" onClick={() => addTerminalPane("vertical")}>
          <PlusIcon className="size-3.5" />
          Terminal
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void addBrowserPane("horizontal")}>
          <Globe className="size-3.5" />
          Browser
        </Button>
        <div className="mx-1 h-4 w-px bg-border" />
        <Button
          size="sm"
          variant="ghost"
          title="Split right"
          onClick={() => addTerminalPane("horizontal")}
        >
          <SquareSplitHorizontal className="size-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          title="Split down"
          onClick={() => addTerminalPane("vertical")}
        >
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

function PaneMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function PaneHeader({
  title,
  isActive,
  actions,
  onClose,
}: {
  title: string;
  isActive?: boolean;
  actions?: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className={cn(
        "flex h-7 shrink-0 items-center justify-between gap-2 border-b px-2 text-xs",
        isActive ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <span className="truncate">{title}</span>
      <div className="flex shrink-0 items-center gap-0.5">
        {actions}
        <button
          type="button"
          aria-label={`Close ${title}`}
          className="rounded p-0.5 hover:bg-accent"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <XIcon className="size-3" />
        </button>
      </div>
    </div>
  );
}

function TerminalPane({
  leaf,
  isActive,
  threadRef,
  cwd,
  worktreePath,
  runtimeEnv,
  keybindings,
  focusRequestId,
  onClose,
}: {
  leaf: DeckPaneLeaf;
  isActive: boolean;
  threadRef: ScopedThreadRef;
  cwd: string;
  worktreePath?: string | null;
  runtimeEnv?: Record<string, string>;
  keybindings: React.ComponentProps<typeof TerminalViewport>["keybindings"];
  focusRequestId: number;
  onClose: () => void;
}) {
  const terminalId = leaf.terminalId ?? leaf.id;
  return (
    <>
      <PaneHeader title={getTerminalLabel(terminalId)} isActive={isActive} onClose={onClose} />
      <div className="min-h-0 flex-1">
        <TerminalViewport
          threadRef={threadRef}
          threadId={threadRef.threadId}
          terminalId={terminalId}
          terminalLabel={getTerminalLabel(terminalId)}
          cwd={cwd}
          {...(worktreePath !== undefined ? { worktreePath } : {})}
          {...(runtimeEnv !== undefined ? { runtimeEnv } : {})}
          onSessionExited={onClose}
          // Deck has no composer to attach terminal context to.
          onAddTerminalContext={() => {}}
          focusRequestId={focusRequestId}
          autoFocus={isActive}
          keybindings={keybindings}
        />
      </div>
    </>
  );
}

function BrowserPane({
  leaf,
  threadRef,
  onClose,
}: {
  leaf: DeckPaneLeaf;
  threadRef: ScopedThreadRef;
  onClose: () => void;
}) {
  const [devToolsHeight, setDevToolsHeight] = useState(0);
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
    <>
      <PaneHeader
        title="Browser"
        onClose={onClose}
        actions={
          leaf.tabId ? (
            <button
              type="button"
              aria-label={devToolsOpen ? "Hide DevTools" : "Show DevTools"}
              aria-pressed={devToolsOpen}
              title={devToolsOpen ? "Hide DevTools" : "Show DevTools"}
              className={cn("rounded p-0.5 hover:bg-accent", devToolsOpen && "bg-accent")}
              onClick={(event) => {
                event.stopPropagation();
                setDevToolsHeight(devToolsOpen ? 0 : DEVTOOLS_DEFAULT_HEIGHT);
              }}
            >
              <Code2 className="size-3" />
            </button>
          ) : null
        }
      />
      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          {leaf.tabId ? (
            <Suspense fallback={<PaneMessage>Loading browser…</PaneMessage>}>
              <PreviewPanel mode="embedded" threadRef={threadRef} tabId={leaf.tabId} visible />
            </Suspense>
          ) : (
            <PaneMessage>Opening browser…</PaneMessage>
          )}
        </div>
        {leaf.tabId && devToolsOpen ? (
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
              <DeckDevToolsPane tabId={leaf.tabId} />
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
