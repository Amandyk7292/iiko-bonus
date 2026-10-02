-- migration-safety: allow-destructive reason=Atomically replace only the report uniqueness constraint with its shift-aware equivalent; no rows, photos or columns are removed.
begin;
-- Existing branches and their permanent daily reports remain unchanged.
alter table public.bulka_locations
  add column round_the_clock boolean not null default false,
  add column photo_day_shift_start time not null default '08:00',
  add column photo_night_shift_start time not null default '21:00',
  add constraint bulka_locations_photo_shift_times check (
    photo_day_shift_start < photo_night_shift_start
    and extract(second from photo_day_shift_start) = 0
    and extract(second from photo_night_shift_start) = 0
    and photo_night_shift_start < time '24:00'
  );
alter table public.branch_closing_sessions
  add column shift text not null default 'daily' check (shift in ('daily','day','night')),
  add column shift_starts_at timestamptz,
  add column shift_ends_at timestamptz;
alter table public.branch_closing_uploads
  add column shift text not null default 'daily' check (shift in ('daily','day','night')),
  add column shift_starts_at timestamptz,
  add column shift_ends_at timestamptz;
alter table public.branch_closing_reports
  add column shift text not null default 'daily' check (shift in ('daily','day','night')),
  add column shift_starts_at timestamptz,
  add column shift_ends_at timestamptz;
-- Replace only the uniqueness rule, preserving every report and photo row.
alter table public.branch_closing_reports
  drop constraint branch_closing_reports_branch_id_business_date_kind_key,
  add constraint branch_closing_reports_shift_unique unique(branch_id,business_date,shift,kind);

