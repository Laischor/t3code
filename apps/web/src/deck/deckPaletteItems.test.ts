import { describe, expect, it } from "vite-plus/test";

import {
  buildDeckPaletteItems,
  filterDeckPaletteItems,
  matchesQuery,
  stepPaletteIndex,
  type DeckPaletteProject,
} from "./deckPaletteItems";

const projects: ReadonlyArray<DeckPaletteProject> = [
  {
    environmentId: "local",
    projectId: "p1",
    title: "terminal",
    windows: [
      { id: "w1", name: "Window 1" },
      { id: "w2", name: "logs" },
    ],
  },
  {
    environmentId: "local",
    projectId: "p2",
    title: "yuki",
    windows: [{ id: "w3", name: "Window 1" }],
  },
];

describe("buildDeckPaletteItems", () => {
  it("lists windows before creation actions", () => {
    const items = buildDeckPaletteItems(projects);
    const kinds = items.map((item) => item.kind);
    expect(kinds.slice(0, 3)).toEqual(["window", "window", "window"]);
    expect(kinds).toContain("new-terminal");
    expect(kinds).toContain("new-window");
    // Switching is the common case, so nothing that changes state is first.
    expect(kinds[0]).toBe("window");
  });

  it("keeps windows addressable and distinguishes same-named ones", () => {
    const items = buildDeckPaletteItems(projects);
    const windows = items.filter((item) => item.kind === "window");
    expect(new Set(windows.map((item) => item.id)).size).toBe(3);
    // Two windows are both called "Window 1"; the project tells them apart.
    const named = windows.filter((item) => item.label === "Window 1");
    expect(named.map((item) => item.detail)).toEqual(["terminal", "yuki"]);
  });

  it("offers a new window per project", () => {
    const items = buildDeckPaletteItems(projects);
    const labels = items.filter((item) => item.kind === "new-window").map((item) => item.label);
    expect(labels).toEqual(["New window in terminal", "New window in yuki"]);
  });

  it("still offers actions with no projects", () => {
    // The escape hatch out of an empty app: without this you cannot add the
    // second project, or the first after deleting one.
    expect(buildDeckPaletteItems([]).map((item) => item.kind)).toEqual([
      "new-terminal",
      "new-browser",
      "new-project",
    ]);
  });

  it("always offers adding a project", () => {
    expect(buildDeckPaletteItems(projects).some((item) => item.kind === "new-project")).toBe(true);
  });
});

describe("matchesQuery", () => {
  const items = buildDeckPaletteItems(projects);
  const logs = items.find((item) => item.label === "logs")!;

  it("matches everything on an empty query", () => {
    expect(matchesQuery(logs, "")).toBe(true);
    expect(matchesQuery(logs, "   ")).toBe(true);
  });

  it("matches case-insensitively on label and detail", () => {
    expect(matchesQuery(logs, "LOG")).toBe(true);
    expect(matchesQuery(logs, "terminal")).toBe(true);
  });

  it("matches a scattered subsequence but respects order", () => {
    const newWindow = items.find((item) => item.label === "New window in terminal")!;
    expect(matchesQuery(newWindow, "nwt")).toBe(true);
    expect(matchesQuery(newWindow, "twn")).toBe(false);
  });

  it("rejects characters that are not there", () => {
    expect(matchesQuery(logs, "zzz")).toBe(false);
  });
});

describe("filterDeckPaletteItems", () => {
  const items = buildDeckPaletteItems(projects);

  it("returns everything unfiltered", () => {
    expect(filterDeckPaletteItems(items, "")).toHaveLength(items.length);
  });

  it("ranks a direct label hit above a scattered one", () => {
    const results = filterDeckPaletteItems(items, "logs");
    expect(results[0]?.label).toBe("logs");
  });

  it("narrows to matching entries", () => {
    const results = filterDeckPaletteItems(items, "yuki");
    expect(results.every((item) => `${item.label} ${item.detail}`.includes("yuki"))).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });
});

describe("stepPaletteIndex", () => {
  it("wraps in both directions", () => {
    expect(stepPaletteIndex(3, 2, 1)).toBe(0);
    expect(stepPaletteIndex(3, 0, -1)).toBe(2);
  });

  it("stays put with nothing to select", () => {
    expect(stepPaletteIndex(0, 0, 1)).toBe(0);
  });
});
