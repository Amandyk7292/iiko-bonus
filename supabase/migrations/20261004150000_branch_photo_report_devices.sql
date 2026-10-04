begin;
-- Credentials live only in a persistent HttpOnly cookie. Active approval has no expiry.
create table public.branch_closing_devices (
  id uuid primary key,
  branch_id uuid not null references public.bulka_locations(id),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check(status in ('pending','active','revoked')),
  name text check(name is null or length(trim(name)) between 1 and 80),
  code_hash text check(code_hash is null or code_hash ~ '^[a-f0-9]{64}$'),
  code_ciphertext text,
  code_attempts integer not null default 0 check(code_attempts between 0 and 5),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by text,
  revoked_at timestamptz,
  revoked_by text,
  last_seen_at timestamptz,
  constraint branch_closing_device_state check (
    (status='pending' and expires_at is not null and code_hash is not null and code_ciphertext is not null)
    or (status='active' and expires_at is null and name is not null and approved_at is not null and code_hash is null and code_ciphertext is null)
    or (status='revoked' and code_hash is null and code_ciphertext is null)
  )
);
create index branch_closing_devices_branch_created on public.branch_closing_devices(branch_id,created_at);
alter table public.branch_closing_devices enable row level security;
revoke all on public.branch_closing_devices from public,anon,authenticated;
grant all on public.branch_closing_devices to service_role;
-- Nullable columns preserve old reports without granting old sessions upload access.
alter table public.branch_closing_sessions add column device_id uuid references public.branch_closing_devices(id);
alter table public.branch_closing_uploads
  add column device_id uuid references public.branch_closing_devices(id),
  add column device_name text,
  add column checks jsonb;
alter table public.branch_closing_reports
  add column device_id uuid references public.branch_closing_devices(id),
  add column device_name text,
  add column checks jsonb;

