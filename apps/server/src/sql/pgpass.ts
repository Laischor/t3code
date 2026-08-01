/**
 * Parser for PostgreSQL password files (~/.pgpass).
 * Format: host:port:database:user:password — one entry per line, `*` wildcards,
 * `\` escapes `:` and `\` inside fields. See
 * https://www.postgresql.org/docs/current/libpq-pgpass.html
 */

export interface PgPassEntry {
  readonly host: string;
  readonly port: string;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

function splitPgPassLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let escaped = false;
  for (const char of line) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === ":") {
      fields.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  fields.push(current);
  return fields;
}

export function parsePgPass(contents: string): PgPassEntry[] {
  const entries: PgPassEntry[] = [];
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.length === 0 || line.trimStart().startsWith("#")) continue;
    const fields = splitPgPassLine(line);
    if (fields.length !== 5) continue;
    const [host, port, database, user, password] = fields as [
      string,
      string,
      string,
      string,
      string,
    ];
    entries.push({ host, port, database, user, password });
  }
  return entries;
}

const matches = (pattern: string, value: string): boolean => pattern === "*" || pattern === value;

export function lookupPgPass(
  entries: ReadonlyArray<PgPassEntry>,
  target: {
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly user: string;
  },
): string | null {
  for (const entry of entries) {
    if (
      matches(entry.host, target.host) &&
      matches(entry.port, String(target.port)) &&
      matches(entry.database, target.database) &&
      matches(entry.user, target.user)
    ) {
      return entry.password;
    }
  }
  return null;
}
