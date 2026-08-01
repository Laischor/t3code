/**
 * Deck's additions to the shortcuts a browser pane hands back to the app.
 *
 * A click into a pane gives the guest web contents focus, and the guest keeps
 * every key event to itself — the renderer that implements these commands never
 * sees them. Upstream's `APP_FORWARDED_SHORTCUTS` covers T3's own chords;
 * deck's live here so the manager keeps a single fork hook instead of a growing
 * list inside an upstream constant.
 */

/** The subset of `Electron.Input` the match needs. */
export interface DeckForwardableInput {
  readonly type: string;
  readonly key: string;
  readonly code: string;
  readonly meta: boolean;
  readonly shift: boolean;
  readonly control: boolean;
}

/**
 * Alt is deliberately not matched: a chord and its alt variant are both app
 * shortcuts (mod+B toggles the sidebar, mod+alt+B the right panel), and the
 * replay carries the real modifier state, so the renderer picks the right
 * command.
 */
const DECK_FORWARDED_SHORTCUTS: ReadonlyArray<{
  key: string;
  meta: boolean;
  shift: boolean;
  control: boolean;
}> = Object.freeze([
  // mod+B → sidebar.toggle, mod+alt+B → rightPanel.toggle
  { key: "b", meta: true, shift: false, control: false },
  // mod+T → new terminal tab
  { key: "t", meta: true, shift: false, control: false },
  // mod+shift+T → new browser tab
  { key: "t", meta: true, shift: true, control: false },
  // ctrl+tab / ctrl+shift+tab → cycle tabs
  { key: "Tab", meta: false, shift: false, control: true },
  { key: "Tab", meta: false, shift: true, control: true },
  // mod+N → new window
  { key: "n", meta: true, shift: false, control: false },
  // mod+F → find in page. Forwarding matters most here: the guest has focus
  // whenever you are reading the page you want to search.
  { key: "f", meta: true, shift: false, control: false },
  // mod+shift+] / mod+shift+[ → cycle tabs. Shift reports the shifted
  // character on most layouts, so both forms are listed.
  { key: "]", meta: true, shift: true, control: false },
  { key: "}", meta: true, shift: true, control: false },
  { key: "[", meta: true, shift: true, control: false },
  { key: "{", meta: true, shift: true, control: false },
]);

const LETTER_CODE = /^Key([A-Z])$/;

const letterFromCode = (code: string): string | null =>
  LETTER_CODE.exec(code)?.[1]?.toLowerCase() ?? null;

/**
 * `key` alone is not enough: alt rewrites it into the composed character
 * (option+B reports "∫" on macOS), so the physical code decides letter chords.
 * Mirrors how the renderer resolves a shortcut from a keyboard event.
 */
const inputKeys = (input: DeckForwardableInput): ReadonlySet<string> => {
  const keys = new Set([input.key.toLowerCase()]);
  const letter = letterFromCode(input.code);
  if (letter) keys.add(letter);
  return keys;
};

export function isDeckForwardedShortcut(input: DeckForwardableInput): boolean {
  if (input.type !== "keyDown") return false;
  const keys = inputKeys(input);
  return DECK_FORWARDED_SHORTCUTS.some(
    (shortcut) =>
      keys.has(shortcut.key.toLowerCase()) &&
      shortcut.meta === input.meta &&
      shortcut.shift === input.shift &&
      shortcut.control === input.control,
  );
}

/**
 * The key to replay for a letter chord, or null to keep the reported one.
 * `sendInputEvent` cannot map a composed character such as "∫" back to a key.
 */
export function deckForwardedKeyCode(input: DeckForwardableInput): string | null {
  return letterFromCode(input.code);
}
