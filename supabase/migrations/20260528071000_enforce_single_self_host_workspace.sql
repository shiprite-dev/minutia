DO $$
BEGIN
  IF (SELECT count(*) FROM public.organizations) > 1 THEN
    RAISE EXCEPTION 'Self-host Minutia supports one workspace. Consolidate organizations before applying this migration.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_single_self_host_workspace
  ON public.organizations ((true));
