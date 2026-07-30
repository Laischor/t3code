/**
 * Local phishing/malware blocklist for preview navigation.
 *
 * Electron ships no Safe Browsing — Chromium's service is not wired into
 * Electron builds and there is no API to switch it on — so known-bad hosts are
 * matched against lists fetched from public feeds instead.
 *
 * Weaker than Google's Safe Browsing by design: it catches known campaigns, not
 * a phishing page registered an hour ago. In exchange no URL ever leaves the
 * machine, which the Lookup API cannot say.
 *
 * Electron-free so it can be unit-tested.
 */

/** Hosts format: `0.0.0.0 evil.example` — used by URLhaus. */
export function parseHostsFeed(body: string): ReadonlyArray<string> {
  const hosts: string[] = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.split("#")[0]?.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    // Either "<ip> <host>" or a bare host per line.
    const candidate = parts.length >= 2 ? parts[1] : parts[0];
    const host = normalizeHost(candidate);
    if (host) hosts.push(host);
  }
  return hosts;
}

/** Plain URL-per-line feeds, e.g. OpenPhish. Only the host is kept. */
export function parseUrlFeed(body: string): ReadonlyArray<string> {
  const hosts: string[] = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    try {
      const host = normalizeHost(new URL(line).hostname);
      if (host) hosts.push(host);
    } catch {
      // Not a URL; feeds occasionally carry banner lines.
    }
  }
  return hosts;
}

export function normalizeHost(value: string | undefined): string | null {
  if (!value) return null;
  let host = value.trim().toLowerCase();
  if (host.length === 0) return null;
  // Strip a trailing root dot and any leading "www.", so one entry covers both.
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.startsWith("www.")) host = host.slice(4);
  // Reject entries that are clearly not hostnames, including the null-route
  // addresses that hosts files start every line with.
  if (host.length === 0 || !host.includes(".")) return null;
  if (host === "0.0.0.0" || host === "127.0.0.1" || host === "::1") return null;
  if (/\s/.test(host)) return null;
  return host;
}

/**
 * True when `hostname` is listed, or is a subdomain of a listed host.
 *
 * Matching parent domains means one entry for `evil.example` also covers
 * `login.evil.example`, which is how these campaigns are usually served.
 */
export function isBlockedHost(blocked: ReadonlySet<string>, hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (!host) return false;
  if (blocked.has(host)) return true;
  let rest = host;
  for (;;) {
    const dot = rest.indexOf(".");
    if (dot < 0) return false;
    rest = rest.slice(dot + 1);
    // A bare TLD can never be a meaningful entry; stop before matching one.
    if (!rest.includes(".")) return false;
    if (blocked.has(rest)) return true;
  }
}

/** Only http(s) navigations are checked; everything else is left alone. */
export function shouldCheckUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function blockedHostFor(blocked: ReadonlySet<string>, url: string): string | null {
  if (!shouldCheckUrl(url)) return null;
  try {
    const { hostname } = new URL(url);
    return isBlockedHost(blocked, hostname) ? normalizeHost(hostname) : null;
  } catch {
    return null;
  }
}
