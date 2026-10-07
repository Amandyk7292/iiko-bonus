begin;
-- An approved, cookie-bound tablet stays connected until its approval is revoked.
-- Report date/shift and QR generation are still checked on every submission.
alter table public.branch_closing_sessions alter column expires_at drop not null;
update public.branch_closing_sessions s set expires_at=null
from public.branch_closing_devices d, public.bulka_locations b, public.branch_closing_links l
where s.device_id=d.id and d.status='active' and d.branch_id=s.branch_id
  and b.id=s.branch_id and b.active and l.branch_id=s.branch_id and l.generation=s.link_generation;
alter table public.branch_closing_sessions add constraint branch_closing_session_lifetime
  check (expires_at is not null or device_id is not null);

create or replace function public.open_branch_closing_device_session(
  p_session_hash text,p_device_hash text,p_branch uuid,p_link_generation uuid,p_date date,p_shift text,p_starts_at timestamptz,p_ends_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public as $$
declare b bulka_locations%rowtype; d jsonb;
begin
  select * into b from bulka_locations where id=p_branch for update;
  if b.id is null or not b.active or not exists(select 1 from branch_closing_links where branch_id=p_branch and generation=p_link_generation) then
    return jsonb_build_object('error','link_invalid');
  end if;
  d:=public.authorize_branch_closing_device(p_device_hash,p_branch);
  if d ? 'error' then return d; end if;
  insert into branch_closing_sessions(token_hash,branch_id,link_generation,business_date,shift,shift_starts_at,shift_ends_at,device_id,expires_at)
  values(p_session_hash,p_branch,p_link_generation,p_date,p_shift,p_starts_at,p_ends_at,(d->>'id')::uuid,null);
  return jsonb_build_object('opened',true);
end $$;
revoke all on function public.open_branch_closing_device_session(text,text,uuid,uuid,date,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.open_branch_closing_device_session(text,text,uuid,uuid,date,text,timestamptz,timestamptz) to service_role;
notify pgrst, 'reload schema';
commit;
