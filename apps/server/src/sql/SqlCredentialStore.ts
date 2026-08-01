import * as NodeCrypto from "node:crypto";

import { SqlCredentialStoreError } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ProcessRunner from "../processRunner.ts";

const KEYCHAIN_SERVICE = "t3code-sql";
const KEYCHAIN_TIMEOUT = "5 seconds";
const KEYCHAIN_MAX_OUTPUT = 64 * 1024;

/** macOS `security` exit code for "item not found". */
const SECURITY_ITEM_NOT_FOUND = 44;

/**
 * Filenames in the ServerSecretStore fallback must not carry user input, so the
 * connection id is hashed.
 */
const fallbackSecretName = (connectionId: string) =>
  `sql-connection-${NodeCrypto.createHash("sha256").update(connectionId).digest("hex").slice(0, 32)}`;

/**
 * Quote an argument for `security -i` interactive command lines. Passing the
 * command via stdin keeps the password out of the process argument list.
 */
const quoteSecurityArg = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/**
 * Stores SQL connection passwords in the OS keychain when a keychain CLI is
 * available (macOS `security`, Linux `secret-tool`), falling back to the
 * file-based ServerSecretStore (0600 files under stateDir/secrets) otherwise.
 * Secrets are always piped over stdin — never passed as CLI arguments.
 */
export class SqlCredentialStore extends Context.Service<
  SqlCredentialStore,
  {
    readonly get: (
      connectionId: string,
    ) => Effect.Effect<Option.Option<string>, SqlCredentialStoreError>;
    readonly set: (
      connectionId: string,
      password: string,
    ) => Effect.Effect<void, SqlCredentialStoreError>;
    readonly remove: (connectionId: string) => Effect.Effect<void, SqlCredentialStoreError>;
  }
>()("t3/sql/SqlCredentialStore") {}

