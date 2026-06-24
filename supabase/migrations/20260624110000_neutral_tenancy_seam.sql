-- =============================================================================
-- Neutral tenancy seam: single-workspace self-host vs multi-workspace hosted.
-- =============================================================================
-- 20260622090000 unconditionally restored multi-tenant signup (every uninvited
-- signup gets its own org) and dropped the single-workspace guard. That is the
-- HOSTED behavior; the OSS self-host default must stay one workspace, invite-
-- only. This makes the choice a runtime flag instead of a baked-in behavior:
--
--   instance_config key 'multi_workspace_enabled'
--     absent / 'false' (default) -> single-workspace self-host
--     'true'                     -> multi-workspace, public self-serve signup
--
-- The hosted deploy (minutia-ops "Deploy Minutia VPS", hosted_mode=true) sets
-- instance_config.hosted_mode='true'; this repo ships the neutral default
-- (absent = single-workspace). Mirrors the retro_enabled / feature-gating seams.
-- NOTE: 'hosted_mode' is the existing deploy contract key; this seam is its
-- first consumer (it was previously written but unread).
-- =============================================================================

-- 1. Flag reader. SECURITY DEFINER so triggers can read instance_config under
--    its default-deny RLS. Default false when the row is absent.
CREATE OR REPLACE FUNCTION public.multi_workspace_enabled()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT value = 'true' FROM public.instance_config
      WHERE key = 'hosted_mode'),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.multi_workspace_enabled() TO authenticated, anon, service_role;

-- 2. Reject a second workspace unless multi-workspace mode is on. Replaces the
--    static unique index dropped by 20260622090000 with a flag-aware guard, so
--    the first workspace (self-host setup) is always allowed and the hosted
--    instance can create many.
CREATE OR REPLACE FUNCTION public.reject_extra_workspace()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  IF NOT public.multi_workspace_enabled()
     AND (SELECT count(*) FROM public.organizations) >= 1 THEN
    RAISE EXCEPTION 'This Minutia instance is configured for a single workspace. Enable multi_workspace_enabled to allow more.'
      USING errcode = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_single_workspace ON public.organizations;
CREATE TRIGGER enforce_single_workspace
  BEFORE INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.reject_extra_workspace();

-- 3. handle_new_user: an uninvited signup gets its own personal org only in
--    multi-workspace mode OR when it is the very first workspace (the self-host
--    setup admin). Otherwise the instance is single-workspace + invite-only and
--    the profile is left org-less (the app routes them to request access).
--
--    SECURITY: membership is granted ONLY from server-created
--    organization_invitations (matched by email). The prior version
--    (20260622090000) also honored an organization_id passed in
--    raw_user_meta_data, which is user-controlled, so a public signup could
--    forge { organization_id, organization_role: 'admin' } and join any
--    workspace as admin. That path is removed; legitimate invites already
--    flow through organization_invitations (and an explicit membership upsert
--    in /api/admin/invitations), so nothing legitimate depends on it.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  profile_name text;
  invitation_row record;
  created_org_id uuid;
  accepted_org_id uuid;
  base_slug text;
  final_slug text;
BEGIN
  profile_name := COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1));

  INSERT INTO public.profiles (id, email, name, current_organization_id)
  VALUES (NEW.id, NEW.email, profile_name, NULL);

  -- Invite-acceptance: pending organization_invitations for this email.
  FOR invitation_row IN
    SELECT id, organization_id, role
    FROM public.organization_invitations
    WHERE lower(email) = lower(NEW.email)
      AND status = 'pending'
    ORDER BY created_at
  LOOP
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (invitation_row.organization_id, NEW.id, invitation_row.role)
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    UPDATE public.organization_invitations
    SET status = 'accepted',
        accepted_by = NEW.id,
        accepted_at = now()
    WHERE id = invitation_row.id;

    accepted_org_id := COALESCE(accepted_org_id, invitation_row.organization_id);
  END LOOP;

  IF accepted_org_id IS NOT NULL THEN
    UPDATE public.profiles
    SET current_organization_id = accepted_org_id
    WHERE id = NEW.id;
    RETURN NEW;
  END IF;

  -- Uninvited signup. Personal org only when multi-workspace mode is on, or when
  -- this is the first workspace (self-host setup admin). Single-workspace +
  -- invite-only instances leave the profile org-less by design.
  IF public.multi_workspace_enabled()
     OR NOT EXISTS (SELECT 1 FROM public.organizations) THEN
    base_slug := COALESCE(NULLIF(public.slugify_organization_name(profile_name), ''), 'workspace');
    final_slug := base_slug || '-' || substr(replace(NEW.id::text, '-', ''), 1, 8);

    INSERT INTO public.organizations (name, slug, created_by)
    VALUES (profile_name || '''s workspace', final_slug, NEW.id)
    RETURNING id INTO created_org_id;

    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (created_org_id, NEW.id, 'admin');

    UPDATE public.profiles
    SET current_organization_id = created_org_id
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
