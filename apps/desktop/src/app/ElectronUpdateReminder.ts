/**
 * Startup reminder when the bundled Electron has fallen behind.
 *
 * A notification rather than a dialog: this is information, not a decision, and
 * nothing here can perform the update — the fork is rebuilt by hand.
 *
 * Fails silently. A missing network, a rate-limited registry or a shape the
 * parser does not recognise must never delay or interrupt startup.
 */

import { Notification } from "electron";

import { resolveElectronUpdateNotice, updateNoticeBody } from "./electronUpdateCheck.ts";

const REGISTRY_URL = "https://registry.npmjs.org/electron/latest";
const FETCH_TIMEOUT_MS = 10_000;
/** Long enough to stay out of the way of the first window. */
const START_DELAY_MS = 15_000;

async function fetchLatestVersion(): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(REGISTRY_URL, { signal: controller.signal });
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return undefined;
    const version = (body as { version?: unknown }).version;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function check(currentVersion: string | undefined): Promise<void> {
  const notice = resolveElectronUpdateNotice(currentVersion, await fetchLatestVersion());
  if (!notice || !Notification.isSupported()) return;
  new Notification({
    title: "Electron update available",
    body: updateNoticeBody(notice),
    silent: true,
  }).show();
}

/** Schedules one check for this run. Returns a cancel function. */
export function scheduleElectronUpdateReminder(
  currentVersion: string | undefined = process.versions.electron,
): () => void {
  const timer = setTimeout(() => void check(currentVersion), START_DELAY_MS);
  // Do not hold the process open for a reminder.
  timer.unref?.();
  return () => clearTimeout(timer);
}
