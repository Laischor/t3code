import postgres from "postgres";

import type {
  SqlColumnInfo,
  SqlCompletionTable,
  SqlObjectType,
  SqlPostgresConnectionConfig,
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
import { quoteTableRef } from "./sqlText.ts";

const OBJECT_TYPE_LABELS: ReadonlyArray<{ type: SqlObjectType; label: string }> = [
  { type: "table", label: "Tables" },
  { type: "view", label: "Views" },
  { type: "materializedView", label: "Materialized Views" },
  { type: "function", label: "Functions" },
  { type: "procedure", label: "Procedures" },
  { type: "sequence", label: "Sequences" },
  { type: "index", label: "Indexes" },
  { type: "trigger", label: "Triggers" },
];

const RELKIND_BY_OBJECT_TYPE: Partial<Record<SqlObjectType, string>> = {
  table: "r",
  view: "v",
  materializedView: "m",
  sequence: "S",
  index: "i",
};

interface ActiveQuery {
  cancel(): void;
}

export async function openPostgresDriver(
  config: SqlPostgresConnectionConfig,
  password: string | null,
): Promise<SqlIdeDriver> {
  const sql = postgres({
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.user,
    ...(password === null ? {} : { password }),
    ssl:
      config.sslMode === undefined || config.sslMode === "disable"
        ? false
        : config.sslMode === "prefer"
          ? "prefer"
          : config.sslMode === "require"
            ? true
            : { rejectUnauthorized: config.sslMode === "verify-full" },
    // One physical connection: session state (SET, temp tables, transactions
    // spanning multiple execute calls) must stick to this IDE session.
    max: 1,
    prepare: false,
    connect_timeout: 15,
    // The IDE renders raw values; keep bigints and numerics lossless as text.
    types: {
      bigint: { to: 20, from: [20], serialize: (v: string) => v, parse: (v: string) => v },
    },
    onnotice: () => {},
  });

  let typeNames = new Map<number, string>();
  let activeQuery: ActiveQuery | null = null;

  // Fail fast (and resolve the server version) before reporting the session open.
  const [versionRow] = await sql.unsafe("SELECT current_setting('server_version') AS version");
  const serverVersion = typeof versionRow?.version === "string" ? versionRow.version : null;

  const loadTypeNames = async () => {
    if (typeNames.size > 0) return typeNames;
    const rows = await sql.unsafe("SELECT oid, typname FROM pg_catalog.pg_type");
    typeNames = new Map(rows.map((row) => [Number(row.oid), String(row.typname)]));
    return typeNames;
  };

  const execute = async (
    text: string,
    params: ReadonlyArray<SqlScalar>,
    maxRows: number,
  ): Promise<SqlDriverResult> => {
    const names = await loadTypeNames();
    const query = sql.unsafe(text, params as never[]);
    activeQuery = query as unknown as ActiveQuery;
    try {
      const result = await query.values();
      const columns = (result.columns ?? []).map((column) => ({
        name: column.name,
        dataType: names.get(column.type) ?? `oid:${column.type}`,
      }));
      const truncated = result.length > maxRows;
      const rows = (truncated ? result.slice(0, maxRows) : result).map((row) =>
        (row as unknown[]).map(toSqlScalar),
      );
      return {
        columns,
        rows,
        command: result.command ?? commandTagFromSql(text),
        rowCount: result.count ?? null,
        truncated,
      };
    } finally {
      activeQuery = null;
    }
  };

  const queryRows = async (text: string, params: ReadonlyArray<SqlScalar> = []) =>
    sql.unsafe(text, params as never[]);

  const listColumns = async (table: SqlTableRef): Promise<SqlColumnInfo[]> => {
    const rows = await queryRows(
      `
      SELECT
        a.attname AS name,
        pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
        NOT a.attnotnull AS nullable,
        COALESCE(i.indisprimary, false) AS is_primary_key
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_index i
        ON i.indrelid = a.attrelid AND i.indisprimary AND a.attnum = ANY (i.indkey)
      WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum
      `,
      [table.schema ?? "public", table.name],
    );
    return rows.map((row) => ({
      name: String(row.name),
      dataType: String(row.data_type),
      nullable: Boolean(row.nullable),
      isPrimaryKey: Boolean(row.is_primary_key),
    }));
  };

  const getTreeChildren = async (
    node: SqlTreeNodeRef,
  ): Promise<{ children: SqlTreeNode[]; columns: SqlColumnInfo[] | null }> => {
    switch (node.kind) {
      case "root": {
        const rows = await queryRows(
          `SELECT nspname FROM pg_catalog.pg_namespace
           WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
           ORDER BY nspname`,
        );
        return {
          children: rows.map((row) => ({
            ref: { kind: "schema", schema: String(row.nspname) },
            label: String(row.nspname),
            detail: null,
            hasChildren: true,
          })),
          columns: null,
        };
      }
      case "schema":
        return {
          children: OBJECT_TYPE_LABELS.map(({ type, label }) => ({
            ref: { kind: "objectType", schema: node.schema, objectType: type },
            label,
            detail: null,
            hasChildren: true,
          })),
          columns: null,
        };
      case "objectType": {
        const schema = node.schema ?? "public";
        if (node.objectType === "function" || node.objectType === "procedure") {
          const prokind = node.objectType === "function" ? "f" : "p";
          const rows = await queryRows(
            `SELECT p.proname AS name,
                    pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
             FROM pg_catalog.pg_proc p
             JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = $1 AND p.prokind = $2
             ORDER BY p.proname`,
            [schema, prokind],
          );
          return {
            children: rows.map((row) => ({
              ref: {
                kind: "object",
                schema: node.schema,
                objectType: node.objectType,
                name: String(row.name),
              },
              label: String(row.name),
              detail: `(${String(row.args)})`,
              hasChildren: false,
            })),
            columns: null,
          };
        }
        if (node.objectType === "trigger") {
          const rows = await queryRows(
            `SELECT t.tgname AS name, c.relname AS table_name
             FROM pg_catalog.pg_trigger t
             JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1 AND NOT t.tgisinternal
             ORDER BY t.tgname`,
            [schema],
          );
          return {
            children: rows.map((row) => ({
              ref: {
                kind: "object",
                schema: node.schema,
                objectType: "trigger",
                name: String(row.name),
              },
              label: String(row.name),
              detail: `on ${String(row.table_name)}`,
              hasChildren: false,
            })),
            columns: null,
          };
        }
        const relkind = RELKIND_BY_OBJECT_TYPE[node.objectType];
        if (relkind === undefined) return { children: [], columns: null };
        const rows = await queryRows(
          `SELECT c.relname AS name
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = $1 AND c.relkind = $2
           ORDER BY c.relname`,
          [schema, relkind],
        );
        const tableLike =
          node.objectType === "table" ||
          node.objectType === "view" ||
          node.objectType === "materializedView";
        return {
          children: rows.map((row) => ({
            ref: {
              kind: "object",
              schema: node.schema,
              objectType: node.objectType,
              name: String(row.name),
            },
            label: String(row.name),
            detail: null,
            hasChildren: tableLike,
          })),
          columns: null,
        };
      }
      case "object": {
        const tableLike =
          node.objectType === "table" ||
          node.objectType === "view" ||
          node.objectType === "materializedView";
        if (!tableLike) return { children: [], columns: null };
        const columns = await listColumns({ schema: node.schema, name: node.name });
        return { children: [], columns };
      }
    }
  };

  const getObjectDefinition = async (
    schema: string | null,
    objectType: SqlObjectType,
    name: string,
  ): Promise<string | null> => {
    const qualified = quoteTableRef({ schema: schema ?? "public", name });
    if (objectType === "view" || objectType === "materializedView") {
      const rows = await queryRows(`SELECT pg_catalog.pg_get_viewdef($1::regclass, true) AS def`, [
        qualified,
      ]);
      const def = rows[0]?.def;
      return typeof def === "string" ? `CREATE VIEW ${qualified} AS\n${def}` : null;
    }
    if (objectType === "function" || objectType === "procedure") {
      const rows = await queryRows(
        `SELECT pg_catalog.pg_get_functiondef(p.oid) AS def
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = $1 AND p.proname = $2
         LIMIT 1`,
        [schema ?? "public", name],
      );
      const def = rows[0]?.def;
      return typeof def === "string" ? def : null;
    }
    if (objectType === "index") {
      const rows = await queryRows(`SELECT pg_catalog.pg_get_indexdef($1::regclass) AS def`, [
        qualified,
      ]);
      const def = rows[0]?.def;
      return typeof def === "string" ? def : null;
    }
    return null;
  };

  const getCompletionMetadata = async (): Promise<{
    defaultSchema: string | null;
    tables: SqlCompletionTable[];
  }> => {
    const [current] = await queryRows("SELECT current_schema() AS schema");
    const rows = await queryRows(
      `
      SELECT n.nspname AS schema, c.relname AS table_name,
             array_agg(a.attname ORDER BY a.attnum) AS columns
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE c.relkind IN ('r', 'v', 'm', 'p') AND n.nspname NOT LIKE 'pg\\_%'
        AND n.nspname <> 'information_schema'
      GROUP BY n.nspname, c.relname
      ORDER BY n.nspname, c.relname
      `,
    );
    return {
      defaultSchema: typeof current?.schema === "string" ? current.schema : null,
      tables: rows.map((row) => ({
        schema: String(row.schema),
        name: String(row.table_name),
        columns: Array.isArray(row.columns) ? row.columns.map(String) : [],
      })),
    };
  };

  const getTableIdentity = async (
    table: SqlTableRef,
  ): Promise<{ identity: SqlTableIdentity | null; columns: SqlColumnInfo[] }> => {
    const columns = await listColumns(table);
    const keyColumns = columns.filter((column) => column.isPrimaryKey).map((c) => c.name);
    if (keyColumns.length > 0) {
      return { identity: { kind: "primaryKey", keyColumns }, columns };
    }
    // Plain tables always have a ctid; views and foreign tables do not.
    const rows = await queryRows(
      `SELECT c.relkind FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = $2`,
      [table.schema ?? "public", table.name],
    );
    const relkind = rows[0]?.relkind;
    if (relkind === "r" || relkind === "p") {
      return { identity: { kind: "ctid", keyColumns: ["ctid"] }, columns };
    }
    return { identity: null, columns };
  };

  return {
    engine: "postgres",
    serverVersion,
    database: config.database,
    execute,
    cancel: async () => {
      activeQuery?.cancel();
    },
    close: async () => {
      await sql.end({ timeout: 2 });
    },
    getTreeChildren,
    getObjectDefinition,
    getCompletionMetadata,
    getTableIdentity,
  };
}
