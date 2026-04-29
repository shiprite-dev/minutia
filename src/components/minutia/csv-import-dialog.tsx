"use client";

import * as React from "react";
import { useState, useCallback, useMemo } from "react";
import Papa from "papaparse";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { issueKeys } from "@/lib/hooks/use-issues";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, FileSpreadsheet, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IssueCategory, IssueStatus, Priority } from "@/lib/types";

// ---------------------------------------------------------------------------
// Column mapping types
// ---------------------------------------------------------------------------

const MAPPABLE_FIELDS = [
  { key: "title", label: "Title", required: true },
  { key: "description", label: "Description" },
  { key: "category", label: "Category" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "owner_name", label: "Owner" },
  { key: "due_date", label: "Due date" },
] as const;

type FieldKey = (typeof MAPPABLE_FIELDS)[number]["key"];

type ColumnMapping = Record<string, FieldKey | "skip">;

// ---------------------------------------------------------------------------
// Smart matching: auto-detect CSV columns to fields
// ---------------------------------------------------------------------------

const FIELD_SYNONYMS: Record<FieldKey, string[]> = {
  title: ["title", "name", "summary", "subject", "item", "issue", "task", "action"],
  description: ["description", "desc", "details", "notes", "body", "content"],
  category: ["category", "type", "kind", "label", "tag"],
  status: ["status", "state", "progress"],
  priority: ["priority", "urgency", "severity", "importance", "prio"],
  owner_name: ["owner", "assignee", "assigned", "responsible", "who", "person"],
  due_date: ["due", "due_date", "duedate", "deadline", "date", "target_date", "target"],
};

function autoMapColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const usedFields = new Set<FieldKey>();

  for (const header of headers) {
    const normalized = header.toLowerCase().replace(/[^a-z0-9]/g, "");
    let bestMatch: FieldKey | null = null;
    let bestScore = 0;

    for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS) as [FieldKey, string[]][]) {
      if (usedFields.has(field)) continue;
      for (const synonym of synonyms) {
        const normalizedSyn = synonym.replace(/[^a-z0-9]/g, "");
        if (normalized === normalizedSyn) {
          bestMatch = field;
          bestScore = 100;
          break;
        }
        if (normalized.includes(normalizedSyn) && normalizedSyn.length > bestScore) {
          bestMatch = field;
          bestScore = normalizedSyn.length;
        }
      }
      if (bestScore === 100) break;
    }

    if (bestMatch && bestScore > 0) {
      mapping[header] = bestMatch;
      usedFields.add(bestMatch);
    } else {
      mapping[header] = "skip";
    }
  }

  return mapping;
}

// ---------------------------------------------------------------------------
// Value normalization
// ---------------------------------------------------------------------------

const CATEGORY_MAP: Record<string, IssueCategory> = {
  action: "action", task: "action", todo: "action",
  decision: "decision",
  info: "info", fyi: "info", note: "info", information: "info",
  risk: "risk", warning: "risk",
  blocker: "blocker", blocked: "blocker",
};

const STATUS_MAP: Record<string, IssueStatus> = {
  open: "open", new: "open", backlog: "open", todo: "open",
  in_progress: "in_progress", "in progress": "in_progress", active: "in_progress", doing: "in_progress", wip: "in_progress",
  pending: "pending", waiting: "pending", review: "pending", blocked: "pending",
  resolved: "resolved", done: "resolved", closed: "resolved", completed: "resolved", fixed: "resolved",
  dropped: "dropped", cancelled: "dropped", canceled: "dropped", wontfix: "dropped",
};

const PRIORITY_MAP: Record<string, Priority> = {
  low: "low", minor: "low", p3: "low", p4: "low",
  medium: "medium", normal: "medium", moderate: "medium", p2: "medium",
  high: "high", major: "high", p1: "high",
  critical: "critical", urgent: "critical", blocker: "critical", p0: "critical",
};

