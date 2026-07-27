-- Persistent WhatsApp inbox, assistant settings, knowledge and customer memory.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.whatsapp_assistant_settings (
  id text primary key default 'default' check (id = 'default'),
  assistant_enabled boolean not null default true,
  auto_reply_enabled boolean not null default true,
  memory_enabled boolean not null default true,
  bot_name varchar(80) not null default 'Ассистент Bulka'
    check (char_length(btrim(bot_name)) between 1 and 80),
  tone varchar(20) not null default 'friendly'
    check (tone in ('friendly', 'warm', 'concise', 'formal')),
  supported_languages text[] not null default array['ru', 'kk', 'en']::text[]
    check (cardinality(supported_languages) between 1 and 3),
  history_messages smallint not null default 12
    check (history_messages between 0 and 30),
  business_description text not null default '',
  custom_instructions text not null default '',
  welcome_message varchar(500) not null default 'Здравствуйте! Я ассистент Bulka. Чем помочь?',
  fallback_message varchar(500) not null default 'Сейчас не получается ответить. Оператор Bulka подключится к диалогу.',
  updated_by varchar(120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.whatsapp_assistant_settings (id)
values ('default')
on conflict (id) do nothing;

create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  chat_jid varchar(255) not null unique,
  phone varchar(32),
  display_name varchar(160),
  status varchar(20) not null default 'open'
    check (status in ('open', 'closed', 'spam')),
  assistant_enabled boolean not null default true,
  context_reset_at timestamptz,
  unread_count integer not null default 0 check (unread_count >= 0),
  last_message_preview varchar(500),
  last_message_at timestamptz,
  last_customer_message_at timestamptz,
  last_operator_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  wa_message_id varchar(180),
  direction varchar(16) not null check (direction in ('inbound', 'outbound')),
  sender_type varchar(20) not null
    check (sender_type in ('customer', 'assistant', 'operator', 'system')),
  content text not null check (char_length(btrim(content)) between 1 and 10000),
  delivery_status varchar(20) not null default 'sent'
    check (delivery_status in ('received', 'pending', 'sent', 'delivered', 'read', 'failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists whatsapp_messages_external_id_idx
  on public.whatsapp_messages (conversation_id, wa_message_id)
  where wa_message_id is not null;

create table if not exists public.whatsapp_knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  title varchar(160) not null check (char_length(btrim(title)) between 1 and 160),
  category varchar(60) not null default 'general'
    check (char_length(btrim(category)) between 1 and 60),
  content text not null check (char_length(btrim(content)) between 1 and 12000),
  is_active boolean not null default true,
  created_by varchar(120),
  updated_by varchar(120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_memories (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  label varchar(120) not null default 'Заметка'
    check (char_length(btrim(label)) between 1 and 120),
  content text not null check (char_length(btrim(content)) between 1 and 2000),
  source_type varchar(20) not null default 'manual'
    check (source_type in ('manual', 'message', 'assistant')),
  source_message_id uuid references public.whatsapp_messages(id) on delete set null,
  is_active boolean not null default true,
  created_by varchar(120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_conversations_last_message_idx
  on public.whatsapp_conversations (last_message_at desc nulls last, created_at desc);
create index if not exists whatsapp_conversations_status_idx
  on public.whatsapp_conversations (status, last_message_at desc nulls last);
create index if not exists whatsapp_messages_conversation_idx
  on public.whatsapp_messages (conversation_id, created_at desc);
create index if not exists whatsapp_knowledge_active_idx
  on public.whatsapp_knowledge_documents (is_active, updated_at desc);
create index if not exists whatsapp_memories_conversation_idx
  on public.whatsapp_memories (conversation_id, is_active, updated_at desc);

alter table public.whatsapp_assistant_settings enable row level security;
alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_knowledge_documents enable row level security;
alter table public.whatsapp_memories enable row level security;

drop policy if exists service_role_all_whatsapp_assistant_settings
  on public.whatsapp_assistant_settings;
drop policy if exists service_role_all_whatsapp_conversations
  on public.whatsapp_conversations;
drop policy if exists service_role_all_whatsapp_messages
  on public.whatsapp_messages;
drop policy if exists service_role_all_whatsapp_knowledge_documents
  on public.whatsapp_knowledge_documents;
drop policy if exists service_role_all_whatsapp_memories
  on public.whatsapp_memories;

create policy service_role_all_whatsapp_assistant_settings
  on public.whatsapp_assistant_settings for all to service_role
  using (true) with check (true);
create policy service_role_all_whatsapp_conversations
  on public.whatsapp_conversations for all to service_role
  using (true) with check (true);
create policy service_role_all_whatsapp_messages
  on public.whatsapp_messages for all to service_role
  using (true) with check (true);
create policy service_role_all_whatsapp_knowledge_documents
  on public.whatsapp_knowledge_documents for all to service_role
  using (true) with check (true);
create policy service_role_all_whatsapp_memories
  on public.whatsapp_memories for all to service_role
  using (true) with check (true);

create or replace function public.sync_whatsapp_conversation_from_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.whatsapp_conversations
  set
    last_message_preview = left(regexp_replace(new.content, '[[:space:]]+', ' ', 'g'), 500),
    last_message_at = new.created_at,
    last_customer_message_at = case
      when new.direction = 'inbound' then new.created_at
      else last_customer_message_at
    end,
    last_operator_message_at = case
      when new.sender_type = 'operator' then new.created_at
      else last_operator_message_at
    end,
    unread_count = case
      when new.direction = 'inbound' then unread_count + 1
      else unread_count
    end,
    updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

revoke all on function public.sync_whatsapp_conversation_from_message()
  from public, anon, authenticated;

drop trigger if exists whatsapp_messages_sync_conversation on public.whatsapp_messages;
create trigger whatsapp_messages_sync_conversation
after insert on public.whatsapp_messages
for each row execute function public.sync_whatsapp_conversation_from_message();

drop trigger if exists whatsapp_assistant_settings_set_updated_at
  on public.whatsapp_assistant_settings;
create trigger whatsapp_assistant_settings_set_updated_at
before update on public.whatsapp_assistant_settings
for each row execute function public.set_updated_at();

drop trigger if exists whatsapp_conversations_set_updated_at
  on public.whatsapp_conversations;
create trigger whatsapp_conversations_set_updated_at
before update on public.whatsapp_conversations
for each row execute function public.set_updated_at();

drop trigger if exists whatsapp_knowledge_documents_set_updated_at
  on public.whatsapp_knowledge_documents;
create trigger whatsapp_knowledge_documents_set_updated_at
before update on public.whatsapp_knowledge_documents
for each row execute function public.set_updated_at();

drop trigger if exists whatsapp_memories_set_updated_at
  on public.whatsapp_memories;
create trigger whatsapp_memories_set_updated_at
before update on public.whatsapp_memories
for each row execute function public.set_updated_at();
