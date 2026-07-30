/**
 * Decides what to write into xterm when the session buffer changes.
 *
 * The session buffer is capped (`trimBufferToBytes`, 512 KB) and trimmed from
 * the front, so once a program produces more than that the new buffer is no
 * longer a continuation of the old one. Treating that as "unrelated" means a
 * full reset — `c` plus a rewrite of the whole buffer — on every update,
 * which is a visible flash. Full-screen programs hit it on every keystroke,
 * because each redraw is kilobytes.
 *
 * Recognising a front-trim turns those back into ordinary appends.
 */

/**
 * How much of the previous buffer's tail is used to find the seam. Large enough
 * that a coincidental match is implausible, small enough to stay cheap.
 */
const ANCHOR_LENGTH = 2048;

export type TerminalWrite =
  /** Append `data`; the terminal keeps its current contents. */
  | { readonly mode: "append"; readonly data: string }
  /** Reset and rewrite; the buffers have no recoverable relationship. */
  | { readonly mode: "reset"; readonly data: string };

export function resolveTerminalWrite(previous: string, current: string): TerminalWrite {
  if (previous.length === 0) {
    return { mode: "reset", data: current };
  }
  if (current === previous) {
    return { mode: "append", data: "" };
  }
  // The common case: output was appended and nothing was trimmed.
  if (current.length >= previous.length && current.startsWith(previous)) {
    return { mode: "append", data: current.slice(previous.length) };
  }

  // Otherwise the front may have been trimmed. The tail of the old buffer must
  // still appear in the new one; everything after it is what is actually new.
  const anchor = previous.slice(-Math.min(ANCHOR_LENGTH, previous.length));
  const seam = current.lastIndexOf(anchor);
  if (seam >= 0) {
    // lastIndexOf on purpose: a redraw-heavy program repeats itself, and
    // resuming at the newest match may skip an intermediate frame but can
    // never duplicate output. The newest frame repaints the screen anyway.
    return { mode: "append", data: current.slice(seam + anchor.length) };
  }

  return { mode: "reset", data: current };
}
