/**
 * One xterm instance bound to a T3 terminal session.
 *
 * Extracted from ThreadTerminalDrawer so the drawer and the Deck pane grid can
 * both mount terminals without one owning the other. The component sizes itself
 * from its container, so hosts only need to give it a box.
 */

import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { FitAddon } from "@xterm/addon-fit";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type ResolvedKeybindingsConfig,
  type ScopedThreadRef,
  type TerminalAttachInput,
  type ThreadId,
} from "@t3tools/contracts";
import { Terminal, type ITheme } from "@xterm/xterm";
import { useEffect, useEffectEvent, useMemo, useRef } from "react";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { type TerminalContextSelection } from "~/lib/terminalContext";
import { readLocalApi } from "~/localApi";
import { useOpenInPreferredEditor } from "../editorPreferences";
import {
  isDiffToggleShortcut,
  isTerminalClearShortcut,
  isTerminalCloseShortcut,
  isTerminalNewShortcut,
  isTerminalSplitShortcut,
  isTerminalSplitVerticalShortcut,
  isTerminalToggleShortcut,
  terminalDeleteShortcutData,
  terminalNavigationShortcutData,
} from "../keybindings";
import { previewEnvironment } from "../state/preview";
import { serverEnvironment } from "../state/server";
import { terminalEnvironment } from "../state/terminal";
import { useAttachedTerminalSession } from "../state/terminalSessions";
import { useAtomCommand } from "../state/use-atom-command";
import {
  collectWrappedTerminalLinkLine,
  extractTerminalLinks,
  isTerminalLinkActivation,
  resolvePathLinkTarget,
  resolveWrappedTerminalLinkRange,
  wrappedTerminalLinkRangeIntersectsBufferLine,
} from "../terminal-links";
import { openTerminalLinkInPreview } from "./preview/openTerminalLinkInPreview";
import { resolveTerminalWrite } from "./terminalBufferSync";

const MULTI_CLICK_SELECTION_ACTION_DELAY_MS = 260;

function writeSystemMessage(terminal: Terminal, message: string): void {
  terminal.write(`\r\n[terminal] ${message}\r\n`);
}

function writeTerminalBuffer(terminal: Terminal, buffer: string): void {
  terminal.write("\u001bc");
  if (buffer.length > 0) {
    terminal.write(buffer);
  }
}

function fitTerminalSafely(fitAddon: FitAddon): boolean {
  try {
    fitAddon.fit();
    return true;
  } catch {
    return false;
  }
}

function runtimeEnvSignature(runtimeEnv: Record<string, string> | undefined): string {
  if (!runtimeEnv) return "";
  return JSON.stringify(
    Object.entries(runtimeEnv)
      .filter(([key, value]) => key.length > 0 && typeof value === "string")
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
  );
}

function normalizeComputedColor(value: string | null | undefined, fallback: string): string {
  const normalizedValue = value?.trim().toLowerCase();
  if (
    !normalizedValue ||
    normalizedValue === "transparent" ||
    normalizedValue === "rgba(0, 0, 0, 0)" ||
    normalizedValue === "rgba(0 0 0 / 0)"
  ) {
    return fallback;
  }
  return value ?? fallback;
}

