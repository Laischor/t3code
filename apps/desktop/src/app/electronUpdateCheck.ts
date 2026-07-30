/**
 * Notices when the bundled Electron — and with it Chromium — has fallen behind.
 *
 * This fork is built by hand, so nothing updates itself. Chromium security
 * fixes only arrive when someone reinstalls and rebuilds, and the gap is
 * invisible from inside the running app. A reminder is the cheapest way to keep
 * that from quietly stretching to months.
 *
 * Electron-free so the comparison can be unit-tested.
 */

export interface SemverParts {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export function parseVersion(value: string | undefined): SemverParts | null {
  if (!value) return null;
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/** Positive when `left` is newer, negative when older, 0 when equal. */
export function compareVersions(left: SemverParts, right: SemverParts): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

export interface ElectronUpdateNotice {
  readonly current: string;
  readonly latest: string;
  /** Majors behind; each one is roughly a Chromium major of security fixes. */
  readonly majorsBehind: number;
}

/**
 * Returns what to tell the user, or null when up to date or undecidable.
 *
 * Undecidable counts as up to date on purpose: a garbled registry response must
 * not produce a nagging notification.
 */
export function resolveElectronUpdateNotice(
  currentVersion: string | undefined,
  latestVersion: string | undefined,
): ElectronUpdateNotice | null {
  const current = parseVersion(currentVersion);
  const latest = parseVersion(latestVersion);
  if (!current || !latest) return null;
  if (compareVersions(latest, current) <= 0) return null;
  return {
    current: `${current.major}.${current.minor}.${current.patch}`,
    latest: `${latest.major}.${latest.minor}.${latest.patch}`,
    majorsBehind: Math.max(0, latest.major - current.major),
  };
}

export function updateNoticeBody(notice: ElectronUpdateNotice): string {
  const version = `Electron ${notice.latest} is out; this build runs ${notice.current}.`;
  if (notice.majorsBehind <= 0) {
    return `${version} Reinstall and rebuild to pick up the fixes.`;
  }
  const majors = notice.majorsBehind === 1 ? "1 major" : `${notice.majorsBehind} majors`;
  return `${version} That is ${majors} of Chromium security fixes — reinstall and rebuild.`;
}
