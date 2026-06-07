"use client";

import * as React from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useWidgetStore } from "@/lib/stores/widget-store";

// CSS Grid bento canvas. Row heights come from content (the browser's layout
// engine), so cards never clip; dnd-kit handles reorder. No GridStack.
export function WidgetCanvas({
  children,
  widgetIds,
}: {
  children: React.ReactNode;
  widgetIds: string[];
}) {
  const moveWidget = useWidgetStore((s) => s.moveWidget);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = widgetIds.indexOf(String(active.id));
    const to = widgetIds.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    moveWidget(from, to);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={widgetIds} strategy={rectSortingStrategy}>
        <div
          className="widget-grid"
          data-grid-engine="css-grid"
          data-testid="dashboard-widget-canvas"
        >
          {children}
        </div>
      </SortableContext>
    </DndContext>
  );
}
