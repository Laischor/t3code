import { describe, expect, it } from "vite-plus/test";

import {
  classifyPreviewPermission,
  permissionDecisionKey,
  permissionOrigin,
  permissionPromptMessage,
} from "./previewPermissions.ts";

describe("classifyPreviewPermission", () => {
  it("asks before revealing anything about the user", () => {
    expect(classifyPreviewPermission("clipboard-read")).toBe("ask");
    expect(classifyPreviewPermission("geolocation")).toBe("ask");
    expect(classifyPreviewPermission("notifications")).toBe("ask");
  });

  it("still allows clipboard writes, which Copy buttons depend on", () => {
    expect(classifyPreviewPermission("clipboard-sanitized-write")).toBe("allow");
  });

  it("denies everything else without asking", () => {
    expect(classifyPreviewPermission("media")).toBe("deny");
    expect(classifyPreviewPermission("midi")).toBe("deny");
    expect(classifyPreviewPermission("openExternal")).toBe("deny");
    expect(classifyPreviewPermission("")).toBe("deny");
  });
});

describe("permissionOrigin", () => {
  it("reduces a URL to its origin", () => {
    expect(permissionOrigin("https://example.com/a/b?c=1")).toBe("https://example.com");
    expect(permissionOrigin("http://localhost:3000/x")).toBe("http://localhost:3000");
  });

  it("separates ports and schemes", () => {
    expect(permissionOrigin("https://example.com:8443/")).toBe("https://example.com:8443");
    expect(permissionOrigin("http://example.com/")).not.toBe(
      permissionOrigin("https://example.com/"),
    );
  });

  it("refuses URLs with no grantable identity", () => {
    expect(permissionOrigin(undefined)).toBeNull();
    expect(permissionOrigin("")).toBeNull();
    expect(permissionOrigin("not a url")).toBeNull();
    // Opaque origins must never accumulate grants.
    expect(permissionOrigin("data:text/html,<p>hi</p>")).toBeNull();
  });
});

describe("permissionDecisionKey", () => {
  it("keeps partitions, origins and permissions apart", () => {
    const key = permissionDecisionKey("persist:a", "https://example.com", "geolocation");
    expect(key).not.toBe(permissionDecisionKey("persist:b", "https://example.com", "geolocation"));
    expect(key).not.toBe(permissionDecisionKey("persist:a", "https://evil.com", "geolocation"));
    expect(key).not.toBe(
      permissionDecisionKey("persist:a", "https://example.com", "clipboard-read"),
    );
  });
});

describe("permissionPromptMessage", () => {
  it("names the origin and what is being asked for", () => {
    expect(permissionPromptMessage("https://example.com", "clipboard-read")).toContain(
      "https://example.com",
    );
    expect(permissionPromptMessage("https://example.com", "clipboard-read")).toContain("clipboard");
    expect(permissionPromptMessage("https://example.com", "geolocation")).toContain("location");
  });

  it("falls back to naming an unknown permission", () => {
    expect(permissionPromptMessage("https://example.com", "midi")).toContain("midi");
  });
});
