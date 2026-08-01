import { describe, expect, it } from "vite-plus/test";

import {
  applySqlQueryStreamEvent,
  EMPTY_SQL_QUERY_BUFFER_STATE,
  type SqlQueryBufferState,
} from "./sqlSession.ts";

function apply(events: Parameters<typeof applySqlQueryStreamEvent>[1][]): SqlQueryBufferState {
  return events.reduce(applySqlQueryStreamEvent, EMPTY_SQL_QUERY_BUFFER_STATE);
}

describe("applySqlQueryStreamEvent", () => {
  it("accumulates columns and row chunks per statement", () => {
    const state = apply([
      { type: "statementStarted", statementIndex: 0 },
      { type: "columns", statementIndex: 0, columns: [{ name: "id", dataType: "int4" }] },
      { type: "rows", statementIndex: 0, rows: [[1], [2]] },
      { type: "rows", statementIndex: 0, rows: [[3]] },
      {
        type: "statementComplete",
        statementIndex: 0,
        command: "SELECT",
        rowCount: 3,
        truncated: false,
      },
      { type: "complete", durationMs: 12 },
    ]);
    expect(state.status).toBe("complete");
    expect(state.durationMs).toBe(12);
    expect(state.statements).toHaveLength(1);
    expect(state.statements[0]).toMatchObject({
      command: "SELECT",
      rowCount: 3,
      truncated: false,
      complete: true,
      rows: [[1], [2], [3]],
    });
  });

  it("tracks multiple statements independently", () => {
    const state = apply([
      { type: "statementStarted", statementIndex: 0 },
      {
        type: "statementComplete",
        statementIndex: 0,
        command: "UPDATE",
        rowCount: 2,
        truncated: false,
      },
      { type: "statementStarted", statementIndex: 1 },
      { type: "columns", statementIndex: 1, columns: [{ name: "n", dataType: "int4" }] },
      { type: "rows", statementIndex: 1, rows: [[9]] },
    ]);
    expect(state.statements).toHaveLength(2);
    expect(state.statements[0]?.command).toBe("UPDATE");
    expect(state.statements[1]?.rows).toEqual([[9]]);
    expect(state.status).toBe("running");
  });

  it("keeps partial results and marks the batch failed on an error event", () => {
    const state = apply([
      { type: "statementStarted", statementIndex: 0 },
      { type: "columns", statementIndex: 0, columns: [{ name: "id", dataType: "int4" }] },
      { type: "rows", statementIndex: 0, rows: [[1]] },
      { type: "error", statementIndex: 0, message: "syntax error", position: 8 },
      { type: "complete", durationMs: 3 },
    ]);
    expect(state.status).toBe("error");
    expect(state.error).toEqual({ message: "syntax error", position: 8 });
    expect(state.statements[0]?.rows).toEqual([[1]]);
  });
});
