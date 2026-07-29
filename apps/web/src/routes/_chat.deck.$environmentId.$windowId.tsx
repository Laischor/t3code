import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { SidebarInset } from "../components/ui/sidebar";
import { DeckWorkspace } from "../deck/DeckWorkspace";
import {
  findWindowProject,
  parseDeckProjectKey,
  useDeckWindowStore,
} from "../deck/deckWindowStore";
import { useProjects } from "../state/entities";

/**
 * A window's own route.
 *
 * Deliberately not the thread route: a window id is never registered as a chat
 * thread, so `resolveThreadRouteRenderState` would report it missing and bounce
 * back to the index.
 */
function DeckWindowRouteView() {
  const { environmentId, windowId } = Route.useParams();
  const navigate = useNavigate();
  const projects = useProjects();
  const windowsByProjectKey = useDeckWindowStore((store) => store.windowsByProjectKey);

  const found = useMemo(
    () => findWindowProject(windowsByProjectKey, windowId),
    [windowId, windowsByProjectKey],
  );

  const project = useMemo(() => {
    if (!found) return null;
    const ref = parseDeckProjectKey(found.projectKey);
    if (!ref) return null;
    return (
      projects.find(
        (candidate) => candidate.environmentId === environmentId && candidate.id === ref.projectId,
      ) ?? null
    );
  }, [environmentId, found, projects]);

  // A window can outlive its project (removed from T3) or be closed in another
  // tab; either way the route has nothing to render.
  useEffect(() => {
    if (!found) void navigate({ to: "/", replace: true });
  }, [found, navigate]);

  if (!found) return null;

  const threadRef = {
    environmentId: EnvironmentId.make(environmentId),
    threadId: ThreadId.make(windowId),
  };

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      {project ? (
        <DeckWorkspace threadRef={threadRef} cwd={project.workspaceRoot} />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          This window's project is no longer available.
        </div>
      )}
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/deck/$environmentId/$windowId")({
  component: DeckWindowRouteView,
});
