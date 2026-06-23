-- =============================================================================
-- Transcription pipeline support.
-- =============================================================================
-- Records when a transcription run began so the /transcribe route can atomically
-- claim a meeting (one run at a time) and reclaim a row whose run crashed and
-- left it stuck in 'processing'. Nullable and additive; no backfill needed.
-- =============================================================================

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS transcription_started_at timestamptz;
