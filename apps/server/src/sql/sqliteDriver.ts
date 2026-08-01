import * as NodeSqlite from "node:sqlite";

import type {
  SqlColumnInfo,
  SqlCompletionTable,
  SqlObjectType,
  SqlScalar,
  SqlTableRef,
  SqlTreeNode,
  SqlTreeNodeRef,
} from "@t3tools/contracts";

import {
  commandTagFromSql,
  toSqlScalar,
  type SqlDriverResult,
  type SqlIdeDriver,
  type SqlTableIdentity,
} from "./driver.ts";
import { quoteIdentifier } from "./sqlText.ts";

const OBJECT_TYPE_LABELS: ReadonlyArray<{
  type: SqlObjectType;
  label: string;
  sqliteType: string | null;
}> = [
  { type: "table", label: "Tables", sqliteType: "table" },
  { type: "view", label: "Views", sqliteType: "view" },
  { type: "index", label: "Indexes", sqliteType: "index" },
  { type: "trigger", label: "Triggers", sqliteType: "trigger" },
];

/**
 * node:sqlite is synchronous; queries run on the server event loop. Fine for
 * the local IDE use case — large scans block briefly rather than crash.
 */
export async function openSqliteDriver(file: string): Promise<SqlIdeDriver> {
  const db = new NodeSqlite.DatabaseSync(file);

  const versionRow = db.prepare("SELECT sqlite_version() AS version").get() as
    | { version?: unknown }
    | undefined;
  const serverVersion = typeof versionRow?.version === "string" ? versionRow.version : null;

  // SQLite has no boolean storage class; bind booleans as 0/1.
  const toBoundParams = (params: ReadonlyArray<SqlScalar>) =>
    params.map((value) => (typeof value === "boolean" ? (value ? 1 : 0) : value));

  const execute = async (
    text: string,
    params: ReadonlyArray<SqlScalar>,
    maxRows: number,
  ): Promise<SqlDriverResult> => {
    const statement = db.prepare(text);
    const boundParams = toBoundParams(params);
    const columnNames = statement.columns().map((column) => ({
      name: column.name,
      dataType: column.type ?? "",
    }));
    if (columnNames.length === 0) {
      const info = statement.run(...boundParams);
      return {
        columns: [],
        rows: [],
        command: commandTagFromSql(text),
        rowCount: Number(info.changes),
        truncated: false,
      };
    }
    const rows: SqlScalar[][] = [];
    let truncated = false;
    for (const row of statement.iterate(...boundParams)) {
      if (rows.length >= maxRows) {
        truncated = true;
        break;
      }
      const record = row as Record<string, unknown>;
      rows.push(columnNames.map((column) => toSqlScalar(record[column.name])));
    }
    return {
      columns: columnNames,
      rows,
      command: commandTagFromSql(text),
      rowCount: rows.length,
      truncated,
    };
  };

  const queryRows = (text: string, params: ReadonlyArray<SqlScalar> = []) =>
    db.prepare(text).all(...toBoundParams(params)) as Record<string, unknown>[];

  const listColumns = (table: string): SqlColumnInfo[] => {
    // PRAGMA arguments cannot be bound parameters — quote the identifier instead.
    const rows = queryRows(`PRAGMA table_info(${quoteIdentifier(table)})`);
    return rows.map((row) => ({
      name: String(row.name),
      dataType: String(row.type ?? ""),
      nullable: Number(row.notnull) === 0,
      isPrimaryKey: Number(row.pk) > 0,
    }));
  };

  const getTreeChildren = async (
    node: SqlTreeNodeRef,
  ): Promise<{ children: SqlTreeNode[]; columns: SqlColumnInfo[] | null }> => {
    switch (node.kind) {
      case "root":
        // SQLite has no schemas — the root lists object types directly.
        return {
          children: OBJECT_TYPE_LABELS.map(({ type, label }) => ({
            ref: { kind: "objectType", schema: null, objectType: type },
            label,
            detail: null,
            hasChildren: true,
          })),
          columns: null,
        };
      case "schema":
        return { children: [], columns: null };
      case "objectType": {
        const mapping = OBJECT_TYPE_LABELS.find((entry) => entry.type === node.objectType);
        if (mapping === undefined || mapping.sqliteType === null) {
          return { children: [], columns: null };
        }
        const rows = queryRows(
          `SELECT name, tbl_name FROM sqlite_master
           WHERE type = ? AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
           ORDER BY name`,
          [mapping.sqliteType],
        );
        const tableLike = node.objectType === "table" || node.objectType === "view";
        return {
          children: rows.map((row) => ({
            ref: {
              kind: "object",
              schema: null,
              objectType: node.objectType,
              name: String(row.name),
            },
            label: String(row.name),
            detail:
              node.objectType === "index" || node.objectType === "trigger"
                ? `on ${String(row.tbl_name)}`
                : null,
            hasChildren: tableLike,
          })),
          columns: null,
        };
      }
      case "object": {
        const tableLike = node.objectType === "table" || node.objectType === "view";
        if (!tableLike) return { children: [], columns: null };
        return { children: [], columns: listColumns(node.name) };
      }
    }
  };

  const getObjectDefinition = async (
    _schema: string | null,
    _objectType: SqlObjectType,
    name: string,
  ): Promise<string | null> => {
    const rows = queryRows("SELECT sql FROM sqlite_master WHERE name = ? LIMIT 1", [name]);
    const definition = rows[0]?.sql;
    return typeof definition === "string" ? definition : null;
  };

  const getCompletionMetadata = async (): Promise<{
    defaultSchema: string | null;
    tables: SqlCompletionTable[];
  }> => {
    const rows = queryRows(
      `SELECT name FROM sqlite_master
       WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
       ORDER BY name`,
    );
    return {
      defaultSchema: null,
      tables: rows.map((row) => ({
        schema: null,
        name: String(row.name),
        columns: listColumns(String(row.name)).map((column) => column.name),
      })),
    };
  };

  const getTableIdentity = async (
    table: SqlTableRef,
  ): Promise<{ identity: SqlTableIdentity | null; columns: SqlColumnInfo[] }> => {
    const columns = listColumns(table.name);
    if (columns.length === 0) return { identity: null, columns };
    const keyColumns = columns.filter((column) => column.isPrimaryKey).map((c) => c.name);
    if (keyColumns.length > 0) {
      return { identity: { kind: "primaryKey", keyColumns }, columns };
    }
    // WITHOUT ROWID tables must declare a primary key, so a table with no
    // declared key is always a rowid table.
    const isView =
      queryRows("SELECT type FROM sqlite_master WHERE name = ? LIMIT 1", [table.name])[0]?.type ===
      "view";
    if (isView) return { identity: null, columns };
    return { identity: { kind: "rowid", keyColumns: ["rowid"] }, columns };
  };

  return {
    engine: "sqlite",
    serverVersion,
    database: file,
    execute,
    cancel: async () => {
      // node:sqlite runs synchronously; there is nothing in flight to cancel.
    },
    close: async () => {
      db.close();
    },
    getTreeChildren,
    getObjectDefinition,
    getCompletionMetadata,
    getTableIdentity,
  };
}
