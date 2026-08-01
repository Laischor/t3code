import type { SqlColumnDescriptor, SqlQueryStreamEvent, SqlScalar } from "@t3tools/contracts";

export interface SqlStatementResult {
  readonly statementIndex: number;
  readonly columns: ReadonlyArray<SqlColumnDescriptor>;
  readonly rows: ReadonlyArray<ReadonlyArray<SqlScalar>>;
  readonly command: string | null;
  readonly rowCount: number | null;
  readonly truncated: boolean;
  readonly complete: boolean;
}

export interface SqlQueryBufferState {
  readonly status: "idle" | "running" | "complete" | "error";
  readonly statements: ReadonlyArray<SqlStatementResult>;
  readonly error: { readonly message: string; readonly position: number | null } | null;
  readonly durationMs: number | null;
}

export const EMPTY_SQL_QUERY_BUFFER_STATE: SqlQueryBufferState = {
  status: "idle",
  statements: [],
  error: null,
  durationMs: null,
};

function emptyStatement(statementIndex: number): SqlStatementResult {
  return {
    statementIndex,
    columns: [],
    rows: [],
    command: null,
    rowCount: null,
    truncated: false,
    complete: false,
  };
}

function updateStatement(
  state: SqlQueryBufferState,
  statementIndex: number,
  update: (statement: SqlStatementResult) => SqlStatementResult,
): SqlQueryBufferState {
  const existing = state.statements.find(
    (statement) => statement.statementIndex === statementIndex,
  );
  const statements =
    existing === undefined
      ? [...state.statements, update(emptyStatement(statementIndex))]
      : state.statements.map((statement) =>
          statement.statementIndex === statementIndex ? update(statement) : statement,
        );
  return { ...state, statements };
}

export function applySqlQueryStreamEvent(
  state: SqlQueryBufferState,
  event: SqlQueryStreamEvent,
): SqlQueryBufferState {
  switch (event.type) {
    case "statementStarted":
      return updateStatement({ ...state, status: "running" }, event.statementIndex, (s) => s);
    case "columns":
      return updateStatement(state, event.statementIndex, (statement) => ({
        ...statement,
        columns: event.columns,
      }));
    case "rows":
      return updateStatement(state, event.statementIndex, (statement) => ({
        ...statement,
        rows: [...statement.rows, ...event.rows],
      }));
    case "statementComplete":
      return updateStatement(state, event.statementIndex, (statement) => ({
        ...statement,
        command: event.command,
        rowCount: event.rowCount,
        truncated: event.truncated,
        complete: true,
      }));
    case "error":
      return {
        ...state,
        status: "error",
        error: { message: event.message, position: event.position },
      };
    case "complete":
      return {
        ...state,
        status: state.status === "error" ? "error" : "complete",
        durationMs: event.durationMs,
      };
  }
}
