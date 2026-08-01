import type {
  EnvironmentId,
  TerminalAttachStreamEvent,
  TerminalMetadataStreamEvent,
  TerminalSessionSnapshot,
  TerminalSummary,
  ThreadId,
} from "@t3tools/contracts";

export interface TerminalSessionState {
  readonly summary: TerminalSummary | null;
  readonly buffer: string;
  readonly status: TerminalSessionSnapshot["status"] | "closed";
  readonly error: string | null;
  readonly hasRunningSubprocess: boolean;
  readonly updatedAt: string | null;
  readonly version: number;
  readonly resetEpoch: number;
  readonly streamOffset: number;
}

export interface TerminalBufferState {
  readonly buffer: string;
  readonly status: TerminalSessionSnapshot["status"] | "closed";
  readonly error: string | null;
  readonly updatedAt: string | null;
  readonly version: number;
  /**
   * Bumped whenever the buffer stopped being a continuation of the previous one
   * — a snapshot, a restart, a clear. Consumers that mirror the buffer into a
   * terminal emulator must reset instead of appending when this changes.
   */
  readonly resetEpoch: number;
  /**
   * Characters appended since the current `resetEpoch`, counted before the
   * 512 KB cap trims the front. `buffer` alone cannot tell an append from a
   * repeated frame; this can, exactly, without searching for a seam.
   */
  readonly streamOffset: number;
  /**
   * UTF-8 byte length of `buffer`. Kept because measuring it means encoding the
   * whole buffer, which is the single most expensive thing this reducer does.
   */
  readonly bufferBytes: number;
}

export interface KnownTerminalSessionTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly terminalId: string;
}

export interface KnownTerminalSession {
  readonly target: KnownTerminalSessionTarget;
  readonly state: TerminalSessionState;
}

export function selectRunningSubprocessTerminalIds(
  sessions: ReadonlyArray<KnownTerminalSession>,
): ReadonlyArray<string> {
  return sessions
    .filter((session) => session.state.hasRunningSubprocess)
    .map((session) => session.target.terminalId);
}

export const EMPTY_TERMINAL_BUFFER_STATE = Object.freeze<TerminalBufferState>({
  buffer: "",
  status: "closed",
  error: null,
  updatedAt: null,
  version: 0,
  resetEpoch: 0,
  streamOffset: 0,
  bufferBytes: 0,
});

export const EMPTY_TERMINAL_SESSION_STATE = Object.freeze<TerminalSessionState>({
  summary: null,
  buffer: "",
  status: "closed",
  error: null,
  hasRunningSubprocess: false,
  updatedAt: null,
  version: 0,
  resetEpoch: 0,
  streamOffset: 0,
});

export const DEFAULT_MAX_TERMINAL_BUFFER_BYTES = 512 * 1024;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * How far past the cut to look for a safe replay start. A line of terminal
 * output with attributes stays well inside this; giving up keeps the scan cheap
 * when the cut landed in something else entirely.
 */
const CONTROL_SEQUENCE_ALIGN_WINDOW = 4_096;

const ESCAPE_BYTE = 0x1b;
const LINE_FEED_BYTE = 0x0a;

/**
 * Where a terminal can start reading the retained bytes.
 *
 * The byte cut lands anywhere, including inside an escape sequence, and the
 * remainder of a sequence without its ESC is ordinary text: replaying it prints
 * `38;5;120m` at the top of the scrollback instead of setting a colour. Start at
 * the next sequence or the next line instead — the buffer is already truncated
 * there, so a partial first line costs nothing.
 *
 * Both markers are ASCII, so neither can be a UTF-8 continuation byte: a hit is
 * always a character boundary, and searching the bytes replaces both the
 * continuation walk and a second pass over the decoded string.
 */
function alignedCutIndex(encoded: Uint8Array, cut: number): number {
  const limit = Math.min(encoded.length, cut + CONTROL_SEQUENCE_ALIGN_WINDOW);
  for (let index = cut; index < limit; index += 1) {
    const byte = encoded[index];
    if (byte === ESCAPE_BYTE) return index;
    if (byte === LINE_FEED_BYTE) return index + 1;
  }

  let start = cut;
  while (start < encoded.length) {
    const byte = encoded[start];
    if (byte === undefined || (byte & 0b1100_0000) !== 0b1000_0000) {
      break;
    }
    start += 1;
  }
  return start;
}

interface RetainedBuffer {
  readonly buffer: string;
  readonly bufferBytes: number;
}

