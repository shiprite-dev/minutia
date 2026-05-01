"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import Link from "next/link";
import {
  Check,
  Plus,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORY_CONFIG } from "@/lib/constants";
import type { Issue, IssueCategory, IssueStatus } from "@/lib/types";

interface InlineTaskListProps {
  issues: Issue[];
  attendees: string[];
  onStatusChange: (issueId: string, newStatus: IssueStatus) => void;
  onTitleChange?: (issueId: string, title: string) => void;
  onAssigneeChange?: (issueId: string, ownerName: string | null) => void;
  onAddItem?: (title: string, category: IssueCategory) => void;
  readOnly?: boolean;
}

const categoryColors: Record<IssueCategory, string> = {
  action: "bg-blue-100 text-blue-700",
  blocker: "bg-red-100 text-red-700",
  risk: "bg-amber-100 text-amber-700",
  decision: "bg-purple-100 text-purple-700",
  info: "bg-gray-100 text-gray-500",
};

function InlineTaskItem({
  issue,
  attendees,
  onStatusChange,
  onTitleChange,
  onAssigneeChange,
  readOnly,
  index,
  isFocused,
  onFocus,
}: {
  issue: Issue;
  attendees: string[];
  onStatusChange: (issueId: string, newStatus: IssueStatus) => void;
  onTitleChange?: (issueId: string, title: string) => void;
  onAssigneeChange?: (issueId: string, ownerName: string | null) => void;
  readOnly?: boolean;
  index: number;
  isFocused: boolean;
  onFocus: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(issue.title);
  const [mentionOpen, setMentionOpen] = React.useState(false);
  const [mentionFilter, setMentionFilter] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const mentionRef = React.useRef<HTMLDivElement>(null);
  const itemRef = React.useRef<HTMLDivElement>(null);

  const isChecked = issue.status === "resolved" || issue.status === "dropped";

  React.useEffect(() => {
    setEditValue(issue.title);
  }, [issue.title]);

  React.useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (mentionRef.current && !mentionRef.current.contains(e.target as Node)) {
        setMentionOpen(false);
      }
    }
    if (mentionOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [mentionOpen]);

  function handleCheckboxClick() {
    if (readOnly) return;
    const newStatus: IssueStatus = isChecked ? "open" : "resolved";
    onStatusChange(issue.id, newStatus);
  }

  function handleTitleSubmit() {
    setEditing(false);
    if (editValue.trim() && editValue !== issue.title && onTitleChange) {
      onTitleChange(issue.id, editValue.trim());
    } else {
      setEditValue(issue.title);
    }
  }

  function handleTitleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleTitleSubmit();
    }
    if (e.key === "Escape") {
      setEditValue(issue.title);
      setEditing(false);
    }
    if (e.key === "@" && !readOnly && attendees.length > 0) {
      setMentionFilter("");
      setMentionOpen(true);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (readOnly || editing) return;
    if (e.key === " ") {
      e.preventDefault();
      handleCheckboxClick();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      setEditing(true);
    }
  }

  function handleAssign(name: string) {
    setMentionOpen(false);
    setMentionFilter("");
    if (onAssigneeChange) {
      onAssigneeChange(issue.id, name);
    }
  }

  const filteredAttendees = attendees.filter((a) =>
    a.toLowerCase().includes(mentionFilter.toLowerCase())
  );

  const config = CATEGORY_CONFIG[issue.category];

  return (
    <motion.div
      ref={itemRef}
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={{ duration: 0.15, delay: index * 0.02 }}
      tabIndex={readOnly ? undefined : 0}
      onFocus={onFocus}
      onKeyDown={handleKeyDown}
      className={cn(
        "group flex items-center gap-3 py-2 px-3 -mx-3 rounded-lg transition-colors outline-none",
        !readOnly && "hover:bg-paper-2 focus-visible:ring-1 focus-visible:ring-accent",
        isFocused && !readOnly && "bg-paper-2",
      )}
    >
      {/* Checkbox */}
      <button
        type="button"
        onClick={handleCheckboxClick}
        disabled={readOnly}
        aria-label={isChecked ? "Mark incomplete" : "Mark complete"}
        className={cn(
          "size-5 rounded border-2 shrink-0 flex items-center justify-center transition-all",
          isChecked
            ? "bg-success border-success text-white"
            : "border-rule hover:border-ink-3",
          readOnly && "cursor-default",
        )}
      >
        {isChecked && <Check className="size-3" strokeWidth={3} />}
      </button>

      {/* Title (editable or link) */}
      <div className="flex-1 min-w-0 relative">
        {editing && !readOnly ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={handleTitleKeyDown}
            className="w-full bg-transparent text-sm text-ink outline-none border-b border-accent py-0.5"
          />
        ) : (
          <Link
            href={`/issues/${issue.id}`}
            onClick={(e) => {
              if (!readOnly) {
                e.preventDefault();
                setEditing(true);
              }
            }}
            onDoubleClick={(e) => {
              e.preventDefault();
              setEditing(true);
            }}
            className={cn(
              "text-sm transition-colors block truncate",
              isChecked
                ? "line-through text-ink-3"
                : "text-ink hover:text-accent",
            )}
          >
            {issue.title}
          </Link>
        )}

        {/* @mention dropdown */}
        {mentionOpen && (
          <div
            ref={mentionRef}
            className="absolute left-0 top-full mt-1 z-50 w-56 rounded-lg border border-rule bg-paper shadow-lg py-1"
          >
            <div className="px-2 pb-1">
              <input
                type="text"
                value={mentionFilter}
                onChange={(e) => setMentionFilter(e.target.value)}
                placeholder="Search attendees..."
                className="w-full text-xs bg-paper-2 rounded px-2 py-1.5 outline-none border border-rule"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Escape") setMentionOpen(false);
                  if (e.key === "Enter" && filteredAttendees.length > 0) {
                    handleAssign(filteredAttendees[0]);
                  }
                }}
              />
            </div>
            {filteredAttendees.length === 0 ? (
              <p className="text-xs text-ink-4 px-3 py-2">No matches</p>
            ) : (
              filteredAttendees.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => handleAssign(name)}
                  className="w-full text-left px-3 py-1.5 text-sm text-ink hover:bg-paper-2 transition-colors flex items-center gap-2"
                >
                  <span className="inline-flex items-center justify-center size-5 rounded-full bg-accent text-white text-[9px] font-medium shrink-0">
                    {name.charAt(0).toUpperCase()}
                  </span>
                  {name}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Category pill */}
      <span
        className={cn(
          "text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0",
          categoryColors[issue.category],
        )}
      >
        {config.label}
      </span>

      {/* Assignee chip */}
      {issue.owner_name ? (
        <button
          type="button"
          onClick={() => !readOnly && setMentionOpen(true)}
          disabled={readOnly}
          className="flex items-center gap-1 shrink-0 group/assign"
        >
          <span className="inline-flex items-center justify-center size-5 rounded-full bg-ink text-paper text-[9px] font-medium">
            {issue.owner_name.charAt(0).toUpperCase()}
          </span>
          <span className="text-xs text-ink-3 max-w-[80px] truncate hidden sm:inline group-hover/assign:text-ink transition-colors">
            {issue.owner_name}
          </span>
        </button>
      ) : !readOnly ? (
        <button
          type="button"
          onClick={() => setMentionOpen(true)}
          className="text-xs text-ink-4 hover:text-ink-2 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
          aria-label="Assign"
        >
          @
        </button>
      ) : null}
    </motion.div>
  );
}

