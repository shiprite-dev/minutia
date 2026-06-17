-- Minutia Retro: merge the reveal/theme/vote phases into one "Reveal & Vote" phase.
-- The ritual is now lobby -> reflect -> reveal -> discuss -> commit (-> closed).
-- Mirror of src/lib/retro/phases.ts ALL_RETRO_PHASES.

-- Fold any board parked in the retired phases into the merged reveal phase.
update public.retro_boards set phase = 'reveal' where phase in ('theme', 'vote');

alter table public.retro_boards drop constraint retro_boards_phase_check;
alter table public.retro_boards add constraint retro_boards_phase_check
  check (phase in ('lobby', 'reflect', 'reveal', 'discuss', 'commit', 'closed'));

create or replace function public.retro_set_phase(p_ftoken text, p_phase text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_assert_facilitator(p_ftoken);
  if p_phase not in ('lobby', 'reflect', 'reveal', 'discuss', 'commit', 'closed') then
    raise exception 'retro: bad phase' using errcode = '22000'; end if;
  update public.retro_boards set phase = p_phase, phase_started_at = now(), updated_at = now() where id = b.id;
  return jsonb_build_object('ok', true, 'phase', p_phase);
end $$;
