import type { Ref } from "react";

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
  textareaRef: Ref<HTMLTextAreaElement>;
}) {
  const textarea = (
    <textarea
      ref={textareaRef}
      value={webNotes}
      onChange={(e) => onChange(e.target.value)}
      readOnly={!canEdit}
      placeholder="Meeting notes..."
      rows={1}
      className="field-sizing-content -ml-3 block min-h-[1.75rem] w-full max-w-[65ch] resize-none border-0 border-l-2 border-transparent bg-transparent pl-3 font-sans text-[15px] leading-7 text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none"
    />
  );
  const desktop = companionNotes ? (
    <div>
      <h3 className="mb-2 font-mono text-[11px] font-medium uppercase tracking-wider text-ink-4">
        From your desktop notepad
      </h3>
      <pre className="max-w-[65ch] whitespace-pre-wrap font-sans text-[15px] leading-7 text-ink">
        {companionNotes}
      </pre>
    </div>
  ) : null;
  if (!webNotes.trim() && desktop) {
    return (
      <div className="space-y-4">
        {desktop}
        {textarea}
      </div>
    );
  }
  return (
    <div>
      {textarea}
      {desktop && <div className="my-6 border-t border-rule" />}
      {desktop}
    </div>
  );
}
