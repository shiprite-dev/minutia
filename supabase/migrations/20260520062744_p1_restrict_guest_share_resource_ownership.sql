-- P1 security hardening: a user may only create or retarget guest shares for
-- resources they own through the parent meeting series.

CREATE OR REPLACE FUNCTION public.user_owns_share_resource(
  target_resource_type text,
  target_resource_id uuid,
  target_user_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT target_user_id IS NOT NULL
    AND (
      (
        target_resource_type = 'series'
        AND EXISTS (
          SELECT 1
          FROM public.meeting_series ms
          WHERE ms.id = target_resource_id
            AND ms.owner_id = target_user_id
        )
      )
      OR (
        target_resource_type = 'meeting'
        AND EXISTS (
          SELECT 1
          FROM public.meetings m
          JOIN public.meeting_series ms ON ms.id = m.series_id
          WHERE m.id = target_resource_id
            AND ms.owner_id = target_user_id
        )
      )
      OR (
        target_resource_type = 'issue'
        AND EXISTS (
          SELECT 1
          FROM public.issues i
          JOIN public.meeting_series ms ON ms.id = i.series_id
          WHERE i.id = target_resource_id
            AND ms.owner_id = target_user_id
        )
      )
    )
$$;

REVOKE ALL ON FUNCTION public.user_owns_share_resource(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_owns_share_resource(text, uuid, uuid)
  TO authenticated, service_role;

DROP POLICY IF EXISTS "guest_shares_insert_creator" ON public.guest_shares;
DROP POLICY IF EXISTS "guest_shares_update_creator" ON public.guest_shares;

CREATE POLICY "guest_shares_insert_creator"
  ON public.guest_shares FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND public.user_owns_share_resource(resource_type, resource_id, auth.uid())
  );

CREATE POLICY "guest_shares_update_creator"
  ON public.guest_shares FOR UPDATE
  USING (auth.uid() = created_by)
  WITH CHECK (
    auth.uid() = created_by
    AND public.user_owns_share_resource(resource_type, resource_id, auth.uid())
  );
