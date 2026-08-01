import { WS_METHODS, type EnvironmentId as EnvironmentIdType } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { runStream, type EnvironmentRpcInput } from "../rpc/client.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createRuntimeStreamCommand,
  runStreamInEnvironment,
} from "./runtime.ts";
import {
  applySqlQueryStreamEvent,
  EMPTY_SQL_QUERY_BUFFER_STATE,
  type SqlQueryBufferState,
} from "./sqlSession.ts";

export const sqlQueryBufferKey = (
  environmentId: string,
  threadId: string,
  sessionId: string,
): string => JSON.stringify([environmentId, threadId, sessionId]);

/**
 * Streaming query results accumulate here, keyed by
 * `sqlQueryBufferKey(environmentId, threadId, sessionId)`. The executeQuery
 * command writes into the buffer while the stream runs, so views render rows
 * incrementally and the state survives unmounts.
 */
export const sqlQueryBufferAtom = Atom.family((key: string) =>
  Atom.make<SqlQueryBufferState>(EMPTY_SQL_QUERY_BUFFER_STATE).pipe(
    Atom.keepAlive,
    Atom.withLabel(`sql:query-buffer:${key}`),
  ),
);

export function createSqlEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const lifecycleScheduler = createAtomCommandScheduler();
  const sqlSessionKey = ({
    environmentId,
    input,
  }: {
    readonly environmentId: string;
    readonly input: { readonly threadId: string; readonly sessionId: string };
  }) => JSON.stringify([environmentId, input.threadId, input.sessionId]);
  const lifecycleConcurrency = { mode: "serial" as const, key: sqlSessionKey };
  return {
    connections: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:sql:connections",
      tag: WS_METHODS.sqlListConnections,
    }),
    treeChildren: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:sql:treeChildren",
      tag: WS_METHODS.sqlGetTreeChildren,
      staleTimeMs: 60_000,
    }),
    completionMetadata: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:sql:completionMetadata",
      tag: WS_METHODS.sqlGetCompletionMetadata,
      staleTimeMs: 60_000,
    }),
    tableIdentity: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:sql:tableIdentity",
      tag: WS_METHODS.sqlGetTableIdentity,
      staleTimeMs: 60_000,
    }),
    objectDefinition: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:sql:objectDefinition",
      tag: WS_METHODS.sqlGetObjectDefinition,
      staleTimeMs: 60_000,
    }),
    upsertConnection: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sql:upsertConnection",
      tag: WS_METHODS.sqlUpsertConnection,
    }),
    removeConnection: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sql:removeConnection",
      tag: WS_METHODS.sqlRemoveConnection,
    }),
    testConnection: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sql:testConnection",
      tag: WS_METHODS.sqlTestConnection,
    }),
    open: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sql:open",
      tag: WS_METHODS.sqlOpen,
      scheduler: lifecycleScheduler,
      concurrency: lifecycleConcurrency,
    }),
    close: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sql:close",
      tag: WS_METHODS.sqlClose,
      scheduler: lifecycleScheduler,
      concurrency: lifecycleConcurrency,
    }),
    executeQuery: createRuntimeStreamCommand(runtime, {
      label: "environment-data:sql:executeQuery",
      concurrency: {
        mode: "serial",
        key: (target: {
          readonly environmentId: EnvironmentIdType;
          readonly input: EnvironmentRpcInput<typeof WS_METHODS.sqlExecuteQuery>;
        }) => sqlSessionKey(target),
      },
      execute: (target, registry) => {
        const bufferAtom = sqlQueryBufferAtom(
          sqlQueryBufferKey(target.environmentId, target.input.threadId, target.input.sessionId),
        );
        return runStreamInEnvironment(
          target.environmentId,
          runStream(WS_METHODS.sqlExecuteQuery, target.input),
        ).pipe(
          Stream.scan(EMPTY_SQL_QUERY_BUFFER_STATE, applySqlQueryStreamEvent),
          Stream.tap((state) => Effect.sync(() => registry.set(bufferAtom, state))),
        );
      },
    }),
    cancelQuery: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sql:cancelQuery",
      tag: WS_METHODS.sqlCancelQuery,
    }),
    updateRows: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:sql:updateRows",
      tag: WS_METHODS.sqlUpdateRows,
      scheduler: lifecycleScheduler,
      concurrency: lifecycleConcurrency,
    }),
  };
}

export * from "./sqlSession.ts";
