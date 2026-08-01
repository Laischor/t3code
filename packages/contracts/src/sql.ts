import * as Schema from "effect/Schema";
import { IsoDateTime, PortSchema, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

const SqlIdentifierSchema = TrimmedNonEmptyString.check(Schema.isMaxLength(256));
const SqlSessionIdSchema = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
const SqlConnectionIdSchema = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
/** Passwords travel only over the WS transport and are never persisted outside the credential store. */
const SqlPasswordSchema = Schema.String.check(Schema.isMaxLength(1_024));
const SqlTextSchema = Schema.String.check(Schema.isNonEmpty()).check(Schema.isMaxLength(1_000_000));

export const SqlEngine = Schema.Literals(["postgres", "sqlite"]);
export type SqlEngine = typeof SqlEngine.Type;

export const SqlPostgresConnectionConfig = Schema.Struct({
  engine: Schema.Literal("postgres"),
  host: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  port: PortSchema,
  database: SqlIdentifierSchema,
  user: SqlIdentifierSchema,
  sslMode: Schema.optional(
    Schema.Literals(["disable", "prefer", "require", "verify-ca", "verify-full"]),
  ),
});
export type SqlPostgresConnectionConfig = typeof SqlPostgresConnectionConfig.Type;

export const SqlSqliteConnectionConfig = Schema.Struct({
  engine: Schema.Literal("sqlite"),
  /** Absolute path, or a path relative to the project workspace root. */
  file: TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)),
});
export type SqlSqliteConnectionConfig = typeof SqlSqliteConnectionConfig.Type;

export const SqlConnectionConfig = Schema.Union([
  SqlPostgresConnectionConfig,
  SqlSqliteConnectionConfig,
]);
export type SqlConnectionConfig = typeof SqlConnectionConfig.Type;

export const SqlConnectionSummary = Schema.Struct({
  id: SqlConnectionIdSchema,
  projectId: ProjectId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  config: SqlConnectionConfig,
  /** Whether a secret for this connection is present in the credential store. */
  hasStoredSecret: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type SqlConnectionSummary = typeof SqlConnectionSummary.Type;

export const SqlListConnectionsInput = Schema.Struct({
  projectId: ProjectId,
});
export type SqlListConnectionsInput = Schema.Codec.Encoded<typeof SqlListConnectionsInput>;

export const SqlListConnectionsResult = Schema.Struct({
  connections: Schema.Array(SqlConnectionSummary),
});
export type SqlListConnectionsResult = typeof SqlListConnectionsResult.Type;

/** Connection ids are chosen by the client (uuid), mirroring terminal id allocation. */
export const SqlUpsertConnectionInput = Schema.Struct({
  id: SqlConnectionIdSchema,
  projectId: ProjectId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  config: SqlConnectionConfig,
  /** When set, the secret is written to the credential store (keychain, file fallback). */
  password: Schema.optional(SqlPasswordSchema),
});
export type SqlUpsertConnectionInput = Schema.Codec.Encoded<typeof SqlUpsertConnectionInput>;

export const SqlRemoveConnectionInput = Schema.Struct({
  connectionId: SqlConnectionIdSchema,
});
export type SqlRemoveConnectionInput = Schema.Codec.Encoded<typeof SqlRemoveConnectionInput>;

export const SqlSessionInput = Schema.Struct({
  threadId: TrimmedNonEmptyString,
  sessionId: SqlSessionIdSchema,
});
export type SqlSessionInput = Schema.Codec.Encoded<typeof SqlSessionInput>;

export const SqlOpenInput = Schema.Struct({
  ...SqlSessionInput.fields,
  connectionId: SqlConnectionIdSchema,
  /** Transient password for this open only; not persisted unless savePassword is set. */
  password: Schema.optional(SqlPasswordSchema),
  savePassword: Schema.optional(Schema.Boolean),
});
export type SqlOpenInput = Schema.Codec.Encoded<typeof SqlOpenInput>;

export const SqlSessionStatus = Schema.Literals(["connected", "closed", "error"]);
export type SqlSessionStatus = typeof SqlSessionStatus.Type;

export const SqlSessionSnapshot = Schema.Struct({
  threadId: Schema.String.check(Schema.isNonEmpty()),
  sessionId: Schema.String.check(Schema.isNonEmpty()),
  connectionId: SqlConnectionIdSchema,
  engine: SqlEngine,
  status: SqlSessionStatus,
  serverVersion: Schema.NullOr(Schema.String),
  database: Schema.NullOr(Schema.String),
  updatedAt: IsoDateTime,
});
export type SqlSessionSnapshot = typeof SqlSessionSnapshot.Type;

export const SqlCloseInput = SqlSessionInput;
export type SqlCloseInput = Schema.Codec.Encoded<typeof SqlCloseInput>;

export const SqlTestConnectionInput = Schema.Struct({
  connectionId: SqlConnectionIdSchema,
  password: Schema.optional(SqlPasswordSchema),
});
export type SqlTestConnectionInput = Schema.Codec.Encoded<typeof SqlTestConnectionInput>;

export const SqlTestConnectionResult = Schema.Struct({
  serverVersion: Schema.NullOr(Schema.String),
});
export type SqlTestConnectionResult = typeof SqlTestConnectionResult.Type;

/**
 * Scalar cell value crossing the wire. The server stringifies driver values
 * that JSON cannot carry losslessly (bigint, dates, bytea) and reports the
 * database type separately in the column descriptor.
 */
export const SqlScalar = Schema.Union([Schema.Null, Schema.String, Schema.Number, Schema.Boolean]);
export type SqlScalar = typeof SqlScalar.Type;

export const SqlColumnDescriptor = Schema.Struct({
  name: Schema.String,
  /** Database type name as reported by the engine (e.g. "int4", "TEXT"). */
  dataType: Schema.String,
});
export type SqlColumnDescriptor = typeof SqlColumnDescriptor.Type;

const SqlMaxRowsSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100_000 }));

