"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCreateIssue } from "@/lib/hooks/use-issues";
import { useSeries } from "@/lib/hooks/use-series";
import { useAllMeetings } from "@/lib/hooks/use-meetings";
import { useUIStore } from "@/lib/stores/ui-store";
import { CATEGORY_CONFIG } from "@/lib/constants";
import type { IssueCategory } from "@/lib/types";

export function QuickAddDialog() {
  const open = useUIStore((s) => s.quickAddDialogOpen);
  const closeQuickAddDialog = useUIStore((s) => s.closeQuickAddDialog);

  const [title, setTitle] = React.useState("");
  const [seriesId, setSeriesId] = React.useState("");
  const [category, setCategory] = React.useState<IssueCategory>("action");
  const [error, setError] = React.useState<string | null>(null);
  const titleRef = React.useRef<HTMLInputElement>(null);

  const createIssue = useCreateIssue();
  const { data: seriesList = [] } = useSeries(open);
  const { data: allMeetings = [] } = useAllMeetings();

  const latestMeetingId = React.useMemo(() => {
    if (!seriesId) return null;
    const seriesMeetings = allMeetings.filter(
      (m) => m.series_id === seriesId,
    );
    if (!seriesMeetings.length) return null;
    const sorted = [...seriesMeetings].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    return sorted[0].id;
  }, [allMeetings, seriesId]);

  React.useEffect(() => {
    if (open && titleRef.current) {
      // Small delay so the dialog animation finishes before focus.
      const timer = setTimeout(() => titleRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Reset state when dialog closes.
  React.useEffect(() => {
    if (!open) {
      setTitle("");
      setSeriesId("");
      setCategory("action");
      setError(null);
    }
  }, [open]);

  // Auto-select first series when dialog opens.
  React.useEffect(() => {
    if (open && seriesList.length > 0 && !seriesId) {
      setSeriesId(seriesList[0].id);
    }
  }, [open, seriesList, seriesId]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    if (!seriesId) {
      setError("Please select a series");
      return;
    }

    if (!latestMeetingId) {
      setError("No meeting found for this series. Create a meeting first.");
      return;
    }

    createIssue.mutate(
      {
        title: title.trim(),
        category,
        priority: "medium",
        meeting_id: latestMeetingId,
        series_id: seriesId,
      },
      {
        onSuccess: () => {
          closeQuickAddDialog();
        },
        onError: () => {
          setError("Failed to create issue. Please try again.");
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeQuickAddDialog();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">
            Quick add issue
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="quick-add-title"
              className="text-[11px] font-mono uppercase tracking-wider text-ink-3"
            >
              Issue title
            </label>
            <Input
              id="quick-add-title"
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be tracked?"
              aria-label="Issue title"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  closeQuickAddDialog();
                }
              }}
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="quick-add-series"
              className="text-[11px] font-mono uppercase tracking-wider text-ink-3"
            >
              Series
            </label>
            <Select
              value={seriesId}
              onValueChange={setSeriesId}
            >
              <SelectTrigger id="quick-add-series" className="w-full" aria-label="Series">
                <SelectValue placeholder="Select a series" />
              </SelectTrigger>
              <SelectContent>
                {seriesList.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="quick-add-category"
              className="text-[11px] font-mono uppercase tracking-wider text-ink-3"
            >
              Category
            </label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as IssueCategory)}
            >
              <SelectTrigger id="quick-add-category" className="w-full" aria-label="Category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    {config.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={closeQuickAddDialog}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={createIssue.isPending}>
              {createIssue.isPending ? "Adding..." : "Add issue"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}