export const make = Effect.gen(function* () {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const secretStore = yield* ServerSecretStore.ServerSecretStore;
  const platform = yield* HostProcessPlatform;

  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  const storeError = (operation: "read" | "write" | "remove", reason: string) =>
    new SqlCredentialStoreError({ operation, reason });

  const fallbackGet = (connectionId: string) =>
    secretStore.get(fallbackSecretName(connectionId)).pipe(
      Effect.map(Option.map((bytes) => textDecoder.decode(bytes))),
      Effect.mapError((cause) => storeError("read", cause.message)),
    );

  const fallbackSet = (connectionId: string, password: string) =>
    secretStore
      .set(fallbackSecretName(connectionId), textEncoder.encode(password))
      .pipe(Effect.mapError((cause) => storeError("write", cause.message)));

  const fallbackRemove = (connectionId: string) =>
    secretStore
      .remove(fallbackSecretName(connectionId))
      .pipe(Effect.mapError((cause) => storeError("remove", cause.message)));

  /**
   * Runs a keychain CLI. Resolves to Option.none when the CLI itself is
   * unavailable (spawn failure), so callers can fall back to the file store.
   */
  const runKeychainCli = (input: {
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly stdin?: string;
  }) =>
    processRunner
      .run({
        command: input.command,
        args: input.args,
        ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
        timeout: KEYCHAIN_TIMEOUT,
        maxOutputBytes: KEYCHAIN_MAX_OUTPUT,
      })
      .pipe(
        Effect.map(Option.some),
        Effect.catch((cause) =>
          cause._tag === "ProcessSpawnError"
            ? Effect.succeed(Option.none<ProcessRunner.ProcessRunOutput>())
            : Effect.fail(cause),
        ),
      );

  const keychainGet = (
    connectionId: string,
  ): Effect.Effect<Option.Option<Option.Option<string>>, SqlCredentialStoreError> => {
    if (platform === "darwin") {
      return runKeychainCli({
        command: "security",
        args: ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", connectionId, "-w"],
      }).pipe(
        Effect.mapError((cause) => storeError("read", cause.message)),
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(Option.none()),
            onSome: (output) => {
              if (output.code === 0) {
                return Effect.succeed(Option.some(Option.some(output.stdout.replace(/\n$/, ""))));
              }
              if (output.code === SECURITY_ITEM_NOT_FOUND) {
                return Effect.succeed(Option.some(Option.none<string>()));
              }
              return Effect.fail(storeError("read", output.stderr.trim() || "security failed"));
            },
          }),
        ),
      );
    }
    if (platform === "linux") {
      return runKeychainCli({
        command: "secret-tool",
        args: ["lookup", "service", KEYCHAIN_SERVICE, "account", connectionId],
      }).pipe(
        Effect.mapError((cause) => storeError("read", cause.message)),
        Effect.map(
          Option.map((output) =>
            output.code === 0 ? Option.some(output.stdout) : Option.none<string>(),
          ),
        ),
      );
    }
    return Effect.succeed(Option.none());
  };

  const keychainSet = (
    connectionId: string,
    password: string,
  ): Effect.Effect<Option.Option<void>, SqlCredentialStoreError> => {
    if (platform === "darwin") {
      const command = [
        "add-generic-password",
        "-U",
        "-s",
        quoteSecurityArg(KEYCHAIN_SERVICE),
        "-a",
        quoteSecurityArg(connectionId),
        "-w",
        quoteSecurityArg(password),
      ].join(" ");
      return runKeychainCli({ command: "security", args: ["-i"], stdin: `${command}\n` }).pipe(
        Effect.mapError((cause) => storeError("write", cause.message)),
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(Option.none()),
            onSome: (output) =>
              output.code === 0
                ? Effect.succeed(Option.some(undefined))
                : Effect.fail(storeError("write", output.stderr.trim() || "security failed")),
          }),
        ),
      );
    }
    if (platform === "linux") {
      return runKeychainCli({
        command: "secret-tool",
        args: [
          "store",
          `--label=T3 Code SQL connection ${connectionId}`,
          "service",
          KEYCHAIN_SERVICE,
          "account",
          connectionId,
        ],
        stdin: password,
      }).pipe(
        Effect.mapError((cause) => storeError("write", cause.message)),
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(Option.none()),
            onSome: (output) =>
              output.code === 0
                ? Effect.succeed(Option.some(undefined))
                : Effect.fail(storeError("write", output.stderr.trim() || "secret-tool failed")),
          }),
        ),
      );
    }
    return Effect.succeed(Option.none());
  };

  const keychainRemove = (
    connectionId: string,
  ): Effect.Effect<Option.Option<void>, SqlCredentialStoreError> => {
    if (platform === "darwin") {
      return runKeychainCli({
        command: "security",
        args: ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", connectionId],
      }).pipe(
        Effect.mapError((cause) => storeError("remove", cause.message)),
        Effect.map(Option.map(() => undefined)),
      );
    }
    if (platform === "linux") {
      return runKeychainCli({
        command: "secret-tool",
        args: ["clear", "service", KEYCHAIN_SERVICE, "account", connectionId],
      }).pipe(
        Effect.mapError((cause) => storeError("remove", cause.message)),
        Effect.map(Option.map(() => undefined)),
      );
    }
    return Effect.succeed(Option.none());
  };

  const get: SqlCredentialStore["Service"]["get"] = (connectionId) =>
    keychainGet(connectionId).pipe(
      Effect.flatMap(
        Option.match({
          // Keychain CLI unavailable — the secret can only live in the fallback store.
          onNone: () => fallbackGet(connectionId),
          onSome: Option.match({
            onNone: () => fallbackGet(connectionId),
            onSome: (password) => Effect.succeed(Option.some(password)),
          }),
        }),
      ),
      Effect.withSpan("SqlCredentialStore.get"),
    );

  const set: SqlCredentialStore["Service"]["set"] = (connectionId, password) =>
    keychainSet(connectionId, password).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => fallbackSet(connectionId, password),
          onSome: () => Effect.void,
        }),
      ),
      Effect.withSpan("SqlCredentialStore.set"),
    );

  const remove: SqlCredentialStore["Service"]["remove"] = (connectionId) =>
    keychainRemove(connectionId).pipe(
      // Best effort in both stores: the secret may have landed in either one.
      Effect.flatMap(() => fallbackRemove(connectionId)),
      Effect.withSpan("SqlCredentialStore.remove"),
    );

  return { get, set, remove } satisfies SqlCredentialStore["Service"];
});

export const layer = Layer.effect(SqlCredentialStore, make);
