import type {
  EnvironmentId,
  ProjectId,
  SqlConnectionConfig,
  SqlConnectionSummary,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

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
import { randomUUID } from "../lib/utils";
import { useAtomCommand } from "../state/use-atom-command";
import { sqlEnvironment } from "../state/sql";
import { useSqlPaneStore } from "./sqlPaneStore";

export interface SqlConnectionsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  /** Window key for the per-window allowlist section. */
  readonly threadKey: string;
  readonly connections: ReadonlyArray<SqlConnectionSummary>;
  readonly onConnectionsChanged: () => void;
}

interface ConnectionDraft {
  id: string;
  name: string;
  engine: "postgres" | "sqlite";
  host: string;
  port: string;
  database: string;
  user: string;
  file: string;
  password: string;
}

const EMPTY_DRAFT: Omit<ConnectionDraft, "id"> = {
  name: "",
  engine: "postgres",
  host: "localhost",
  port: "5432",
  database: "",
  user: "",
  file: "",
  password: "",
};

function draftFromSummary(summary: SqlConnectionSummary): ConnectionDraft {
  const base: ConnectionDraft = { id: summary.id, ...EMPTY_DRAFT, name: summary.name };
  if (summary.config.engine === "postgres") {
    return {
      ...base,
      engine: "postgres",
      host: summary.config.host,
      port: String(summary.config.port),
      database: summary.config.database,
      user: summary.config.user,
    };
  }
  return { ...base, engine: "sqlite", file: summary.config.file };
}

function configFromDraft(draft: ConnectionDraft): SqlConnectionConfig | null {
  if (draft.engine === "sqlite") {
    if (draft.file.trim() === "") return null;
    return { engine: "sqlite", file: draft.file.trim() };
  }
  const port = Number.parseInt(draft.port, 10);
  if (
    draft.host.trim() === "" ||
    !Number.isFinite(port) ||
    draft.database.trim() === "" ||
    draft.user.trim() === ""
  ) {
    return null;
  }
  return {
    engine: "postgres",
    host: draft.host.trim(),
    port,
    database: draft.database.trim(),
    user: draft.user.trim(),
  };
}

