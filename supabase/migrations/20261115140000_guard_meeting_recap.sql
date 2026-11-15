CREATE OR REPLACE FUNCTION public.enforce_meeting_recap_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role'
    OR session_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;

  IF (NEW.recap_markdown IS DISTINCT FROM OLD.recap_markdown
    OR NEW.recap_generated_at IS DISTINCT FROM OLD.recap_generated_at
    OR NEW.recap_model IS DISTINCT FROM OLD.recap_model)
    AND NOT public.user_can_manage_series(OLD.series_id) THEN
    RAISE EXCEPTION 'Only series owners and facilitators can change the meeting recap'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_meeting_recap_permissions ON public.meetings;
CREATE TRIGGER enforce_meeting_recap_permissions
  BEFORE UPDATE OF recap_markdown, recap_generated_at, recap_model ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_meeting_recap_permissions();
