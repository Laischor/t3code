/**
 * Renders a pane tree as nested CSS grids with draggable dividers.
 *
 * Layout only — leaf content comes from `renderPane`, so the grid stays
 * independent of terminals and browsers and can be reasoned about on its own.
 */

import {
  Fragment,
  useCallback,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { cn } from "~/lib/utils";
import {
  isSplit,
  MIN_PANE_FRACTION,
  normalizeSizes,
  type DeckPaneLeaf,
  type DeckPaneNode,
  type DeckPaneSplit,
} from "./paneTree";

const DIVIDER_SIZE = 6;

export interface DeckPaneGridProps {
  node: DeckPaneNode;
  activePaneId: string | null;
  onActivatePane: (paneId: string) => void;
  onResizeSplit: (splitId: string, sizes: ReadonlyArray<number>) => void;
  renderPane: (leaf: DeckPaneLeaf, isActive: boolean) => ReactNode;
}

export function DeckPaneGrid(props: DeckPaneGridProps) {
  const { node } = props;
  if (!isSplit(node)) {
    return <PaneSlot {...props} leaf={node} />;
  }
  return <SplitSlot {...props} split={node} />;
}

function PaneSlot({
  leaf,
  activePaneId,
  onActivatePane,
  renderPane,
}: DeckPaneGridProps & { leaf: DeckPaneLeaf }) {
  const isActive = activePaneId === leaf.id;
  return (
    <div
      // Capture phase so a click anywhere inside the pane focuses it, including
      // on children that stop propagation (xterm does).
      onPointerDownCapture={() => {
        if (!isActive) onActivatePane(leaf.id);
      }}
      className={cn(
        "relative flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[6px] border",
        isActive ? "border-primary/60" : "border-border/60",
      )}
      data-deck-pane={leaf.id}
      data-deck-pane-kind={leaf.kind}
      data-deck-pane-active={isActive ? "true" : undefined}
    >
      {renderPane(leaf, isActive)}
    </div>
  );
}

function SplitSlot({ split, ...props }: DeckPaneGridProps & { split: DeckPaneSplit }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { onResizeSplit } = props;
  const horizontal = split.direction === "horizontal";
  const sizes = normalizeSizes(split.sizes, split.children.length);

  // `<fraction>fr` per child with fixed divider tracks between them, so the
  // dividers never eat into the fractions.
  const template = sizes
    .map((size) => `${size}fr`)
    .join(` ${DIVIDER_SIZE}px `);

  const handleDividerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, index: number) => {
      const container = containerRef.current;
      if (!container || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const rect = container.getBoundingClientRect();
      const dividerTotal = DIVIDER_SIZE * (split.children.length - 1);
      const available = (horizontal ? rect.width : rect.height) - dividerTotal;
      if (available <= 0) return;

      const startPosition = horizontal ? event.clientX : event.clientY;
      const startSizes = [...sizes];
      const pairTotal = (startSizes[index] ?? 0) + (startSizes[index + 1] ?? 0);
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);

      const onMove = (moveEvent: PointerEvent) => {
        const position = horizontal ? moveEvent.clientX : moveEvent.clientY;
        const delta = (position - startPosition) / available;
        const first = clamp(
          (startSizes[index] ?? 0) + delta,
          MIN_PANE_FRACTION,
          pairTotal - MIN_PANE_FRACTION,
        );
        const next = [...startSizes];
        next[index] = first;
        next[index + 1] = pairTotal - first;
        onResizeSplit(split.id, next);
      };

      const onUp = () => {
        target.releasePointerCapture(event.pointerId);
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
      };

      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [horizontal, onResizeSplit, sizes, split.children.length, split.id],
  );

  return (
    <div
      ref={containerRef}
      className="grid h-full w-full min-h-0 min-w-0"
      style={
        horizontal
          ? { gridTemplateColumns: template, gridTemplateRows: "100%" }
          : { gridTemplateRows: template, gridTemplateColumns: "100%" }
      }
    >
      {split.children.map((child, index) => (
        <Fragment key={child.id}>
          {index > 0 ? (
            <div
              role="separator"
              aria-orientation={horizontal ? "vertical" : "horizontal"}
              onPointerDown={(event) => handleDividerDown(event, index - 1)}
              className={cn(
                "group flex items-center justify-center bg-transparent",
                horizontal ? "cursor-col-resize" : "cursor-row-resize",
              )}
            >
              <div
                className={cn(
                  "rounded-full bg-border/70 transition-colors group-hover:bg-primary/60",
                  horizontal ? "h-8 w-[2px]" : "h-[2px] w-8",
                )}
              />
            </div>
          ) : null}
          <DeckPaneGrid {...props} node={child} />
        </Fragment>
      ))}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