export function SqlConnectionsDialog({
  open,
  onOpenChange,
  environmentId,
  projectId,
  threadKey,
  connections,
  onConnectionsChanged,
}: SqlConnectionsDialogProps) {
  const [draft, setDraft] = useState<ConnectionDraft | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const upsert = useAtomCommand(sqlEnvironment.upsertConnection, "sql upsert connection");
  const remove = useAtomCommand(sqlEnvironment.removeConnection, "sql remove connection");
  const test = useAtomCommand(sqlEnvironment.testConnection, "sql test connection");
  const allowlist = useSqlPaneStore((state) => state.windowAllowlist[threadKey] ?? null);
  const setWindowAllowlist = useSqlPaneStore((state) => state.setWindowAllowlist);

  const patchDraft = (patch: Partial<ConnectionDraft>) =>
    setDraft((current) => (current === null ? current : { ...current, ...patch }));

  const saveDraft = async () => {
    if (draft === null) return;
    const config = configFromDraft(draft);
    if (config === null || draft.name.trim() === "") {
      setStatus("Please fill in all required fields.");
      return;
    }
    const result = await upsert({
      environmentId,
      input: {
        id: draft.id,
        projectId,
        name: draft.name.trim(),
        config,
        ...(draft.password === "" ? {} : { password: draft.password }),
      },
    });
    if (AsyncResult.isSuccess(result)) {
      setDraft(null);
      setStatus(null);
      onConnectionsChanged();
    } else {
      setStatus("Saving the connection failed.");
    }
  };

  const testDraft = async () => {
    if (draft === null) return;
    setStatus("Testing…");
    const config = configFromDraft(draft);
    if (config === null) {
      setStatus("Please fill in all required fields.");
      return;
    }
    // Persist first so the server can resolve the connection by id.
    const saved = await upsert({
      environmentId,
      input: {
        id: draft.id,
        projectId,
        name: draft.name.trim() === "" ? "Untitled" : draft.name.trim(),
        config,
        ...(draft.password === "" ? {} : { password: draft.password }),
      },
    });
    if (!AsyncResult.isSuccess(saved)) {
      setStatus("Saving the connection failed.");
      return;
    }
    onConnectionsChanged();
    const result = await test({
      environmentId,
      input: { connectionId: draft.id },
    });
    if (AsyncResult.isSuccess(result)) {
      setStatus(
        result.value.serverVersion === null
          ? "Connection OK."
          : `Connection OK — server ${result.value.serverVersion}.`,
      );
    } else {
      setStatus("Connection failed.");
    }
  };

  const removeConnection = async (connectionId: string) => {
    const result = await remove({ environmentId, input: { connectionId } });
    if (AsyncResult.isSuccess(result)) onConnectionsChanged();
  };

  const toggleAllowed = (connectionId: string, allowed: boolean) => {
    const current = allowlist ?? connections.map((connection) => connection.id);
    const next = allowed
      ? [...new Set([...current, connectionId])]
      : current.filter((id) => id !== connectionId);
    // Allowing everything again clears the restriction.
    setWindowAllowlist(
      threadKey,
      next.length >= connections.length &&
        connections.every((connection) => next.includes(connection.id))
        ? null
        : next,
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogTitle>SQL Connections</DialogTitle>
        {draft === null ? (
          <div className="flex flex-col gap-2 p-4 pt-2">
            {connections.length === 0 && (
              <p className="text-sm text-muted-foreground">No connections for this project yet.</p>
            )}
            {connections.map((connection) => {
              const detail =
                connection.config.engine === "postgres"
                  ? `${connection.config.user}@${connection.config.host}:${connection.config.port}/${connection.config.database}`
                  : connection.config.file;
              const allowed = allowlist === null || allowlist.includes(connection.id);
              return (
                <div
                  key={connection.id}
                  className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
                >
                  <Checkbox
                    checked={allowed}
                    onCheckedChange={(checked) => toggleAllowed(connection.id, checked === true)}
                    aria-label="Visible in this window"
                    title="Visible in this window"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{connection.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {connection.config.engine} · {detail}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Edit"
                    onClick={() => {
                      setStatus(null);
                      setDraft(draftFromSummary(connection));
                    }}
                  >
                    <PencilIcon className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete"
                    onClick={() => void removeConnection(connection.id)}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              );
            })}
            <div className="mt-1 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Checkbox = visible in this window. Passwords go to the OS keychain.
              </p>
              <Button
                size="sm"
                onClick={() => {
                  setStatus(null);
                  setDraft({ id: randomUUID(), ...EMPTY_DRAFT });
                }}
              >
                <PlusIcon className="size-3.5" /> Add
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-4 pt-2">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Label className="text-xs">Name</Label>
                <Input
                  value={draft.name}
                  onChange={(event) => patchDraft({ name: event.currentTarget.value })}
                  placeholder="Local Postgres"
                />
              </div>
              <div>
                <Label className="text-xs">Engine</Label>
                <Select
                  value={draft.engine}
                  onValueChange={(value) =>
                    patchDraft({ engine: value as ConnectionDraft["engine"] })
                  }
                >
                  <SelectTrigger size="sm" className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="postgres">PostgreSQL</SelectItem>
                    <SelectItem value="sqlite">SQLite</SelectItem>
                  </SelectPopup>
                </Select>
              </div>
            </div>
            {draft.engine === "postgres" ? (
              <>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label className="text-xs">Host</Label>
                    <Input
                      value={draft.host}
                      onChange={(event) => patchDraft({ host: event.currentTarget.value })}
                    />
                  </div>
                  <div className="w-24">
                    <Label className="text-xs">Port</Label>
                    <Input
                      value={draft.port}
                      onChange={(event) => patchDraft({ port: event.currentTarget.value })}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label className="text-xs">Database</Label>
                    <Input
                      value={draft.database}
                      onChange={(event) => patchDraft({ database: event.currentTarget.value })}
                    />
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs">User</Label>
                    <Input
                      value={draft.user}
                      onChange={(event) => patchDraft({ user: event.currentTarget.value })}
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Password</Label>
                  <Input
                    type="password"
                    value={draft.password}
                    onChange={(event) => patchDraft({ password: event.currentTarget.value })}
                    placeholder="Stored in the OS keychain — leave empty to keep / use .pgpass"
                  />
                </div>
              </>
            ) : (
              <div>
                <Label className="text-xs">Database file</Label>
                <Input
                  value={draft.file}
                  onChange={(event) => patchDraft({ file: event.currentTarget.value })}
                  placeholder="state.sqlite or /absolute/path.db"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Relative paths resolve against the project workspace root.
                </p>
              </div>
            )}
            {status !== null && <p className="text-xs text-muted-foreground">{status}</p>}
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => void testDraft()}>
                  Test
                </Button>
                <Button size="sm" onClick={() => void saveDraft()}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogPopup>
    </Dialog>
  );
}
