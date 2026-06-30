-- Add 'daily' as a meeting-series cadence option.
-- The original constraint was an inline column CHECK in 00001, auto-named
-- meeting_series_cadence_check. Drop and recreate it with 'daily' included.

ALTER TABLE public.meeting_series
  DROP CONSTRAINT IF EXISTS meeting_series_cadence_check,
  ADD CONSTRAINT meeting_series_cadence_check
    CHECK (cadence IN ('daily', 'weekly', 'biweekly', 'monthly', 'adhoc'));
