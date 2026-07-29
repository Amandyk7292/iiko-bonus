create extension if not exists pgcrypto;

create table if not exists public.push_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key varchar(200) not null unique
    check (char_length(btrim(dedupe_key)) between 8 and 200),
  customer_id uuid not null
    references public.customers(id) on delete cascade,
  title varchar(160) not null
    check (char_length(btrim(title)) between 1 and 160),
  body varchar(2000) not null
    check (char_length(btrim(body)) between 1 and 2000),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  pending_tokens jsonb not null default '[]'::jsonb
    check (jsonb_typeof(pending_tokens) = 'array'),
  status varchar(16) not null default 'queued'
    check (status in ('queued', 'processing', 'retry', 'sent', 'failed', 'skipped', 'cancelled')),
  attempt_count smallint not null default 0
    check (attempt_count between 0 and 20),
  max_attempts smallint not null default 8
    check (max_attempts between 1 and 20),
  attempted_tokens integer not null default 0
    check (attempted_tokens >= 0),
  delivered_tokens integer not null default 0
    check (delivered_tokens >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error varchar(500),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_notification_outbox_delivery_idx
  on public.push_notification_outbox(status, next_attempt_at, created_at)
  where status in ('queued', 'retry', 'processing');

create index if not exists push_notification_outbox_customer_idx
  on public.push_notification_outbox(customer_id, created_at desc);

create or replace function public.claim_push_notification_outbox(
  p_limit integer default 50,
  p_message_id uuid default null
)
returns setof public.push_notification_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.push_notification_outbox message
  set
    status = 'failed',
    pending_tokens = '[]'::jsonb,
    last_error = coalesce(message.last_error, 'Delivery worker stopped during final attempt'),
    locked_at = null,
    updated_at = now()
  where
    message.status = 'processing'
    and message.locked_at < now() - interval '5 minutes'
    and message.attempt_count >= message.max_attempts;

  return query
  with candidates as (
    select message.id
    from public.push_notification_outbox message
    where
      (p_message_id is null or message.id = p_message_id)
      and (
        (
          message.status in ('queued', 'retry')
          and message.next_attempt_at <= now()
        )
        or (
          message.status = 'processing'
          and message.locked_at < now() - interval '5 minutes'
        )
      )
      and message.attempt_count < message.max_attempts
    order by message.next_attempt_at, message.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  )
  update public.push_notification_outbox message
  set
    status = 'processing',
    attempt_count = message.attempt_count + 1,
    locked_at = now(),
    updated_at = now()
  from candidates
  where message.id = candidates.id
  returning message.*;
end;
$$;

revoke all on function public.claim_push_notification_outbox(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_push_notification_outbox(integer, uuid)
  to service_role;

alter table public.push_notification_outbox enable row level security;

drop policy if exists service_role_all_push_notification_outbox
  on public.push_notification_outbox;
create policy service_role_all_push_notification_outbox
  on public.push_notification_outbox for all to service_role
  using (true) with check (true);

revoke all on table public.push_notification_outbox from anon, authenticated;

create or replace function public.purge_push_outbox_for_anonymised_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is not null and old.deleted_at is distinct from new.deleted_at then
    delete from public.push_notification_outbox where customer_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists customers_purge_push_outbox_on_anonymise on public.customers;
create trigger customers_purge_push_outbox_on_anonymise
after update of deleted_at on public.customers
for each row execute function public.purge_push_outbox_for_anonymised_customer();

revoke all on function public.purge_push_outbox_for_anonymised_customer()
  from public, anon, authenticated;

comment on table public.push_notification_outbox is
  'Durable FCM delivery queue. Device tokens are removed after a terminal state.';
