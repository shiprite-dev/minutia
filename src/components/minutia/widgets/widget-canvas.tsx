"use client";

import * as React from "react";
import { GridStack } from "gridstack";
import type { GridStackNode, GridStackOptions } from "gridstack";
import { useWidgetStore, type WidgetLayout } from "@/lib/stores/widget-store";

const GRID_OPTIONS: GridStackOptions = {
  column: 12,
  cellHeight: 86,
  margin: 20,
  float: false,
  animate: true,
  handle: ".widget-drag-handle",
  alwaysShowResizeHandle: false,
  resizable: { handles: "se" },
  columnOpts: {
    breakpointForWindow: false,
    layout: "moveScale",
    breakpoints: [
      { w: 560, c: 1, layout: "list" },
      { w: 900, c: 6, layout: "moveScale" },
      { w: 9999, c: 12, layout: "moveScale" },
    ],
  },
};

function toLayouts(nodes: GridStackNode[]) {
  return nodes.reduce<Record<string, WidgetLayout>>((next, node) => {
    const id = node.id?.toString();
    if (!id) return next;
    next[id] = {
      x: node.x ?? 0,
      y: node.y ?? 0,
      w: node.w ?? 1,
      h: node.h ?? 1,
    };
    return next;
  }, {});
}

export function WidgetCanvas({
  children,
  layoutKey,
  widgetIds,
}: {
  children: React.ReactNode;
  layoutKey: string;
  widgetIds: string[];
}) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const gridRef = React.useRef<GridStack | null>(null);
  const syncLayouts = useWidgetStore((s) => s.syncLayouts);

  React.useEffect(() => {
    if (!rootRef.current || gridRef.current) return;

    const root = rootRef.current;
    const grid = GridStack.init(GRID_OPTIONS, rootRef.current);
    gridRef.current = grid;

    grid.on("change", (_event, nodes) => {
      if (grid.getColumn() !== 12) return;
      syncLayouts(toLayouts(nodes));
    });

    function handleWidgetRemove(event: Event) {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      const item = Array.from(root.querySelectorAll<HTMLElement>(".grid-stack-item")).find(
        (el) => el.getAttribute("gs-id") === id
      );
      if (item) grid.removeWidget(item, true, false);
    }

    root.addEventListener("minutia:widget-remove", handleWidgetRemove);

    return () => {
      root.removeEventListener("minutia:widget-remove", handleWidgetRemove);
      grid.destroy(false);
      gridRef.current = null;
    };
  }, [syncLayouts]);

  React.useEffect(() => {
    const grid = gridRef.current;
    const root = rootRef.current;
    if (!grid || !root) return;

    const activeIds = new Set(widgetIds);
    root.querySelectorAll<HTMLElement>(".grid-stack-item").forEach((el) => {
      const id = el.getAttribute("gs-id");
      if (id && !activeIds.has(id)) el.remove();
    });

    grid.batchUpdate();
    grid.removeAll(false, false);
    root.querySelectorAll<HTMLElement>(".grid-stack-item").forEach((el) => {
      grid.makeWidget(el);
    });
    grid.batchUpdate(false);
  }, [layoutKey, widgetIds]);

  return (
    <div
      ref={rootRef}
      className="grid-stack"
      data-grid-engine="gridstack"
      data-testid="dashboard-widget-canvas"
    >
      {children}
    </div>
  );
}