function trimBufferToBytes(buffer: string, maxBufferBytes: number): RetainedBuffer {
  if (maxBufferBytes <= 0) {
    return { buffer: "", bufferBytes: 0 };
  }

  const encoded = textEncoder.encode(buffer);
  if (encoded.byteLength <= maxBufferBytes) {
    return { buffer, bufferBytes: encoded.byteLength };
  }

  const cut = alignedCutIndex(encoded, encoded.byteLength - maxBufferBytes);
  return {
    buffer: textDecoder.decode(encoded.subarray(cut)),
    bufferBytes: encoded.byteLength - cut,
  };
}

/**
 * How far the buffer may overshoot the cap before it is cut back to it.
 *
 * Trimming encodes the whole retained buffer, so trimming on every output event
 * costs a pass over half a megabyte per redraw — and a full-screen program
 * redraws on every keystroke, which is what makes scrolling inside one drag. An
 * overshoot amortises that pass: at the default cap the trim runs once per
 * 128 KB of output instead of once per event.
 */
const bufferTrimSlack = (maxBufferBytes: number): number => Math.max(maxBufferBytes >> 2, 1);

function retainBuffer(buffer: string, bufferBytes: number, maxBufferBytes: number): RetainedBuffer {
  return bufferBytes > maxBufferBytes + bufferTrimSlack(maxBufferBytes)
    ? trimBufferToBytes(buffer, maxBufferBytes)
    : { buffer, bufferBytes };
}

export function terminalBufferStateFromSnapshot(
  snapshot: TerminalSessionSnapshot,
  maxBufferBytes: number,
): TerminalBufferState {
  const retained = trimBufferToBytes(snapshot.history, maxBufferBytes);
  return {
    buffer: retained.buffer,
    status: snapshot.status,
    error: null,
    updatedAt: snapshot.updatedAt,
    version: 1,
    resetEpoch: 1,
    streamOffset: retained.buffer.length,
    bufferBytes: retained.bufferBytes,
  };
}

function latestTimestamp(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

export function combineTerminalSessionState(
  summary: TerminalSummary | null,
  buffer: TerminalBufferState,
): TerminalSessionState {
  return {
    summary,
    buffer: buffer.buffer,
    status: buffer.version > 0 ? buffer.status : (summary?.status ?? buffer.status),
    error: buffer.error,
    hasRunningSubprocess: summary?.hasRunningSubprocess ?? false,
    updatedAt: latestTimestamp(summary?.updatedAt ?? null, buffer.updatedAt),
    version: buffer.version,
    resetEpoch: buffer.resetEpoch,
    streamOffset: buffer.streamOffset,
  };
}

export function applyTerminalAttachStreamEvent(
  current: TerminalBufferState,
  event: TerminalAttachStreamEvent,
  maxBufferBytes = DEFAULT_MAX_TERMINAL_BUFFER_BYTES,
): TerminalBufferState {
  switch (event.type) {
    case "snapshot":
    case "restarted":
      return {
        ...terminalBufferStateFromSnapshot(event.snapshot, maxBufferBytes),
        version: current.version + 1,
        resetEpoch: current.resetEpoch + 1,
      };
    case "output": {
      const retained = retainBuffer(
        `${current.buffer}${event.data}`,
        current.bufferBytes + textEncoder.encode(event.data).byteLength,
        maxBufferBytes,
      );
      return {
        ...current,
        buffer: retained.buffer,
        bufferBytes: retained.bufferBytes,
        status: current.status === "closed" ? "running" : current.status,
        error: null,
        version: current.version + 1,
        streamOffset: current.streamOffset + event.data.length,
      };
    }
    case "cleared":
      return {
        ...current,
        buffer: "",
        bufferBytes: 0,
        error: null,
        version: current.version + 1,
        resetEpoch: current.resetEpoch + 1,
        streamOffset: 0,
      };
    case "exited":
      return {
        ...current,
        status: "exited",
        error: null,
        version: current.version + 1,
      };
    case "closed":
      return {
        ...current,
        status: "closed",
        error: null,
        version: current.version + 1,
      };
    case "error":
      return {
        ...current,
        status: "error",
        error: event.message,
        version: current.version + 1,
      };
    case "activity":
      return current;
  }
}

export function applyTerminalMetadataStreamEvent(
  current: ReadonlyArray<TerminalSummary>,
  event: TerminalMetadataStreamEvent,
): ReadonlyArray<TerminalSummary> {
  if (event.type === "snapshot") {
    return event.terminals;
  }
  if (event.type === "remove") {
    return current.filter(
      (terminal) =>
        terminal.threadId !== event.threadId || terminal.terminalId !== event.terminalId,
    );
  }
  const next = current.filter(
    (terminal) =>
      terminal.threadId !== event.terminal.threadId ||
      terminal.terminalId !== event.terminal.terminalId,
  );
  return [...next, event.terminal];
}
