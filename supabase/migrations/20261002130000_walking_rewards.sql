begin;
create table public.walking_device_keys (
  key_id text primary key,
  device_hash text not null check(device_hash ~ '^[a-f0-9]{64}$'),
  public_key text not null,
  sign_count bigint not null default 0 check(sign_count>=0),
  created_at timestamptz not null default now()
);
create table public.walking_daily_progress (
  customer_id uuid not null references public.customers(id),
  walking_date date not null,
  device_hash text not null,
  steps integer not null check(steps between 0 and 150000),
  measurement_end_at timestamptz not null,
  reward_amount integer not null default 0 check(reward_amount in (0,1000)),
  credited_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(customer_id,walking_date),
  check((reward_amount=0)=(credited_at is null))
);
create unique index walking_device_daily_reward on public.walking_daily_progress(device_hash,walking_date) where reward_amount>0;
create table public.walking_used_challenges (
  challenge_id uuid primary key,
  created_at timestamptz not null default now()
);
create index walking_challenge_expiry on public.walking_used_challenges(created_at);
create table public.walking_reward_policy (
  id boolean primary key default true check(id),
  enabled boolean not null default true,
  starts_on date not null default (now() at time zone 'Asia/Almaty')::date
);
insert into public.walking_reward_policy(id) values(true);
alter table public.walking_device_keys enable row level security;
alter table public.walking_daily_progress enable row level security;
alter table public.walking_used_challenges enable row level security;
alter table public.walking_reward_policy enable row level security;
revoke all on public.walking_device_keys,public.walking_daily_progress,public.walking_used_challenges,public.walking_reward_policy from public,anon,authenticated;
grant select,insert on public.walking_device_keys to service_role;
grant select on public.walking_daily_progress,public.walking_reward_policy to service_role;

create function public.apply_walking_steps(
  p_customer_id uuid,p_key_id text,p_previous_counter bigint,p_counter bigint,p_challenge_id uuid,
  p_date date,p_steps integer,p_start_at timestamptz,p_end_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare k walking_device_keys%rowtype; progress walking_daily_progress%rowtype;
  today date:=(now() at time zone 'Asia/Almaty')::date;
  start_boundary timestamptz:=(p_date::timestamp at time zone 'Asia/Almaty');
  paid boolean:=false; blocked boolean:=false; new_balance numeric; policy walking_reward_policy%rowtype;
begin
  if p_customer_id is null or p_key_id is null or p_counter is null or p_previous_counter is null
    or p_challenge_id is null or p_date is null or p_steps is null or p_start_at is null or p_end_at is null
    or p_steps not between 0 and 150000 or p_counter<=p_previous_counter
    or p_date not between today-6 and today or p_start_at<>start_boundary
    or p_end_at<=p_start_at or p_end_at>start_boundary+interval '1 day'
    or p_end_at>now()+interval '30 seconds' or p_end_at<least(now(),start_boundary+interval '1 day')-interval '5 minutes' then
    raise exception 'invalid walking proof' using errcode='22023';
  end if;
  select * into policy from walking_reward_policy where id=true;
  if not found or not policy.enabled or p_date<policy.starts_on then
    raise exception 'walking rewards inactive' using errcode='P0001';
  end if;
  select * into k from walking_device_keys where key_id=p_key_id for update;
  if not found or k.sign_count<>p_previous_counter then
    raise exception 'walking counter conflict' using errcode='P0001';
  end if;
  -- Tokens expire after five minutes. Discard only expired technical nonces,
  -- in bounded batches, without removing any step totals or reward records.
  delete from walking_used_challenges where challenge_id in (
    select challenge_id from walking_used_challenges where created_at<now()-interval '10 minutes'
    order by created_at limit 500
  );
  insert into walking_used_challenges(challenge_id) values(p_challenge_id) on conflict do nothing;
  if not found then raise exception 'walking challenge reused' using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('walking:'||k.device_hash||':'||p_date,0));
  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  select balance into new_balance from customers where id=p_customer_id and deleted_at is null for update;
  if not found then raise exception 'customer unavailable' using errcode='P0001'; end if;
  select * into progress from walking_daily_progress where customer_id=p_customer_id and walking_date=p_date for update;
  -- Never combine separate phones' measurements into an artificial daily total.
  if found and progress.device_hash<>k.device_hash then
    raise exception 'walking device changed today' using errcode='P0001';
  end if;
  insert into walking_daily_progress(customer_id,walking_date,device_hash,steps,measurement_end_at)
    values(p_customer_id,p_date,k.device_hash,p_steps,p_end_at)
    on conflict(customer_id,walking_date) do update set steps=greatest(walking_daily_progress.steps,excluded.steps),
      measurement_end_at=greatest(walking_daily_progress.measurement_end_at,excluded.measurement_end_at),updated_at=now();
  select * into progress from walking_daily_progress where customer_id=p_customer_id and walking_date=p_date;
  if progress.steps>=10000 and progress.reward_amount=0 then
    blocked:=exists(select 1 from walking_daily_progress where device_hash=k.device_hash and walking_date=p_date and reward_amount>0);
    if not blocked then
      update customers set balance=balance+1000,updated_at=now() where id=p_customer_id returning balance into new_balance;
      insert into transactions(customer_id,order_id,type,amount,description)
        values(p_customer_id,'WALKING-'||p_date||'-'||p_customer_id,'deposit',1000,'10 000 шагов · '||p_date);
      update walking_daily_progress set reward_amount=1000,credited_at=now() where customer_id=p_customer_id and walking_date=p_date;
      paid:=true;
    end if;
  end if;
  update walking_device_keys set sign_count=p_counter where key_id=p_key_id;
  return jsonb_build_object('date',p_date,'steps',progress.steps,'credited',paid,
    'rewarded',paid or progress.reward_amount=1000,'deviceRewarded',blocked,'balance',new_balance,'rewardAmount',1000,'targetSteps',10000);
end;
$$;
revoke all on function public.apply_walking_steps(uuid,text,bigint,bigint,uuid,date,integer,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.apply_walking_steps(uuid,text,bigint,bigint,uuid,date,integer,timestamptz,timestamptz) to service_role;
commit;
