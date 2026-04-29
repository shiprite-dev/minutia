import type { Issue } from "@/lib/types";

function issueToCsvRow(issue: Issue): Record<string, string> {
  return {
    Title: issue.title,
    Description: issue.description ?? "",
    Category: issue.category,
    Status: issue.status,
    Priority: issue.priority,
    Owner: issue.owner_name ?? "",
    "Due Date": issue.due_date ? String(issue.due_date) : "",
    "Created At": String(issue.created_at),
  };
}

function escapeCsvField(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

export function issuesToCsv(issues: Issue[]): string {
  if (issues.length === 0) return "";
  const rows = issues.map(issueToCsvRow);
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(escapeCsvField).join(","),
    ...rows.map((row) =>
      headers.map((h) => escapeCsvField(row[h] ?? "")).join(",")
    ),
  ];
  return lines.join("\n");
}

export function issuesToJson(issues: Issue[]): string {
  const data = issues.map((issue) => ({
    title: issue.title,
    description: issue.description,
    category: issue.category,
    status: issue.status,
    priority: issue.priority,
    owner: issue.owner_name,
    due_date: issue.due_date,
    created_at: issue.created_at,
  }));
  return JSON.stringify(data, null, 2);
}

export function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
