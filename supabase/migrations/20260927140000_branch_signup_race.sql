-- Attribution is earned by a verified phone, then counted atomically with signup.
-- No purchase or referral reward is involved. Phone keys are HMACs made by the server.
alter table public.customers add column app_registered_at timestamptz;
create table public.branch_signup_claims (
  id uuid primary key default gen_random_uuid(),
  phone_key text not null check(length(phone_key)=64),
  branch_id uuid not null references public.bulka_locations(id),
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '30 days',
  completed_at timestamptz,
  customer_id uuid references public.customers(id) on delete set null,
  check(expires_at>verified_at)
);
create index branch_signup_phone on public.branch_signup_claims(phone_key,verified_at desc);
create index branch_signup_period on public.branch_signup_claims(branch_id,completed_at,verified_at);
create unique index branch_signup_once_per_phone on public.branch_signup_claims(phone_key) where completed_at is not null;
create unique index branch_signup_once_per_customer on public.branch_signup_claims(customer_id) where customer_id is not null;
alter table public.branch_signup_claims enable row level security;
create policy branch_signup_service on public.branch_signup_claims for all to service_role using(true) with check(true);
revoke all on public.branch_signup_claims from public,anon,authenticated;
grant all on public.branch_signup_claims to service_role;

create function public.claim_branch_signup(p_phone text,p_phone_key text,p_branch uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.branch_signup_claims%rowtype;
begin
  if length(p_phone_key)<>64 or p_phone is null then raise exception 'Invalid phone attribution'; end if;
  perform pg_advisory_xact_lock(hashtext('branch-signup:'||p_phone_key));
  if not exists(select 1 from public.bulka_locations where id=p_branch and active=true) then
    raise exception 'Branch unavailable'; end if;
  if exists(select 1 from public.customers where phone=p_phone and
    (app_registered_at is not null or lower(btrim(coalesce(name,''))) not in ('','гость','новый гость','қонақ','жаңа қонақ','guest','new guest')))
    or exists(select 1 from public.branch_signup_claims where phone_key=p_phone_key and completed_at is not null) then
    return jsonb_build_object('status','existing'); end if;
  select * into c from public.branch_signup_claims where phone_key=p_phone_key and expires_at>now()
    and completed_at is null order by verified_at limit 1 for update;
  if c.id is null then
    insert into public.branch_signup_claims(phone_key,branch_id) values(p_phone_key,p_branch) returning * into c;
  end if;
  -- The first verified branch keeps attribution; rescans do not extend the deadline.
  return jsonb_build_object('status','saved','branchId',c.branch_id,'expiresAt',c.expires_at,
    'branchName',(select name from public.bulka_locations where id=c.branch_id));
end; $$;

create function public.finish_customer_registration(p_customer_id uuid,p_phone_key text,p_profile jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.customers%rowtype; claim_id uuid;
begin
  if length(p_phone_key)<>64 or length(btrim(coalesce(p_profile->>'name','')))=0 then
    raise exception 'Invalid registration'; end if;
  perform pg_advisory_xact_lock(hashtext('branch-signup:'||p_phone_key));
  select * into c from public.customers where id=p_customer_id for update;
  if c.id is null then raise exception 'Customer not found'; end if;
  if c.app_registered_at is not null or lower(btrim(coalesce(c.name,''))) not in
    ('','гость','новый гость','қонақ','жаңа қонақ','guest','new guest') then
    raise exception 'Customer already registered'; end if;
  update public.customers set name=p_profile->>'name',
    last_name=case when p_profile ? 'last_name' then p_profile->>'last_name' else last_name end,
    email=case when p_profile ? 'email' then p_profile->>'email' else email end,
    gender=case when p_profile ? 'gender' then p_profile->>'gender' else gender end,
    birth_date=case when p_profile ? 'birth_date' then (p_profile->>'birth_date')::date else birth_date end,
    app_registered_at=now(),updated_at=now() where id=p_customer_id;
  if not exists(select 1 from public.branch_signup_claims where phone_key=p_phone_key and completed_at is not null) then
    select id into claim_id from public.branch_signup_claims where phone_key=p_phone_key
      and completed_at is null and expires_at>now() order by verified_at limit 1 for update;
    if claim_id is not null then
      update public.branch_signup_claims set completed_at=now(),customer_id=p_customer_id where id=claim_id;
    end if;
  end if;
  return jsonb_build_object('counted',claim_id is not null);
end; $$;

create function public.branch_signup_ranking(p_from timestamptz,p_to timestamptz,p_branches uuid[] default '{}') returns jsonb
language sql security definer set search_path=public as $$
  with totals as (
    select l.id,l.name,l.city,l.active,
      count(c.id) filter(where c.verified_at>=p_from and c.verified_at<p_to) as started,
      count(c.id) filter(where c.completed_at>=p_from and c.completed_at<p_to) as completed,
      count(c.id) filter(where c.verified_at>=p_from and c.verified_at<p_to and c.completed_at is null and c.expires_at>now()) as pending,
      count(c.id) filter(where c.verified_at>=p_from and c.verified_at<p_to and c.completed_at is null and c.expires_at<=now()) as expired
    from public.bulka_locations l left join public.branch_signup_claims c on c.branch_id=l.id
    where cardinality(p_branches)=0 or l.id=any(p_branches)
    group by l.id,l.name,l.city,l.active
  ), ranked as (select *,dense_rank() over(order by completed desc) as rank from totals)
  select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(ranked) order by completed desc,name,id),'[]'::jsonb)) from ranked;
$$;
revoke all on function public.claim_branch_signup(text,text,uuid),public.finish_customer_registration(uuid,text,jsonb),
  public.branch_signup_ranking(timestamptz,timestamptz,uuid[]) from public,anon,authenticated;
grant execute on function public.claim_branch_signup(text,text,uuid),public.finish_customer_registration(uuid,text,jsonb),
  public.branch_signup_ranking(timestamptz,timestamptz,uuid[]) to service_role;
