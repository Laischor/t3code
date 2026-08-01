import { describe, expect, it } from "vite-plus/test";

import {
  deckForwardedKeyCode,
  isDeckForwardedShortcut,
  type DeckForwardableInput,
} from "./deckForwardedShortcuts.ts";

const input = (overrides: Partial<DeckForwardableInput>): DeckForwardableInput => ({
  type: "keyDown",
  key: "a",
  code: "KeyA",
  meta: false,
  shift: false,
  control: false,
  ...overrides,
});

describe("isDeckForwardedShortcut", () => {
  it("forwards mod+B so the sidebar toggles from a focused browser pane", () => {
    expect(isDeckForwardedShortcut(input({ key: "b", code: "KeyB", meta: true }))).toBe(true);
  });

  it("forwards option+B, whose key is the composed character on macOS", () => {
    expect(isDeckForwardedShortcut(input({ key: "∫", code: "KeyB", meta: true }))).toBe(true);
  });

  it("forwards the tab shortcuts", () => {
    expect(isDeckForwardedShortcut(input({ key: "f", code: "KeyF", meta: true }))).toBe(true);
    expect(
      isDeckForwardedShortcut(input({ key: "Tab", code: "Tab", control: true, shift: true })),
    ).toBe(true);
    expect(
      isDeckForwardedShortcut(input({ key: "}", code: "BracketRight", meta: true, shift: true })),
    ).toBe(true);
  });

  it("leaves plain typing and unbound chords to the page", () => {
    expect(isDeckForwardedShortcut(input({ key: "b", code: "KeyB" }))).toBe(false);
    expect(
      isDeckForwardedShortcut(input({ key: "b", code: "KeyB", meta: true, shift: true })),
    ).toBe(false);
    expect(isDeckForwardedShortcut(input({ key: "g", code: "KeyG", meta: true }))).toBe(false);
  });

  it("only forwards key-down, so the guest is not hit twice per press", () => {
    expect(
      isDeckForwardedShortcut(input({ type: "keyUp", key: "b", code: "KeyB", meta: true })),
    ).toBe(false);
  });

  it("leaves upstream's own chords to upstream's matcher", () => {
    expect(isDeckForwardedShortcut(input({ key: "k", code: "KeyK", meta: true }))).toBe(false);
    expect(isDeckForwardedShortcut(input({ key: "w", code: "KeyW", meta: true }))).toBe(false);
  });
});

describe("deckForwardedKeyCode", () => {
  it("replays the unmodified letter rather than a composed character", () => {
    expect(deckForwardedKeyCode(input({ key: "∫", code: "KeyB", meta: true }))).toBe("b");
    expect(deckForwardedKeyCode(input({ key: "T", code: "KeyT", meta: true, shift: true }))).toBe(
      "t",
    );
  });

  it("keeps the reported key for non-letter chords", () => {
    expect(deckForwardedKeyCode(input({ key: "Tab", code: "Tab", control: true }))).toBeNull();
    expect(
      deckForwardedKeyCode(input({ key: "}", code: "BracketRight", meta: true, shift: true })),
    ).toBeNull();
  });
});
