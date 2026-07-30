import { describe, expect, it } from "vite-plus/test";

import {
  blockedHostFor,
  isBlockedHost,
  normalizeHost,
  parseHostsFeed,
  parseUrlFeed,
  shouldCheckUrl,
} from "./previewBlocklist.ts";

describe("parseHostsFeed", () => {
  it("reads the host column and skips comments and blanks", () => {
    expect(
      parseHostsFeed(
        ["# banner", "", "0.0.0.0 evil.example", "0.0.0.0 bad.example # inline", "   "].join("\n"),
      ),
    ).toEqual(["evil.example", "bad.example"]);
  });

  it("accepts bare hosts as well as ip-prefixed lines", () => {
    expect(parseHostsFeed("evil.example\n0.0.0.0 other.example")).toEqual([
      "evil.example",
      "other.example",
    ]);
  });

  it("never yields the null-route address itself", () => {
    expect(parseHostsFeed("0.0.0.0\n127.0.0.1")).toEqual([]);
  });
});

describe("parseUrlFeed", () => {
  it("keeps only the host of each URL", () => {
    expect(parseUrlFeed("https://evil.example/login?a=1\nhttp://bad.example/x")).toEqual([
      "evil.example",
      "bad.example",
    ]);
  });

  it("ignores lines that are not URLs", () => {
    expect(parseUrlFeed("# note\nnot a url\nhttps://evil.example/")).toEqual(["evil.example"]);
  });
});

describe("normalizeHost", () => {
  it("lowercases, strips a root dot and a www prefix", () => {
    expect(normalizeHost("WWW.Evil.Example.")).toBe("evil.example");
  });

  it("rejects things that are not hostnames", () => {
    expect(normalizeHost(undefined)).toBeNull();
    expect(normalizeHost("")).toBeNull();
    expect(normalizeHost("localhost")).toBeNull();
    expect(normalizeHost("0.0.0.0")).toBeNull();
    expect(normalizeHost("evil example.com")).toBeNull();
  });
});

describe("isBlockedHost", () => {
  const blocked = new Set(["evil.example", "phish.co.uk"]);

  it("matches the host itself, case and www insensitively", () => {
    expect(isBlockedHost(blocked, "evil.example")).toBe(true);
    expect(isBlockedHost(blocked, "EVIL.example")).toBe(true);
    expect(isBlockedHost(blocked, "www.evil.example")).toBe(true);
  });

  it("matches subdomains of a listed host", () => {
    expect(isBlockedHost(blocked, "login.evil.example")).toBe(true);
    expect(isBlockedHost(blocked, "a.b.c.evil.example")).toBe(true);
  });

  it("does not match unrelated hosts", () => {
    expect(isBlockedHost(blocked, "example.com")).toBe(false);
    expect(isBlockedHost(blocked, "notevil.example")).toBe(false);
    // A suffix that is not on a label boundary must not match.
    expect(isBlockedHost(blocked, "myevil.example")).toBe(false);
  });

  it("never blocks a whole TLD by walking up too far", () => {
    expect(isBlockedHost(new Set(["example"]), "safe.example")).toBe(false);
    expect(isBlockedHost(new Set(["uk"]), "phish.co.uk")).toBe(false);
  });
});

describe("shouldCheckUrl", () => {
  it("checks http and https only", () => {
    expect(shouldCheckUrl("https://example.com")).toBe(true);
    expect(shouldCheckUrl("http://example.com")).toBe(true);
    expect(shouldCheckUrl("about:blank")).toBe(false);
    expect(shouldCheckUrl("data:text/html,x")).toBe(false);
    expect(shouldCheckUrl("file:///etc/passwd")).toBe(false);
    expect(shouldCheckUrl("nonsense")).toBe(false);
  });
});

describe("blockedHostFor", () => {
  const blocked = new Set(["evil.example"]);

  it("reports which host caused the block", () => {
    expect(blockedHostFor(blocked, "https://login.evil.example/x")).toBe("login.evil.example");
    expect(blockedHostFor(blocked, "https://good.example/")).toBeNull();
  });

  it("leaves non-http schemes alone even when the host is listed", () => {
    expect(blockedHostFor(blocked, "ftp://evil.example/")).toBeNull();
  });
});
