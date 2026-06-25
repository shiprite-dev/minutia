-- =============================================================================
-- MIN-121: Context-aware AI suggestions
-- =============================================================================
-- Extends meeting_ai_suggestions so a suggestion can describe how it relates to
-- the existing OIL, not just propose a brand-new item:
--   - type                  new_item | status_update | duplicate_warning
--   - related_issue_number  the OIL item (issues.issue_number) it references
--   - suggested_status      the status a status_update would move that item to
-- Legacy rows are new_item by default (they predate cross-meeting context), so
-- the backfill is a no-op and the change is fully backward compatible.
-- =============================================================================

ALTER TABLE public.meeting_ai_suggestions
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'new_item'
    CHECK (type IN ('new_item', 'status_update', 'duplicate_warning')),
  ADD COLUMN IF NOT EXISTS related_issue_number integer,
  ADD COLUMN IF NOT EXISTS suggested_status text
    CHECK (
      suggested_status IS NULL
      OR suggested_status IN ('open', 'in_progress', 'pending', 'resolved', 'dropped')
    );
