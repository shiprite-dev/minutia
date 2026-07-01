-- FIX: restrict notifications INSERT to service_role only.
-- The original policy had no TO clause, allowing anon/authenticated to INSERT
-- arbitrary notifications into any user's inbox. Triggers invoke
-- create_notification() which is SECURITY DEFINER and bypasses RLS, so this
-- does not affect trigger-driven notifications.
DROP POLICY IF EXISTS "Service role can insert notifications" ON public.notifications;

CREATE POLICY "notifications_insert_service_role"
  ON public.notifications
  FOR INSERT
  TO service_role
  WITH CHECK (true);
