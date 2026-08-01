import { describe, expect, it } from "vite-plus/test";

import { resolveTerminalWrite, type TerminalBufferPosition } from "./terminalBufferSync";

/**
 * A screenful of output. Uniform filler is a poor stand-in for a redraw: every
 * offset matches every other, which no real frame does.
 */
const frame = (marker: string) =>
  Array.from(
    { length: 300 },
    (_, index) => `${marker}-line-${String(index).padStart(4, "0")}`,
  ).join("\n");

/** What the reducer produces: the tail of the stream plus its offset. */
const position = (
  buffer: string,
  streamOffset: number,
  resetEpoch = 1,
): TerminalBufferPosition => ({ buffer, resetEpoch, streamOffset });

/** The 512 KB cap: keep the tail, count everything that ever arrived. */
const appendCapped = (
  previous: TerminalBufferPosition,
  data: string,
  capacity: number,
): TerminalBufferPosition =>
  position(
    `${previous.buffer}${data}`.slice(-capacity),
    previous.streamOffset + data.length,
    previous.resetEpoch,
  );

describe("resolveTerminalWrite", () => {
  it("appends when output was simply added", () => {
    expect(resolveTerminalWrite(position("hello", 5), position("hello world", 11))).toEqual({
      mode: "append",
      data: " world",
    });
  });

  it("writes nothing when the buffer is unchanged", () => {
    expect(resolveTerminalWrite(position("hello", 5), position("hello", 5))).toEqual({
      mode: "append",
      data: "",
    });
  });

  it("resets on the first buffer", () => {
    expect(resolveTerminalWrite(position("", 0, 0), position("hello", 5))).toEqual({
      mode: "reset",
      data: "hello",
    });
  });

  it("appends only the new tail when the front was trimmed away", () => {
    const previous = position(`${frame("a")}TAIL`, 4_000);
    const current = appendCapped(previous, "NEW", previous.buffer.length);
    expect(resolveTerminalWrite(previous, current)).toEqual({ mode: "append", data: "NEW" });
  });

  it("appends a repeated frame instead of skipping it", () => {
    // The bug this replaced: a seam search resumed at the newest match of the
    // previous tail, so a repeat of the same frame was dropped. Those bytes
    // carry the erases and cursor moves, so dropping them left stale cells on
    // screen — visible as artifacts once you scrolled back over them.
    const screen = frame("a");
    const previous = position(`HEAD${screen}`, 4 + screen.length);
    const current = appendCapped(previous, `${screen}X`, previous.buffer.length);
    expect(resolveTerminalWrite(previous, current)).toEqual({
      mode: "append",
      data: `${screen}X`,
    });
  });

  it("resets when the buffer stopped continuing the previous one", () => {
    // A snapshot, a restart or a clear bumps the epoch.
    const previous = position(frame("a"), 4_000, 1);
    const current = position(frame("b"), 4_000, 2);
    expect(resolveTerminalWrite(previous, current)).toEqual({
      mode: "reset",
      data: current.buffer,
    });
  });

  it("resets when a single batch of output outran the cap", () => {
    const previous = position("abc", 3);
    const current = position("xyz", 3 + 1_000);
    expect(resolveTerminalWrite(previous, current)).toEqual({ mode: "reset", data: "xyz" });
  });

  it("ignores an offset that went backwards without an epoch change", () => {
    expect(resolveTerminalWrite(position("abcdef", 6), position("abcdef", 4))).toEqual({
      mode: "append",
      data: "",
    });
  });
});
