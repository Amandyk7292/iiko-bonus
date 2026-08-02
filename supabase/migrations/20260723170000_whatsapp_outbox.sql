create extension if not exists pgcrypto;

create table if not exists public.whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key varchar(200) not null unique
    check (char_length(btrim(dedupe_key)) between 8 and 200),
  chat_jid varchar(255) not null
    check (char_length(btrim(chat_jid)) between 5 and 255),
  message_type varchar(16) not null default 'text'
    check (message_type in ('text', 'voice')),
  source_type varchar(40) not null default 'system'
    check (char_length(btrim(source_type)) between 1 and 40),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  status varchar(16) not null default 'queued'
    check (status in ('queued', 'processing', 'retry', 'sent', 'failed', 'cancelled')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 20),
  max_attempts smallint not null default 8 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  provider_message_id varchar(180),
  last_error varchar(500),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_outbox_delivery_idx
  on public.whatsapp_outbox(status, next_attempt_at, created_at)
  where status in ('queued', 'retry', 'processing');
create index if not exists whatsapp_outbox_created_idx
  on public.whatsapp_outbox(created_at desc);

alter table public.whatsapp_messages
  add column if not exists outbox_id uuid
    references public.whatsapp_outbox(id) on delete set null;
create unique index if not exists whatsapp_messages_outbox_idx
  on public.whatsapp_messages(outbox_id)
  where outbox_id is not null;

create or replace function public.claim_whatsapp_outbox(
  p_limit integer default 25,
  p_message_id uuid default null
)
returns setof public.whatsapp_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  with terminal as (
    update public.whatsapp_outbox message
    set
      status = 'failed',
      last_error = coalesce(message.last_error, 'Delivery worker stopped during final attempt'),
      locked_at = null,
      updated_at = now()
    where
      message.status = 'processing'
      and message.locked_at < now() - interval '2 minutes'
      and message.attempt_count >= message.max_attempts
    returning message.id
  )
  update public.whatsapp_messages conversation_message
  set delivery_status = 'failed'
  from terminal
  where conversation_message.outbox_id = terminal.id;

  return query
  with candidates as (
    select message.id
    from public.whatsapp_outbox message
    where
      (p_message_id is null or message.id = p_message_id)
      and (
        (
          message.status in ('queued', 'retry')
          and message.next_attempt_at <= now()
        )
        or (
          message.status = 'processing'
          and message.locked_at < now() - interval '2 minutes'
        )
      )
      and message.attempt_count < message.max_attempts
    order by message.next_attempt_at, message.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
  )
  update public.whatsapp_outbox message
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

revoke all on function public.claim_whatsapp_outbox(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_whatsapp_outbox(integer, uuid)
  to service_role;

alter table public.whatsapp_outbox enable row level security;
drop policy if exists service_role_all_whatsapp_outbox
  on public.whatsapp_outbox;
create policy service_role_all_whatsapp_outbox
  on public.whatsapp_outbox for all to service_role
  using (true) with check (true);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'whatsapp-outbox',
  'whatsapp-outbox',
  false,
  5242880,
  array['audio/ogg', 'audio/opus', 'application/ogg']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

revoke all on table public.whatsapp_outbox from anon, authenticated;
