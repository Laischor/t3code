import {
  ProjectId,
  SqlConnectionConfig,
  SqlConnectionStoreError,
  type SqlConnectionSummary,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

const SqlConnectionDbRow = Schema.Struct({
  id: Schema.String,
  projectId: ProjectId,
  name: Schema.String,
  config: Schema.fromJsonString(SqlConnectionConfig),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
type SqlConnectionDbRow = typeof SqlConnectionDbRow.Type;

export type StoredSqlConnection = Omit<SqlConnectionSummary, "hasStoredSecret">;

export class SqlConnectionStore extends Context.Service<
  SqlConnectionStore,
  {
    readonly listByProject: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<StoredSqlConnection>, SqlConnectionStoreError>;
    readonly getById: (
      connectionId: string,
    ) => Effect.Effect<Option.Option<StoredSqlConnection>, SqlConnectionStoreError>;
    readonly upsert: (
      connection: StoredSqlConnection,
    ) => Effect.Effect<void, SqlConnectionStoreError>;
    readonly remove: (connectionId: string) => Effect.Effect<void, SqlConnectionStoreError>;
  }
>()("t3/sql/SqlConnectionStore") {}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const selectColumns = sql`
    id,
    project_id AS "projectId",
    name,
    config_json AS "config",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  `;

  const listRows = SqlSchema.findAll({
    Request: ProjectId,
    Result: SqlConnectionDbRow,
    execute: (projectId) => sql`
      SELECT ${selectColumns}
      FROM sql_connections
      WHERE project_id = ${projectId}
      ORDER BY name ASC, id ASC
    `,
  });

  const getRow = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: SqlConnectionDbRow,
    execute: (connectionId) => sql`
      SELECT ${selectColumns}
      FROM sql_connections
      WHERE id = ${connectionId}
    `,
  });

  const upsertRow = SqlSchema.void({
    Request: SqlConnectionDbRow,
    execute: (row) => sql`
      INSERT INTO sql_connections (id, project_id, name, config_json, created_at, updated_at)
      VALUES (
        ${row.id},
        ${row.projectId},
        ${row.name},
        ${JSON.stringify(row.config)},
        ${row.createdAt},
        ${row.updatedAt}
      )
      ON CONFLICT (id)
      DO UPDATE SET
        project_id = excluded.project_id,
        name = excluded.name,
        config_json = excluded.config_json,
        updated_at = excluded.updated_at
    `,
  });

  const removeRow = SqlSchema.void({
    Request: Schema.String,
    execute: (connectionId) => sql`
      DELETE FROM sql_connections
      WHERE id = ${connectionId}
    `,
  });

  const storeError = (operation: "list" | "upsert" | "remove") => (cause: unknown) =>
    new SqlConnectionStoreError({
      operation,
      reason: cause instanceof Error ? cause.message : String(cause),
    });

  const listByProject: SqlConnectionStore["Service"]["listByProject"] = (projectId) =>
    listRows(projectId).pipe(
      Effect.mapError(storeError("list")),
      Effect.withSpan("SqlConnectionStore.listByProject"),
    );

  const getById: SqlConnectionStore["Service"]["getById"] = (connectionId) =>
    getRow(connectionId).pipe(
      Effect.mapError(storeError("list")),
      Effect.withSpan("SqlConnectionStore.getById"),
    );

  const upsert: SqlConnectionStore["Service"]["upsert"] = (connection) =>
    upsertRow(connection).pipe(
      Effect.mapError(storeError("upsert")),
      Effect.withSpan("SqlConnectionStore.upsert"),
    );

  const remove: SqlConnectionStore["Service"]["remove"] = (connectionId) =>
    removeRow(connectionId).pipe(
      Effect.mapError(storeError("remove")),
      Effect.withSpan("SqlConnectionStore.remove"),
    );

  return { listByProject, getById, upsert, remove } satisfies SqlConnectionStore["Service"];
});

export const layer = Layer.effect(SqlConnectionStore, make);