export const SqlExecuteQueryInput = Schema.Struct({
  ...SqlSessionInput.fields,
  sql: SqlTextSchema,
  /** Row cap per statement; results beyond it are dropped and flagged truncated. Default 1000. */
  maxRows: Schema.optional(SqlMaxRowsSchema),
});
export type SqlExecuteQueryInput = Schema.Codec.Encoded<typeof SqlExecuteQueryInput>;

const SqlQueryStatementStartedEvent = Schema.Struct({
  type: Schema.Literal("statementStarted"),
  statementIndex: Schema.Int,
});

const SqlQueryColumnsEvent = Schema.Struct({
  type: Schema.Literal("columns"),
  statementIndex: Schema.Int,
  columns: Schema.Array(SqlColumnDescriptor),
});

const SqlQueryRowsEvent = Schema.Struct({
  type: Schema.Literal("rows"),
  statementIndex: Schema.Int,
  rows: Schema.Array(Schema.Array(SqlScalar)),
});

const SqlQueryStatementCompleteEvent = Schema.Struct({
  type: Schema.Literal("statementComplete"),
  statementIndex: Schema.Int,
  /** Command tag, e.g. "SELECT", "UPDATE". */
  command: Schema.NullOr(Schema.String),
  rowCount: Schema.NullOr(Schema.Int),
  truncated: Schema.Boolean,
});

/**
 * In-stream failure: earlier statements may already have produced results, so
 * errors are events rather than stream failures to keep partial output usable.
 */
const SqlQueryErrorEvent = Schema.Struct({
  type: Schema.Literal("error"),
  statementIndex: Schema.NullOr(Schema.Int),
  message: Schema.String,
  /** 1-based character offset into the submitted SQL where the engine flagged the error. */
  position: Schema.NullOr(Schema.Int),
});

const SqlQueryCompleteEvent = Schema.Struct({
  type: Schema.Literal("complete"),
  durationMs: Schema.Int,
});

export const SqlQueryStreamEvent = Schema.Union([
  SqlQueryStatementStartedEvent,
  SqlQueryColumnsEvent,
  SqlQueryRowsEvent,
  SqlQueryStatementCompleteEvent,
  SqlQueryErrorEvent,
  SqlQueryCompleteEvent,
]);
export type SqlQueryStreamEvent = typeof SqlQueryStreamEvent.Type;

export const SqlCancelQueryInput = SqlSessionInput;
export type SqlCancelQueryInput = Schema.Codec.Encoded<typeof SqlCancelQueryInput>;

export const SqlObjectType = Schema.Literals([
  "table",
  "view",
  "materializedView",
  "function",
  "procedure",
  "index",
  "sequence",
  "trigger",
]);
export type SqlObjectType = typeof SqlObjectType.Type;

