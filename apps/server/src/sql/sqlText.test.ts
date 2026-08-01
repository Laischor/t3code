import { describe, expect, it } from "vite-plus/test";

import {
  buildUpdateStatements,
  quoteIdentifier,
  quoteTableRef,
  splitSqlStatements,
} from "./sqlText.ts";

describe("splitSqlStatements", () => {
  it("splits on semicolons and trims", () => {
    expect(splitSqlStatements("SELECT 1; SELECT 2;")).toEqual([
      { sql: "SELECT 1", offset: 0 },
      { sql: "SELECT 2", offset: 10 },
    ]);
  });

  it("ignores semicolons inside single-quoted strings", () => {
    const statements = splitSqlStatements("SELECT 'a;b'; SELECT 2");
    expect(statements.map((s) => s.sql)).toEqual(["SELECT 'a;b'", "SELECT 2"]);
  });

  it("treats doubled quotes as escapes inside strings", () => {
    const statements = splitSqlStatements("SELECT 'it''s;fine'; SELECT 2");
    expect(statements.map((s) => s.sql)).toEqual(["SELECT 'it''s;fine'", "SELECT 2"]);
  });

  it("ignores semicolons in line and block comments", () => {
    const statements = splitSqlStatements("SELECT 1 -- no; split\n; SELECT /* a;b */ 2");
    expect(statements.map((s) => s.sql)).toEqual(["SELECT 1 -- no; split", "SELECT /* a;b */ 2"]);
  });

  it("ignores semicolons inside dollar-quoted bodies", () => {
    const script =
      "CREATE FUNCTION f() RETURNS void AS $fn$ BEGIN; END; $fn$ LANGUAGE plpgsql; SELECT 1";
    const statements = splitSqlStatements(script);
    expect(statements).toHaveLength(2);
    expect(statements[1]?.sql).toBe("SELECT 1");
  });

  it("drops empty trailing statements", () => {
    expect(splitSqlStatements("SELECT 1;  \n")).toHaveLength(1);
  });
});

describe("quoteIdentifier", () => {
  it("wraps in double quotes and doubles embedded quotes", () => {
    expect(quoteIdentifier("plain")).toBe('"plain"');
    expect(quoteIdentifier('we"ird')).toBe('"we""ird"');
  });

  it("qualifies table refs with schemas", () => {
    expect(quoteTableRef({ schema: "public", name: "users" })).toBe('"public"."users"');
    expect(quoteTableRef({ schema: null, name: "users" })).toBe('"users"');
  });
});

describe("buildUpdateStatements", () => {
  it("builds one parameterized update per edit with postgres placeholders", () => {
    const statements = buildUpdateStatements(
      { schema: "public", name: "users" },
      "primaryKey",
      [{ key: { id: 7 }, set: { name: "Ada", active: true } }],
      "postgres",
    );
    expect(statements).toEqual([
      {
        sql: 'UPDATE "public"."users" SET "name" = $1, "active" = $2 WHERE "id" = $3',
        params: ["Ada", true, 7],
      },
    ]);
  });

  it("uses question-mark placeholders for sqlite", () => {
    const statements = buildUpdateStatements(
      { schema: null, name: "users" },
      "rowid",
      [{ key: { rowid: 3 }, set: { name: "Bob" } }],
      "sqlite",
    );
    expect(statements).toEqual([
      { sql: 'UPDATE "users" SET "name" = ? WHERE "rowid" = ?', params: ["Bob", 3] },
    ]);
  });

  it("casts ctid identity parameters", () => {
    const statements = buildUpdateStatements(
      { schema: "public", name: "log" },
      "ctid",
      [{ key: { ctid: "(0,1)" }, set: { level: "warn" } }],
      "postgres",
    );
    expect(statements[0]?.sql).toBe(
      'UPDATE "public"."log" SET "level" = $1 WHERE "ctid" = $2::tid',
    );
  });

  it("matches NULL key values with IS NULL instead of equality", () => {
    const statements = buildUpdateStatements(
      { schema: null, name: "t" },
      "primaryKey",
      [{ key: { a: 1, b: null }, set: { c: "x" } }],
      "postgres",
    );
    expect(statements[0]?.sql).toBe('UPDATE "t" SET "c" = $1 WHERE "a" = $2 AND "b" IS NULL');
    expect(statements[0]?.params).toEqual(["x", 1]);
  });
});
