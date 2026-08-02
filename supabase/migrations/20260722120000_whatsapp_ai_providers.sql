-- Switchable AI providers and encrypted per-provider API credentials.

alter table public.whatsapp_assistant_settings
  add column if not exists ai_provider varchar(20) not null default 'gemini';

alter table public.whatsapp_assistant_settings
  add column if not exists ai_model varchar(120) not null default 'gemini-3.1-flash-lite';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'whatsapp_assistant_settings_ai_provider_check'
      and conrelid = 'public.whatsapp_assistant_settings'::regclass
  ) then
    alter table public.whatsapp_assistant_settings
      add constraint whatsapp_assistant_settings_ai_provider_check
      check (ai_provider in ('gemini', 'qwen', 'deepseek'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'whatsapp_assistant_settings_ai_model_check'
      and conrelid = 'public.whatsapp_assistant_settings'::regclass
  ) then
    alter table public.whatsapp_assistant_settings
      add constraint whatsapp_assistant_settings_ai_model_check
      check (char_length(btrim(ai_model)) between 1 and 120);
  end if;
end;
$$;

create table if not exists public.whatsapp_ai_provider_credentials (
  provider varchar(20) primary key
    check (provider in ('gemini', 'qwen', 'deepseek')),
  encrypted_api_key text not null
    check (char_length(encrypted_api_key) between 40 and 2000),
  updated_by varchar(120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_ai_provider_credentials enable row level security;

drop policy if exists service_role_all_whatsapp_ai_provider_credentials
  on public.whatsapp_ai_provider_credentials;

create policy service_role_all_whatsapp_ai_provider_credentials
  on public.whatsapp_ai_provider_credentials for all to service_role
  using (true) with check (true);

drop trigger if exists whatsapp_ai_provider_credentials_set_updated_at
  on public.whatsapp_ai_provider_credentials;

create trigger whatsapp_ai_provider_credentials_set_updated_at
before update on public.whatsapp_ai_provider_credentials
for each row execute function public.set_updated_at();
