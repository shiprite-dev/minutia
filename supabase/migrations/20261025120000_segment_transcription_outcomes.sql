-- ---------------------------------------------------------------------------
-- Segment transcription outcomes: persist confirmed silence as terminal.
--
-- Empty completed transcripts were previously indistinguishable from provider
-- failures, so every silent segment was retried forever and could never
-- complete its meeting. This adds a persisted outcome so confirmed no-speech
-- segments are terminal. Historical empty rows are reclassified as failed
-- (their emptiness is unexplained, so they stay retryable); their audio paths
-- are retained for that retry.
-- ---------------------------------------------------------------------------

alter table public.meeting_audio_segments
  add column if not exists transcription_outcome text;

-- Outcome vocabulary + consistency: no_speech requires a completed row with
-- empty text. speech may only sit on a completed row.
alter table public.meeting_audio_segments
  drop constraint if exists segment_transcription_outcome_consistent;
alter table public.meeting_audio_segments
  add constraint segment_transcription_outcome_consistent check (
    transcription_outcome is null
    or (
      transcription_outcome in ('speech', 'no_speech')
      and status = 'completed'
      and (
        (transcription_outcome = 'speech' and coalesce(btrim(transcript_text), '') <> '')
        or (transcription_outcome = 'no_speech' and coalesce(btrim(transcript_text), '') = '')
      )
    )
  );

-- Backfill: completed rows with real text are confirmed speech.
update public.meeting_audio_segments
   set transcription_outcome = 'speech'
 where status = 'completed'
   and coalesce(btrim(transcript_text), '') <> '';

-- Historical completed-empty rows have no silence evidence: reclassify as
-- failed/invalid_result so the resume path retries them instead of silently
-- trusting emptiness. Audio paths are kept for the retry.
update public.meeting_audio_segments
   set status = 'failed',
       error_code = 'invalid_result',
       transcription_outcome = null,
       updated_at = now()
 where status = 'completed'
   and coalesce(btrim(transcript_text), '') = '';