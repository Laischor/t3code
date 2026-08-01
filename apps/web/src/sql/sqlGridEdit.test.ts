import { describe, expect, it } from "vite-plus/test";

import {
  buildRowEdits,
  formatCellValue,
  parseCellInput,
  resolveEditContext,
  type SqlCellEdit,
} from "./sqlGridEdit";

const columns = [
  { name: "id", dataType: "int4" },
  { name: "name", dataType: "text" },
];

const identity = {
  identity: { kind: "primaryKey" as const, keyColumns: ["id"] },
  columns: [],
};

describe("resolveEditContext", () => {
  it("is editable when the grid shows a table and its key columns are present", () => {
    const context = resolveEditContext(
      { table: { schema: null, name: "users" } },
      identity,
      columns,
    );
    expect(context).toEqual({
      table: { schema: null, name: "users" },
      identity: identity.identity,
    });
  });

  it("stays read-only for arbitrary query results", () => {
    expect(resolveEditContext({ table: null }, identity, columns)).toBeNull();
  });

  it("stays read-only when the identity is missing or its columns are not selected", () => {
    const table = { table: { schema: null, name: "users" } };
    expect(resolveEditContext(table, { identity: null, columns: [] }, columns)).toBeNull();
    expect(
      resolveEditContext(
        table,
        { identity: { kind: "primaryKey", keyColumns: ["uuid"] }, columns: [] },
        columns,
      ),
    ).toBeNull();
  });
});

describe("buildRowEdits", () => {
  const rows = [
    [1, "Ada"],
    [2, "Bob"],
  ];

  it("groups cell edits per row and keys them by the original row values", () => {
    const edits: SqlCellEdit[] = [
      { rowIndex: 1, column: "name", value: "Robert" },
      { rowIndex: 0, column: "name", value: "Ada L." },
    ];
    expect(buildRowEdits(edits, rows, columns, ["id"])).toEqual([
      { key: { id: 2 }, set: { name: "Robert" } },
      { key: { id: 1 }, set: { name: "Ada L." } },
    ]);
  });

  it("merges multiple edits of the same row", () => {
    const edits: SqlCellEdit[] = [
      { rowIndex: 0, column: "name", value: "X" },
      { rowIndex: 0, column: "id", value: 99 },
    ];
    expect(buildRowEdits(edits, rows, columns, ["id"])).toEqual([
      { key: { id: 1 }, set: { name: "X", id: 99 } },
    ]);
  });

  it("returns nothing when a key column is not part of the result", () => {
    expect(
      buildRowEdits([{ rowIndex: 0, column: "name", value: "X" }], rows, columns, ["missing"]),
    ).toEqual([]);
  });
});

describe("parseCellInput", () => {
  it("keeps the previous value's type where possible", () => {
    expect(parseCellInput("42", 7)).toBe(42);
    expect(parseCellInput("true", false)).toBe(true);
    expect(parseCellInput("0", true)).toBe(false);
    expect(parseCellInput("hello", "old")).toBe("hello");
  });

  it("maps empty input to NULL except for string columns", () => {
    expect(parseCellInput("", 7)).toBeNull();
    expect(parseCellInput("", "old")).toBe("");
  });
});

describe("formatCellValue", () => {
  it("renders scalars for display", () => {
    expect(formatCellValue(null)).toBe("");
    expect(formatCellValue(true)).toBe("true");
    expect(formatCellValue(42)).toBe("42");
  });
});