create function public.branch_closing_period(p_branch uuid,p_shift text,p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare b bulka_locations%rowtype; d date; local_now timestamp; start_at timestamp; end_at timestamp;
begin
  select * into b from bulka_locations where id=p_branch;
  if not b.round_the_clock then
    if p_shift <> 'daily' then return null; end if;
    return jsonb_build_object('date',(timezone('UTC',p_now)+interval '1 hour')::date,'shift','daily');
  end if;
  if p_shift not in ('day','night') then return null; end if;
  local_now := timezone('UTC',p_now)+interval '5 hours';
  d := local_now::date;
  if local_now::time < (case when p_shift='day' then b.photo_day_shift_start else b.photo_night_shift_start end) then
    d := d-1;
  end if;
  start_at := d + case when p_shift='day' then b.photo_day_shift_start else b.photo_night_shift_start end;
  end_at := case when p_shift='day' then d+b.photo_night_shift_start else (d+1)+b.photo_day_shift_start end;
  return jsonb_build_object('date',d,'shift',p_shift,
    'startsAt',(start_at-interval '5 hours') at time zone 'UTC',
    'endsAt',(end_at-interval '5 hours') at time zone 'UTC');
end $$;

create or replace function public.claim_branch_closing_upload(
  p_session_hash text,p_upload_id uuid,p_kind text,p_manifest_hash text,p_photos jsonb,p_claim uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare s branch_closing_sessions%rowtype; b bulka_locations%rowtype;
  u branch_closing_uploads%rowtype; existing branch_closing_reports%rowtype;
  item jsonb; n integer; period jsonb;
begin
  if p_kind not in ('hall','baker') or p_manifest_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_photos)<>'array' then return jsonb_build_object('error','invalid_upload'); end if;
  n:=jsonb_array_length(p_photos);
  if n<1 or n>10 then return jsonb_build_object('error','photo_limit'); end if;
  select * into s from branch_closing_sessions where token_hash=p_session_hash;
  if s.id is null or s.expires_at<=now() then return jsonb_build_object('error','session_expired'); end if;
  select * into b from bulka_locations where id=s.branch_id for update;
  if b.id is null or not b.active or not exists(
    select 1 from branch_closing_links where branch_id=b.id and generation=s.link_generation
  ) then return jsonb_build_object('error','link_invalid'); end if;
  period:=public.branch_closing_period(b.id,s.shift);
  if period is null or s.business_date is distinct from (period->>'date')::date
    or s.shift_starts_at is distinct from (period->>'startsAt')::timestamptz
    or s.shift_ends_at is distinct from (period->>'endsAt')::timestamptz then
    return jsonb_build_object('error','session_expired');
  end if;
  select * into existing from branch_closing_reports
    where branch_id=b.id and business_date=s.business_date and shift=s.shift and kind=p_kind;
  if existing.id is not null then
    if existing.upload_id=p_upload_id then return jsonb_build_object('submitted',true,'reportId',existing.id); end if;
    return jsonb_build_object('error','already_submitted');
  end if;
  select * into u from branch_closing_uploads where id=p_upload_id for update;
  if u.id is not null and (u.branch_id<>b.id or u.business_date<>s.business_date or u.shift<>s.shift
    or u.kind<>p_kind or u.manifest_hash<>p_manifest_hash
    or u.shift_starts_at is distinct from s.shift_starts_at
    or u.shift_ends_at is distinct from s.shift_ends_at) then
    return jsonb_build_object('error','upload_conflict');
  end if;
  if exists(select 1 from branch_closing_uploads where branch_id=b.id and business_date=s.business_date
    and shift=s.shift and kind=p_kind and submitted_at is null and lease_until>now()) then
    return jsonb_build_object('error','upload_busy');
  end if;
  if u.id is not null and exists(select 1 from branch_closing_photos
    where upload_id=u.id and (deleted_at is not null or cleanup_claim is not null)) then
    return jsonb_build_object('error','upload_expired');
  end if;
  if u.id is null then
    insert into branch_closing_uploads(id,branch_id,business_date,shift,shift_starts_at,shift_ends_at,
      kind,branch_name,city,manifest_hash,claim,lease_until)
    values(p_upload_id,b.id,s.business_date,s.shift,s.shift_starts_at,s.shift_ends_at,
      p_kind,b.name,coalesce(b.city,''),p_manifest_hash,p_claim,now()+interval '15 minutes');
    for item in select value from jsonb_array_elements(p_photos) loop
      insert into branch_closing_photos(id,upload_id,position,object_path,bytes,width,height)
      values((item->>'id')::uuid,p_upload_id,(item->>'position')::integer,
        item->>'path',(item->>'bytes')::integer,(item->>'width')::integer,(item->>'height')::integer);
    end loop;
    if (select count(*) from branch_closing_photos where upload_id=p_upload_id)<>n then raise exception 'Invalid photo manifest'; end if;
  else
    update branch_closing_uploads set claim=p_claim,lease_until=now()+interval '15 minutes' where id=p_upload_id;
    update branch_closing_photos set expires_at=now()+interval '1 hour' where upload_id=p_upload_id;
  end if;
  return jsonb_build_object('accepted',true,'branchId',b.id);
end $$;

create or replace function public.finish_branch_closing_upload(p_upload_id uuid,p_claim uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare u branch_closing_uploads%rowtype; r branch_closing_reports%rowtype; n integer;
begin
  perform 1 from bulka_locations where id=(select branch_id from branch_closing_uploads where id=p_upload_id) for update;
  select * into u from branch_closing_uploads where id=p_upload_id for update;
  if u.id is null then return jsonb_build_object('error','upload_conflict'); end if;
  select * into r from branch_closing_reports where upload_id=p_upload_id;
  if r.id is not null then return jsonb_build_object('submitted',true,'reportId',r.id); end if;
  if u.claim<>p_claim or u.lease_until<=now() then return jsonb_build_object('error','upload_expired'); end if;
  select count(*) into n from branch_closing_photos where upload_id=p_upload_id;
  if n<1 or n>10 or exists(select 1 from branch_closing_photos where upload_id=p_upload_id
    and (stored_at is null or deleted_at is not null or cleanup_claim is not null)) then
    return jsonb_build_object('error','photos_incomplete');
  end if;
  if exists(select 1 from branch_closing_reports where branch_id=u.branch_id and business_date=u.business_date and shift=u.shift and kind=u.kind) then
    return jsonb_build_object('error','already_submitted');
  end if;
  insert into branch_closing_reports(branch_id,business_date,shift,shift_starts_at,shift_ends_at,
    kind,branch_name,city,upload_id,photo_count)
  values(u.branch_id,u.business_date,u.shift,u.shift_starts_at,u.shift_ends_at,
    u.kind,u.branch_name,u.city,u.id,n) returning * into r;
  update branch_closing_uploads set submitted_at=r.submitted_at,lease_until=now() where id=u.id;
  update branch_closing_photos set expires_at=r.submitted_at+interval '3 days' where upload_id=u.id;
  return jsonb_build_object('submitted',true,'reportId',r.id);
end $$;
revoke all on function public.branch_closing_period(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.branch_closing_period(uuid,text,timestamptz) to service_role;
commit;
