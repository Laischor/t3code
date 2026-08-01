import type { SqlColumnDescriptor, SqlScalar } from "@t3tools/contracts";
import { LegendList } from "@legendapp/list/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../lib/utils";
import { formatCellValue, parseCellInput, type SqlCellEdit } from "./sqlGridEdit";

const ROW_HEIGHT = 26;
const MIN_COLUMN_WIDTH = 60;
const MAX_COLUMN_WIDTH = 420;

export interface SqlResultsGridProps {
  readonly columns: ReadonlyArray<SqlColumnDescriptor>;
  readonly rows: ReadonlyArray<ReadonlyArray<SqlScalar>>;
  readonly editable: boolean;
  /** Uncommitted edits, keyed `${rowIndex}:${columnName}`. */
  readonly pendingEdits: ReadonlyMap<string, SqlCellEdit>;
  readonly onEditCell: (edit: SqlCellEdit) => void;
}

export const cellEditKey = (rowIndex: number, column: string) => `${rowIndex}:${column}`;

function estimateColumnWidth(
  column: SqlColumnDescriptor,
  rows: ReadonlyArray<ReadonlyArray<SqlScalar>>,
  columnIndex: number,
): number {
  let sample = column.name.length;
  const limit = Math.min(rows.length, 50);
  for (let index = 0; index < limit; index += 1) {
    const value = rows[index]?.[columnIndex];
    if (value !== null && value !== undefined) {
      sample = Math.max(sample, String(value).length);
    }
  }
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, sample * 7 + 18));
}

interface EditingCell {
  readonly rowIndex: number;
  readonly columnIndex: number;
  readonly draft: string;
}

/**
 * Virtualized, optionally editable result grid. Double-click a cell to edit;
 * Enter commits the edit into the pending set, Escape cancels.
 */
export function SqlResultsGrid({
  columns,
  rows,
  editable,
  pendingEdits,
  onEditCell,
}: SqlResultsGridProps) {
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const columnWidths = useMemo(
    () => columns.map((column, index) => estimateColumnWidth(column, rows, index)),
    [columns, rows],
  );
  const totalWidth = useMemo(
    () => columnWidths.reduce((sum, width) => sum + width, 0),
    [columnWidths],
  );

  useEffect(() => {
    if (editing !== null) inputRef.current?.select();
  }, [editing]);

  const commitEdit = () => {
    if (editing === null) return;
    const column = columns[editing.columnIndex];
    if (column !== undefined) {
      const previous = rows[editing.rowIndex]?.[editing.columnIndex] ?? null;
      onEditCell({
        rowIndex: editing.rowIndex,
        column: column.name,
        value: parseCellInput(editing.draft, previous),
      });
    }
    setEditing(null);
  };

  const cellValue = (rowIndex: number, columnIndex: number): SqlScalar => {
    const column = columns[columnIndex];
    if (column !== undefined) {
      const pending = pendingEdits.get(cellEditKey(rowIndex, column.name));
      if (pending !== undefined) return pending.value;
    }
    return rows[rowIndex]?.[columnIndex] ?? null;
  };

  const renderRow = ({ index: rowIndex }: { index: number }) => (
    <div
      className={cn("flex border-b border-border/40", rowIndex % 2 === 1 && "bg-muted/20")}
      style={{ width: totalWidth, height: ROW_HEIGHT }}
    >
      {columns.map((column, columnIndex) => {
        const isEditing =
          editing !== null && editing.rowIndex === rowIndex && editing.columnIndex === columnIndex;
        const value = cellValue(rowIndex, columnIndex);
        const isPending = pendingEdits.has(cellEditKey(rowIndex, column.name));
        return (
          <div
            key={column.name}
            className={cn(
              "flex items-center overflow-hidden border-r border-border/30 px-1.5 font-mono text-xs",
              isPending && "bg-amber-500/15",
            )}
            style={{ width: columnWidths[columnIndex], height: ROW_HEIGHT }}
            onDoubleClick={() => {
              if (!editable) return;
              setEditing({ rowIndex, columnIndex, draft: formatCellValue(value) });
            }}
          >
            {isEditing ? (
              <input
                ref={inputRef}
                className="w-full bg-background font-mono text-xs outline outline-1 outline-ring"
                value={editing.draft}
                onChange={(event) => setEditing({ ...editing, draft: event.currentTarget.value })}
                onBlur={commitEdit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitEdit();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setEditing(null);
                  }
                }}
              />
            ) : value === null ? (
              <span className="italic text-muted-foreground/60">NULL</span>
            ) : (
              <span className="truncate">{formatCellValue(value)}</span>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="h-full overflow-x-auto" data-sql-results-grid>
      <div style={{ minWidth: totalWidth }} className="flex h-full flex-col">
        <div
          className="flex shrink-0 border-b border-border bg-muted/40"
          style={{ width: totalWidth }}
        >
          {columns.map((column, columnIndex) => (
            <div
              key={column.name}
              className="truncate border-r border-border/30 px-1.5 py-1 text-xs font-semibold"
              style={{ width: columnWidths[columnIndex] }}
              title={column.dataType}
            >
              {column.name}
              <span className="ml-1 font-normal text-muted-foreground/70">{column.dataType}</span>
            </div>
          ))}
        </div>
        <div className="min-h-0 flex-1">
          <LegendList
            data={rows.map((_, index) => index)}
            keyExtractor={(index) => String(index)}
            estimatedItemSize={ROW_HEIGHT}
            renderItem={({ item }) => renderRow({ index: item })}
          />
        </div>
      </div>
    </div>
  );
}
