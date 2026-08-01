import { describe, expect, it } from "vite-plus/test";

import { lookupPgPass, parsePgPass } from "./pgpass.ts";

const target = { host: "localhost", port: 5432, database: "app", user: "postgres" };

describe("parsePgPass", () => {
  it("parses entries and skips comments and blank lines", () => {
    const entries = parsePgPass(
      ["# comment", "", "localhost:5432:app:postgres:secret", "  # indented comment"].join("\n"),
    );
    expect(entries).toEqual([
      { host: "localhost", port: "5432", database: "app", user: "postgres", password: "secret" },
    ]);
  });

  it("unescapes backslash-escaped colons and backslashes", () => {
    const entries = parsePgPass(String.raw`localhost:5432:a\:b:user:p\\a\:ss`);
    expect(entries).toEqual([
      {
        host: "localhost",
        port: "5432",
        database: "a:b",
        user: "user",
        password: String.raw`p\a:ss`,
      },
    ]);
  });

  it("ignores malformed lines", () => {
    expect(parsePgPass("only:three:fields")).toEqual([]);
  });
});

describe("lookupPgPass", () => {
  it("matches exact entries", () => {
    const entries = parsePgPass("localhost:5432:app:postgres:secret");
    expect(lookupPgPass(entries, target)).toBe("secret");
  });

  it("honors wildcards in any field", () => {
    const entries = parsePgPass("*:*:*:postgres:wild");
    expect(lookupPgPass(entries, target)).toBe("wild");
  });

  it("returns the first matching entry", () => {
    const entries = parsePgPass(["localhost:5432:app:postgres:first", "*:*:*:*:second"].join("\n"));
    expect(lookupPgPass(entries, target)).toBe("first");
  });

  it("returns null when nothing matches", () => {
    const entries = parsePgPass("otherhost:5432:app:postgres:nope");
    expect(lookupPgPass(entries, target)).toBeNull();
  });
});
