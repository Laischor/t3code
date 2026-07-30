import type { Session } from "electron";
import { dialog, session, webContents } from "electron";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as SynchronizedRef from "effect/SynchronizedRef";

import { createPreviewBlocklist } from "./PreviewBlocklistFeeds.ts";
import { blockedHostFor } from "./previewBlocklist.ts";
import {
  classifyPreviewPermission,
  permissionDecisionKey,
  permissionOrigin,
  permissionPromptMessage,
} from "./previewPermissions.ts";

const PREVIEW_PARTITION_PREFIX = "persist:t3code-preview-";

/**
 * Remembered permission answers, keyed by partition + origin + permission.
 *
 * Kept for the run of the app rather than persisted: a wrong "allow" should not
 * outlive a restart, and the prompt is cheap to answer again.
 */
const permissionDecisions = new Map<string, boolean>();

/**
 * Electron ships no Safe Browsing, so known-bad hosts are matched locally.
 * One list for the whole app; sessions only consult it.
 */
const blocklist = createPreviewBlocklist();

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function blockedPageUrl(url: string, host: string): string {
  const page = `<!doctype html>
<meta charset="utf-8">
<title>Blocked</title>
<style>
  :root { color-scheme: dark light; }
  body { font: 14px/1.6 system-ui, sans-serif; margin: 0; display: grid;
         place-items: center; height: 100vh; background: #1b1b1f; color: #e8e8ea; }
  main { max-width: 34rem; padding: 2rem; }
  h1 { font-size: 1.1rem; margin: 0 0 .75rem; }
  code { background: #ffffff14; padding: .1rem .35rem; border-radius: .25rem;
         word-break: break-all; }
  p { color: #b9b9c0; }
</style>
<main>
  <h1>This site is on a known phishing or malware list</h1>
  <p><code>${escapeHtml(host)}</code> appears in a public blocklist, so the page was not loaded.</p>
  <p>Full address: <code>${escapeHtml(url)}</code></p>
  <p>Lists come from abuse.ch and OpenPhish and are matched on this machine — no
     address is sent anywhere. They can be wrong or out of date.</p>
</main>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(page)}`;
}

/**
 * The permission *check* handler is synchronous, so it can only answer from
 * what has already been decided. Unknown means not granted — which is the
 * correct answer for `navigator.permissions.query()` before any prompt.
 */
function answerPermissionCheck(partition: string, requestingUrl: string, permission: string) {
  const policy = classifyPreviewPermission(permission);
  if (policy !== "ask") return policy === "allow";
  const origin = permissionOrigin(requestingUrl);
  if (!origin) return false;
  return permissionDecisions.get(permissionDecisionKey(partition, origin, permission)) ?? false;
}

export class BrowserSessionPartitionDerivationError extends Schema.TaggedErrorClass<BrowserSessionPartitionDerivationError>()(
  "BrowserSessionPartitionDerivationError",
  {
    scope: Schema.String,
    cause: Schema.instanceOf(PlatformError.PlatformError),
  },
) {
  override get message(): string {
    return `Failed to derive a desktop preview browser partition for scope ${this.scope}.`;
  }
}

export class BrowserSessionCreationError extends Schema.TaggedErrorClass<BrowserSessionCreationError>()(
  "BrowserSessionCreationError",
  {
    scope: Schema.String,
    partition: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to create a desktop preview browser session for scope ${this.scope} (partition ${this.partition}).`;
  }
}

export class BrowserSessionStorageClearError extends Schema.TaggedErrorClass<BrowserSessionStorageClearError>()(
  "BrowserSessionStorageClearError",
  {
    partition: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to clear desktop preview browser storage for partition ${this.partition}.`;
  }
}