/** Reference to a tree level whose children should be listed. */
export const SqlTreeNodeRef = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("root") }),
  Schema.Struct({ kind: Schema.Literal("schema"), schema: SqlIdentifierSchema }),
  Schema.Struct({
    kind: Schema.Literal("objectType"),
    schema: Schema.NullOr(SqlIdentifierSchema),
    objectType: SqlObjectType,
  }),
  Schema.Struct({
    kind: Schema.Literal("object"),
    schema: Schema.NullOr(SqlIdentifierSchema),
    objectType: SqlObjectType,
    name: SqlIdentifierSchema,
  }),
]);
export type SqlTreeNodeRef = typeof SqlTreeNodeRef.Type;

export const SqlTreeNode = Schema.Struct({
  ref: SqlTreeNodeRef,
  label: Schema.String,
  /** Secondary text, e.g. a column's data type or a function's signature. */
  detail: Schema.NullOr(Schema.String),
  hasChildren: Schema.Boolean,
});
export type SqlTreeNode = typeof SqlTreeNode.Type;

export const SqlColumnInfo = Schema.Struct({
  name: Schema.String,
  dataType: Schema.String,
  nullable: Schema.Boolean,
  isPrimaryKey: Schema.Boolean,
});
export type SqlColumnInfo = typeof SqlColumnInfo.Type;

export const SqlGetTreeChildrenInput = Schema.Struct({
  ...SqlSessionInput.fields,
  node: SqlTreeNodeRef,
});
export type SqlGetTreeChildrenInput = Schema.Codec.Encoded<typeof SqlGetTreeChildrenInput>;

export const SqlGetTreeChildrenResult = Schema.Struct({
  children: Schema.Array(SqlTreeNode),
  /** Populated when the requested node is a table-like object. */
  columns: Schema.NullOr(Schema.Array(SqlColumnInfo)),
});
export type SqlGetTreeChildrenResult = typeof SqlGetTreeChildrenResult.Type;

export const SqlGetObjectDefinitionInput = Schema.Struct({
  ...SqlSessionInput.fields,
  schema: Schema.NullOr(SqlIdentifierSchema),
  objectType: SqlObjectType,
  name: SqlIdentifierSchema,
});
export type SqlGetObjectDefinitionInput = Schema.Codec.Encoded<typeof SqlGetObjectDefinitionInput>;

export const SqlGetObjectDefinitionResult = Schema.Struct({
  definition: Schema.NullOr(Schema.String),
});
export type SqlGetObjectDefinitionResult = typeof SqlGetObjectDefinitionResult.Type;

/** Flat table/column listing feeding editor autocomplete. */
export const SqlGetCompletionMetadataInput = SqlSessionInput;
export type SqlGetCompletionMetadataInput = Schema.Codec.Encoded<
  typeof SqlGetCompletionMetadataInput
>;

export const SqlCompletionTable = Schema.Struct({
  schema: Schema.NullOr(Schema.String),
  name: Schema.String,
  columns: Schema.Array(Schema.String),
});
export type SqlCompletionTable = typeof SqlCompletionTable.Type;

export const SqlGetCompletionMetadataResult = Schema.Struct({
  defaultSchema: Schema.NullOr(Schema.String),
  tables: Schema.Array(SqlCompletionTable),
});
export type SqlGetCompletionMetadataResult = typeof SqlGetCompletionMetadataResult.Type;

export const SqlTableRef = Schema.Struct({
  schema: Schema.NullOr(SqlIdentifierSchema),
  name: SqlIdentifierSchema,
});
export type SqlTableRef = typeof SqlTableRef.Type;

export const SqlGetTableIdentityInput = Schema.Struct({
  ...SqlSessionInput.fields,
  table: SqlTableRef,
});
export type SqlGetTableIdentityInput = Schema.Codec.Encoded<typeof SqlGetTableIdentityInput>;

export const SqlTableIdentityKind = Schema.Literals(["primaryKey", "rowid", "ctid"]);
export type SqlTableIdentityKind = typeof SqlTableIdentityKind.Type;

export const SqlGetTableIdentityResult = Schema.Struct({
  /** Null when the table offers no usable row identity — the grid stays read-only. */
  identity: Schema.NullOr(
    Schema.Struct({
      kind: SqlTableIdentityKind,
      keyColumns: Schema.Array(Schema.String),
    }),
  ),
  columns: Schema.Array(SqlColumnInfo),
});
export type SqlGetTableIdentityResult = typeof SqlGetTableIdentityResult.Type;

