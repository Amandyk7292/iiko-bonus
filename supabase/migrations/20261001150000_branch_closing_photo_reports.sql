-- Closing reports keep permanent submission metadata; only private image objects expire.
create table if not exists public.branch_closing_links (
  branch_id uuid primary key references public.bulka_locations(id),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  token_ciphertext text not null,
  generation uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now()
);
create table if not exists public.branch_closing_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  branch_id uuid not null references public.bulka_locations(id),
  link_generation uuid not null,
  business_date date not null,
  expires_at timestamptz not null default now() + interval '2 hours',
  created_at timestamptz not null default now()
);
create index if not exists branch_closing_sessions_expiry on public.branch_closing_sessions(expires_at);
create table if not exists public.branch_closing_uploads (
  id uuid primary key,
  branch_id uuid not null references public.bulka_locations(id),
  business_date date not null,
  kind text not null check (kind in ('hall', 'baker')),
  branch_name text not null,
  city text not null,
  manifest_hash text not null check (manifest_hash ~ '^[a-f0-9]{64}$'),
  claim uuid not null,
  lease_until timestamptz not null,
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists branch_closing_uploads_scope
  on public.branch_closing_uploads(branch_id, business_date, kind, lease_until);
create table if not exists public.branch_closing_reports (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.bulka_locations(id),
  business_date date not null,
  kind text not null check (kind in ('hall', 'baker')),
  branch_name text not null,
  city text not null,
  upload_id uuid not null unique references public.branch_closing_uploads(id),
  photo_count integer not null check (photo_count between 1 and 10),
  submitted_at timestamptz not null default now(),
  unique(branch_id, business_date, kind)
);
create index if not exists branch_closing_reports_date on public.branch_closing_reports(business_date, branch_id);
create table if not exists public.branch_closing_photos (
  id uuid primary key,
  upload_id uuid not null references public.branch_closing_uploads(id),
  position integer not null check (position between 0 and 9),
  object_path text not null unique,
  bytes integer not null check (bytes between 1 and 3000000),
  width integer not null check (width between 1 and 1600),
  height integer not null check (height between 1 and 1600),
  stored_at timestamptz,
  expires_at timestamptz not null default now() + interval '1 hour',
  deleted_at timestamptz,
  cleanup_claim uuid,
  cleanup_lease_until timestamptz,
  unique(upload_id, position),
  check (object_path = 'uploads/' || upload_id::text || '/' || position::text || '.jpg')
);
create index if not exists branch_closing_photos_expiry on public.branch_closing_photos(expires_at)
  where deleted_at is null;

-- Only backend service_role can inspect QR credentials, reports or private photos.
alter table public.branch_closing_links enable row level security;
alter table public.branch_closing_sessions enable row level security;
alter table public.branch_closing_uploads enable row level security;
alter table public.branch_closing_reports enable row level security;
alter table public.branch_closing_photos enable row level security;
revoke all on public.branch_closing_links, public.branch_closing_sessions,
  public.branch_closing_uploads, public.branch_closing_reports, public.branch_closing_photos from public, anon, authenticated;
grant all on public.branch_closing_links, public.branch_closing_sessions,
  public.branch_closing_uploads, public.branch_closing_reports, public.branch_closing_photos to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values('branch-closing-photos', 'branch-closing-photos', false, 3000000, array['image/jpeg'])
on conflict(id) do update set public = false, file_size_limit = 3000000, allowed_mime_types = array['image/jpeg'];
-- Restrictive policy also protects this bucket if older storage policies are broad.
do $$ begin
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='branch_closing_private') then
    create policy branch_closing_private on storage.objects as restrictive for all to anon, authenticated
      using (bucket_id <> 'branch-closing-photos') with check (bucket_id <> 'branch-closing-photos');
  end if;
end $$;

