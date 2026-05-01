"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string[]; label: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Global",
    shortcuts: [
      { keys: ["⌘", "K"], label: "Command palette" },
      { keys: ["N"], label: "New issue" },
      { keys: ["G", "O"], label: "Go to OIL Board" },
      { keys: ["G", "S"], label: "Go to Series" },
      { keys: ["G", "A"], label: "Go to My Actions" },
      { keys: ["G", "I"], label: "Go to Inbox" },
      { keys: ["/"], label: "Focus search" },
      { keys: ["?"], label: "Show shortcuts" },
    ],
  },
  {
    title: "OIL Board",
    shortcuts: [
      { keys: ["J"], label: "Next item" },
      { keys: ["K"], label: "Previous item" },
      { keys: ["Enter"], label: "Open focused item" },
    ],
  },
  {
    title: "Issue Detail",
    shortcuts: [
      { keys: ["S"], label: "Cycle status" },
      { keys: ["R"], label: "Mark resolved" },
      { keys: ["D"], label: "Mark dropped" },
      { keys: ["C"], label: "Add update" },
      { keys: ["Esc"], label: "Back to board" },
    ],
  },
  {
    title: "Live Capture",
    shortcuts: [
      { keys: ["A", "Space"], label: "Set category: Action" },
      { keys: ["D", "Space"], label: "Set category: Decision" },
      { keys: ["I", "Space"], label: "Set category: Info" },
      { keys: ["R", "Space"], label: "Set category: Risk" },
      { keys: ["Enter"], label: "Submit item" },
      { keys: ["Shift", "Enter"], label: "New line" },
      { keys: ["Esc"], label: "Exit capture" },
    ],
  },
];

export function KeyboardShortcutsDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">
            Keyboard shortcuts
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-[11px] font-mono uppercase tracking-wider text-ink-3 mb-2">
                {group.title}
              </h3>
              <div className="space-y-1">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.label}
                    className="flex items-center justify-between py-1.5"
                  >
                    <span className="text-sm text-ink-2">{shortcut.label}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, i) => (
                        <span key={i}>
                          <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded bg-paper-2 border border-rule text-[11px] font-mono font-medium text-ink-2">
                            {key}
                          </kbd>
                          {i < shortcut.keys.length - 1 && key !== "⌘" && (
                            <span className="text-ink-4 text-[10px] mx-0.5">then</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
