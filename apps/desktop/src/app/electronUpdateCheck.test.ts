import { describe, expect, it } from "vite-plus/test";

import {
  compareVersions,
  parseVersion,
  resolveElectronUpdateNotice,
  updateNoticeBody,
} from "./electronUpdateCheck.ts";

describe("parseVersion", () => {
  it("reads a plain semver", () => {
    expect(parseVersion("43.2.0")).toEqual({ major: 43, minor: 2, patch: 0 });
  });

  it("ignores prerelease and build suffixes", () => {
    expect(parseVersion("44.0.0-beta.3")).toEqual({ major: 44, minor: 0, patch: 0 });
  });

  it("rejects anything else", () => {
    expect(parseVersion(undefined)).toBeNull();
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("latest")).toBeNull();
    expect(parseVersion("43.2")).toBeNull();
  });
});

describe("compareVersions", () => {
  const v = (major: number, minor: number, patch: number) => ({ major, minor, patch });

  it("orders by major, then minor, then patch", () => {
    expect(compareVersions(v(44, 0, 0), v(43, 9, 9))).toBeGreaterThan(0);
    expect(compareVersions(v(43, 3, 0), v(43, 2, 9))).toBeGreaterThan(0);
    expect(compareVersions(v(43, 2, 1), v(43, 2, 0))).toBeGreaterThan(0);
    expect(compareVersions(v(43, 2, 0), v(43, 2, 0))).toBe(0);
  });

  it("compares numerically, not as strings", () => {
    // "9" > "10" as text; as versions it is not.
    expect(compareVersions(v(9, 0, 0), v(10, 0, 0))).toBeLessThan(0);
  });
});

describe("resolveElectronUpdateNotice", () => {
  it("reports how far behind the build is", () => {
    expect(resolveElectronUpdateNotice("41.5.0", "43.2.0")).toEqual({
      current: "41.5.0",
      latest: "43.2.0",
      majorsBehind: 2,
    });
  });

  it("still reports a patch-level gap, with no majors", () => {
    expect(resolveElectronUpdateNotice("43.2.0", "43.2.4")?.majorsBehind).toBe(0);
  });

  it("says nothing when current or newer", () => {
    expect(resolveElectronUpdateNotice("43.2.0", "43.2.0")).toBeNull();
    expect(resolveElectronUpdateNotice("44.0.0", "43.2.0")).toBeNull();
  });

  it("stays quiet rather than nagging on unusable input", () => {
    expect(resolveElectronUpdateNotice(undefined, "43.2.0")).toBeNull();
    expect(resolveElectronUpdateNotice("43.2.0", undefined)).toBeNull();
    expect(resolveElectronUpdateNotice("43.2.0", "not a version")).toBeNull();
  });
});

describe("updateNoticeBody", () => {
  it("names both versions and the gap", () => {
    const body = updateNoticeBody({ current: "41.5.0", latest: "43.2.0", majorsBehind: 2 });
    expect(body).toContain("41.5.0");
    expect(body).toContain("43.2.0");
    expect(body).toContain("2 majors");
  });

  it("uses the singular for one major", () => {
    expect(updateNoticeBody({ current: "42.0.0", latest: "43.0.0", majorsBehind: 1 })).toContain(
      "1 major",
    );
  });

  it("drops the majors clause when there is none", () => {
    const body = updateNoticeBody({ current: "43.2.0", latest: "43.2.4", majorsBehind: 0 });
    expect(body).not.toContain("major");
  });
});
