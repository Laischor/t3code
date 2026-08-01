import type { SqlScalar, SqlTableIdentityKind, SqlTableRef } from "@t3tools/contracts";

/**
 * Split a SQL script into individual statements. Handles single/double quoted
 * strings, line and block comments, and PostgreSQL dollar-quoted strings.
 * Known limitation: SQLite `CREATE TRIGGER … BEGIN …; …; END` bodies are split
 * at inner semicolons; run such DDL as a single statement.
 */
export interface SqlStatement {
  readonly sql: string;
  /** 0-based character offset of the statement inside the original script. */
  readonly offset: number;
}

export function splitSqlStatements(script: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let start = 0;
  let index = 0;
  const length = script.length;

  const push = (end: number) => {
    const sql = script.slice(start, end);
    if (sql.trim().length > 0) {
      const leading = sql.length - sql.trimStart().length;
      statements.push({ sql: sql.trim(), offset: start + leading });
    }
    start = end + 1;
  };

  while (index < length) {
    const char = script[index];
    if (char === "'" || char === '"') {
      const quote = char;
      index += 1;
      while (index < length) {
        if (script[index] === quote) {
          // Doubled quote is an escaped quote inside the literal.
          if (script[index + 1] === quote) {
            index += 2;
            continue;
          }
          break;
        }
        index += 1;
      }
      index += 1;
      continue;
    }
    if (char === "-" && script[index + 1] === "-") {
      const newline = script.indexOf("\n", index);
      index = newline === -1 ? length : newline + 1;
      continue;
    }
    if (char === "/" && script[index + 1] === "*") {
      const close = script.indexOf("*/", index + 2);
      index = close === -1 ? length : close + 2;
      continue;
    }
    if (char === "$") {
      const match = /^\$[A-Za-z_]?[A-Za-z0-9_]*\$/.exec(script.slice(index));
      if (match !== null) {
        const tag = match[0];
        const close = script.indexOf(tag, index + tag.length);
        index = close === -1 ? length : close + tag.length;
        continue;
      }
    }
    if (char === ";") {
      push(index);
      index += 1;
      continue;
    }
    index += 1;
  }
  push(length);
  return statements;
}

/** Quote an identifier for PostgreSQL and SQLite (double quotes, doubled inside). */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function quoteTableRef(table: SqlTableRef): string {
  return table.schema === null
    ? quoteIdentifier(table.name)
    : `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`;
}

export interface SqlUpdateStatement {
  readonly sql: string;
  readonly params: ReadonlyArray<SqlScalar>;
}

export type SqlParamStyle = "postgres" | "sqlite";

export interface SqlRowEditInput {
  readonly key: Readonly<Record<string, SqlScalar>>;
  readonly set: Readonly<Record<string, SqlScalar>>;
}

/**
 * Build one parameterized UPDATE per edit. Identifiers are quoted here; values
 * always travel as bound parameters. The ctid identity column gets an explicit
 * ::tid cast because PostgreSQL cannot infer the type of a bare parameter there.
 */
export function buildUpdateStatements(
  table: SqlTableRef,
  identityKind: SqlTableIdentityKind,
  edits: ReadonlyArray<SqlRowEditInput>,
  paramStyle: SqlParamStyle,
): SqlUpdateStatement[] {
  return edits.map((edit) => {
    const params: SqlScalar[] = [];
    const placeholder = (value: SqlScalar): string => {
      params.push(value);
      return paramStyle === "postgres" ? `$${params.length}` : "?";
    };
    const assignments = Object.entries(edit.set).map(
      ([column, value]) => `${quoteIdentifier(column)} = ${placeholder(value)}`,
    );
    const conditions = Object.entries(edit.key).map(([column, value]) => {
      if (value === null) {
        return `${quoteIdentifier(column)} IS NULL`;
      }
      const bound = placeholder(value);
      const cast = identityKind === "ctid" && column === "ctid" ? "::tid" : "";
      return `${quoteIdentifier(column)} = ${bound}${cast}`;
    });
    const sql = `UPDATE ${quoteTableRef(table)} SET ${assignments.join(", ")} WHERE ${conditions.join(" AND ")}`;
    return { sql, params };
  });
}
