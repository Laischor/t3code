/**
 * Deck's palette: jump to a window, or create one.
 *
 * Separate from T3's CommandPalette, which is built around projects and chat
 * threads and is one of the files upstream changes most.
 */

import { useNavigate } from "@tanstack/react-router";
import { FolderPlus, Globe, PlusIcon, SquareTerminal, TerminalSquare } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { inferProjectTitleFromPath } from "~/lib/projectPaths";
import { cn, newProjectId } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { useProjects } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { projectEnvironment } from "../state/projects";
import { useAtomCommand } from "../state/use-atom-command";
import {
  buildDeckPaletteItems,
  filterDeckPaletteItems,
  stepPaletteIndex,
  type DeckPaletteItem,
  type DeckPaletteProject,
} from "./deckPaletteItems";
import { deckProjectKey, useDeckWindowStore, type DeckProjectRef } from "./deckWindowStore";

export interface DeckPaletteProps {
  open: boolean;
  onClose: () => void;
  onNewTerminalTab: () => void;
  onNewBrowserTab: () => void;
}

export function DeckPalette({
  open,
  onClose,
  onNewTerminalTab,
  onNewBrowserTab,
}: DeckPaletteProps) {
  const navigate = useNavigate();
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: true });
  const windowsByProjectKey = useDeckWindowStore((store) => store.windowsByProjectKey);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const paletteProjects = useMemo<ReadonlyArray<DeckPaletteProject>>(
    () =>
      [...projects]
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((project) => ({
          environmentId: project.environmentId,
          projectId: project.id,
          title: project.title,
          windows: (
            windowsByProjectKey[
              deckProjectKey({ environmentId: project.environmentId, projectId: project.id })
            ] ?? []
          ).map((window) => ({ id: window.id, name: window.name })),
        })),
    [projects, windowsByProjectKey],
  );

  const items = useMemo(() => buildDeckPaletteItems(paletteProjects), [paletteProjects]);
  const results = useMemo(() => filterDeckPaletteItems(items, query), [items, query]);

  // A shrinking result list must never leave the highlight past the end.
  const selected = results.length === 0 ? -1 : Math.min(index, results.length - 1);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
  }, [open]);

  useEffect(() => {
    if (selected < 0) return;
    listRef.current
      ?.querySelector(`[data-palette-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  /**
   * Adds a project by folder, then opens its first window — otherwise the app
   * has no way back once you are down to one project, or none.
   */
  const addProject = useCallback(async () => {
    const environmentId = primaryEnvironmentId;
    if (!environmentId) return;
    const workspaceRoot = await readLocalApi()?.dialogs.pickFolder();
    if (!workspaceRoot) return;

    // The id is ours, so the window can be created without waiting for the
    // project to come back through the entity stream.
    const projectId = newProjectId();
    const result = await createProject({
      environmentId,
      input: {
        projectId,
        title: inferProjectTitleFromPath(workspaceRoot),
        workspaceRoot,
        createWorkspaceRootIfMissing: true,
        defaultModelSelection: null,
      },
    });
    if (result._tag === "Failure") return;

    const created = useDeckWindowStore.getState().createWindow({ environmentId, projectId });
    void navigate({
      to: "/deck/$environmentId/$windowId",
      params: { environmentId, windowId: created.id },
    });
  }, [createProject, navigate, primaryEnvironmentId]);

  if (!open) return null;

  const activate = (item: DeckPaletteItem | undefined) => {
    if (!item) return;
    onClose();
    switch (item.kind) {
      case "window":
        void navigate({
          to: "/deck/$environmentId/$windowId",
          params: { environmentId: item.environmentId, windowId: item.windowId },
        });
        return;
      case "new-window": {
        const ref: DeckProjectRef = {
          environmentId: item.environmentId as DeckProjectRef["environmentId"],
          projectId: item.projectId,
        };
        const created = useDeckWindowStore.getState().createWindow(ref);
        void navigate({
          to: "/deck/$environmentId/$windowId",
          params: { environmentId: ref.environmentId, windowId: created.id },
        });
        return;
      }
      case "new-terminal":
        onNewTerminalTab();
        return;
      case "new-browser":
        onNewBrowserTab();
        return;
      case "new-project":
        void addProject();
        return;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onPointerDown={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border bg-popover shadow-lg"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          placeholder="Jump to a window, or create one…"
          aria-label="Deck palette"
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            // Stopped so the global shortcut handler does not act on typing.
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((value) => stepPaletteIndex(results.length, value, 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((value) => stepPaletteIndex(results.length, value, -1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              activate(results[selected]);
            }
          }}
          className="w-full border-b bg-transparent px-3 py-2.5 text-sm outline-none"
        />

        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No matches.</p>
          ) : null}
          {results.map((item, itemIndex) => (
            <button
              key={item.id}
              type="button"
              data-palette-index={itemIndex}
              onPointerEnter={() => setIndex(itemIndex)}
              onClick={() => activate(item)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                itemIndex === selected ? "bg-accent" : "hover:bg-accent/50",
              )}
            >
              <PaletteIcon kind={item.kind} />
              <span className="truncate">{item.label}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{item.detail}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PaletteIcon({ kind }: { kind: DeckPaletteItem["kind"] }) {
  const className = "size-3.5 shrink-0 opacity-60";
  switch (kind) {
    case "window":
      return <SquareTerminal className={className} />;
    case "new-window":
      return <PlusIcon className={className} />;
    case "new-terminal":
      return <TerminalSquare className={className} />;
    case "new-browser":
      return <Globe className={className} />;
    case "new-project":
      return <FolderPlus className={className} />;
  }
}
