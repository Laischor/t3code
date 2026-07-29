import type { EnvironmentId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  deckProjectKey,
  findWindowProject,
  migratePersistedDeckWindowState,
  nextWindowName,
  parseDeckProjectKey,
  selectProjectWindows,
  useDeckWindowStore,
  type DeckProjectRef,
  type DeckWindow,
} from "./deckWindowStore";

const projectA: DeckProjectRef = {
  environmentId: "local" as EnvironmentId,
  projectId: "proj-a",
};
const projectB: DeckProjectRef = {
  environmentId: "local" as EnvironmentId,
  projectId: "proj-b",
};

function windows(ref: DeckProjectRef): ReadonlyArray<DeckWindow> {
  return selectProjectWindows(useDeckWindowStore.getState().windowsByProjectKey, ref);
}

beforeEach(() => {
  useDeckWindowStore.setState({ windowsByProjectKey: {} });
});

describe("deckProjectKey", () => {
  it("round-trips through parseDeckProjectKey", () => {
    expect(parseDeckProjectKey(deckProjectKey(projectA))).toEqual(projectA);
    expect(parseDeckProjectKey("no-separator")).toBeNull();
  });

  it("cannot be confused by ids containing the other field's text", () => {
    expect(deckProjectKey({ environmentId: "a b" as EnvironmentId, projectId: "c" })).not.toBe(
      deckProjectKey({ environmentId: "a" as EnvironmentId, projectId: "b c" }),
    );
  });
});

describe("nextWindowName", () => {
  it("counts up from the highest existing number", () => {
    expect(nextWindowName([])).toBe("Window 1");
    expect(
      nextWindowName([
        { id: "a", name: "Window 1", createdAt: "" },
        { id: "b", name: "Window 4", createdAt: "" },
      ] as DeckWindow[]),
    ).toBe("Window 5");
  });

  it("ignores renamed windows", () => {
    expect(nextWindowName([{ id: "a", name: "scratch", createdAt: "" }] as DeckWindow[])).toBe(
      "Window 1",
    );
  });
});

describe("createWindow", () => {
  it("adds a window scoped to its project", () => {
    const created = useDeckWindowStore.getState().createWindow(projectA);
    expect(windows(projectA).map((w) => w.id)).toEqual([created.id]);
    expect(windows(projectB)).toEqual([]);
  });

  it("gives each window a distinct id", () => {
    const first = useDeckWindowStore.getState().createWindow(projectA);
    const second = useDeckWindowStore.getState().createWindow(projectA);
    expect(first.id).not.toBe(second.id);
    expect(second.name).toBe("Window 2");
  });

  it("accepts an explicit name", () => {
    const created = useDeckWindowStore.getState().createWindow(projectA, "  build  ");
    expect(created.name).toBe("build");
  });
});

describe("renameWindow", () => {
  it("trims and applies the new name", () => {
    const created = useDeckWindowStore.getState().createWindow(projectA);
    useDeckWindowStore.getState().renameWindow(projectA, created.id, "  logs  ");
    expect(windows(projectA)[0]?.name).toBe("logs");
  });

  it("ignores a blank name", () => {
    const created = useDeckWindowStore.getState().createWindow(projectA);
    useDeckWindowStore.getState().renameWindow(projectA, created.id, "   ");
    expect(windows(projectA)[0]?.name).toBe(created.name);
  });
});

describe("closeWindow", () => {
  it("removes one window and keeps the rest", () => {
    const first = useDeckWindowStore.getState().createWindow(projectA);
    const second = useDeckWindowStore.getState().createWindow(projectA);
    useDeckWindowStore.getState().closeWindow(projectA, first.id);
    expect(windows(projectA).map((w) => w.id)).toEqual([second.id]);
  });

  it("drops the project entry once its last window closes", () => {
    const only = useDeckWindowStore.getState().createWindow(projectA);
    useDeckWindowStore.getState().closeWindow(projectA, only.id);
    expect(useDeckWindowStore.getState().windowsByProjectKey).toEqual({});
  });
});

describe("reorderWindow", () => {
  it("moves a window and clamps out-of-range targets", () => {
    const first = useDeckWindowStore.getState().createWindow(projectA);
    const second = useDeckWindowStore.getState().createWindow(projectA);
    const third = useDeckWindowStore.getState().createWindow(projectA);

    useDeckWindowStore.getState().reorderWindow(projectA, third.id, 0);
    expect(windows(projectA).map((w) => w.id)).toEqual([third.id, first.id, second.id]);

    useDeckWindowStore.getState().reorderWindow(projectA, third.id, 99);
    expect(windows(projectA).map((w) => w.id)).toEqual([first.id, second.id, third.id]);
  });
});

describe("findWindowProject", () => {
  it("locates the project holding a window", () => {
    const created = useDeckWindowStore.getState().createWindow(projectA);
    useDeckWindowStore.getState().createWindow(projectB);
    const found = findWindowProject(useDeckWindowStore.getState().windowsByProjectKey, created.id);
    expect(found?.projectKey).toBe(deckProjectKey(projectA));
    expect(found?.window.id).toBe(created.id);
  });

  it("returns null for an unknown window", () => {
    expect(findWindowProject({}, "nope")).toBeNull();
  });
});

describe("migratePersistedDeckWindowState", () => {
  it("drops malformed entries and duplicate ids", () => {
    const migrated = migratePersistedDeckWindowState(
      {
        windowsByProjectKey: {
          [deckProjectKey(projectA)]: [
            { id: "w1", name: "One", createdAt: "2026-01-01T00:00:00.000Z" },
            { id: "w1", name: "Duplicate", createdAt: "2026-01-01T00:00:00.000Z" },
            { id: "", name: "Blank", createdAt: "" },
            null,
          ],
          [deckProjectKey(projectB)]: [],
        },
      },
      1,
    );
    expect(Object.keys(migrated.windowsByProjectKey ?? {})).toEqual([deckProjectKey(projectA)]);
    expect(migrated.windowsByProjectKey?.[deckProjectKey(projectA)]?.map((w) => w.id)).toEqual([
      "w1",
    ]);
  });

  it("fills a missing name", () => {
    const migrated = migratePersistedDeckWindowState(
      { windowsByProjectKey: { [deckProjectKey(projectA)]: [{ id: "w1" }] } },
      1,
    );
    expect(migrated.windowsByProjectKey?.[deckProjectKey(projectA)]?.[0]?.name).toBe("Window");
  });

  it("survives junk", () => {
    expect(migratePersistedDeckWindowState(null, 1)).toEqual({ windowsByProjectKey: {} });
    expect(migratePersistedDeckWindowState({ windowsByProjectKey: 5 }, 1)).toEqual({
      windowsByProjectKey: {},
    });
  });
});