const SqlRowEdit = Schema.Struct({
  /** Identity values selecting exactly one row (primary key / rowid / ctid columns). */
  key: Schema.Record(Schema.String, SqlScalar).check(Schema.isMaxProperties(64)),
  /** Column values to set. Strings are cast by the engine via parameter binding. */
  set: Schema.Record(Schema.String, SqlScalar)
    .check(Schema.isMinProperties(1))
    .check(Schema.isMaxProperties(256)),
});
export type SqlRowEdit = typeof SqlRowEdit.Type;

/**
 * The server generates the UPDATE statements (quoted identifiers, bound
 * parameters) and runs all edits in one transaction. Any edit matching a row
 * count other than one rolls the whole batch back.
 */
export const SqlUpdateRowsInput = Schema.Struct({
  ...SqlSessionInput.fields,
  table: SqlTableRef,
  identityKind: SqlTableIdentityKind,
  edits: Schema.Array(SqlRowEdit).check(Schema.isMinLength(1)).check(Schema.isMaxLength(1_000)),
});
export type SqlUpdateRowsInput = Schema.Codec.Encoded<typeof SqlUpdateRowsInput>;

export const SqlUpdateRowsResult = Schema.Struct({
  updatedRowCount: Schema.Int,
});
export type SqlUpdateRowsResult = typeof SqlUpdateRowsResult.Type;

export class SqlConnectionNotFoundError extends Schema.TaggedErrorClass<SqlConnectionNotFoundError>()(
  "SqlConnectionNotFoundError",
  {
    connectionId: Schema.String,
  },
) {
  override get message() {
    return `Unknown SQL connection: ${this.connectionId}`;
  }
}

export class SqlSessionLookupError extends Schema.TaggedErrorClass<SqlSessionLookupError>()(
  "SqlSessionLookupError",
  {
    threadId: Schema.String,
    sessionId: Schema.String,
  },
) {
  override get message() {
    return `Unknown SQL session: ${this.threadId}/${this.sessionId}`;
  }
}

/** No secret found in keychain, .pgpass, or the request — the client should prompt. */
export class SqlPasswordRequiredError extends Schema.TaggedErrorClass<SqlPasswordRequiredError>()(
  "SqlPasswordRequiredError",
  {
    connectionId: Schema.String,
    user: Schema.String,
    host: Schema.String,
  },
) {
  override get message() {
    return `Password required for ${this.user}@${this.host}`;
  }
}

export class SqlConnectFailedError extends Schema.TaggedErrorClass<SqlConnectFailedError>()(
  "SqlConnectFailedError",
  {
    connectionId: Schema.String,
    reason: Schema.String,
  },
) {
  override get message() {
    return `Failed to connect: ${this.reason}`;
  }
}

export class SqlQueryFailedError extends Schema.TaggedErrorClass<SqlQueryFailedError>()(
  "SqlQueryFailedError",
  {
    reason: Schema.String,
    position: Schema.optional(Schema.NullOr(Schema.Int)),
  },
) {
  override get message() {
    return `Query failed: ${this.reason}`;
  }
}

export class SqlEditRejectedError extends Schema.TaggedErrorClass<SqlEditRejectedError>()(
  "SqlEditRejectedError",
  {
    failure: Schema.Literals([
      "no_row_identity",
      "row_count_mismatch",
      "unknown_column",
      "engine_rejected",
    ]),
    detail: Schema.String,
  },
) {
  override get message() {
    return `Edit rejected (${this.failure}): ${this.detail}`;
  }
}

export class SqlCredentialStoreError extends Schema.TaggedErrorClass<SqlCredentialStoreError>()(
  "SqlCredentialStoreError",
  {
    operation: Schema.Literals(["read", "write", "remove"]),
    reason: Schema.String,
  },
) {
  override get message() {
    return `Credential store ${this.operation} failed: ${this.reason}`;
  }
}

export class SqlConnectionStoreError extends Schema.TaggedErrorClass<SqlConnectionStoreError>()(
  "SqlConnectionStoreError",
  {
    operation: Schema.Literals(["list", "upsert", "remove"]),
    reason: Schema.String,
  },
) {
  override get message() {
    return `Connection store ${this.operation} failed: ${this.reason}`;
  }
}

export const SqlError = Schema.Union([
  SqlConnectionNotFoundError,
  SqlSessionLookupError,
  SqlPasswordRequiredError,
  SqlConnectFailedError,
  SqlQueryFailedError,
  SqlEditRejectedError,
  SqlCredentialStoreError,
  SqlConnectionStoreError,
]);
export type SqlError = typeof SqlError.Type;
