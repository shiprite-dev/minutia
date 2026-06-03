-- Google Calendar agenda sync state for request-driven incremental sidebar refreshes.

CREATE TABLE IF NOT EXISTS public.google_calendar_sync_state (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id          uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  calendar_id              text        NOT NULL,
  sync_mode                text        NOT NULL DEFAULT 'agenda_window'
                                      CHECK (sync_mode IN ('agenda_window')),
  status                   text        NOT NULL DEFAULT 'never_synced'
                                      CHECK (status IN ('never_synced', 'synced', 'failed')),
  last_success_at          timestamptz,
  last_full_synced_at      timestamptz,
  last_incremental_synced_at timestamptz,
  last_sync_started_at     timestamptz,
  error_message            text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id, calendar_id, sync_mode)
);

DROP TRIGGER IF EXISTS set_google_calendar_sync_state_updated_at ON public.google_calendar_sync_state;
CREATE TRIGGER set_google_calendar_sync_state_updated_at
  BEFORE UPDATE ON public.google_calendar_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_google_calendar_sync_state_user
  ON public.google_calendar_sync_state(user_id, organization_id);

ALTER TABLE public.google_calendar_sync_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "google_calendar_sync_state_select_own" ON public.google_calendar_sync_state;
CREATE POLICY "google_calendar_sync_state_select_own"
  ON public.google_calendar_sync_state FOR SELECT
  USING (auth.uid() = user_id);

DROP INDEX IF EXISTS public.idx_meeting_series_gcal_owner_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_series_gcal_org_owner_key
  ON public.meeting_series(organization_id, owner_id, gcal_series_key)
  WHERE gcal_series_key IS NOT NULL;

ALTER TABLE public.google_calendar_events
  DROP CONSTRAINT IF EXISTS google_calendar_events_user_id_calendar_id_event_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_google_calendar_events_org_user_calendar_event
  ON public.google_calendar_events(user_id, organization_id, calendar_id, event_id);
