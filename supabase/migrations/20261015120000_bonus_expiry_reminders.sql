begin;

-- One durable warning for each customer's dated expiry bucket and milestone.
-- Several accruals expiring on the same local day are one bucket; newer
-- accruals with another expiry date are never included in its amount.
create or replace function public.bonus_expiry_reminder_state(
  p_customer_id uuid,
  p_expires_on date,
  p_reminder_days integer,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_customer public.customers%rowtype;
  v_days integer := p_expires_on - (p_now at time zone 'Asia/Almaty')::date;
  v_amount numeric;
  v_expires_at timestamptz;
  v_floor integer;
begin
  if p_now is null or p_expires_on is null or p_reminder_days is null or
    p_reminder_days not in (30,15,7) or not public.bonus_expiry_policy_enabled() then
    return jsonb_build_object('eligible',false);
  end if;
  -- Retries may cross midnight or quiet hours. A delayed 30-day warning stops
  -- at the 15-day milestone instead of competing with the next warning.
  v_floor := case p_reminder_days when 30 then 15 when 15 then 7 else 0 end;
  if v_days > p_reminder_days or v_days <= v_floor then
    return jsonb_build_object('eligible',false);
  end if;
  select * into v_customer from public.customers
    where id=p_customer_id and deleted_at is null;
  if not found then return jsonb_build_object('eligible',false); end if;
  select coalesce(sum(remaining_amount),0),min(expires_at)
    into v_amount,v_expires_at
    from public.bonus_credit_lots
    where customer_id=p_customer_id and remaining_amount>0 and expires_at>p_now
      and (expires_at at time zone 'Asia/Almaty')::date=p_expires_on;
  return jsonb_build_object(
    'eligible',v_amount>0,'amount',v_amount,'daysLeft',v_days,
    'expiresOn',p_expires_on,'expiresAt',v_expires_at,
    'language',coalesce(v_customer.preferred_language,'ru'),
    'deliveryExpiresAt',least(v_expires_at,
      (((p_now at time zone 'Asia/Almaty')::date+1)::timestamp at time zone 'Asia/Almaty')));
end;
$$;

create or replace function public.enqueue_bonus_expiry_reminders(
  p_now timestamptz default now(),
  p_limit integer default 500
)
returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_bucket record;
  v_tokens jsonb;
  v_key text;
  v_payload jsonb;
  v_inserted integer := 0;
  v_today date := (p_now at time zone 'Asia/Almaty')::date;
begin
  if p_now is null or not public.bonus_expiry_policy_enabled() then return 0; end if;
  for v_bucket in
    select lot.customer_id,(lot.expires_at at time zone 'Asia/Almaty')::date expires_on,
      sum(lot.remaining_amount) amount,min(lot.expires_at) expires_at,
      customer.preferred_language,
      (lot.expires_at at time zone 'Asia/Almaty')::date-v_today days_left
    from public.bonus_credit_lots lot
    join public.customers customer on customer.id=lot.customer_id and customer.deleted_at is null
    where lot.remaining_amount>0 and lot.expires_at>p_now
      and lot.expires_at >= ((v_today+7)::timestamp at time zone 'Asia/Almaty')
      and lot.expires_at < ((v_today+31)::timestamp at time zone 'Asia/Almaty')
      and (lot.expires_at at time zone 'Asia/Almaty')::date-v_today in (30,15,7)
      and exists(select 1 from public.customer_push_tokens token
        where token.customer_id=lot.customer_id and char_length(btrim(token.token)) between 16 and 4096)
      and not exists(select 1 from public.push_notification_outbox queued where queued.dedupe_key=
        'bonus-expiry:'||lot.customer_id::text||':'||
        ((lot.expires_at at time zone 'Asia/Almaty')::date)::text||':'||
        (((lot.expires_at at time zone 'Asia/Almaty')::date-v_today)::text))
    group by lot.customer_id,(lot.expires_at at time zone 'Asia/Almaty')::date,customer.preferred_language
    order by (lot.expires_at at time zone 'Asia/Almaty')::date,lot.customer_id
    limit least(greatest(coalesce(p_limit,500),1),2000)
  loop
    v_key := 'bonus-expiry:'||v_bucket.customer_id::text||':'||v_bucket.expires_on::text||':'||v_bucket.days_left::text;
    select coalesce(jsonb_agg(token order by token),'[]'::jsonb) into v_tokens from (
      select distinct btrim(token) token from public.customer_push_tokens
      where customer_id=v_bucket.customer_id and char_length(btrim(token)) between 16 and 4096
    ) destinations;
    if jsonb_array_length(v_tokens)=0 then continue; end if;
    v_payload := jsonb_build_object(
      'type','bonus_expiry_reminder','reminderVersion','credit-lots-v1',
      'reminderDays',v_bucket.days_left,'daysLeft',v_bucket.days_left,
      'bonusExpiresOn',v_bucket.expires_on,'bonusExpiresAt',v_bucket.expires_at,
      'reminderExpiresAt',least(v_bucket.expires_at,((v_today+1)::timestamp at time zone 'Asia/Almaty')),
      'amount',v_bucket.amount,'language',coalesce(v_bucket.preferred_language,'ru'),
      'destination','bonuses','deepLink','https://bulka.com.kz/app/');
    -- Delivery replaces the copy and amount from live lots immediately before
    -- FCM. No direct-send fallback may bypass that eligibility check.
    insert into public.push_notification_outbox
      (dedupe_key,customer_id,title,body,payload,pending_tokens,next_attempt_at,created_at,updated_at)
    values(v_key,v_bucket.customer_id,'Успейте потратить бонусы',
      'Через '||v_bucket.days_left||' дней сгорят '||v_bucket.amount||' ₸ бонусов.',
      v_payload,v_tokens,p_now,p_now,p_now)
    on conflict(dedupe_key) do nothing;
    if found then v_inserted := v_inserted+1; end if;
  end loop;
  return v_inserted;
end;
$$;

revoke all on function public.bonus_expiry_reminder_state(uuid,date,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.bonus_expiry_reminder_state(uuid,date,integer,timestamptz) to service_role;
revoke all on function public.enqueue_bonus_expiry_reminders(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.enqueue_bonus_expiry_reminders(timestamptz,integer) to service_role;

-- The win-back grant invokes this helper inside its own transaction. The
-- claim UUID belongs to the absence cycle, so a retry can never create a
-- second inbox item or push for the same committed reward.
create or replace function public.queue_bonus_winback_notification(
  p_customer_id uuid,p_claim_id uuid,p_amount numeric default 1000
)
returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_customer public.customers%rowtype;
  v_notification_id uuid;
  v_language text;
  v_titles jsonb;
  v_bodies jsonb;
  v_payload jsonb;
  v_tokens jsonb;
begin
  if p_claim_id is null or p_amount is null or p_amount<=0 then
    raise exception 'Win-back claim and positive reward are required';
  end if;
  select * into v_customer from public.customers where id=p_customer_id and deleted_at is null;
  if not found then return; end if;
  v_notification_id := md5('bulka:bonus-winback:v1:'||p_claim_id::text)::uuid;
  v_language := case when v_customer.preferred_language in ('kk','kz') then 'kk'
    when v_customer.preferred_language='en' then 'en' else 'ru' end;
  v_titles := jsonb_build_object('ru','Мы скучали!','kk','Сізді сағындық!','en','We missed you!');
  v_bodies := jsonb_build_object(
    'ru','Начислили '||trim(to_char(p_amount,'FM999999990'))||' ₸ бонусов. Возвращайтесь за любимой выпечкой в Bulka!',
    'kk',trim(to_char(p_amount,'FM999999990'))||' ₸ бонус есептелді. Сүйікті пісірмелеріңіз үшін Bulka-ға оралыңыз!',
    'en','We added '||trim(to_char(p_amount,'FM999999990'))||' ₸ in bonuses. Come back for your favourites at Bulka!');
  v_payload := jsonb_build_object('type','bonus_winback','messageKey','bonus_winback',
    'notificationId',v_notification_id,'winbackClaimId',p_claim_id,'amount',p_amount,
    'destination','notifications','deepLink','https://bulka.com.kz/app/');
  insert into public.customer_notifications(id,customer_id,title,body,type,payload)
  values(v_notification_id,p_customer_id,v_titles->>v_language,v_bodies->>v_language,'bonus',
    v_payload||jsonb_build_object('i18n',jsonb_build_object('titles',v_titles,'bodies',v_bodies)))
  on conflict(id) do nothing;
  select coalesce(jsonb_agg(token order by token),'[]'::jsonb) into v_tokens from (
    select distinct btrim(token) token from public.customer_push_tokens
    where customer_id=p_customer_id and char_length(btrim(token)) between 16 and 4096
  ) destinations;
  if jsonb_array_length(v_tokens)>0 then
    insert into public.push_notification_outbox(dedupe_key,customer_id,title,body,payload,pending_tokens)
    values('bonus-winback:'||p_claim_id::text,p_customer_id,v_titles->>v_language,v_bodies->>v_language,v_payload,v_tokens)
    on conflict(dedupe_key) do nothing;
  end if;
end;
$$;
revoke all on function public.queue_bonus_winback_notification(uuid,uuid,numeric)
  from public,anon,authenticated,service_role;

-- Retire inactivity-based warnings already queued by the previous policy.
-- Their payload refers to the whole balance, not to individual credit lots.
update public.marketing_deliveries delivery set status='skipped',
  error='Replaced by dated bonus expiry reminders'
from public.marketing_automations automation
where delivery.automation_id=automation.id and automation.trigger_type='bonus_expiring'
  and delivery.status='pending';
update public.push_notification_outbox set status='cancelled',pending_tokens='[]'::jsonb,
  locked_at=null,lease_token=null,updated_at=now(),last_error='Replaced by dated bonus expiry reminders'
where payload->>'type'='marketing_bonus_expiring' and status in ('queued','retry','processing');

commit;
