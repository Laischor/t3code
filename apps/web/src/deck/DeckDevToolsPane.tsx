/**
 * DevTools pinned inside a browser pane.
 *
 * Electron's preview DevTools normally open detached (`mode: "detach"`).
 * Docking modes would dock into the whole app window rather than the pane, so
 * instead the guest renders its DevTools into a second `<webview>` here via
 * `setDevToolsWebContents`, which keeps them inside the pane's own layout.
 */

import { useEffect, useRef } from "react";

import { previewBridge } from "~/components/preview/previewBridge";

interface DevToolsHostWebview extends HTMLElement {
  src: string;
  getWebContentsId: () => number;
}

export function DeckDevToolsPane({ tabId }: { tabId: string }) {
  const hostRef = useRef<DevToolsHostWebview | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const bridge = previewBridge;
    if (!host || !bridge) return;

    let disposed = false;
    const attach = () => {
      if (disposed) return;
      const hostWebContentsId = host.getWebContentsId();
      if (!Number.isInteger(hostWebContentsId) || hostWebContentsId <= 0) return;
      void bridge.openDevToolsInHost(tabId, hostWebContentsId).catch(() => {
        // did-attach and dom-ready both fire; whichever lands first wins and
        // the main process treats an already-open DevTools as a no-op.
      });
    };

    host.addEventListener("did-attach", attach);
    host.addEventListener("dom-ready", attach);
    return () => {
      disposed = true;
      host.removeEventListener("did-attach", attach);
      host.removeEventListener("dom-ready", attach);
      // Electron leaves the host WebContents alive after closing DevTools; the
      // element unmounting with this effect is what actually frees it.
      void bridge.closeDevTools(tabId).catch(() => {});
    };
  }, [tabId]);

  return (
    <webview
      ref={hostRef as React.Ref<DevToolsHostWebview>}
      src="about:blank"
      className="h-full w-full"
      data-deck-devtools-host={tabId}
    />
  );
}
