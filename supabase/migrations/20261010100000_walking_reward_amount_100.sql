begin;
-- migration-safety: allow-destructive reason=expand-walking-reward-check-to-100-with-existing-1000-preserved
-- Only expand the allowed amounts. Previously credited rewards and their
-- ledger/inbox/push records stay intact, including a reward from earlier today.
alter table public.walking_daily_progress
  drop constraint walking_daily_progress_reward_amount_check;
alter table public.walking_daily_progress
  add constraint walking_daily_progress_reward_amount_check check(reward_amount in (0,100,1000));

-- Both iPhone measurements and Android batches use this atomic daily RPC.
create or replace function public.apply_walking_steps(
  p_customer_id uuid,p_key_id text,p_previous_counter bigint,p_counter bigint,p_challenge_id uuid,
  p_date date,p_steps integer,p_start_at timestamptz,p_end_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare k walking_device_keys%rowtype; progress walking_daily_progress%rowtype;
  today date:=(now() at time zone 'Asia/Almaty')::date;
  start_boundary timestamptz:=(p_date::timestamp at time zone 'Asia/Almaty');
  reward integer:=100; paid boolean:=false; blocked boolean:=false; new_balance numeric; policy walking_reward_policy%rowtype;
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
      update customers set balance=balance+reward,updated_at=now() where id=p_customer_id returning balance into new_balance;
      insert into transactions(customer_id,order_id,type,amount,description)
        values(p_customer_id,'WALKING-'||p_date||'-'||p_customer_id,'deposit',reward,'10 000 шагов · '||p_date);
      update walking_daily_progress set reward_amount=reward,credited_at=now() where customer_id=p_customer_id and walking_date=p_date returning * into progress;
      paid:=true;
    end if;
  end if;
  update walking_device_keys set sign_count=p_counter where key_id=p_key_id;
  return jsonb_build_object('date',p_date,'steps',progress.steps,'credited',paid,
    'rewarded',progress.reward_amount>0,'deviceRewarded',blocked,'balance',new_balance,'rewardAmount',reward,'creditedAmount',progress.reward_amount,'targetSteps',10000);
end;
$$;
revoke all on function public.apply_walking_steps(uuid,text,bigint,bigint,uuid,date,integer,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.apply_walking_steps(uuid,text,bigint,bigint,uuid,date,integer,timestamptz,timestamptz) to service_role;

create or replace function public.queue_walking_reward_notification()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  customer public.customers%rowtype;
  notification_id uuid;
  titles jsonb;
  bodies jsonb;
  payload jsonb;
  tokens jsonb;
  language text;
begin
  if new.credited_at is null or new.reward_amount<=0 or
    (tg_op='UPDATE' and old.credited_at is not null) then
    return new;
  end if;
  select * into customer from public.customers where id=new.customer_id and deleted_at is null;
  if not found then return new; end if;
  notification_id:=md5('bulka:walking:notice:v1:'||new.customer_id::text||':'||new.walking_date::text)::uuid;
  language:=case when customer.preferred_language in ('kk','en') then customer.preferred_language else 'ru' end;
  titles:=jsonb_build_object(
    'ru','Начислено +'||replace(to_char(new.reward_amount,'FM999,999,999'),',',' ')||' бонусов',
    'kk','+'||replace(to_char(new.reward_amount,'FM999,999,999'),',',' ')||' бонус есептелді',
    'en','+'||to_char(new.reward_amount,'FM999,999,999')||' bonuses earned');
  bodies:=jsonb_build_object(
    'ru','За 10 000 шагов · '||new.walking_date||'. Баланс: '||customer.balance||' бонусов.',
    'kk','10 000 қадам үшін · '||new.walking_date||'. Баланс: '||customer.balance||' бонус.',
    'en','For 10,000 steps · '||new.walking_date||'. Balance: '||customer.balance||' bonuses.');
  payload:=jsonb_build_object(
    'type','bonus','messageKey','walking_reward','destination','notifications',
    'notificationId',notification_id,'walkingDate',new.walking_date,
    'amount',new.reward_amount,'balance',customer.balance,'steps',new.steps,'targetSteps',10000,
    'deepLink','https://bulka.com.kz/notifications');
  insert into public.customer_notifications(id,customer_id,title,body,type,payload)
    values(notification_id,new.customer_id,titles->>language,bodies->>language,'bonus',
      payload||jsonb_build_object('i18n',jsonb_build_object('titles',titles,'bodies',bodies)))
    on conflict(id) do nothing;
  select coalesce(jsonb_agg(token order by token),'[]'::jsonb) into tokens from (
    select distinct btrim(token) token from (
      select token from public.customer_push_tokens where customer_id=new.customer_id
      union all select customer.fcm_token
    ) installed
    where char_length(btrim(token)) between 20 and 4096
  ) destinations;
  -- Without a registered push destination the inbox and bonus history still
  -- persist. Do not repeatedly deliver an empty queue or resend old rewards
  -- when a customer later enables device notifications.
  if jsonb_array_length(tokens)>0 then
    insert into public.push_notification_outbox(dedupe_key,customer_id,title,body,payload,pending_tokens)
      values('walking:'||notification_id,new.customer_id,titles->>language,bodies->>language,payload,tokens)
      on conflict(dedupe_key) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.queue_walking_reward_notification() from public,anon,authenticated;

commit;