export class BrowserSessionCacheClearError extends Schema.TaggedErrorClass<BrowserSessionCacheClearError>()(
  "BrowserSessionCacheClearError",
  {
    partition: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to clear the desktop preview browser cache for partition ${this.partition}.`;
  }
}

export const BrowserSessionGetSessionError = Schema.Union([
  BrowserSessionPartitionDerivationError,
  BrowserSessionCreationError,
]);
export type BrowserSessionGetSessionError = typeof BrowserSessionGetSessionError.Type;
export const isBrowserSessionGetSessionError = Schema.is(BrowserSessionGetSessionError);

export const BrowserSessionError = Schema.Union([
  BrowserSessionPartitionDerivationError,
  BrowserSessionCreationError,
  BrowserSessionStorageClearError,
  BrowserSessionCacheClearError,
]);
export type BrowserSessionError = typeof BrowserSessionError.Type;
export const isBrowserSessionError = Schema.is(BrowserSessionError);

export class BrowserSession extends Context.Service<
  BrowserSession,
  {
    readonly getPartition: (
      scope?: string,
    ) => Effect.Effect<string, BrowserSessionPartitionDerivationError>;
    readonly isPartition: (partition: string) => boolean;
    readonly getSession: (scope?: string) => Effect.Effect<Session, BrowserSessionGetSessionError>;
    readonly clearCookies: () => Effect.Effect<void, BrowserSessionStorageClearError>;
    readonly clearCache: () => Effect.Effect<void, BrowserSessionCacheClearError>;
  }
>()("@t3tools/desktop/preview/BrowserSession") {}

export const make = Effect.gen(function* BrowserSessionMake() {
  const crypto = yield* Crypto.Crypto;
  const sessionsRef = yield* SynchronizedRef.make<ReadonlyMap<string, Session>>(new Map());

  const getPartition = Effect.fn("BrowserSession.getPartition")(function* (scope = "shared") {
    const digest = yield* crypto.digest("SHA-256", new TextEncoder().encode(scope)).pipe(
      Effect.mapError(
        (cause) =>
          new BrowserSessionPartitionDerivationError({
            scope,
            cause,
          }),
      ),
    );
    return `${PREVIEW_PARTITION_PREFIX}${Encoding.encodeHex(digest).slice(0, 20)}`;
  });

  const getSession = Effect.fn("BrowserSession.getSession")(function* (scope = "shared") {
    const partition = yield* getPartition(scope);
    return yield* SynchronizedRef.modifyEffect(sessionsRef, (sessions) => {
      const existing = sessions.get(partition);
      if (existing) return Effect.succeed([existing, sessions] as const);
      return Effect.try({
        try: () => {
          const browserSession = session.fromPartition(partition);
          const userAgent = browserSession
            .getUserAgent()
            .replace(/Electron\/[\d.]+ /, "")
            .replace(/\s*t3code\/[\d.]+/, "");
          browserSession.setUserAgent(userAgent);
          // Main-frame navigations only: subresources are not worth the cost,
          // and blocking them would break pages in confusing ways.
          browserSession.webRequest.onBeforeRequest(
            { urls: ["http://*/*", "https://*/*"], types: ["mainFrame"] },
            (details, callback) => {
              const host = blockedHostFor(blocklist.hosts(), details.url);
              if (!host) {
                callback({});
                return;
              }
              callback({ cancel: true });
              // Loading from inside the handler would re-enter it, and a
              // renderer-initiated data: navigation is refused by Chromium, so
              // the notice has to be pushed from here.
              const target =
                details.webContentsId === undefined
                  ? null
                  : webContents.fromId(details.webContentsId);
              if (!target || target.isDestroyed()) return;
              const notice = blockedPageUrl(details.url, host);
              setImmediate(() => {
                if (!target.isDestroyed()) void target.loadURL(notice).catch(() => {});
              });
            },
          );

          browserSession.setPermissionRequestHandler(
            (webContents, permission, callback, details) => {
              const policy = classifyPreviewPermission(permission);
              if (policy !== "ask") {
                callback(policy === "allow");
                return;
              }

              const origin = permissionOrigin(
                details?.requestingUrl || webContents?.getURL() || undefined,
              );
              // Nothing to attribute a grant to (opaque origin, about:blank, ...).
              if (!origin) {
                callback(false);
                return;
              }

              const key = permissionDecisionKey(partition, origin, permission);
              const remembered = permissionDecisions.get(key);
              if (remembered !== undefined) {
                callback(remembered);
                return;
              }

              void dialog
                .showMessageBox({
                  type: "question",
                  buttons: ["Block", "Allow"],
                  defaultId: 0,
                  cancelId: 0,
                  title: "Permission request",
                  message: permissionPromptMessage(origin, permission),
                  detail: "Remembered until the app restarts.",
                  noLink: true,
                })
                .then(({ response }) => {
                  const granted = response === 1;
                  permissionDecisions.set(key, granted);
                  callback(granted);
                })
                .catch(() => callback(false));
            },
          );
          browserSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) =>
            answerPermissionCheck(
              partition,
              requestingOrigin || webContents?.getURL() || "",
              permission,
            ),
          );
          const next = new Map(sessions);
          next.set(partition, browserSession);
          return [browserSession, next] as const;
        },
        catch: (cause) =>
          new BrowserSessionCreationError({
            scope,
            partition,
            cause,
          }),
      });
    });
  });

  return BrowserSession.of({
    getPartition,
    isPartition: (partition) => partition.startsWith(PREVIEW_PARTITION_PREFIX),
    getSession,
    clearCookies: Effect.fn("BrowserSession.clearCookies")(function* () {
      const sessions = yield* SynchronizedRef.get(sessionsRef);
      yield* Effect.all(
        [...sessions.entries()].map(([partition, browserSession]) =>
          Effect.tryPromise({
            try: () =>
              browserSession.clearStorageData({
                // "websql" is gone in Electron 43 — Chromium removed Web SQL.
                storages: ["cookies", "localstorage", "indexdb", "serviceworkers"],
              }),
            catch: (cause) =>
              new BrowserSessionStorageClearError({
                partition,
                cause,
              }),
          }),
        ),
        { concurrency: "unbounded", discard: true },
      );
    }),
    clearCache: Effect.fn("BrowserSession.clearCache")(function* () {
      const sessions = yield* SynchronizedRef.get(sessionsRef);
      yield* Effect.all(
        [...sessions.entries()].map(([partition, browserSession]) =>
          Effect.tryPromise({
            try: () => browserSession.clearCache(),
            catch: (cause) =>
              new BrowserSessionCacheClearError({
                partition,
                cause,
              }),
          }),
        ),
        { concurrency: "unbounded", discard: true },
      );
    }),
  });
}).pipe(Effect.withSpan("BrowserSession.make"));

export const layer = Layer.effect(BrowserSession, make);
