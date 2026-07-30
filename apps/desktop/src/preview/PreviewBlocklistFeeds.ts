/**
 * Keeps the preview blocklist populated from public feeds.
 *
 * Fails open on purpose: a feed that is unreachable, rate-limited or malformed
 * must never stop you browsing. The worst case is the protection you would have
 * had without this file at all.
 */

import { parseHostsFeed, parseUrlFeed } from "./previewBlocklist.ts";

export interface PreviewBlocklistFeed {
  readonly url: string;
  readonly parse: (body: string) => ReadonlyArray<string>;
}

/** abuse.ch and OpenPhish both publish without an API key or attribution gate. */
export const DEFAULT_PREVIEW_BLOCKLIST_FEEDS: ReadonlyArray<PreviewBlocklistFeed> = [
  { url: "https://urlhaus.abuse.ch/downloads/hostfile/", parse: parseHostsFeed },
  { url: "https://openphish.com/feed.txt", parse: parseUrlFeed },
];

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;
/** A feed that suddenly returns something enormous is more likely broken. */
const MAX_HOSTS = 500_000;

export interface PreviewBlocklist {
  /** Hosts currently considered bad. Empty until the first refresh lands. */
  readonly hosts: () => ReadonlySet<string>;
  readonly refresh: () => Promise<void>;
  readonly dispose: () => void;
}

async function fetchFeed(feed: PreviewBlocklistFeed): Promise<ReadonlyArray<string>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(feed.url, { signal: controller.signal });
    if (!response.ok) return [];
    return feed.parse(await response.text());
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function createPreviewBlocklist(
  feeds: ReadonlyArray<PreviewBlocklistFeed> = DEFAULT_PREVIEW_BLOCKLIST_FEEDS,
): PreviewBlocklist {
  let hosts: ReadonlySet<string> = new Set();
  let timer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  const refresh = async () => {
    const results = await Promise.all(feeds.map((feed) => fetchFeed(feed)));
    if (disposed) return;
    const next = new Set<string>();
    for (const list of results) {
      for (const host of list) {
        if (next.size >= MAX_HOSTS) break;
        next.add(host);
      }
    }
    // Every feed failing leaves the previous list in place rather than
    // silently dropping protection.
    if (next.size === 0 && hosts.size > 0) return;
    hosts = next;
  };

  timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
  // Not awaited: startup must not wait on the network.
  void refresh();

  return {
    hosts: () => hosts,
    refresh,
    dispose: () => {
      disposed = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
