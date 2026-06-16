-- Retro expiry cleanup. Removes unsaved boards past their 30-day TTL (cascades children).
create or replace function public.retro_cleanup_expired()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with del as (
    delete from public.retro_boards
      where saved_to_series_id is null and expires_at <= now() returning 1)
  select count(*) into n from del;
  return n;
end $$;
revoke all on function public.retro_cleanup_expired() from anon, authenticated;

-- Schedule daily if pg_cron is available; ignore if not (self-host without the extension).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('retro-cleanup', '17 3 * * *', 'select public.retro_cleanup_expired();');
  end if;
exception when others then null;
end $$;