function normalizeValue(field: FieldKey, raw: string): string | null {
  const val = raw.trim();
  if (!val) return null;

  switch (field) {
    case "category":
      return CATEGORY_MAP[val.toLowerCase().replace(/[^a-z]/g, "")] ?? "action";
    case "status":
      return STATUS_MAP[val.toLowerCase().replace(/[_-]/g, " ").trim()] ?? "open";
    case "priority":
      return PRIORITY_MAP[val.toLowerCase().replace(/[^a-z0-9]/g, "")] ?? "medium";
    case "due_date": {
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    default:
      return val;
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

type Step = "upload" | "map" | "preview" | "done";

interface CsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seriesId: string;
  meetingId: string;
}

export function CsvImportDialog({
  open,
  onOpenChange,
  seriesId,
  meetingId,
}: CsvImportDialogProps) {
  const [step, setStep] = useState<Step>("upload");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [importCount, setImportCount] = useState(0);

  const queryClient = useQueryClient();
  const supabase = createClient();

  const reset = useCallback(() => {
    setStep("upload");
    setHeaders([]);
    setRows([]);
    setMapping({});
    setImportCount(0);
  }, []);

  function handleOpenChange(v: boolean) {
    if (!v) reset();
    onOpenChange(v);
  }

  // Parse CSV file
  const handleFile = useCallback((file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        if (!result.meta.fields?.length || result.data.length === 0) return;
        setHeaders(result.meta.fields);
        setRows(result.data);
        setMapping(autoMapColumns(result.meta.fields));
        setStep("map");
      },
    });
  }, []);

  // Drop handler
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith(".csv") || file.type === "text/csv")) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  // File input handler
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  // Build preview rows from mapping
  const previewRows = useMemo(() => {
    const titleCol = Object.entries(mapping).find(([, v]) => v === "title")?.[0];
    if (!titleCol) return [];

    return rows.slice(0, 100).map((row) => {
      const mapped: Record<string, string | null> = {};
      for (const [col, field] of Object.entries(mapping)) {
        if (field === "skip") continue;
        mapped[field] = normalizeValue(field, row[col] ?? "");
      }
      return mapped;
    });
  }, [rows, mapping]);

  const titleMapped = Object.values(mapping).includes("title");

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const titleCol = Object.entries(mapping).find(([, v]) => v === "title")?.[0];
      if (!titleCol) throw new Error("No title column mapped");

      const issueRows = rows
        .map((row) => {
          const title = (row[titleCol] ?? "").trim();
          if (!title) return null;

          const issue: Record<string, unknown> = {
            title,
            series_id: seriesId,
            raised_in_meeting_id: meetingId,
            source: "manual" as const,
            owner_user_id: user.id,
          };

          for (const [col, field] of Object.entries(mapping)) {
            if (field === "skip" || field === "title") continue;
            const val = normalizeValue(field, row[col] ?? "");
            if (val !== null) issue[field] = val;
          }

          return issue;
        })
        .filter(Boolean);

      if (issueRows.length === 0) throw new Error("No valid rows to import");

      const { error } = await supabase.from("issues").insert(issueRows);
      if (error) throw error;
      return issueRows.length;
    },
    onSuccess: (count) => {
      setImportCount(count);
      setStep("done");
      queryClient.invalidateQueries({ queryKey: issueKeys.all });
    },
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {step === "upload" && "Import from CSV"}
            {step === "map" && "Map columns"}
            {step === "preview" && "Preview import"}
            {step === "done" && "Import complete"}
          </DialogTitle>
        </DialogHeader>

        {/* Step: Upload */}
        {step === "upload" && (
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed border-rule p-12 transition-colors hover:border-ink-3"
          >
            <Upload className="size-8 text-ink-3" />
            <div className="text-center">
              <p className="text-sm font-medium text-ink">
                Drag and drop a CSV file
              </p>
              <p className="mt-1 text-xs text-ink-3">
                or click to browse
              </p>
            </div>
            <label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleInputChange}
                className="sr-only"
              />
              <span className="inline-flex cursor-pointer items-center rounded-md border border-rule px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-paper-2">
                Choose file
              </span>
            </label>
          </div>
        )}

        {/* Step: Map columns */}
        {step === "map" && (
          <div className="flex-1 overflow-y-auto space-y-3">
            <p className="text-xs text-ink-3">
              {rows.length} rows found. Map your CSV columns to Minutia fields.
            </p>
            {headers.map((header) => (
              <div
                key={header}
                className="flex items-center gap-3"
              >
                <span className="text-sm text-ink truncate w-36 shrink-0 font-mono">
                  {header}
                </span>
                <span className="text-ink-4 text-xs shrink-0">&rarr;</span>
                <Select
                  value={mapping[header] ?? "skip"}
                  onValueChange={(val) =>
                    setMapping((prev) => ({ ...prev, [header]: val as FieldKey | "skip" }))
                  }
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip">Skip</SelectItem>
                    {MAPPABLE_FIELDS.map((f) => (
                      <SelectItem key={f.key} value={f.key}>
                        {f.label}
                        {"required" in f && f.required ? " *" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}

        {/* Step: Preview */}
        {step === "preview" && (
          <div className="flex-1 overflow-auto">
            <p className="text-xs text-ink-3 mb-3">
              Previewing {Math.min(previewRows.length, 10)} of {rows.length} rows.
            </p>
            <div className="overflow-x-auto rounded-md border border-rule">
              <table className="w-full text-xs">
                <thead className="bg-paper-2">
                  <tr>
                    {MAPPABLE_FIELDS.filter((f) =>
                      Object.values(mapping).includes(f.key)
                    ).map((f) => (
                      <th
                        key={f.key}
                        className="px-3 py-2 text-left font-medium text-ink-2 whitespace-nowrap"
                      >
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.slice(0, 10).map((row, i) => (
                    <tr key={i} className="border-t border-rule">
                      {MAPPABLE_FIELDS.filter((f) =>
                        Object.values(mapping).includes(f.key)
                      ).map((f) => (
                        <td
                          key={f.key}
                          className={cn(
                            "px-3 py-2 whitespace-nowrap max-w-[200px] truncate",
                            f.key === "title" ? "text-ink font-medium" : "text-ink-2"
                          )}
                        >
                          {row[f.key] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Step: Done */}
        {step === "done" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="flex items-center justify-center size-12 rounded-full bg-success/10">
              <Check className="size-6 text-success" />
            </div>
            <p className="text-sm font-medium text-ink">
              {importCount} items imported
            </p>
            <p className="text-xs text-ink-3">
              They appear on the OIL Board for this series.
            </p>
          </div>
        )}

        {/* Error */}
        {importMutation.isError && (
          <div className="flex items-center gap-2 text-xs text-danger">
            <AlertCircle className="size-3.5 shrink-0" />
            {importMutation.error?.message ?? "Import failed"}
          </div>
        )}

        {/* Footer */}
        <DialogFooter>
          {step === "map" && (
            <>
              <Button variant="ghost" size="sm" onClick={reset}>
                Back
              </Button>
              <Button
                size="sm"
                disabled={!titleMapped}
                onClick={() => setStep("preview")}
              >
                Preview
              </Button>
            </>
          )}
          {step === "preview" && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setStep("map")}>
                Back
              </Button>
              <Button
                size="sm"
                disabled={importMutation.isPending}
                onClick={() => importMutation.mutate()}
              >
                {importMutation.isPending ? (
                  <>
                    <FileSpreadsheet className="size-3.5 animate-pulse" />
                    Importing...
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="size-3.5" />
                    Import {rows.length} items
                  </>
                )}
              </Button>
            </>
          )}
          {step === "done" && (
            <Button size="sm" onClick={() => handleOpenChange(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
