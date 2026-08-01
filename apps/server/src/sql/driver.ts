import type {
  SqlColumnDescriptor,
  SqlColumnInfo,
  SqlCompletionTable,
  SqlObjectType,
  SqlScalar,
  SqlTableIdentityKind,
  SqlTableRef,
  SqlTreeNode,
  SqlTreeNodeRef,
} from "@t3tools/contracts";

export interface SqlDriverResult {
  readonly columns: ReadonlyArray<SqlColumnDescriptor>;
  readonly rows: ReadonlyArray<ReadonlyArray<SqlScalar>>;
  readonly command: string | null;
  readonly rowCount: number | null;
  readonly truncated: boolean;
}

export interface SqlTableIdentity {
  readonly kind: SqlTableIdentityKind;
  readonly keyColumns: ReadonlyArray<string>;
}

/**
 * A live database session. Promise-based on purpose: implementations wrap raw
 * drivers (porsager postgres, node:sqlite) and are lifted into Effect by the
 * SqlIdeService.
 */
export interface SqlIdeDriver {
  readonly engine: "postgres" | "sqlite";
  readonly serverVersion: string | null;
  readonly database: string | null;
  execute(sql: string, params: ReadonlyArray<SqlScalar>, maxRows: number): Promise<SqlDriverResult>;
  /** Cancel the in-flight query, if the engine supports it. */
  cancel(): Promise<void>;
  close(): Promise<void>;
  getTreeChildren(
    node: SqlTreeNodeRef,
  ): Promise<{ children: SqlTreeNode[]; columns: SqlColumnInfo[] | null }>;
  getObjectDefinition(
    schema: string | null,
    objectType: SqlObjectType,
    name: string,
  ): Promise<string | null>;
  getCompletionMetadata(): Promise<{
    defaultSchema: string | null;
    tables: SqlCompletionTable[];
  }>;
  getTableIdentity(
    table: SqlTableRef,
  ): Promise<{ identity: SqlTableIdentity | null; columns: SqlColumnInfo[] }>;
}

/** Convert an arbitrary driver value into a wire-safe scalar. */
export function toSqlScalar(value: unknown): SqlScalar {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `\\x${Buffer.from(value).toString("hex")}`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Derive a command tag ("SELECT", "UPDATE", …) from the statement text. */
export function commandTagFromSql(sql: string): string | null {
  const match = /^[\s(]*([A-Za-z]+)/.exec(sql);
  return match === null ? null : (match[1] ?? "").toUpperCase() || null;
}
