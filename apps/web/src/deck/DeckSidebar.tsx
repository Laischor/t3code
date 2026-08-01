/**
 * Deck's sidebar: projects, and the windows inside each one.
 *
 * Deliberately separate from T3's thread sidebars rather than woven into them.
 * Those render an inbox — snooze and settle shelves, rename, change-request
 * state — none of which applies to a window, and they are the files upstream
 * churns most. Owning this one outright keeps rebases cheap.
 */

import { useNavigate, useParams } from "@tanstack/react-router";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ChevronRightIcon, PlusIcon, XIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { SidebarChromeFooter, SidebarChromeHeader } from "~/components/sidebar/SidebarChrome";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { useProjects } from "../state/entities";
import { previewEnvironment } from "../state/preview";
import { terminalEnvironment } from "../state/terminal";
import { useAtomCommand } from "../state/use-atom-command";
import { useDeckStore } from "./deckStore";
import {
  deckProjectKey,
  useDeckWindowStore,
  type DeckProjectRef,
  type DeckWindow,
} from "./deckWindowStore";

export function DeckSidebar() {
  const projects = useProjects();
  const windowsByProjectKey = useDeckWindowStore((store) => store.windowsByProjectKey);
  const navigate = useNavigate();
  const activeWindowId = useParams({
    strict: false,
    select: (params) => (params as { windowId?: string }).windowId ?? null,
  });
  const closeThreadTerminals = useAtomCommand(terminalEnvironment.close, {
    label: "terminal close",
    reportFailure: false,
  });
  const closeThreadPreviews = useAtomCommand(previewEnvironment.close, { reportFailure: false });

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggleProject = useCallback((key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const openWindow = useCallback(
    (ref: DeckProjectRef, window: DeckWindow) => {
      void navigate({
        to: "/deck/$environmentId/$windowId",
        params: { environmentId: ref.environmentId, windowId: window.id },
      });
    },
    [navigate],
  );

  const createWindow = useCallback(
    (ref: DeckProjectRef) => {
      const window = useDeckWindowStore.getState().createWindow(ref);
      openWindow(ref, window);
    },
    [openWindow],
  );

  const closeWindow = useCallback(
    (ref: DeckProjectRef, window: DeckWindow) => {
      const successor = (
        useDeckWindowStore.getState().windowsByProjectKey[deckProjectKey(ref)] ?? []
      ).find((entry) => entry.id !== window.id);
      // A window id *is* the thread id both managers key by, so one call each
      // takes down every terminal and browser session the window held. Without
      // it the PTYs outlive the window nothing can reach any more.
      const threadRef = {
        environmentId: EnvironmentId.make(ref.environmentId),
        threadId: ThreadId.make(window.id),
      };
      void closeThreadTerminals({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, deleteHistory: true },
      });
      void closeThreadPreviews({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      });
      useDeckStore.getState().clearPaneState(threadRef);
      useDeckWindowStore.getState().closeWindow(ref, window.id);
      // Only move if the window being closed is the one on screen.
      if (activeWindowId !== window.id) return;
      if (successor) openWindow(ref, successor);
      else void navigate({ to: "/" });
    },
    [activeWindowId, closeThreadPreviews, closeThreadTerminals, navigate, openWindow],
  );

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => a.title.localeCompare(b.title)),
    [projects],
  );

  return (
    <Sidebar>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent>
        {sortedProjects.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">No projects yet.</p>
        ) : null}

        {sortedProjects.map((project) => {
          const ref: DeckProjectRef = {
            environmentId: project.environmentId,
            projectId: project.id,
          };
          const key = deckProjectKey(ref);
          const windows = windowsByProjectKey[key] ?? [];
          const isCollapsed = collapsed.has(key);

          return (
            <SidebarGroup key={key} className="py-1">
              <div className="flex items-center gap-1 pr-1">
                <button
                  type="button"
                  onClick={() => toggleProject(key)}
                  aria-expanded={!isCollapsed}
                  className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1 text-xs font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground"
                  title={project.workspaceRoot}
                >
                  <ChevronRightIcon
                    aria-hidden
                    className={cn(
                      "size-3 shrink-0 transition-transform",
                      !isCollapsed && "rotate-90",
                    )}
                  />
                  <span className="truncate">{project.title}</span>
                </button>
                <button
                  type="button"
                  aria-label={`New window in ${project.title}`}
                  title="New window"
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => createWindow(ref)}
                >
                  <PlusIcon className="size-3.5" />
                </button>
              </div>

              {isCollapsed ? null : (
                <SidebarMenu>
                  {windows.length === 0 ? (
                    <p className="px-3 py-1 text-xs text-muted-foreground">No windows yet.</p>
                  ) : null}
                  {windows.map((window) => (
                    <WindowRow
                      key={window.id}
                      window={window}
                      isActive={window.id === activeWindowId}
                      onOpen={() => openWindow(ref, window)}
                      onRename={(name) =>
                        useDeckWindowStore.getState().renameWindow(ref, window.id, name)
                      }
                      onClose={() => closeWindow(ref, window)}
                    />
                  ))}
                </SidebarMenu>
              )}
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarChromeFooter />
    </Sidebar>
  );
}

function WindowRow({
  window,
  isActive,
  onOpen,
  onRename,
  onClose,
}: {
  window: DeckWindow;
  isActive: boolean;
  onOpen: () => void;
  onRename: (name: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const isRenaming = draft !== null;
  // Escape unmounts the input, and a blur fired on the way out must not be
  // mistaken for a confirmation.
  const cancelledRef = useRef(false);

  const commit = useCallback(() => {
    if (draft === null || cancelledRef.current) return;
    // A blank name is a no-op in the store, so this also covers "cleared it".
    onRename(draft);
    setDraft(null);
  }, [draft, onRename]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setDraft(null);
  }, []);

  const startRenaming = useCallback((name: string) => {
    cancelledRef.current = false;
    setDraft(name);
  }, []);

  return (
    <SidebarMenuItem className="group/window">
      {isRenaming ? (
        <input
          autoFocus
          value={draft}
          aria-label={`Rename ${window.name}`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
          onFocus={(event) => event.currentTarget.select()}
          className="h-8 w-full rounded-md border border-sidebar-border bg-sidebar px-2 text-sm outline-none focus:border-sidebar-ring"
        />
      ) : (
        <>
          <SidebarMenuButton
            isActive={isActive}
            onClick={onOpen}
            onDoubleClick={() => startRenaming(window.name)}
            className="pr-7"
          >
            <span className="truncate">{window.name}</span>
          </SidebarMenuButton>
          <button
            type="button"
            aria-label={`Close ${window.name}`}
            title="Close window"
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover/window:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            <XIcon className="size-3" />
          </button>
        </>
      )}
    </SidebarMenuItem>
  );
}
