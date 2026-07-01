-- FIX: prevent cross-tenant notification spoof via issues.owner_user_id.
-- Both trigger functions notified owner_user_id without verifying the user
-- is a participant of the issue's series, enabling cross-tenant inbox writes.
-- Guard: only notify when owner_user_id has a row in series_participants for
-- the issue's series_id.

CREATE OR REPLACE FUNCTION notify_issue_assigned() RETURNS trigger AS $$
BEGIN
  IF NEW.owner_user_id IS NOT NULL
     AND (OLD.owner_user_id IS NULL OR OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id) THEN
    -- Only notify when the new owner is a participant of this series.
    IF EXISTS (
      SELECT 1 FROM public.series_participants
      WHERE series_id = NEW.series_id
        AND user_id = NEW.owner_user_id
    ) THEN
      PERFORM create_notification(
        NEW.owner_user_id,
        'issue_assigned',
        'You were assigned: ' || NEW.title,
        NULL,
        '/issues/' || NEW.id,
        jsonb_build_object('issue_id', NEW.id, 'series_id', NEW.series_id)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION notify_issue_status_change() RETURNS trigger AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.owner_user_id IS NOT NULL THEN
    -- Only notify when the owner is a participant of this series.
    IF EXISTS (
      SELECT 1 FROM public.series_participants
      WHERE series_id = NEW.series_id
        AND user_id = NEW.owner_user_id
    ) THEN
      PERFORM create_notification(
        NEW.owner_user_id,
        'issue_status_changed',
        NEW.title || ' changed to ' || REPLACE(NEW.status::text, '_', ' '),
        NULL,
        '/issues/' || NEW.id,
        jsonb_build_object('issue_id', NEW.id, 'old_status', OLD.status, 'new_status', NEW.status)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
