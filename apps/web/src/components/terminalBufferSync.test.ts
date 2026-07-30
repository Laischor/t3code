import { describe, expect, it } from "vite-plus/test";

import { resolveTerminalWrite } from "./terminalBufferSync";

/** Long enough to exceed the seam anchor, so trims are recognised. */
const filler = (marker: string) => marker.repeat(3000).slice(0, 3000);

/**
 * A screenful of distinguishable output. Uniform filler is a poor stand-in for
 * a redraw: every offset matches every other, which no real frame does.
 */
const frame = (marker: string) =>
  Array.from(
    { length: 300 },
    (_, index) => `${marker}-line-${String(index).padStart(4, "0")}`,
  ).join("\n");

describe("resolveTerminalWrite", () => {
  it("appends when output was simply added", () => {
    expect(resolveTerminalWrite("hello", "hello world")).toEqual({
      mode: "append",
      data: " world",
    });
  });

  it("writes nothing when the buffer is unchanged", () => {
    expect(resolveTerminalWrite("hello", "hello")).toEqual({ mode: "append", data: "" });
  });

  it("resets on the first buffer", () => {
    expect(resolveTerminalWrite("", "hello")).toEqual({ mode: "reset", data: "hello" });
  });

  it("appends when the front was trimmed away", () => {
    // What the 512 KB cap does: drop the head, keep the tail, add new output.
    const previous = `${filler("a")}TAIL`;
    const current = `${previous.slice(500)}NEW`;
    expect(resolveTerminalWrite(previous, current)).toEqual({ mode: "append", data: "NEW" });
  });

  it("resets when the buffers have nothing in common", () => {
    const previous = filler("a");
    const current = filler("b");
    expect(resolveTerminalWrite(previous, current)).toEqual({ mode: "reset", data: current });
  });

  it("resumes at the newest seam when a repeated frame was also trimmed", () => {
    // What a redraw-heavy program actually produces: the same frame again, with
    // the head dropped. Resuming at the last match may skip an intermediate
    // frame — the newest one repaints anyway — but must never write twice.
    const screen = frame("a");
    const previous = `HEAD${screen}`;
    const current = `${previous}${screen}X`.slice(100);
    const result = resolveTerminalWrite(previous, current);
    expect(result.mode).toBe("append");
    expect(result.data).toBe("X");
  });

  it("resets a short buffer rather than guessing at a seam", () => {
    // The anchor is the whole previous buffer when it is short, so a trim is
    // not recognised. Harmless: trimming only happens near the 512 KB cap, and
    // rewriting a few hundred bytes is not a visible flash.
    expect(resolveTerminalWrite("abc", "bcdef")).toEqual({ mode: "reset", data: "bcdef" });
  });

  it("never returns data that would duplicate what is on screen", () => {
    const previous = `${filler("a")}END`;
    const current = `${previous}MORE`;
    const result = resolveTerminalWrite(previous, current);
    expect(result.mode).toBe("append");
    expect(result.data).toBe("MORE");
    expect(result.data.includes("END")).toBe(false);
  });
});
