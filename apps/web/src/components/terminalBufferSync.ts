/**
 * Decides what to write into xterm when the session buffer changes.
 *
 * The session buffer is capped (`trimBufferToBytes`, 512 KB) and trimmed from
 * the front, so the new buffer is not always a continuation of the old one.
 * Comparing the two strings cannot tell an append from a repeated frame: a
 * redraw-heavy program emits the same bytes over and over, so any seam search
 * has more than one plausible answer, and picking the wrong one drops or
 * repeats escape sequences — the terminal then keeps stale cells forever,
 * because the dropped bytes were the ones that would have erased them.
 *
 * So the buffer state carries the two numbers that answer it exactly:
 * `streamOffset` counts every character the stream appended before trimming,
 * and `resetEpoch` changes whenever the buffer stopped continuing the previous
 * one. The delta is then plain arithmetic, and the trimmed front never matters
 * because new output is always at the tail.
 */

/** The parts of the session buffer state that decide the next write. */
export interface TerminalBufferPosition {
  readonly buffer: string;
  readonly resetEpoch: number;
  readonly streamOffset: number;
}

export type TerminalWrite =
  /** Append `data`; the terminal keeps its current contents. */
  | { readonly mode: "append"; readonly data: string }
  /** Reset and rewrite; the buffers have no recoverable relationship. */
  | { readonly mode: "reset"; readonly data: string };

export function resolveTerminalWrite(
  previous: TerminalBufferPosition,
  current: TerminalBufferPosition,
): TerminalWrite {
  if (current.resetEpoch !== previous.resetEpoch) {
    return { mode: "reset", data: current.buffer };
  }

  const appended = current.streamOffset - previous.streamOffset;
  if (appended <= 0) {
    return { mode: "append", data: "" };
  }

  // More arrived than the cap retains, so the tail alone is not the whole
  // delta. Only reachable when a single batch of output exceeds 512 KB.
  if (appended > current.buffer.length) {
    return { mode: "reset", data: current.buffer };
  }

  return { mode: "append", data: current.buffer.slice(current.buffer.length - appended) };
}