function terminalThemeFromApp(mountElement?: HTMLElement | null): ITheme {
  const isDark = document.documentElement.classList.contains("dark");
  const fallbackBackground = isDark ? "rgb(14, 18, 24)" : "rgb(255, 255, 255)";
  const fallbackForeground = isDark ? "rgb(237, 241, 247)" : "rgb(28, 33, 41)";
  const drawerSurface =
    mountElement?.closest(".thread-terminal-drawer") ??
    document.querySelector(".thread-terminal-drawer") ??
    document.body;
  const drawerStyles = getComputedStyle(drawerSurface);
  const bodyStyles = getComputedStyle(document.body);
  const background = normalizeComputedColor(
    drawerStyles.backgroundColor,
    normalizeComputedColor(bodyStyles.backgroundColor, fallbackBackground),
  );
  const foreground = normalizeComputedColor(
    drawerStyles.color,
    normalizeComputedColor(bodyStyles.color, fallbackForeground),
  );

  if (isDark) {
    return {
      background,
      foreground,
      cursor: "rgb(180, 203, 255)",
      selectionBackground: "rgba(180, 203, 255, 0.25)",
      scrollbarSliderBackground: "rgba(255, 255, 255, 0.1)",
      scrollbarSliderHoverBackground: "rgba(255, 255, 255, 0.18)",
      scrollbarSliderActiveBackground: "rgba(255, 255, 255, 0.22)",
      black: "rgb(24, 30, 38)",
      red: "rgb(255, 122, 142)",
      green: "rgb(134, 231, 149)",
      yellow: "rgb(244, 205, 114)",
      blue: "rgb(137, 190, 255)",
      magenta: "rgb(208, 176, 255)",
      cyan: "rgb(124, 232, 237)",
      white: "rgb(210, 218, 230)",
      brightBlack: "rgb(110, 120, 136)",
      brightRed: "rgb(255, 168, 180)",
      brightGreen: "rgb(176, 245, 186)",
      brightYellow: "rgb(255, 224, 149)",
      brightBlue: "rgb(174, 210, 255)",
      brightMagenta: "rgb(229, 203, 255)",
      brightCyan: "rgb(167, 244, 247)",
      brightWhite: "rgb(244, 247, 252)",
    };
  }

  return {
    background,
    foreground,
    cursor: "rgb(38, 56, 78)",
    selectionBackground: "rgba(37, 63, 99, 0.2)",
    scrollbarSliderBackground: "rgba(0, 0, 0, 0.15)",
    scrollbarSliderHoverBackground: "rgba(0, 0, 0, 0.25)",
    scrollbarSliderActiveBackground: "rgba(0, 0, 0, 0.3)",
    black: "rgb(44, 53, 66)",
    red: "rgb(191, 70, 87)",
    green: "rgb(60, 126, 86)",
    yellow: "rgb(146, 112, 35)",
    blue: "rgb(72, 102, 163)",
    magenta: "rgb(132, 86, 149)",
    cyan: "rgb(53, 127, 141)",
    white: "rgb(210, 215, 223)",
    brightBlack: "rgb(112, 123, 140)",
    brightRed: "rgb(212, 95, 112)",
    brightGreen: "rgb(85, 148, 111)",
    brightYellow: "rgb(173, 133, 45)",
    brightBlue: "rgb(91, 124, 194)",
    brightMagenta: "rgb(153, 107, 172)",
    brightCyan: "rgb(70, 149, 164)",
    brightWhite: "rgb(236, 240, 246)",
  };
}

function getTerminalSelectionRect(mountElement: HTMLElement): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const commonAncestor = range.commonAncestorContainer;
  const selectionRoot =
    commonAncestor instanceof Element ? commonAncestor : commonAncestor.parentElement;
  if (!(selectionRoot instanceof Element) || !mountElement.contains(selectionRoot)) {
    return null;
  }

  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 || rect.height > 0,
  );
  if (rects.length > 0) {
    return rects[rects.length - 1] ?? null;
  }

  const boundingRect = range.getBoundingClientRect();
  return boundingRect.width > 0 || boundingRect.height > 0 ? boundingRect : null;
}

export function resolveTerminalSelectionActionPosition(options: {
  bounds: { left: number; top: number; width: number; height: number };
  selectionRect: { right: number; bottom: number } | null;
  pointer: { x: number; y: number } | null;
  viewport?: { width: number; height: number } | null;
}): { x: number; y: number } {
  const { bounds, selectionRect, pointer, viewport } = options;
  const viewportWidth =
    viewport?.width ??
    (typeof window === "undefined" ? bounds.left + bounds.width + 8 : window.innerWidth);
  const viewportHeight =
    viewport?.height ??
    (typeof window === "undefined" ? bounds.top + bounds.height + 8 : window.innerHeight);
  const drawerLeft = Math.round(bounds.left);
  const drawerTop = Math.round(bounds.top);
  const drawerRight = Math.round(bounds.left + bounds.width);
  const drawerBottom = Math.round(bounds.top + bounds.height);
  const preferredX =
    selectionRect !== null
      ? Math.round(selectionRect.right)
      : pointer === null
        ? Math.round(bounds.left + bounds.width - 140)
        : Math.max(drawerLeft, Math.min(Math.round(pointer.x), drawerRight));
  const preferredY =
    selectionRect !== null
      ? Math.round(selectionRect.bottom + 4)
      : pointer === null
        ? Math.round(bounds.top + 12)
        : Math.max(drawerTop, Math.min(Math.round(pointer.y), drawerBottom));
  return {
    x: Math.max(8, Math.min(preferredX, Math.max(viewportWidth - 8, 8))),
    y: Math.max(8, Math.min(preferredY, Math.max(viewportHeight - 8, 8))),
  };
}

