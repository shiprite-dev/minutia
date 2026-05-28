-- Never trust caller-supplied organization_id on guest shares.
-- The organization is derived from the shared resource before RLS checks run.

CREATE OR REPLACE FUNCTION public.set_guest_share_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.organization_id = NULL;

  IF NEW.resource_type = 'series' THEN
    SELECT organization_id INTO NEW.organization_id
    FROM public.meeting_series
    WHERE id = NEW.resource_id;
  ELSIF NEW.resource_type = 'meeting' THEN
    SELECT ms.organization_id INTO NEW.organization_id
    FROM public.meetings m
    JOIN public.meeting_series ms ON ms.id = m.series_id
    WHERE m.id = NEW.resource_id;
  ELSIF NEW.resource_type = 'issue' THEN
    SELECT ms.organization_id INTO NEW.organization_id
    FROM public.issues i
    JOIN public.meeting_series ms ON ms.id = i.series_id
    WHERE i.id = NEW.resource_id;
  END IF;

  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'Guest share resource does not belong to a workspace';
  END IF;

  RETURN NEW;
END;
$$;
