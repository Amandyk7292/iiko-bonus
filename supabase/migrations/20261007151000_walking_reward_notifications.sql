begin;

-- The reward, ledger entry, inbox notice and push queue commit together.
-- Actual FCM delivery happens in the existing outbox worker, never inside
-- a signed walking measurement or its database transaction.
create function public.queue_walking_reward_notification()
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
  if new.credited_at is null or new.reward_amount<>1000 or
    (tg_op='UPDATE' and old.credited_at is not null) then
    return new;
  end if;
  select * into customer from public.customers where id=new.customer_id and deleted_at is null;
  if not found then return new; end if;
  notification_id:=md5('bulka:walking:notice:v1:'||new.customer_id::text||':'||new.walking_date::text)::uuid;
  language:=case when customer.preferred_language in ('kk','en') then customer.preferred_language else 'ru' end;
  titles:=jsonb_build_object(
    'ru','Начислено +1 000 бонусов',
    'kk','+1 000 бонус есептелді',
    'en','+1,000 bonuses earned');
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

create trigger walking_reward_notification
after insert or update of credited_at on public.walking_daily_progress
for each row execute function public.queue_walking_reward_notification();

comment on function public.queue_walking_reward_notification() is
  'One inbox notice and durable push per committed walking reward; existing FCM worker observes notification preferences.';
commit;
