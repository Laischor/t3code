import type {
  EnvironmentId,
  SqlColumnInfo,
  SqlObjectType,
  SqlTableRef,
  SqlTreeNode,
  SqlTreeNodeRef,
} from "@t3tools/contracts";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ColumnsIcon,
  DatabaseIcon,
  FolderIcon,
  KeyRoundIcon,
  TableIcon,
} from "lucide-react";
import { memo, useState } from "react";

import { useEnvironmentQuery } from "../state/query";
import { sqlEnvironment } from "../state/sql";
import { cn } from "../lib/utils";

export interface SqlObjectTreeProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly sessionId: string;
  /** Bumped after reconnects so every level refetches. */
  readonly revision: number;
  readonly onOpenTable: (table: SqlTableRef) => void;
  readonly onShowDefinition: (node: {
    schema: string | null;
    objectType: SqlObjectType;
    name: string;
  }) => void;
}

const nodeKey = (ref: SqlTreeNodeRef): string => JSON.stringify(ref);

const TABLE_LIKE: ReadonlySet<SqlObjectType> = new Set(["table", "view", "materializedView"]);
const DEFINITION_TYPES: ReadonlySet<SqlObjectType> = new Set([
  "view",
  "materializedView",
  "function",
  "procedure",
  "index",
  "trigger",
]);

function nodeIcon(ref: SqlTreeNodeRef) {
  switch (ref.kind) {
    case "schema":
      return <DatabaseIcon className="size-3.5 shrink-0 text-muted-foreground" />;
    case "objectType":
      return <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />;
    case "object":
      return <TableIcon className="size-3.5 shrink-0 text-muted-foreground" />;
    default:
      return null;
  }
}

function ColumnRow({ column }: { readonly column: SqlColumnInfo }) {
  return (
    <div className="flex items-center gap-1.5 py-0.5 pl-6 pr-2 text-xs">
      {column.isPrimaryKey ? (
        <KeyRoundIcon className="size-3 shrink-0 text-amber-500" />
      ) : (
        <ColumnsIcon className="size-3 shrink-0 text-muted-foreground/60" />
      )}
      <span className="truncate">{column.name}</span>
      <span className="ml-auto shrink-0 text-muted-foreground/70">{column.dataType}</span>
      {!column.nullable && <span className="shrink-0 text-muted-foreground/50">NN</span>}
    </div>
  );
}

interface TreeLevelProps extends SqlObjectTreeProps {
  readonly node: SqlTreeNodeRef;
  readonly depth: number;
}

function TreeLevel(props: TreeLevelProps) {
  const { environmentId, threadId, sessionId, revision, node, depth } = props;
  const query = useEnvironmentQuery(
    sqlEnvironment.treeChildren({
      environmentId,
      input: { threadId, sessionId, node, ...(revision > 0 ? {} : {}) },
    }),
  );
  if (query.error !== null) {
    return (
      <div className="px-2 py-1 text-xs text-destructive" style={{ paddingLeft: depth * 12 + 8 }}>
        {query.error}
      </div>
    );
  }
  if (query.data === null) {
    return (
      <div
        className="px-2 py-1 text-xs text-muted-foreground"
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        Loading…
      </div>
    );
  }
  const { children, columns } = query.data;
  if (columns !== null) {
    return (
      <div style={{ paddingLeft: depth * 12 - 12 }}>
        {columns.map((column) => (
          <ColumnRow key={column.name} column={column} />
        ))}
      </div>
    );
  }
  if (children.length === 0) {
    return (
      <div
        className="px-2 py-1 text-xs text-muted-foreground/70"
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        Empty
      </div>
    );
  }
  return (
    <div>
      {children.map((child) => (
        <TreeNodeRow key={nodeKey(child.ref)} {...props} treeNode={child} depth={depth} />
      ))}
    </div>
  );
}

function TreeNodeRowInner(props: TreeLevelProps & { readonly treeNode: SqlTreeNode }) {
  const { treeNode, depth, onOpenTable, onShowDefinition } = props;
  const [expanded, setExpanded] = useState(false);
  const ref = treeNode.ref;
  const isObject = ref.kind === "object";
  const isTableLike = isObject && TABLE_LIKE.has(ref.objectType);
  const hasDefinition = isObject && DEFINITION_TYPES.has(ref.objectType);

  return (
    <div>
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-1 rounded-sm py-0.5 pr-2 text-left text-xs",
          "hover:bg-accent hover:text-accent-foreground",
        )}
        style={{ paddingLeft: depth * 12 }}
        onClick={() => {
          if (treeNode.hasChildren) setExpanded((value) => !value);
        }}
        onDoubleClick={() => {
          if (isTableLike) {
            onOpenTable({ schema: ref.schema, name: ref.name });
          } else if (hasDefinition) {
            onShowDefinition({ schema: ref.schema, objectType: ref.objectType, name: ref.name });
          }
        }}
        title={
          isTableLike
            ? "Double-click to browse data"
            : hasDefinition
              ? "Double-click to show definition"
              : undefined
        }
      >
        {treeNode.hasChildren ? (
          expanded ? (
            <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="size-3 shrink-0" />
        )}
        {nodeIcon(ref)}
        <span className="truncate">{treeNode.label}</span>
        {treeNode.detail !== null && (
          <span className="ml-1 truncate text-muted-foreground/70">{treeNode.detail}</span>
        )}
      </button>
      {expanded && treeNode.hasChildren && <TreeLevel {...props} node={ref} depth={depth + 1} />}
    </div>
  );
}

const TreeNodeRow = memo(TreeNodeRowInner);

/** Lazy database object browser: schema → object type → object → columns. */
export function SqlObjectTree(props: SqlObjectTreeProps) {
  return (
    <div className="h-full overflow-y-auto py-1" data-sql-object-tree>
      <TreeLevel {...props} node={{ kind: "root" }} depth={1} />
    </div>
  );
}
