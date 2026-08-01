/**
 * Pure helpers turning grid cell edits into sql.updateRows payloads and
 * deciding when a result set is editable.
 */

import type {
  SqlColumnDescriptor,
  SqlGetTableIdentityResult,
  SqlScalar,
  SqlTableRef,
} from "@t3tools/contracts";

export interface SqlGridSource {
  /** Table backing the grid; null for arbitrary query results (read-only). */
  readonly table: SqlTableRef | null;
}

export interface SqlCellEdit {
  readonly rowIndex: number;
  readonly column: string;
  readonly value: SqlScalar;
}

export interface SqlEditContext {
  readonly table: SqlTableRef;
  readonly identity: NonNullable<SqlGetTableIdentityResult["identity"]>;
}

/**
 * A grid is editable when it shows a whole table and every identity column is
 * part of the selected column set (so key values are present in the rows).
 */
export function resolveEditContext(
  source: SqlGridSource,
  identityResult: SqlGetTableIdentityResult | null,
  columns: ReadonlyArray<SqlColumnDescriptor>,
): SqlEditContext | null {
  if (source.table === null || identityResult === null || identityResult.identity === null) {
    return null;
  }
  const present = new Set(columns.map((column) => column.name));
  if (!identityResult.identity.keyColumns.every((column) => present.has(column))) {
    return null;
  }
  return { table: source.table, identity: identityResult.identity };
}

export interface SqlRowEditPayload {
  readonly key: Record<string, SqlScalar>;
  readonly set: Record<string, SqlScalar>;
}

/**
 * Group per-cell edits into one entry per row, keyed by the identity columns
 * of the ORIGINAL row values (edits must not shift the key used to find them).
 */
export function buildRowEdits(
  edits: ReadonlyArray<SqlCellEdit>,
  rows: ReadonlyArray<ReadonlyArray<SqlScalar>>,
  columns: ReadonlyArray<SqlColumnDescriptor>,
  keyColumns: ReadonlyArray<string>,
): SqlRowEditPayload[] {
  const columnIndex = new Map(columns.map((column, index) => [column.name, index]));
  const byRow = new Map<number, Record<string, SqlScalar>>();
  for (const edit of edits) {
    const existing = byRow.get(edit.rowIndex) ?? {};
    existing[edit.column] = edit.value;
    byRow.set(edit.rowIndex, existing);
  }
  const payloads: SqlRowEditPayload[] = [];
  for (const [rowIndex, set] of byRow) {
    const row = rows[rowIndex];
    if (row === undefined) continue;
    const key: Record<string, SqlScalar> = {};
    for (const keyColumn of keyColumns) {
      const index = columnIndex.get(keyColumn);
      if (index === undefined) return [];
      key[keyColumn] = row[index] ?? null;
    }
    payloads.push({ key, set });
  }
  return payloads;
}

/** Parse the text a user typed in a cell into a wire scalar. */
export function parseCellInput(raw: string, previous: SqlScalar): SqlScalar {
  if (raw === "") return typeof previous === "string" ? "" : null;
  if (typeof previous === "number") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : raw;
  }
  if (typeof previous === "boolean") {
    if (/^(true|1|t|yes)$/i.test(raw)) return true;
    if (/^(false|0|f|no)$/i.test(raw)) return false;
    return raw;
  }
  return raw;
}

export function formatCellValue(value: SqlScalar): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}
