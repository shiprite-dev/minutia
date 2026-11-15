"use client";

import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { flushSync } from "react-dom";
import { MarkdownBlocks } from "@/components/minutia/markdown-blocks";
import { parseRecap } from "@/lib/summary/structure";

const typography = "max-w-[65ch] font-sans text-[15px] leading-7 text-ink";

export function MeetingNotesSurface({
  webNotes,
  companionNotes,
  canEdit,
  onChange,
  textareaRef,
}: {
  webNotes: string;
  companionNotes: string;
  canEdit: boolean;
  onChange: (value: string) => void;
  textareaRef: Ref<{ focus: () => void }>;
}) {
  const [editing, setEditing] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  function edit() {
    if (!canEdit) return;
    flushSync(() => setEditing(true));
    const area = areaRef.current;
    if (!area) return;
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  }

  useImperativeHandle(textareaRef, () => ({ focus: edit }));

  const hasNotes = !!webNotes.trim();
  const showRendered = hasNotes && !editing;
  const showTextarea = canEdit && !showRendered;

  const rendered = showRendered && (
    <div
      data-notes-rendered
      className={
        typography +
        (canEdit
          ? " -ml-3 cursor-text rounded-md pl-3 hover:bg-paper-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          : "")
      }
      {...(canEdit && {
        role: "group",
        "aria-label": "Edit notes",
        tabIndex: 0,
        onClick: () => {
          if (window.getSelection()?.isCollapsed !== false) edit();
        },
        onKeyDown: (e: React.KeyboardEvent) => {
          if (
            e.target === e.currentTarget &&
            (e.key === "Enter" || e.key === " ")
          ) {
            e.preventDefault();
            edit();
          }
        },
      })}
    >
      <MarkdownBlocks blocks={parseRecap(webNotes, { lines: true })} dense />
    </div>
  );
  const textarea = showTextarea && (
    <textarea
      ref={areaRef}
      value={webNotes}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setEditing(true)}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
      placeholder="Meeting notes..."
      rows={1}
      className="field-sizing-content -ml-3 block min-h-[1.75rem] w-full max-w-[65ch] resize-none border-0 border-l-2 border-transparent bg-transparent pl-3 font-sans text-[15px] leading-7 text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none"
    />
  );
  const web = rendered || textarea;
  const desktop = companionNotes ? (
    <div>
      <h3 className="mb-2 font-mono text-[11px] font-medium uppercase tracking-wider text-ink-4">
        From your desktop notepad
      </h3>
      <div data-desktop-notes className={typography}>
        <MarkdownBlocks
          blocks={parseRecap(companionNotes, { lines: true })}
          dense
        />
      </div>
    </div>
  ) : null;
  if (!hasNotes && desktop) {
    return (
      <div className="space-y-4">
        {desktop}
        {web}
      </div>
    );
  }
  return (
    <div>
      {web}
      {web && desktop && <div className="my-6 border-t border-rule" />}
      {desktop}
    </div>
  );
}
