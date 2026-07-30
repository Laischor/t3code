/**
 * Find-in-page for a browser tab.
 *
 * Runs entirely in the renderer: the `<webview>` element carries `findInPage`,
 * `stopFindInPage` and a `found-in-page` event, so this needs no IPC and no
 * main-process code.
 */

import type { ScopedThreadRef } from "@t3tools/contracts";
import { ChevronDown, ChevronUp, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { useThreadPreviewState } from "~/previewStateStore";

interface FindableWebview extends Element {
  findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean }) => number;
  stopFindInPage: (action: "clearSelection" | "keepSelection" | "activateSelection") => void;
}

interface FoundInPageEvent extends Event {
  result?: { activeMatchOrdinal?: number; matches?: number };
}

function findWebview(runtimeTabId: string): FindableWebview | null {
  return document.querySelector<FindableWebview>(
    `webview[data-preview-tab="${CSS.escape(runtimeTabId)}"]`,
  );
}

export function DeckFindBar({
  threadRef,
  tabId,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  /** Server-side preview tab id, as stored on the deck tab. */
  tabId: string;
  onClose: () => void;
}) {
  // Desktop preview resources are keyed by runtime id, not the server id.
  const previewState = useThreadPreviewState(threadRef);
  const runtimeTabId = useMemo(
    () => previewRuntimeTabId(threadRef, previewState.serverEpoch, tabId),
    [previewState.serverEpoch, tabId, threadRef],
  );
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ active: number; total: number } | null>(null);
  // Whether a search is running, so Enter continues it instead of restarting.
  const searchingRef = useRef(false);

  useEffect(() => {
    const webview = findWebview(runtimeTabId);
    if (!webview) return;
    const onFound = (event: Event) => {
      const found = (event as FoundInPageEvent).result;
      setResult({ active: found?.activeMatchOrdinal ?? 0, total: found?.matches ?? 0 });
    };
    webview.addEventListener("found-in-page", onFound);
    return () => {
      webview.removeEventListener("found-in-page", onFound);
      // Leaving highlights behind would outlive the bar that explains them.
      try {
        webview.stopFindInPage("clearSelection");
      } catch {
        // The guest may already be gone.
      }
    };
  }, [runtimeTabId]);

  const search = useCallback(
    (text: string, options: { forward: boolean; continued: boolean }) => {
      const webview = findWebview(runtimeTabId);
      if (!webview) return;
      if (text.length === 0) {
        searchingRef.current = false;
        setResult(null);
        try {
          webview.stopFindInPage("clearSelection");
        } catch {
          // Nothing to stop.
        }
        return;
      }
      try {
        webview.findInPage(text, {
          forward: options.forward,
          findNext: options.continued && searchingRef.current,
        });
        searchingRef.current = true;
      } catch {
        // The guest may not be attached yet.
      }
    },
    [runtimeTabId],
  );

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-t bg-background px-2 text-xs">
      <input
        autoFocus
        value={query}
        placeholder="Find on page"
        aria-label="Find on page"
        onChange={(event) => {
          setQuery(event.target.value);
          // Typing restarts the search so the count follows the query.
          searchingRef.current = false;
          search(event.target.value, { forward: true, continued: false });
        }}
        onKeyDown={(event) => {
          // Stopped so ⌘F and the tab shortcuts do not fire while typing.
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "Enter") {
            event.preventDefault();
            search(query, { forward: !event.shiftKey, continued: true });
          }
        }}
        className="min-w-0 flex-1 bg-transparent outline-none"
      />

      <span className="shrink-0 tabular-nums text-muted-foreground">
        {query.length === 0 ? "" : result === null ? "…" : `${result.active}/${result.total}`}
      </span>

      <button
        type="button"
        aria-label="Previous match"
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={() => search(query, { forward: false, continued: true })}
      >
        <ChevronUp className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Next match"
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={() => search(query, { forward: true, continued: true })}
      >
        <ChevronDown className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Close find bar"
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={onClose}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
