/**
 * Items and filtering for Deck's palette.
 *
 * Deliberately not an extension of T3's CommandPalette: that file is large and
 * changes often upstream, and it is built around projects and chat threads,
 * where Deck needs windows. Owning a small one keeps rebases cheap.
 *
 * Pure so the matching can be tested without a DOM.
 */

export type DeckPaletteItem =
  | {
      readonly kind: "window";
      readonly id: string;
      readonly label: string;
      readonly detail: string;
      readonly environmentId: string;
      readonly windowId: string;
    }
  | {
      readonly kind: "new-window";
      readonly id: string;
      readonly label: string;
      readonly detail: string;
      readonly environmentId: string;
      readonly projectId: string;
    }
  | {
      readonly kind: "new-terminal" | "new-browser" | "new-project";
      readonly id: string;
      readonly label: string;
      readonly detail: string;
    };

export interface DeckPaletteProject {
  readonly environmentId: string;
  readonly projectId: string;
  readonly title: string;
  readonly windows: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

/**
 * Windows first — switching is the common case — then creation actions, so the
 * default selection is a jump rather than something that changes state.
 */
export function buildDeckPaletteItems(
  projects: ReadonlyArray<DeckPaletteProject>,
): ReadonlyArray<DeckPaletteItem> {
  const items: DeckPaletteItem[] = [];

  for (const project of projects) {
    for (const window of project.windows) {
      items.push({
        kind: "window",
        id: `window:${project.environmentId}:${window.id}`,
        label: window.name,
        detail: project.title,
        environmentId: project.environmentId,
        windowId: window.id,
      });
    }
  }

  items.push(
    { kind: "new-terminal", id: "new-terminal", label: "New terminal tab", detail: "This pane" },
    { kind: "new-browser", id: "new-browser", label: "New browser tab", detail: "This pane" },
  );

  items.push({
    kind: "new-project",
    id: "new-project",
    label: "Add project…",
    detail: "Choose a folder",
  });

  for (const project of projects) {
    items.push({
      kind: "new-window",
      id: `new-window:${project.environmentId}:${project.projectId}`,
      label: `New window in ${project.title}`,
      detail: "Create",
      environmentId: project.environmentId,
      projectId: project.projectId,
    });
  }

  return items;
}

/**
 * Subsequence match on label and detail: typing "nwt" finds "New window in
 * terminal". Case-insensitive, order matters, gaps are allowed.
 */
export function matchesQuery(item: DeckPaletteItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  const haystack = `${item.label} ${item.detail}`.toLowerCase();

  let index = 0;
  for (const char of needle) {
    if (char === " ") continue;
    const found = haystack.indexOf(char, index);
    if (found < 0) return false;
    index = found + 1;
  }
  return true;
}

/** Exact substring hits rank above scattered subsequence hits. */
export function filterDeckPaletteItems(
  items: ReadonlyArray<DeckPaletteItem>,
  query: string,
): ReadonlyArray<DeckPaletteItem> {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return items;

  const matched = items.filter((item) => matchesQuery(item, query));
  return [...matched].sort((left, right) => {
    const leftDirect = left.label.toLowerCase().includes(needle) ? 0 : 1;
    const rightDirect = right.label.toLowerCase().includes(needle) ? 0 : 1;
    if (leftDirect !== rightDirect) return leftDirect - rightDirect;
    return 0;
  });
}

/** Moves the highlight with wrap-around. */
export function stepPaletteIndex(count: number, current: number, direction: 1 | -1): number {
  if (count <= 0) return 0;
  return (((current + direction) % count) + count) % count;
}
