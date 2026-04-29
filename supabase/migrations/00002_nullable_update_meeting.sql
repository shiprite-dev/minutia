-- Allow issue_updates without a meeting context (standalone comments/status changes)
ALTER TABLE public.issue_updates
  ALTER COLUMN meeting_id DROP NOT NULL;