create function public.request_branch_closing_device(
  p_id uuid,p_branch uuid,p_token_hash text,p_code_hash text,p_code_ciphertext text,p_previous_hash text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare d branch_closing_devices%rowtype; b bulka_locations%rowtype;
begin
  select * into b from bulka_locations where id=p_branch for update;
  if b.id is null or not b.active then return jsonb_build_object('error','link_invalid'); end if;
  select * into d from branch_closing_devices where token_hash=p_previous_hash for update;
  if d.id is not null then
    if d.branch_id<>p_branch then return jsonb_build_object('error','device_branch_mismatch'); end if;
    if d.status='active' or (d.status='pending' and d.expires_at>now() and d.code_attempts<5) then
      return jsonb_build_object('id',d.id,'status',d.status);
    end if;
  end if;
  if (select count(*) from branch_closing_devices where branch_id=p_branch and created_at>now()-interval '1 hour')>=30 then
    return jsonb_build_object('error','device_rate_limit');
  end if;
  insert into branch_closing_devices(id,branch_id,token_hash,code_hash,code_ciphertext,expires_at)
  values(p_id,p_branch,p_token_hash,p_code_hash,p_code_ciphertext,now()+interval '5 minutes');
  return jsonb_build_object('id',p_id,'status','pending');
end $$;

create function public.approve_branch_closing_device(p_id uuid,p_branch uuid,p_admin text,p_code_hash text,p_name text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d branch_closing_devices%rowtype; b bulka_locations%rowtype;
begin
  select * into b from bulka_locations where id=p_branch for update;
  if b.id is null or not b.active then return jsonb_build_object('error','link_invalid'); end if;
  select * into d from branch_closing_devices where id=p_id and branch_id=p_branch for update;
  if d.id is null then return jsonb_build_object('error','device_required'); end if;
  if d.status='revoked' then return jsonb_build_object('error','device_revoked'); end if;
  if d.status='active' then return jsonb_build_object('error','device_active'); end if;
  if d.expires_at<=now() or d.code_attempts>=5 then return jsonb_build_object('error','device_expired'); end if;
  if d.code_hash is distinct from p_code_hash then
    update branch_closing_devices set code_attempts=code_attempts+1 where id=p_id;
    return jsonb_build_object('error','invalid_code');
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80 then return jsonb_build_object('error','invalid_name'); end if;
  update branch_closing_devices set status='active',name=trim(p_name),approved_at=now(),approved_by=p_admin,
    expires_at=null,code_hash=null,code_ciphertext=null,last_seen_at=now() where id=p_id;
  return jsonb_build_object('id',p_id,'status','active');
end $$;

create function public.revoke_branch_closing_device(p_id uuid,p_branch uuid,p_admin text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  -- The branch lock orders revocation with claim/finish; a revoked device cannot finish an upload.
  perform 1 from bulka_locations where id=p_branch for update;
  update branch_closing_devices set status='revoked',revoked_at=coalesce(revoked_at,now()),revoked_by=p_admin,
    code_hash=null,code_ciphertext=null where id=p_id and branch_id=p_branch;
  if not found then return jsonb_build_object('error','device_required'); end if;
  return jsonb_build_object('id',p_id,'status','revoked');
end $$;

create function public.authorize_branch_closing_device(p_device_hash text,p_branch uuid,p_device_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d branch_closing_devices%rowtype;
begin
  -- All mutations lock branch before device. Lock survives through report insertion.
  perform 1 from bulka_locations where id=p_branch for update;
  select * into d from branch_closing_devices where token_hash=p_device_hash for update;
  if d.id is null then return jsonb_build_object('error','device_required'); end if;
  if d.branch_id<>p_branch then return jsonb_build_object('error','device_branch_mismatch'); end if;
  if d.status='revoked' then return jsonb_build_object('error','device_revoked'); end if;
  if d.status='pending' and (d.expires_at<=now() or d.code_attempts>=5) then return jsonb_build_object('error','device_expired'); end if;
  if d.status<>'active' or (p_device_id is not null and d.id<>p_device_id) then return jsonb_build_object('error','device_required'); end if;
  update branch_closing_devices set last_seen_at=now() where id=d.id;
  return jsonb_build_object('id',d.id,'name',d.name);
end $$;

create function public.open_branch_closing_device_session(
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
  insert into branch_closing_sessions(token_hash,branch_id,link_generation,business_date,shift,shift_starts_at,shift_ends_at,device_id)
  values(p_session_hash,p_branch,p_link_generation,p_date,p_shift,p_starts_at,p_ends_at,(d->>'id')::uuid);
  return jsonb_build_object('opened',true);
end $$;

-- Retain the old RPC signatures as fail-closed compatibility stubs.
create or replace function public.claim_branch_closing_upload(
  p_session_hash text,p_upload_id uuid,p_kind text,p_manifest_hash text,p_photos jsonb,p_claim uuid
) returns jsonb language sql security definer set search_path=public as $$
  select jsonb_build_object('error','device_required');
$$;
create or replace function public.finish_branch_closing_upload(p_upload_id uuid,p_claim uuid)
returns jsonb language sql security definer set search_path=public as $$
  select jsonb_build_object('error','device_required');
$$;

create function public.claim_branch_closing_upload(
  p_session_hash text,p_upload_id uuid,p_kind text,p_manifest_hash text,p_photos jsonb,p_claim uuid,p_device_hash text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare s branch_closing_sessions%rowtype; b bulka_locations%rowtype; d jsonb;
  u branch_closing_uploads%rowtype; existing branch_closing_reports%rowtype; item jsonb; n integer; period jsonb;
begin
  if p_kind not in ('hall','baker') or p_manifest_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_photos)<>'array' then
    return jsonb_build_object('error','invalid_upload');
  end if;
  n:=jsonb_array_length(p_photos);
  if n<1 or n>10 then return jsonb_build_object('error','photo_limit'); end if;
  select * into s from branch_closing_sessions where token_hash=p_session_hash;
  if s.id is null or s.expires_at<=now() then return jsonb_build_object('error','session_expired'); end if;
  select * into b from bulka_locations where id=s.branch_id for update;
  if b.id is null or not b.active or not exists(select 1 from branch_closing_links where branch_id=b.id and generation=s.link_generation) then
    return jsonb_build_object('error','link_invalid');
  end if;
  if s.device_id is null then return jsonb_build_object('error','device_required'); end if;
  d:=public.authorize_branch_closing_device(p_device_hash,b.id,s.device_id);
  if d ? 'error' then return d; end if;
  period:=public.branch_closing_period(b.id,s.shift);
  if period is null or s.business_date is distinct from (period->>'date')::date
    or s.shift_starts_at is distinct from (period->>'startsAt')::timestamptz
    or s.shift_ends_at is distinct from (period->>'endsAt')::timestamptz then return jsonb_build_object('error','session_expired'); end if;
  select * into existing from branch_closing_reports where branch_id=b.id and business_date=s.business_date and shift=s.shift and kind=p_kind;
  if existing.id is not null then
    if existing.upload_id=p_upload_id and existing.device_id=s.device_id then return jsonb_build_object('submitted',true,'reportId',existing.id); end if;
    return jsonb_build_object('error','already_submitted');
  end if;
  select * into u from branch_closing_uploads where id=p_upload_id for update;
  if u.id is not null and (u.branch_id<>b.id or u.device_id is distinct from s.device_id or u.business_date<>s.business_date or u.shift<>s.shift
    or u.kind<>p_kind or u.manifest_hash<>p_manifest_hash or u.shift_starts_at is distinct from s.shift_starts_at
    or u.shift_ends_at is distinct from s.shift_ends_at) then return jsonb_build_object('error','upload_conflict'); end if;
  if exists(select 1 from branch_closing_uploads where branch_id=b.id and business_date=s.business_date
    and shift=s.shift and kind=p_kind and submitted_at is null and lease_until>now()) then return jsonb_build_object('error','upload_busy'); end if;
  if u.id is not null and exists(select 1 from branch_closing_photos where upload_id=u.id and (deleted_at is not null or cleanup_claim is not null)) then
    return jsonb_build_object('error','upload_expired');
  end if;
  if u.id is null then
    insert into branch_closing_uploads(id,branch_id,business_date,shift,shift_starts_at,shift_ends_at,kind,branch_name,city,manifest_hash,claim,lease_until,device_id,device_name,checks)
    values(p_upload_id,b.id,s.business_date,s.shift,s.shift_starts_at,s.shift_ends_at,p_kind,b.name,coalesce(b.city,''),p_manifest_hash,p_claim,
      now()+interval '15 minutes',s.device_id,d->>'name',jsonb_build_object('deviceAuthorized',true,'branchMatched',true,'imagesValidated',true));
    for item in select value from jsonb_array_elements(p_photos) loop
      insert into branch_closing_photos(id,upload_id,position,object_path,bytes,width,height)
      values((item->>'id')::uuid,p_upload_id,(item->>'position')::integer,item->>'path',(item->>'bytes')::integer,(item->>'width')::integer,(item->>'height')::integer);
    end loop;
    if (select count(*) from branch_closing_photos where upload_id=p_upload_id)<>n then raise exception 'Invalid photo manifest'; end if;
  else
    update branch_closing_uploads set claim=p_claim,lease_until=now()+interval '15 minutes' where id=p_upload_id;
    update branch_closing_photos set expires_at=now()+interval '1 hour' where upload_id=p_upload_id;
  end if;
  return jsonb_build_object('accepted',true,'branchId',b.id);
end $$;

create function public.finish_branch_closing_upload(p_upload_id uuid,p_claim uuid,p_device_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare u branch_closing_uploads%rowtype; r branch_closing_reports%rowtype; b bulka_locations%rowtype; d jsonb; n integer;
begin
  select * into b from bulka_locations where id=(select branch_id from branch_closing_uploads where id=p_upload_id) for update;
  select * into u from branch_closing_uploads where id=p_upload_id for update;
  if u.id is null then return jsonb_build_object('error','upload_conflict'); end if;
  if not b.active then return jsonb_build_object('error','link_invalid'); end if;
  if u.device_id is null then return jsonb_build_object('error','device_required'); end if;
  d:=public.authorize_branch_closing_device(p_device_hash,u.branch_id,u.device_id);
  if d ? 'error' then return d; end if;
  select * into r from branch_closing_reports where upload_id=p_upload_id;
  if r.id is not null then return jsonb_build_object('submitted',true,'reportId',r.id); end if;
  if u.claim<>p_claim or u.lease_until<=now() then return jsonb_build_object('error','upload_expired'); end if;
  select count(*) into n from branch_closing_photos where upload_id=p_upload_id;
  if n<1 or n>10 or exists(select 1 from branch_closing_photos where upload_id=p_upload_id and (stored_at is null or deleted_at is not null or cleanup_claim is not null)) then
    return jsonb_build_object('error','photos_incomplete');
  end if;
  if exists(select 1 from branch_closing_reports where branch_id=u.branch_id and business_date=u.business_date and shift=u.shift and kind=u.kind) then
    return jsonb_build_object('error','already_submitted');
  end if;
  insert into branch_closing_reports(branch_id,business_date,shift,shift_starts_at,shift_ends_at,kind,branch_name,city,upload_id,photo_count,device_id,device_name,checks)
  values(u.branch_id,u.business_date,u.shift,u.shift_starts_at,u.shift_ends_at,u.kind,u.branch_name,u.city,u.id,n,u.device_id,u.device_name,u.checks) returning * into r;
  update branch_closing_uploads set submitted_at=r.submitted_at,lease_until=now() where id=u.id;
  update branch_closing_photos set expires_at=r.submitted_at+interval '3 days' where upload_id=u.id;
  return jsonb_build_object('submitted',true,'reportId',r.id);
end $$;

revoke all on function public.request_branch_closing_device(uuid,uuid,text,text,text,text),
  public.approve_branch_closing_device(uuid,uuid,text,text,text),public.revoke_branch_closing_device(uuid,uuid,text),
  public.authorize_branch_closing_device(text,uuid,uuid),public.open_branch_closing_device_session(text,text,uuid,uuid,date,text,timestamptz,timestamptz),
  public.claim_branch_closing_upload(text,uuid,text,text,jsonb,uuid),public.finish_branch_closing_upload(uuid,uuid),
  public.claim_branch_closing_upload(text,uuid,text,text,jsonb,uuid,text),public.finish_branch_closing_upload(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.request_branch_closing_device(uuid,uuid,text,text,text,text),
  public.approve_branch_closing_device(uuid,uuid,text,text,text),public.revoke_branch_closing_device(uuid,uuid,text),
  public.authorize_branch_closing_device(text,uuid,uuid),public.open_branch_closing_device_session(text,text,uuid,uuid,date,text,timestamptz,timestamptz),
  public.claim_branch_closing_upload(text,uuid,text,text,jsonb,uuid),public.finish_branch_closing_upload(uuid,uuid),
  public.claim_branch_closing_upload(text,uuid,text,text,jsonb,uuid,text),public.finish_branch_closing_upload(uuid,uuid,text) to service_role;
notify pgrst, 'reload schema';
commit;
