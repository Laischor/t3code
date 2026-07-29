/**
 * DevTools pinned inside a browser pane.
 *
 * Electron's preview DevTools normally open detached (`mode: "detach"`).
 * Docking modes would dock into the whole app window rather than the pane, so
 * instead the guest renders its DevTools into a second `<webview>` here via
 * `setDevToolsWebContents`, which keeps them inside the pane's own layout.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { previewBridge } from "~/components/preview/previewBridge";

interface DevToolsHostWebview extends HTMLElement {
  getWebContentsId: () => number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function DeckDevToolsPane({ tabId }: { tabId: string }) {
  const hostRef = useRef<DevToolsHostWebview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const bridge = previewBridge;
    if (!host) return;
    if (!bridge) {
      setError("DevTools are only available in the desktop app.");
      return;
    }

    let disposed = false;
    let docked = false;

    const attach = () => {
      if (disposed || docked) return;
      let hostWebContentsId: number;
      try {
        hostWebContentsId = host.getWebContentsId();
      } catch {
        // The guest is not attached yet; a later event retries.
        return;
      }
      if (!Number.isInteger(hostWebContentsId) || hostWebContentsId <= 0) return;
      docked = true;
      void bridge.openDevToolsInHost(tabId, hostWebContentsId).catch((cause: unknown) => {
        if (disposed) return;
        docked = false;
        setError(errorMessage(cause));
      });
    };

    host.addEventListener("did-attach", attach);
    host.addEventListener("dom-ready", attach);
    // did-attach can land before this effect runs, so try straight away too.
    attach();

    return () => {
      disposed = true;
      host.removeEventListener("did-attach", attach);
      host.removeEventListener("dom-ready", attach);
      void bridge.closeDevTools(tabId).catch(() => {
        // The pane is going away regardless; nothing to recover.
      });
    };
  }, [tabId]);

  const openDetached = useCallback(() => {
    void previewBridge?.openDevTools(tabId).catch((cause: unknown) => {
      setError(errorMessage(cause));
    });
  }, [tabId]);

  return (
    <div className="relative h-full w-full">
      {/*
        No `src`: setDevToolsWebContents requires a WebContents that has never
        navigated, and even about:blank counts as a navigation.
      */}
      <webview
        ref={hostRef as React.Ref<DevToolsHostWebview>}
        className="h-full w-full"
        data-deck-devtools-host={tabId}
      />
      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background p-4 text-center">
          <p className="text-xs text-muted-foreground">Could not dock DevTools: {error}</p>
          <button
            type="button"
            onClick={openDetached}
            className="rounded border px-2 py-1 text-xs hover:bg-accent"
          >
            Open in a separate window
          </button>
        </div>
      ) : null}
    </div>
  );
}