export function InlineTaskList({
  issues,
  attendees,
  onStatusChange,
  onTitleChange,
  onAssigneeChange,
  onAddItem,
  readOnly,
}: InlineTaskListProps) {
  const [focusedIndex, setFocusedIndex] = React.useState(-1);
  const [addingItem, setAddingItem] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState("");
  const [newCategory, setNewCategory] = React.useState<IssueCategory>("action");
  const [categoryPickerOpen, setCategoryPickerOpen] = React.useState(false);
  const addInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (addingItem && addInputRef.current) {
      addInputRef.current.focus();
    }
  }, [addingItem]);

  function handleAddSubmit() {
    if (newTitle.trim() && onAddItem) {
      onAddItem(newTitle.trim(), newCategory);
      setNewTitle("");
    }
  }

  function handleAddKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddSubmit();
    }
    if (e.key === "Escape") {
      setAddingItem(false);
      setNewTitle("");
    }
  }

  return (
    <div>
      <AnimatePresence mode="popLayout">
        {issues.map((issue, idx) => (
          <InlineTaskItem
            key={issue.id}
            issue={issue}
            attendees={attendees}
            onStatusChange={onStatusChange}
            onTitleChange={onTitleChange}
            onAssigneeChange={onAssigneeChange}
            readOnly={readOnly}
            index={idx}
            isFocused={focusedIndex === idx}
            onFocus={() => setFocusedIndex(idx)}
          />
        ))}
      </AnimatePresence>

      {issues.length === 0 && !addingItem && !readOnly && (
        <p className="text-sm text-ink-4 py-4 text-center">
          No items raised yet. Press the button below to add one.
        </p>
      )}

      {/* Add new item row */}
      {!readOnly && onAddItem && (
        <div className="mt-1">
          {addingItem ? (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 py-2 px-3 -mx-3 rounded-lg bg-paper-2"
            >
              <span className="size-5 rounded border-2 border-dashed border-rule shrink-0" />
              <input
                ref={addInputRef}
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={handleAddKeyDown}
                onBlur={() => {
                  if (!newTitle.trim()) setAddingItem(false);
                }}
                placeholder="Type item title, press Enter..."
                className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4"
              />
              <div className="relative" ref={(el) => {
                if (el) {
                  const handler = (e: MouseEvent) => {
                    if (!el.contains(e.target as Node)) setCategoryPickerOpen(false);
                  };
                  document.addEventListener("mousedown", handler);
                  return () => document.removeEventListener("mousedown", handler);
                }
              }}>
                <button
                  type="button"
                  onClick={() => setCategoryPickerOpen(!categoryPickerOpen)}
                  className={cn(
                    "text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1",
                    categoryColors[newCategory],
                  )}
                >
                  {CATEGORY_CONFIG[newCategory].label}
                  <ChevronDown className="size-3" />
                </button>
                {categoryPickerOpen && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-32 rounded-lg border border-rule bg-paper shadow-lg py-1">
                    {(Object.keys(CATEGORY_CONFIG) as IssueCategory[]).map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => {
                          setNewCategory(cat);
                          setCategoryPickerOpen(false);
                        }}
                        className={cn(
                          "w-full text-left px-3 py-1.5 text-xs hover:bg-paper-2 transition-colors flex items-center gap-2",
                          cat === newCategory && "font-semibold",
                        )}
                      >
                        <span className={cn("size-2 rounded-full", categoryColors[cat].split(" ")[0])} />
                        {CATEGORY_CONFIG[cat].label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <button
              type="button"
              onClick={() => setAddingItem(true)}
              className="flex items-center gap-2 text-xs text-ink-4 hover:text-ink-2 transition-colors py-2 px-3 -mx-3 rounded-lg hover:bg-paper-2 w-full"
            >
              <Plus className="size-3.5" />
              Add item
            </button>
          )}
        </div>
      )}
    </div>
  );
}
