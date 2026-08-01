import { useAtomValue } from "@effect/atom-react";
import {
  sqlQueryBufferAtom,
  sqlQueryBufferKey,
  type SqlStatementResult,
} from "@t3tools/client-runtime/state/sql";
import type {
  EnvironmentId,
  ProjectId,
  SqlObjectType,
  SqlSessionSnapshot,
  SqlTableRef,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { DatabaseIcon, PlayIcon, SettingsIcon, SquareIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog, DialogPopup, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { cn } from "../lib/utils";
import { useEnvironmentQuery } from "../state/query";
import { sqlEnvironment } from "../state/sql";
import { useAtomCommand } from "../state/use-atom-command";
import { SqlConnectionsDialog } from "./SqlConnectionsDialog";
import { SqlEditor } from "./SqlEditor";
import { buildRowEdits, resolveEditContext, type SqlCellEdit } from "./sqlGridEdit";
import { SqlObjectTree } from "./SqlObjectTree";
import { cellEditKey, SqlResultsGrid } from "./SqlResultsGrid";
import {
  EMPTY_SQL_TAB_STATE,
  filterAllowedConnections,
  sqlTabKey,
  useSqlPaneStore,
} from "./sqlPaneStore";

const TABLE_BROWSE_LIMIT = 500;

const quoteIdentifier = (name: string) => `"${name.replaceAll('"', '""')}"`;
const quoteTable = (table: SqlTableRef) =>
  table.schema === null
    ? quoteIdentifier(table.name)
    : `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`;

export interface SqlPanelProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  /** Deck window id — doubles as the server-side session thread. */
  readonly threadId: string;
  /** Deck tab id — doubles as the server-side SQL session id. */
  readonly tabId: string;
  readonly threadKey: string;
}

interface PasswordPrompt {
  readonly user: string;
  readonly host: string;
}

function failureTag(result: { readonly cause: Cause.Cause<unknown> }): string | null {
  const error = Cause.squash(result.cause);
  return typeof error === "object" && error !== null && "_tag" in error
    ? String((error as { _tag: unknown })._tag)
    : null;
}

function failureMessage(result: { readonly cause: Cause.Cause<unknown> }): string {
  const error = Cause.squash(result.cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The request failed.";
}

export default function SqlPanel({
  environmentId,
  projectId,
  threadId,
  tabId,
  threadKey,
}: SqlPanelProps) {
  const tabKey = sqlTabKey(threadKey, tabId);
  const tabState = useSqlPaneStore((state) => state.tabs[tabKey] ?? EMPTY_SQL_TAB_STATE);
  const setTabConnection = useSqlPaneStore((state) => state.setTabConnection);
  const setTabSql = useSqlPaneStore((state) => state.setTabSql);
  const vimMode = useSqlPaneStore((state) => state.vimMode);
  const setVimMode = useSqlPaneStore((state) => state.setVimMode);
  const allowlist = useSqlPaneStore((state) => state.windowAllowlist[threadKey] ?? null);

  const [session, setSession] = useState<SqlSessionSnapshot | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<PasswordPrompt | null>(null);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [savePassword, setSavePassword] = useState(true);
  const [manageOpen, setManageOpen] = useState(false);
  const [gridTable, setGridTable] = useState<SqlTableRef | null>(null);
  const [pendingEdits, setPendingEdits] = useState<ReadonlyMap<string, SqlCellEdit>>(new Map());
  const [definitionNode, setDefinitionNode] = useState<{
    schema: string | null;
    objectType: SqlObjectType;
    name: string;
  } | null>(null);
  const [editStatus, setEditStatus] = useState<string | null>(null);

  const connectionsQuery = useEnvironmentQuery(
    sqlEnvironment.connections({ environmentId, input: { projectId } }),
  );
  const connections = useMemo(
    () => filterAllowedConnections(connectionsQuery.data?.connections ?? [], allowlist),
    [connectionsQuery.data, allowlist],
  );

  const openSession = useAtomCommand(sqlEnvironment.open, "sql open");
  const executeQuery = useAtomCommand(sqlEnvironment.executeQuery, "sql execute");
  const cancelQuery = useAtomCommand(sqlEnvironment.cancelQuery, "sql cancel");
  const updateRows = useAtomCommand(sqlEnvironment.updateRows, "sql update rows");

  const buffer = useAtomValue(
    sqlQueryBufferAtom(sqlQueryBufferKey(environmentId, threadId, tabId)),
  );

  const connect = useCallback(
    async (connectionId: string, password?: string, save?: boolean) => {
      setConnectionError(null);
      const result = await openSession({
        environmentId,
        input: {
          threadId,
          sessionId: tabId,
          connectionId,
          ...(password === undefined ? {} : { password, savePassword: save === true }),
        },
      });
      if (AsyncResult.isSuccess(result)) {
        setSession(result.value);
        setPasswordPrompt(null);
        setPasswordDraft("");
        return;
      }
      setSession(null);
      if (failureTag(result) === "SqlPasswordRequiredError") {
        const error = Cause.squash(result.cause) as { user?: string; host?: string };
        setPasswordPrompt({ user: error.user ?? "", host: error.host ?? "" });
      } else {
        setConnectionError(failureMessage(result));
      }
    },
    [environmentId, openSession, tabId, threadId],
  );

  useEffect(() => {
    if (tabState.connectionId !== null) {
      void connect(tabState.connectionId);
    }
    // Reconnect only when the chosen connection changes.
  }, [tabState.connectionId]);

  const completionQuery = useEnvironmentQuery(
    session === null
      ? null
      : sqlEnvironment.completionMetadata({
          environmentId,
          input: { threadId, sessionId: tabId },
        }),
  );

  const identityQuery = useEnvironmentQuery(
    session === null || gridTable === null
      ? null
      : sqlEnvironment.tableIdentity({
          environmentId,
          input: { threadId, sessionId: tabId, table: gridTable },
        }),
  );

  const runSql = useCallback(
    (sql: string, table: SqlTableRef | null) => {
      if (session === null || sql.trim() === "") return;
      setGridTable(table);
      setPendingEdits(new Map());
      setEditStatus(null);
      void executeQuery({
        environmentId,
        input: { threadId, sessionId: tabId, sql },
      });
    },
    [environmentId, executeQuery, session, tabId, threadId],
  );

  const runEditorSql = useCallback((sql: string) => runSql(sql, null), [runSql]);

  const openTable = useCallback(
    (table: SqlTableRef) => {
      runSql(`SELECT * FROM ${quoteTable(table)} LIMIT ${TABLE_BROWSE_LIMIT}`, table);
    },
    [runSql],
  );

  const displayed: SqlStatementResult | null = useMemo(() => {
    const withColumns = buffer.statements.filter((statement) => statement.columns.length > 0);
    return withColumns.at(-1) ?? buffer.statements.at(-1) ?? null;
  }, [buffer.statements]);

  const editContext = useMemo(
    () =>
      displayed === null
        ? null
        : resolveEditContext({ table: gridTable }, identityQuery.data ?? null, displayed.columns),
    [displayed, gridTable, identityQuery.data],
  );

  const saveEdits = useCallback(async () => {
    if (editContext === null || displayed === null || pendingEdits.size === 0) return;
    setEditStatus("Saving…");
    const edits = buildRowEdits(
      [...pendingEdits.values()],
      displayed.rows,
      displayed.columns,
      editContext.identity.keyColumns,
    );
    const result = await updateRows({
      environmentId,
      input: {
        threadId,
        sessionId: tabId,
        table: editContext.table,
        identityKind: editContext.identity.kind,
        edits,
      },
    });
    if (AsyncResult.isSuccess(result)) {
      setEditStatus(`${result.value.updatedRowCount} row(s) updated.`);
      setPendingEdits(new Map());
      openTable(editContext.table);
    } else {
      setEditStatus(failureMessage(result));
    }
  }, [displayed, editContext, environmentId, openTable, pendingEdits, tabId, threadId, updateRows]);

  const statusLine = useMemo(() => {
    if (buffer.status === "idle") return null;
    const parts = buffer.statements
      .filter((statement) => statement.complete)
      .map((statement) => {
        const command = statement.command ?? "OK";
        const rows =
          statement.rowCount === null
            ? ""
            : ` ${statement.rowCount}${statement.truncated ? "+" : ""} rows`;
        return `${command}${rows}`;
      });
    const duration = buffer.durationMs === null ? "" : ` · ${buffer.durationMs} ms`;
    return `${parts.join(" · ")}${duration}`;
  }, [buffer]);

  if (tabState.connectionId === null || connections.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <DatabaseIcon className="size-8" />
        {connections.length === 0 ? (
          <p>No SQL connections for this project (or this window) yet.</p>
        ) : (
          <ConnectionPicker
            connections={connections}
            value={null}
            onChange={(id) => setTabConnection(tabKey, id)}
          />
        )}
        <Button size="sm" variant="outline" onClick={() => setManageOpen(true)}>
          <SettingsIcon className="size-3.5" /> Manage connections
        </Button>
        <SqlConnectionsDialog
          open={manageOpen}
          onOpenChange={setManageOpen}
          environmentId={environmentId}
          projectId={projectId}
          threadKey={threadKey}
          connections={connectionsQuery.data?.connections ?? []}
          onConnectionsChanged={connectionsQuery.refresh}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-sql-panel>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <ConnectionPicker
          connections={connections}
          value={tabState.connectionId}
          onChange={(id) => {
            setSession(null);
            setTabConnection(tabKey, id);
          }}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Manage connections"
          onClick={() => setManageOpen(true)}
        >
          <SettingsIcon className="size-3.5" />
        </Button>
        <span
          className={cn(
            "size-1.5 rounded-full",
            session !== null ? "bg-emerald-500" : "bg-muted-foreground/40",
          )}
          title={session !== null ? `Connected (${session.serverVersion ?? "?"})` : "Not connected"}
        />
        <div className="flex-1" />
        <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Vim
          <Switch checked={vimMode} onCheckedChange={setVimMode} aria-label="Vim keybindings" />
        </Label>
        {buffer.status === "running" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void cancelQuery({ environmentId, input: { threadId, sessionId: tabId } })
            }
          >
            <SquareIcon className="size-3" /> Cancel
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={session === null}
            onClick={() => runEditorSql(tabState.sql)}
            title="⌘⏎"
          >
            <PlayIcon className="size-3" /> Run
          </Button>
        )}
      </div>
      {connectionError !== null && (
        <div className="border-b border-border bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {connectionError}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="w-60 shrink-0 border-r border-border">
          {session !== null ? (
            <SqlObjectTree
              environmentId={environmentId}
              threadId={threadId}
              sessionId={tabId}
              revision={0}
              onOpenTable={openTable}
              onShowDefinition={setDefinitionNode}
            />
          ) : (
            <div className="p-2 text-xs text-muted-foreground">Not connected.</div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="h-2/5 min-h-24 border-b border-border">
            <SqlEditor
              className="h-full"
              initialValue={tabState.sql}
              engine={session?.engine ?? "postgres"}
              tables={completionQuery.data?.tables ?? null}
              defaultSchema={completionQuery.data?.defaultSchema ?? null}
              vimMode={vimMode}
              onChange={(value) => setTabSql(tabKey, value)}
              onRun={runEditorSql}
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-2 py-1 text-xs text-muted-foreground">
              {buffer.status === "running" && <span>Running…</span>}
              {buffer.error !== null && (
                <span className="text-destructive">{buffer.error.message}</span>
              )}
              {buffer.error === null && statusLine !== null && <span>{statusLine}</span>}
              <div className="flex-1" />
              {editContext !== null && (
                <span className="text-muted-foreground/70">
                  editable ({editContext.identity.kind})
                </span>
              )}
              {pendingEdits.size > 0 && (
                <>
                  <span>{pendingEdits.size} pending edit(s)</span>
                  <Button size="xs" onClick={() => void saveEdits()}>
                    Save
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setPendingEdits(new Map())}>
                    Discard
                  </Button>
                </>
              )}
              {editStatus !== null && <span>{editStatus}</span>}
            </div>
            <div className="min-h-0 flex-1">
              {displayed !== null && displayed.columns.length > 0 ? (
                <SqlResultsGrid
                  columns={displayed.columns}
                  rows={displayed.rows}
                  editable={editContext !== null}
                  pendingEdits={pendingEdits}
                  onEditCell={(edit) =>
                    setPendingEdits((current) => {
                      const next = new Map(current);
                      next.set(cellEditKey(edit.rowIndex, edit.column), edit);
                      return next;
                    })
                  }
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  {buffer.status === "idle" ? "Run a query to see results." : "No result set."}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <SqlConnectionsDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        environmentId={environmentId}
        projectId={projectId}
        threadKey={threadKey}
        connections={connectionsQuery.data?.connections ?? []}
        onConnectionsChanged={connectionsQuery.refresh}
      />
      <DefinitionDialog
        environmentId={environmentId}
        threadId={threadId}
        sessionId={tabId}
        node={definitionNode}
        onClose={() => setDefinitionNode(null)}
      />
      <Dialog
        open={passwordPrompt !== null}
        onOpenChange={(open) => {
          if (!open) setPasswordPrompt(null);
        }}
      >
        <DialogPopup className="max-w-sm">
          <DialogTitle>Password required</DialogTitle>
          <div className="flex flex-col gap-3 p-4 pt-2">
            <p className="text-sm text-muted-foreground">
              {passwordPrompt?.user}@{passwordPrompt?.host}
            </p>
            <Input
              type="password"
              autoFocus
              value={passwordDraft}
              onChange={(event) => setPasswordDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && tabState.connectionId !== null) {
                  void connect(tabState.connectionId, passwordDraft, savePassword);
                }
              }}
            />
            <Label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={savePassword}
                onCheckedChange={(checked) => setSavePassword(checked === true)}
              />
              Save to OS keychain
            </Label>
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => {
                  if (tabState.connectionId !== null) {
                    void connect(tabState.connectionId, passwordDraft, savePassword);
                  }
                }}
              >
                Connect
              </Button>
            </div>
          </div>
        </DialogPopup>
      </Dialog>
    </div>
  );
}

function ConnectionPicker({
  connections,
  value,
  onChange,
}: {
  readonly connections: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly value: string | null;
  readonly onChange: (id: string) => void;
}) {
  return (
    <Select
      value={value ?? ""}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger size="sm" className="min-w-40" aria-label="Connection">
        <DatabaseIcon className="size-3.5 shrink-0" />
        <SelectValue placeholder="Choose connection…" />
      </SelectTrigger>
      <SelectPopup>
        {connections.map((connection) => (
          <SelectItem key={connection.id} value={connection.id}>
            {connection.name}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function DefinitionDialog({
  environmentId,
  threadId,
  sessionId,
  node,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly sessionId: string;
  readonly node: { schema: string | null; objectType: SqlObjectType; name: string } | null;
  readonly onClose: () => void;
}) {
  const query = useEnvironmentQuery(
    node === null
      ? null
      : sqlEnvironment.objectDefinition({
          environmentId,
          input: { threadId, sessionId, ...node },
        }),
  );
  return (
    <Dialog
      open={node !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="max-w-2xl">
        <DialogTitle>{node?.name}</DialogTitle>
        <pre className="max-h-96 overflow-auto p-4 pt-2 font-mono text-xs whitespace-pre-wrap">
          {query.error ??
            query.data?.definition ??
            (query.isPending ? "Loading…" : "No definition available.")}
        </pre>
      </DialogPopup>
    </Dialog>
  );
}