create or replace function public.claim_branch_closing_upload(
  p_session_hash text, p_upload_id uuid, p_kind text, p_manifest_hash text, p_photos jsonb, p_claim uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s branch_closing_sessions%rowtype;
  b bulka_locations%rowtype;
  u branch_closing_uploads%rowtype;
  existing branch_closing_reports%rowtype;
  item jsonb;
  n integer;
  day date := (timezone('UTC', now()) + interval '1 hour')::date;
begin
  if p_kind not in ('hall','baker') or p_manifest_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_photos) <> 'array' then return jsonb_build_object('error','invalid_upload'); end if;
  n := jsonb_array_length(p_photos);
  if n < 1 or n > 10 then return jsonb_build_object('error','photo_limit'); end if;
  select * into s from branch_closing_sessions where token_hash = p_session_hash;
  if s.id is null or s.expires_at <= now() or s.business_date <> day then
    return jsonb_build_object('error','session_expired');
  end if;
  -- Lock the branch first to serialize simultaneous submissions.
  select * into b from bulka_locations where id = s.branch_id for update;
  if b.id is null or not b.active or not exists(
    select 1 from branch_closing_links where branch_id = b.id and generation = s.link_generation
  ) then return jsonb_build_object('error','link_invalid'); end if;
  select * into existing from branch_closing_reports
    where branch_id = b.id and business_date = day and kind = p_kind;
  if existing.id is not null then
    if existing.upload_id = p_upload_id then
      return jsonb_build_object('submitted',true,'reportId',existing.id);
    end if;
    return jsonb_build_object('error','already_submitted');
  end if;
  select * into u from branch_closing_uploads where id = p_upload_id for update;
  if u.id is not null and (u.branch_id <> b.id or u.business_date <> day
    or u.kind <> p_kind or u.manifest_hash <> p_manifest_hash) then
    return jsonb_build_object('error','upload_conflict');
  end if;
  if exists(select 1 from branch_closing_uploads where branch_id = b.id and business_date = day
    and kind = p_kind and submitted_at is null and lease_until > now()) then
    return jsonb_build_object('error','upload_busy');
  end if;
  if u.id is not null and exists(select 1 from branch_closing_photos
    where upload_id = u.id and (deleted_at is not null or cleanup_claim is not null)) then
    return jsonb_build_object('error','upload_expired');
  end if;
  if u.id is null then
    insert into branch_closing_uploads(id, branch_id, business_date, kind, branch_name, city,
      manifest_hash, claim, lease_until)
    values(p_upload_id,b.id,day,p_kind,b.name,coalesce(b.city,''),p_manifest_hash,p_claim,now()+interval '15 minutes');
    for item in select value from jsonb_array_elements(p_photos) loop
      insert into branch_closing_photos(id,upload_id,position,object_path,bytes,width,height)
      values((item->>'id')::uuid,p_upload_id,(item->>'position')::integer,
        item->>'path',(item->>'bytes')::integer,(item->>'width')::integer,(item->>'height')::integer);
    end loop;
    if (select count(*) from branch_closing_photos where upload_id = p_upload_id) <> n then
      raise exception 'Invalid photo manifest';
    end if;
  else
    update branch_closing_uploads set claim = p_claim, lease_until = now()+interval '15 minutes'
      where id = p_upload_id;
    update branch_closing_photos set expires_at = now()+interval '1 hour' where upload_id = p_upload_id;
  end if;
  return jsonb_build_object('accepted',true,'branchId',b.id);
end $$;

create or replace function public.finish_branch_closing_upload(p_upload_id uuid, p_claim uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u branch_closing_uploads%rowtype; r branch_closing_reports%rowtype; n integer;
begin
  -- Use the same branch -> upload lock order as claim.
  perform 1 from bulka_locations where id = (select branch_id from branch_closing_uploads where id = p_upload_id) for update;
  select * into u from branch_closing_uploads where id = p_upload_id for update;
  if u.id is null then return jsonb_build_object('error','upload_conflict'); end if;
  select * into r from branch_closing_reports where upload_id = p_upload_id;
  if r.id is not null then return jsonb_build_object('submitted',true,'reportId',r.id); end if;
  if u.claim <> p_claim or u.lease_until <= now() then return jsonb_build_object('error','upload_expired'); end if;
  select count(*) into n from branch_closing_photos where upload_id = p_upload_id;
  if n < 1 or n > 10 or exists(select 1 from branch_closing_photos where upload_id = p_upload_id
    and (stored_at is null or deleted_at is not null or cleanup_claim is not null)) then
    return jsonb_build_object('error','photos_incomplete');
  end if;
  if exists(select 1 from branch_closing_reports where branch_id=u.branch_id and business_date=u.business_date and kind=u.kind) then
    return jsonb_build_object('error','already_submitted');
  end if;
  insert into branch_closing_reports(branch_id,business_date,kind,branch_name,city,upload_id,photo_count)
    values(u.branch_id,u.business_date,u.kind,u.branch_name,u.city,u.id,n) returning * into r;
  update branch_closing_uploads set submitted_at=r.submitted_at,lease_until=now() where id=u.id;
  update branch_closing_photos set expires_at=r.submitted_at+interval '3 days' where upload_id=u.id;
  return jsonb_build_object('submitted',true,'reportId',r.id);
end $$;

create or replace function public.claim_branch_closing_photo_cleanup(p_claim uuid, p_limit integer default 100)
returns setof public.branch_closing_photos language plpgsql security definer set search_path = public as $$
begin
  return query with candidates as (
    select p.id from branch_closing_photos p join branch_closing_uploads u on u.id=p.upload_id
    where p.expires_at <= now() and p.deleted_at is null and u.lease_until <= now()
      and (p.cleanup_lease_until is null or p.cleanup_lease_until <= now())
    order by p.expires_at for update of p skip locked limit greatest(1,least(100,p_limit))
  ) update branch_closing_photos p set cleanup_claim=p_claim,cleanup_lease_until=now()+interval '5 minutes'
    from candidates c where c.id=p.id returning p.*;
end $$;

revoke all on function public.claim_branch_closing_upload(text,uuid,text,text,jsonb,uuid),
  public.finish_branch_closing_upload(uuid,uuid), public.claim_branch_closing_photo_cleanup(uuid,integer)
  from public, anon, authenticated;
grant execute on function public.claim_branch_closing_upload(text,uuid,text,text,jsonb,uuid),
  public.finish_branch_closing_upload(uuid,uuid), public.claim_branch_closing_photo_cleanup(uuid,integer)
  to service_role;