export function terminalSelectionActionDelayForClickCount(clickCount: number): number {
  return clickCount >= 2 ? MULTI_CLICK_SELECTION_ACTION_DELAY_MS : 0;
}

export function shouldHandleTerminalSelectionMouseUp(
  selectionGestureActive: boolean,
  button: number,
): boolean {
  return selectionGestureActive && button === 0;
}

interface TerminalViewportProps {
  threadRef: ScopedThreadRef;
  threadId: ThreadId;
  terminalId: string;
  terminalLabel: string;
  cwd: string;
  worktreePath?: string | null;
  runtimeEnv?: Record<string, string>;
  onSessionExited: () => void;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
  focusRequestId: number;
  autoFocus: boolean;
  /**
   * Optional refit triggers for hosts that resize the viewport without
   * resizing its container. The component observes its own box, so hosts that
   * lay panes out by size alone can leave both unset.
   */
  resizeEpoch?: number;
  drawerHeight?: number;
  keybindings: ResolvedKeybindingsConfig;
}

export interface TerminalLaunchLocation {
  readonly cwd: string;
  readonly worktreePath?: string | null;
  readonly runtimeEnv?: Record<string, string>;
}

export function TerminalViewport({
  threadRef,
  threadId,
  terminalId,
  terminalLabel,
  cwd,
  worktreePath,
  runtimeEnv,
  onSessionExited,
  onAddTerminalContext,
  focusRequestId,
  autoFocus,
  resizeEpoch,
  drawerHeight,
  keybindings,
}: TerminalViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const environmentId = threadRef.environmentId;
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const openInPreferredEditor = useOpenInPreferredEditor(
    environmentId,
    serverConfig?.availableEditors ?? [],
  );
  const openTerminalPath = useEffectEvent((target: string) => openInPreferredEditor(target));
  const openPreview = useAtomCommand(previewEnvironment.open, {
    reportFailure: false,
  });
  const runTerminalWrite = useAtomCommand(terminalEnvironment.write, {
    reportFailure: false,
  });
  const runTerminalResize = useAtomCommand(terminalEnvironment.resize, {
    reportFailure: false,
  });
  const hasHandledExitRef = useRef(false);
  const selectionPointerRef = useRef<{ x: number; y: number } | null>(null);
  const selectionGestureActiveRef = useRef(false);
  const selectionActionRequestIdRef = useRef(0);
  const selectionActionMenuOpenRef = useRef(false);
  const selectionActionTimerRef = useRef<number | null>(null);
  const keybindingsRef = useRef(keybindings);
  const runtimeEnvKey = useMemo(() => runtimeEnvSignature(runtimeEnv), [runtimeEnv]);
  const handleSessionExited = useEffectEvent(() => {
    onSessionExited();
  });
  const handleAddTerminalContext = useEffectEvent((selection: TerminalContextSelection) => {
    onAddTerminalContext(selection);
  });
  const readTerminalLabel = useEffectEvent(() => terminalLabel);
  // One object for both the subscription and its refresh: the attach atom is
  // keyed by `JSON.stringify` of exactly this input, so a second literal would
  // address a different atom — and open a second session.
  const attachInput = useMemo<TerminalAttachInput>(
    () => ({
      threadId,
      terminalId,
      cwd,
      ...(worktreePath !== undefined ? { worktreePath } : {}),
      ...(runtimeEnv ? { env: runtimeEnv } : {}),
    }),
    [cwd, runtimeEnv, terminalId, threadId, worktreePath],
  );
  const terminalSession = useAttachedTerminalSession({
    environmentId,
    terminal: attachInput,
  });
  /**
   * Re-attach whenever a terminal is mounted onto this session.
   *
   * The attach atom outlives its subscribers by its idle TTL, holding the last
   * buffer it saw. That is what makes switching tabs cheap, but it also means a
   * session closed in the meantime leaves a cached state behind: status
   * `closed`, the old scrollback, and no attach call on the next mount. A tab
   * that then reuses the id shows a prompt from a shell that no longer exists
   * and fails every keystroke with `Unknown terminal thread`. Refreshing re-runs
   * the attach, which reopens the session or reattaches to the live one.
   */
  const refreshAttachedSession = useAtomRefresh(
    terminalEnvironment.attach({ environmentId, input: attachInput }),
  );
  useEffect(() => {
    refreshAttachedSession();
  }, [refreshAttachedSession]);
  const writeTerminal = useEffectEvent((data: string) =>
    runTerminalWrite({
      environmentId,
      input: { threadId, terminalId, data },
    }),
  );
  const resizeTerminal = useEffectEvent((cols: number, rows: number) =>
    runTerminalResize({
      environmentId,
      input: { threadId, terminalId, cols, rows },
    }),
  );
  const terminalBuffer = terminalSession.buffer;
  const terminalError = terminalSession.error;
  const terminalStatus = terminalSession.status;
  const terminalVersion = terminalSession.version;
  const terminalResetEpoch = terminalSession.resetEpoch;
  const terminalStreamOffset = terminalSession.streamOffset;
  const previousSessionRef = useRef({
    buffer: terminalBuffer,
    error: terminalError,
    status: terminalStatus,
    version: terminalVersion,
    resetEpoch: terminalResetEpoch,
    streamOffset: terminalStreamOffset,
  });

  useEffect(() => {
    keybindingsRef.current = keybindings;
  }, [keybindings]);

  useEffect(() => {
    const mount = containerRef.current;
    if (!mount) return;

    const localApi = readLocalApi();

    const fitAddon = new FitAddon();
    const terminal = new Terminal({
      cursorBlink: true,
      lineHeight: 1,
      fontSize: 12,
      scrollback: 5_000,
      fontFamily:
        '"SF Mono", "SFMono-Regular", "JetBrains Mono", Consolas, "Liberation Mono", Menlo, monospace',
      theme: terminalThemeFromApp(mount),
    });
    terminal.loadAddon(fitAddon);
    terminal.open(mount);
    fitTerminalSafely(fitAddon);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    previousSessionRef.current = {
      buffer: "",
      status: "closed",
      error: null,
      version: 0,
      resetEpoch: 0,
      streamOffset: 0,
    };

    const clearSelectionAction = () => {
      selectionActionRequestIdRef.current += 1;
      if (selectionActionTimerRef.current !== null) {
        window.clearTimeout(selectionActionTimerRef.current);
        selectionActionTimerRef.current = null;
      }
    };

    const readSelectionAction = (): {
      position: { x: number; y: number };
      clipboardText: string;
      selection: TerminalContextSelection;
    } | null => {
      const activeTerminal = terminalRef.current;
      const mountElement = containerRef.current;
      if (!activeTerminal || !mountElement || !activeTerminal.hasSelection()) {
        return null;
      }
      const selectionText = activeTerminal.getSelection();
      const selectionPosition = activeTerminal.getSelectionPosition();
      const normalizedText = selectionText.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
      if (!selectionPosition || normalizedText.length === 0) {
        return null;
      }
      const lineStart = selectionPosition.start.y + 1;
      const lineCount = normalizedText.split("\n").length;
      const lineEnd = Math.max(lineStart, lineStart + lineCount - 1);
      const bounds = mountElement.getBoundingClientRect();
      const selectionRect = getTerminalSelectionRect(mountElement);
      const position = resolveTerminalSelectionActionPosition({
        bounds,
        selectionRect:
          selectionRect === null
            ? null
            : { right: selectionRect.right, bottom: selectionRect.bottom },
        pointer: selectionPointerRef.current,
      });
      return {
        position,
        clipboardText: selectionText,
        selection: {
          terminalId,
          terminalLabel: readTerminalLabel(),
          lineStart,
          lineEnd,
          text: normalizedText,
        },
      };
    };

    const showSelectionAction = async () => {
      if (!localApi) {
        clearSelectionAction();
        return;
      }
      if (selectionActionMenuOpenRef.current) {
        return;
      }
      const nextAction = readSelectionAction();
      if (!nextAction) {
        clearSelectionAction();
        return;
      }
      const requestId = ++selectionActionRequestIdRef.current;
      selectionActionMenuOpenRef.current = true;
      const clicked = await localApi.contextMenu
        .show(
          [
            { id: "add-to-chat", label: "Add to chat" },
            { id: "copy", label: "Copy" },
          ],
          nextAction.position,
        )
        .finally(() => {
          selectionActionMenuOpenRef.current = false;
        });
      if (requestId !== selectionActionRequestIdRef.current || clicked === null) {
        return;
      }
      switch (clicked) {
        case "add-to-chat":
          handleAddTerminalContext(nextAction.selection);
          terminalRef.current?.clearSelection();
          terminalRef.current?.focus();
          return;
        case "copy":
          try {
            await writeTextToClipboard(nextAction.clipboardText, "terminal selection");
          } catch (error) {
            if (requestId !== selectionActionRequestIdRef.current) {
              return;
            }
            const activeTerminal = terminalRef.current;
            if (activeTerminal) {
              writeSystemMessage(
                activeTerminal,
                error instanceof Error ? error.message : "Unable to copy terminal selection",
              );
            }
          }
          if (requestId === selectionActionRequestIdRef.current) {
            terminalRef.current?.focus();
          }
          return;
      }
    };

    const sendTerminalInput = async (data: string, fallbackError: string) => {
      const activeTerminal = terminalRef.current;
      if (!activeTerminal) return;
      const result = await writeTerminal(data);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        writeSystemMessage(activeTerminal, error instanceof Error ? error.message : fallbackError);
      }
    };

    terminal.attachCustomKeyEventHandler((event) => {
      const currentKeybindings = keybindingsRef.current;
      const options = { context: { terminalFocus: true, terminalOpen: true } };
      if (
        isTerminalToggleShortcut(event, currentKeybindings, options) ||
        isTerminalSplitShortcut(event, currentKeybindings, options) ||
        isTerminalSplitVerticalShortcut(event, currentKeybindings, options) ||
        isTerminalNewShortcut(event, currentKeybindings, options) ||
        isTerminalCloseShortcut(event, currentKeybindings, options) ||
        isDiffToggleShortcut(event, currentKeybindings, options)
      ) {
        return false;
      }

      const navigationData = terminalNavigationShortcutData(event);
      if (navigationData !== null) {
        event.preventDefault();
        event.stopPropagation();
        void sendTerminalInput(navigationData, "Failed to move cursor");
        return false;
      }

      const deleteData = terminalDeleteShortcutData(event);
      if (deleteData !== null) {
        event.preventDefault();
        event.stopPropagation();
        void sendTerminalInput(deleteData, "Failed to delete terminal input");
        return false;
      }

      if (!isTerminalClearShortcut(event)) return true;
      event.preventDefault();
      event.stopPropagation();
      void sendTerminalInput("\u000c", "Failed to clear terminal");
      return false;
    });

    const terminalLinksDisposable = terminal.registerLinkProvider({
      provideLinks: (bufferLineNumber, callback) => {
        const activeTerminal = terminalRef.current;
        if (!activeTerminal) {
          callback(undefined);
          return;
        }

        const wrappedLine = collectWrappedTerminalLinkLine(bufferLineNumber, (bufferLineIndex) =>
          activeTerminal.buffer.active.getLine(bufferLineIndex),
        );
        if (!wrappedLine) {
          callback(undefined);
          return;
        }

        const links = extractTerminalLinks(wrappedLine.text)
          .map((match) => ({
            match,
            range: resolveWrappedTerminalLinkRange(wrappedLine, match),
          }))
          .filter(({ range }) =>
            wrappedTerminalLinkRangeIntersectsBufferLine(range, bufferLineNumber),
          );
        if (links.length === 0) {
          callback(undefined);
          return;
        }

        callback(
          links.map(({ match, range }) => ({
            text: match.text,
            range,
            activate: (event: MouseEvent) => {
              if (!isTerminalLinkActivation(event)) return;

              const latestTerminal = terminalRef.current;
              if (!latestTerminal) return;

              if (match.kind === "url") {
                if (!localApi) {
                  writeSystemMessage(
                    latestTerminal,
                    "Opening links is unavailable in this browser.",
                  );
                  return;
                }
                const fallbackToBrowser = () => {
                  void localApi.shell.openExternal(match.text).catch((error: unknown) => {
                    writeSystemMessage(
                      latestTerminal,
                      error instanceof Error ? error.message : "Unable to open link",
                    );
                  });
                };
                void openTerminalLinkInPreview({
                  url: match.text,
                  position: { x: event.clientX, y: event.clientY },
                  threadRef,
                  openPreview,
                  localApi,
                  fallbackToBrowser,
                });
                return;
              }

              const target = resolvePathLinkTarget(match.text, cwd);
              void (async () => {
                const result = await openTerminalPath(target);
                if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
                  return;
                }
                const error = squashAtomCommandFailure(result);
                writeSystemMessage(
                  latestTerminal,
                  error instanceof Error ? error.message : "Unable to open path",
                );
              })();
            },
          })),
        );
      },
    });

    const inputDisposable = terminal.onData((data) => {
      void (async () => {
        const result = await writeTerminal(data);
        if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
          return;
        }
        const error = squashAtomCommandFailure(result);
        writeSystemMessage(
          terminal,
          error instanceof Error ? error.message : "Terminal write failed",
        );
      })();
    });

    const selectionDisposable = terminal.onSelectionChange(() => {
      if (terminalRef.current?.hasSelection()) {
        return;
      }
      clearSelectionAction();
    });

    const handleMouseUp = (event: MouseEvent) => {
      const shouldHandle = shouldHandleTerminalSelectionMouseUp(
        selectionGestureActiveRef.current,
        event.button,
      );
      selectionGestureActiveRef.current = false;
      if (!shouldHandle) {
        return;
      }
      selectionPointerRef.current = { x: event.clientX, y: event.clientY };
      const delay = terminalSelectionActionDelayForClickCount(event.detail);
      selectionActionTimerRef.current = window.setTimeout(() => {
        selectionActionTimerRef.current = null;
        window.requestAnimationFrame(() => {
          void showSelectionAction();
        });
      }, delay);
    };
    const handlePointerDown = (event: PointerEvent) => {
      clearSelectionAction();
      selectionGestureActiveRef.current = event.button === 0;
    };
    window.addEventListener("mouseup", handleMouseUp);
    mount.addEventListener("pointerdown", handlePointerDown);

    const themeObserver = new MutationObserver(() => {
      const activeTerminal = terminalRef.current;
      if (!activeTerminal) return;
      activeTerminal.options.theme = terminalThemeFromApp(containerRef.current);
      activeTerminal.refresh(0, activeTerminal.rows - 1);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    const fitTimer = window.setTimeout(() => {
      const activeTerminal = terminalRef.current;
      const activeFitAddon = fitAddonRef.current;
      if (!activeTerminal || !activeFitAddon) return;
      const wasAtBottom =
        activeTerminal.buffer.active.viewportY >= activeTerminal.buffer.active.baseY;
      fitTerminalSafely(activeFitAddon);
      if (wasAtBottom) {
        activeTerminal.scrollToBottom();
      }
      void resizeTerminal(activeTerminal.cols, activeTerminal.rows);
    }, 30);

    return () => {
      window.clearTimeout(fitTimer);
      inputDisposable.dispose();
      selectionDisposable.dispose();
      terminalLinksDisposable.dispose();
      if (selectionActionTimerRef.current !== null) {
        window.clearTimeout(selectionActionTimerRef.current);
      }
      window.removeEventListener("mouseup", handleMouseUp);
      mount.removeEventListener("pointerdown", handlePointerDown);
      themeObserver.disconnect();
      terminalRef.current = null;
      fitAddonRef.current = null;
      terminal.dispose();
    };
    // autoFocus is intentionally omitted;
    // it is only read at mount time and must not trigger terminal teardown/recreation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, environmentId, runtimeEnvKey, terminalId, threadId, worktreePath]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const current = {
      buffer: terminalBuffer,
      error: terminalError,
      status: terminalStatus,
      version: terminalVersion,
      resetEpoch: terminalResetEpoch,
      streamOffset: terminalStreamOffset,
    };
    if (!terminal) {
      previousSessionRef.current = current;
      return;
    }

    const previous = previousSessionRef.current;
    if (current.version === previous.version) {
      return;
    }

    // The session buffer is capped and trimmed from the front, so the delta
    // comes from the stream's own offset rather than from comparing strings.
    const write = resolveTerminalWrite(previous, current);
    if (write.mode === "append") {
      if (write.data.length > 0) terminal.write(write.data);
    } else {
      writeTerminalBuffer(terminal, write.data);
    }
    terminal.clearSelection();

    if (current.error !== null && current.error !== previous.error) {
      writeSystemMessage(terminal, current.error);
    }

    if (current.status === "running") {
      hasHandledExitRef.current = false;
    } else if (
      (current.status === "closed" || current.status === "exited") &&
      current.status !== previous.status &&
      !hasHandledExitRef.current
    ) {
      hasHandledExitRef.current = true;
      writeSystemMessage(
        terminal,
        current.status === "closed" ? "Terminal closed" : "Process exited",
      );
      window.setTimeout(() => {
        if (hasHandledExitRef.current) {
          handleSessionExited();
        }
      }, 0);
    }

    if (previous.version === 0 && autoFocus) {
      window.requestAnimationFrame(() => {
        terminal.focus();
      });
    }
    previousSessionRef.current = current;
  }, [
    autoFocus,
    terminalBuffer,
    terminalError,
    terminalResetEpoch,
    terminalStatus,
    terminalStreamOffset,
    terminalVersion,
  ]);

  useEffect(() => {
    if (!autoFocus) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    const frame = window.requestAnimationFrame(() => {
      terminal.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [autoFocus, focusRequestId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;
    const wasAtBottom = terminal.buffer.active.viewportY >= terminal.buffer.active.baseY;
    const frame = window.requestAnimationFrame(() => {
      fitTerminalSafely(fitAddon);
      if (wasAtBottom) {
        terminal.scrollToBottom();
      }
      void resizeTerminal(terminal.cols, terminal.rows);
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [drawerHeight, environmentId, resizeEpoch, terminalId, threadId]);

  /**
   * Re-send the size once the session actually exists.
   *
   * The resize above runs on mount, before the server has created the PTY, so
   * it is dropped and the PTY keeps its default row count. Nothing sends again
   * while the layout is stable, which leaves full-screen programs — anything on
   * the alternate buffer, like an editor — drawing into fewer rows than the
   * pane shows. Programs that just scroll never reveal it.
   */
  const sizeSyncedRef = useRef(false);
  useEffect(() => {
    sizeSyncedRef.current = false;
  }, [environmentId, terminalId, threadId]);

  useEffect(() => {
    if (sizeSyncedRef.current) return;
    // "closed" is the placeholder state before a session is attached.
    if (terminalStatus === "closed" && terminalVersion === 0) return;
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;
    sizeSyncedRef.current = true;
    fitTerminalSafely(fitAddon);
    void resizeTerminal(terminal.cols, terminal.rows);
  }, [environmentId, terminalId, terminalStatus, terminalVersion, threadId]);

  // Pane grids resize the container directly rather than bumping resizeEpoch,
  // so refit whenever the box changes. Coalesced through rAF because a drag
  // emits many observations per frame.
  useEffect(() => {
    const mount = containerRef.current;
    if (!mount || typeof ResizeObserver === "undefined") return;

    let frame = 0;
    const observer = new ResizeObserver(() => {
      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      if (!terminal || !fitAddon) return;
      const wasAtBottom = terminal.buffer.active.viewportY >= terminal.buffer.active.baseY;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const previousCols = terminal.cols;
        const previousRows = terminal.rows;
        fitTerminalSafely(fitAddon);
        if (wasAtBottom) {
          terminal.scrollToBottom();
        }
        if (terminal.cols !== previousCols || terminal.rows !== previousRows) {
          void resizeTerminal(terminal.cols, terminal.rows);
        }
      });
    });
    observer.observe(mount);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [environmentId, terminalId, threadId]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-[4px] bg-background"
    />
  );
}
