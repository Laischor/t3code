/**
 * A slot that reserves space for docked DevTools.
 *
 * The DevTools themselves live in a main-process `WebContentsView` — the host
 * Electron documents for `setDevToolsWebContents`, and the only one that works:
 * a `<webview>` cannot be a host, because it only creates its guest once a
 * `src` is set, and any `src` is a navigation the API rejects.
 *
 * That view is not part of the DOM, so this component's only job is to keep it
 * lined up with the box the layout gives it.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { previewBridge } from "~/components/preview/previewBridge";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function DeckDevToolsSlot({ tabId, visible }: { tabId: string; visible: boolean }) {
  const slotRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const openedRef = useRef(false);
  // Kept in a ref so toggling visibility parks the view instead of tearing the
  // whole session down and losing whatever was open in DevTools.
  const visibleRef = useRef(visible);
  const syncRef = useRef<(() => void) | null>(null);

  const readBounds = useCallback(() => {
    const element = slotRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
    };
  }, []);

  // Open once the slot has a real box, then keep the view lined up with it.
  useLayoutEffect(() => {
    const element = slotRef.current;
    const bridge = previewBridge;
    if (!element) return;
    if (!bridge) {
      setError("DevTools are only available in the desktop app.");
      return;
    }

    let disposed = false;
    let frame = 0;

    const sync = () => {
      if (disposed) return;
      const bounds = readBounds();
      if (!bounds) return;
      // A background tab is parked off-screen rather than resized to nothing,
      // so DevTools keep their layout and come back unchanged.
      const target = visibleRef.current ? bounds : { ...bounds, x: -100_000, y: -100_000 };
      if (!openedRef.current) {
        if (bounds.width === 0 || bounds.height === 0) return;
        openedRef.current = true;
        void bridge.openDevToolsDocked(tabId, target).catch((cause: unknown) => {
          if (disposed) return;
          openedRef.current = false;
          setError(errorMessage(cause));
        });
        return;
      }
      void bridge.setDevToolsBounds(tabId, target).catch(() => {
        // Bounds updates are best-effort; the next one corrects it.
      });
    };

    const scheduleSync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(sync);
    };

    syncRef.current = scheduleSync;
    sync();
    const observer = new ResizeObserver(scheduleSync);
    observer.observe(element);
    window.addEventListener("resize", scheduleSync);
    // Panes move without resizing — a sibling split drag, a collapsing sidebar.
    // Scroll is capture-phase so nested scrollers count too.
    window.addEventListener("scroll", scheduleSync, true);

    return () => {
      disposed = true;
      syncRef.current = null;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("scroll", scheduleSync, true);
      openedRef.current = false;
      void bridge.closeDevTools(tabId).catch(() => {
        // The slot is going away regardless.
      });
    };
  }, [readBounds, tabId]);

  useEffect(() => {
    visibleRef.current = visible;
    syncRef.current?.();
  }, [visible]);

  const openDetached = useCallback(() => {
    void previewBridge?.openDevTools(tabId).catch((cause: unknown) => {
      setError(errorMessage(cause));
    });
  }, [tabId]);

  return (
    <div ref={slotRef} className="relative h-full w-full bg-background">
      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
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
