"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { CATEGORY_CONFIG, ISSUE_CATEGORIES } from "@/lib/constants";
import type { IssueCategory } from "@/lib/types";

interface CaptureInputProps {
  onSubmit: (text: string, category: IssueCategory) => void;
  onCancel?: () => void;
}

export function CaptureInput({ onSubmit, onCancel }: CaptureInputProps) {
  const [text, setText] = React.useState("");
  const [category, setCategory] = React.useState<IssueCategory>("action");
  const [showGlow, setShowGlow] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function handleTextChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setText(value);

    // Auto-detect category from prefix shortcut
    if (value.length === 2 && value[1] === " ") {
      const prefix = value[0].toLowerCase();
      const matched = ISSUE_CATEGORIES.find(
        (cat) => CATEGORY_CONFIG[cat].shortcut === prefix
      );
      if (matched) {
        setCategory(matched);
        setText("");
        return;
      }
    }
  }

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;

    setShowGlow(true);
    setTimeout(() => setShowGlow(false), 120);

    onSubmit(trimmed, category);
    setText("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel?.();
    }
  }

  return (
    <div className="relative">
      <AnimatePresence>
        {showGlow && (
          <motion.div
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-0 bg-accent/10 rounded-md pointer-events-none"
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      <div className="flex items-end gap-3">
        {/* Text input */}
        <div className="flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder="Capture an item... (type a/d/i/r + space for category)"
            rows={1}
            className={cn(
              "w-full resize-none bg-transparent border-0 border-b border-rule",
              "text-sm text-ink placeholder:text-ink-4",
              "py-2 px-0 outline-none",
              "focus:border-b-ink transition-colors"
            )}
            aria-label="Capture input"
          />
        </div>

        {/* Category buttons */}
        <div
          className="flex items-center gap-1 pb-2"
          role="radiogroup"
          aria-label="Issue category"
        >
          {ISSUE_CATEGORIES.map((cat) => {
            const config = CATEGORY_CONFIG[cat];
            const isSelected = category === cat;
            return (
              <button
                key={cat}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={config.label}
                title={`${config.label} (${config.shortcut})`}
                className={cn(
                  "size-7 flex items-center justify-center rounded text-xs font-medium transition-colors outline-none",
                  "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper",
                  isSelected
                    ? "bg-ink text-paper"
                    : "bg-paper-2 text-ink-3 hover:text-ink-2 hover:bg-paper-3"
                )}
                onClick={() => setCategory(cat)}
              >
                {config.shortcut.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>

      {/* Helper text */}
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px] text-ink-4">
          Enter to submit, Shift+Enter for newline, Esc to cancel
        </span>
        <span className="text-[10px] text-ink-3 font-medium">
          {CATEGORY_CONFIG[category].glyph} {CATEGORY_CONFIG[category].label}
        </span>
      </div>
    </div>
  );
}
