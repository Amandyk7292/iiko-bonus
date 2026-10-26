begin;

create table public.suspicious_purchase_events (
  order_id uuid primary key references public.kaspi_orders(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  branch_id uuid not null references public.bulka_locations(id) on delete cascade,
  paid_at timestamptz not null
);
create index suspicious_purchase_events_window_idx
  on public.suspicious_purchase_events(customer_id, branch_id, paid_at desc);

-- Preserve the current 24-hour activity window when this feature is first enabled.
insert into public.suspicious_purchase_events(order_id, customer_id, branch_id, paid_at)
select id, customer_id, branch_id, created_at
from public.kaspi_orders
where status = 'paid'
  and customer_id is not null
  and branch_id is not null
  and created_at >= now() - interval '24 hours'
on conflict (order_id) do nothing;

create table public.suspicious_purchase_alerts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  branch_id uuid not null references public.bulka_locations(id) on delete cascade,
  order_count integer not null check (order_count > 3),
  trigger_order_id uuid not null references public.kaspi_orders(id) on delete cascade,
  alerted_at timestamptz not null default now()
);
create index suspicious_purchase_alerts_cooldown_idx
  on public.suspicious_purchase_alerts(customer_id, branch_id, alerted_at desc);

create table public.photo_report_telegram_alert_outbox (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.suspicious_purchase_alerts(id) on delete cascade,
  recipient_id uuid not null references public.photo_report_telegram_recipients(id) on delete cascade,
  chat_id text not null check (chat_id ~ '^[1-9][0-9]{0,19}$'),
  text text not null check (length(text) between 1 and 4096),
  status text not null default 'queued'
    check (status in ('queued','sending','sent','failed','uncertain','cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  message_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (alert_id, recipient_id)
);
create index photo_report_telegram_alert_outbox_due
  on public.photo_report_telegram_alert_outbox(status, next_attempt_at);

alter table public.suspicious_purchase_events enable row level security;
alter table public.suspicious_purchase_alerts enable row level security;
alter table public.photo_report_telegram_alert_outbox enable row level security;
revoke all on public.suspicious_purchase_events, public.suspicious_purchase_alerts,
  public.photo_report_telegram_alert_outbox from public, anon, authenticated;
grant all on public.suspicious_purchase_events, public.suspicious_purchase_alerts,
  public.photo_report_telegram_alert_outbox to service_role;

create or replace function public.notify_suspicious_customer_purchase()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_name text;
  v_phone text;
  v_branch text;
  v_city text;
  v_alert_id uuid;
  v_message text;
begin
  if new.status <> 'paid' or new.customer_id is null or new.branch_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'paid' then
    return new;
  end if;

  -- Serialize the threshold and 24-hour cooldown for this customer at this branch.
  perform pg_advisory_xact_lock(hashtextextended(new.customer_id::text || ':' || new.branch_id::text, 0));

  delete from public.suspicious_purchase_events
  where customer_id = new.customer_id
    and branch_id = new.branch_id
    and paid_at < v_now - interval '48 hours';
  delete from public.suspicious_purchase_alerts
  where customer_id = new.customer_id
    and branch_id = new.branch_id
    and alerted_at < v_now - interval '90 days';

  insert into public.suspicious_purchase_events(order_id, customer_id, branch_id, paid_at)
  values (new.id, new.customer_id, new.branch_id, v_now)
  on conflict (order_id) do nothing;
  if not found then
    return new;
  end if;

  select count(*)::integer into v_count
  from public.suspicious_purchase_events e
  join public.kaspi_orders o on o.id = e.order_id and o.status = 'paid'
  where e.customer_id = new.customer_id
    and e.branch_id = new.branch_id
    and e.paid_at > v_now - interval '24 hours'
    and e.paid_at <= v_now;

  if v_count <= 3 or exists (
    select 1 from public.suspicious_purchase_alerts a
    where a.customer_id = new.customer_id
      and a.branch_id = new.branch_id
      and a.alerted_at > v_now - interval '24 hours'
  ) then
    return new;
  end if;

  select
    coalesce(nullif(btrim(c.name), ''), nullif(c.phone, ''), nullif(new.phone, ''), 'Клиент'),
    coalesce(nullif(c.phone, ''), nullif(new.phone, ''), 'не указан')
  into v_name, v_phone
  from public.customers c
  where c.id = new.customer_id;
  if v_name is null then
    v_name := coalesce(nullif(new.phone, ''), 'Клиент');
    v_phone := coalesce(nullif(new.phone, ''), 'не указан');
  end if;
  select coalesce(nullif(btrim(l.name), ''), nullif(new.branch_name, ''), 'Точка'),
         coalesce(nullif(btrim(l.city), ''), 'город не указан')
  into v_branch, v_city
  from public.bulka_locations l
  where l.id = new.branch_id;
  if v_branch is null then
    v_branch := coalesce(nullif(new.branch_name, ''), 'Точка');
    v_city := 'город не указан';
  end if;

  insert into public.suspicious_purchase_alerts(customer_id, branch_id, order_count, trigger_order_id, alerted_at)
  values (new.customer_id, new.branch_id, v_count, new.id, v_now)
  returning id into v_alert_id;

  v_message := format(
    E'⚠️ Проверьте частые покупки\nКлиент: %s\nТелефон: %s\nТочка: %s, %s\nОплаченных заказов за 24 часа: %s\nПоследний заказ: №%s',
    left(regexp_replace(v_name, '[[:cntrl:]]', ' ', 'g'), 160),
    left(regexp_replace(v_phone, '[[:cntrl:]]', ' ', 'g'), 32),
    left(regexp_replace(v_branch, '[[:cntrl:]]', ' ', 'g'), 160),
    left(regexp_replace(v_city, '[[:cntrl:]]', ' ', 'g'), 100),
    v_count,
    new.order_number
  );

  insert into public.photo_report_telegram_alert_outbox(alert_id, recipient_id, chat_id, text, created_at)
  select v_alert_id, r.id, u.chat_id, v_message, v_now
  from public.photo_report_telegram_recipients r
  join public.photo_report_telegram_users u on u.user_id = r.user_id
  where r.role in ('owner', 'admin')
    and r.status = 'active'
    and u.chat_id ~ '^[1-9][0-9]{0,19}$';

  return new;
end;
$$;

drop trigger if exists kaspi_orders_suspicious_purchase_alert on public.kaspi_orders;
create trigger kaspi_orders_suspicious_purchase_alert
after insert or update of status on public.kaspi_orders
for each row execute function public.notify_suspicious_customer_purchase();

create function public.claim_photo_report_telegram_alerts(p_limit integer, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  update public.photo_report_telegram_alert_outbox
  set status = 'uncertain'
  where status = 'sending' and lease_until <= p_now;
  update public.photo_report_telegram_alert_outbox o
  set status = 'cancelled', completed_at = p_now
  where o.status in ('queued', 'sending', 'uncertain', 'failed')
    and not exists (
      select 1 from public.photo_report_telegram_recipients r
      where r.id = o.recipient_id and r.status = 'active'
    );
  delete from public.photo_report_telegram_alert_outbox
  where created_at < p_now - interval '90 days'
    and status in ('sent', 'failed', 'uncertain', 'cancelled');

  with candidates as (
    select o.id
    from public.photo_report_telegram_alert_outbox o
    where o.status = 'queued' and o.next_attempt_at <= p_now
    order by o.created_at, o.id
    limit greatest(1, least(coalesce(p_limit, 1), 100))
    for update skip locked
  ), claimed as (
    update public.photo_report_telegram_alert_outbox o
    set status = 'sending', lease_token = gen_random_uuid(),
        lease_until = p_now + interval '90 seconds', attempts = attempts + 1
    from candidates c
    where o.id = c.id
    returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'chatId', chat_id, 'text', text, 'leaseToken', lease_token,
    'recipientId', recipient_id
  ) order by created_at, id), '[]'::jsonb)
  into result from claimed;
  return result;
end;
$$;

create function public.authorize_photo_report_telegram_alert(p_id uuid, p_lease uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  alert_row public.photo_report_telegram_alert_outbox%rowtype;
begin
  select * into alert_row
  from public.photo_report_telegram_alert_outbox
  where id = p_id and lease_token = p_lease
  for update;
  if alert_row.id is null or alert_row.status <> 'sending' then return 'false'::jsonb; end if;
  if alert_row.lease_until <= p_now then
    update public.photo_report_telegram_alert_outbox set status = 'uncertain' where id = p_id;
    return 'false'::jsonb;
  end if;
  if not exists (
    select 1 from public.photo_report_telegram_recipients r
    where r.id = alert_row.recipient_id and r.status = 'active' and r.role in ('owner', 'admin')
  ) then
    update public.photo_report_telegram_alert_outbox
    set status = 'cancelled', completed_at = p_now
    where id = p_id;
    return 'false'::jsonb;
  end if;
  return 'true'::jsonb;
end;
$$;

create function public.complete_photo_report_telegram_alert(p_id uuid, p_lease uuid, p_message_id text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.photo_report_telegram_alert_outbox
  set status = 'sent', message_id = p_message_id, completed_at = p_now
  where id = p_id and lease_token = p_lease and status = 'sending';
  return to_jsonb(found);
end;
$$;

create function public.fail_photo_report_telegram_alert(
  p_id uuid, p_lease uuid, p_retry integer, p_permanent boolean, p_uncertain boolean, p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.photo_report_telegram_alert_outbox
  set status = case when p_uncertain then 'uncertain' when p_permanent then 'failed' else 'queued' end,
      next_attempt_at = case when not p_uncertain and not p_permanent
        then p_now + make_interval(secs => greatest(1, p_retry)) else next_attempt_at end,
      completed_at = case when p_permanent then p_now else null end
  where id = p_id and lease_token = p_lease and status = 'sending';
  return to_jsonb(found);
end;
$$;

revoke all on function public.notify_suspicious_customer_purchase(),
  public.claim_photo_report_telegram_alerts(integer, timestamptz),
  public.authorize_photo_report_telegram_alert(uuid, uuid, timestamptz),
  public.complete_photo_report_telegram_alert(uuid, uuid, text, timestamptz),
  public.fail_photo_report_telegram_alert(uuid, uuid, integer, boolean, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_photo_report_telegram_alerts(integer, timestamptz),
  public.authorize_photo_report_telegram_alert(uuid, uuid, timestamptz),
  public.complete_photo_report_telegram_alert(uuid, uuid, text, timestamptz),
  public.fail_photo_report_telegram_alert(uuid, uuid, integer, boolean, boolean, timestamptz)
  to service_role;

notify pgrst, 'reload schema';
commit;
