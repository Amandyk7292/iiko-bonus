-- ====================================================================
-- BULKA BONUS / ADMIN PANEL SUPABASE SETUP
-- Run this whole file in Supabase Dashboard -> SQL Editor.
-- Safe to run multiple times.
-- ====================================================================

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------
-- Customers
-- --------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  phone varchar(32) unique not null,
  name varchar(160) default 'Гость',
  balance numeric(12, 2) default 0 not null,
  total_spent numeric(12, 2) default 0 not null,
  telegram_id varchar(80),
  fcm_token text,
  birth_date date,
  tags text[] default '{}',
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table public.customers add column if not exists phone varchar(32);
alter table public.customers add column if not exists name varchar(160) default 'Гость';
alter table public.customers add column if not exists balance numeric(12, 2) default 0;
alter table public.customers add column if not exists total_spent numeric(12, 2) default 0;
alter table public.customers add column if not exists telegram_id varchar(80);
alter table public.customers add column if not exists fcm_token text;
alter table public.customers add column if not exists birth_date date;
alter table public.customers add column if not exists tags text[] default '{}';
alter table public.customers add column if not exists created_at timestamptz default now();
alter table public.customers add column if not exists updated_at timestamptz default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'customers'
      and column_name = 'id'
      and data_type = 'uuid'
  ) then
    alter table public.customers alter column id set default gen_random_uuid();
  end if;
end $$;

create unique index if not exists customers_phone_unique on public.customers (phone);
create index if not exists customers_created_at_idx on public.customers (created_at desc);
create index if not exists customers_phone_idx on public.customers (phone);

-- --------------------------------------------------------------------
-- Transactions
-- --------------------------------------------------------------------
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  order_id text,
  type varchar(50) not null,
  amount numeric(12, 2) not null,
  order_total numeric(12, 2),
  description text,
  available_at timestamptz,
  activated_at timestamptz,
  timestamp timestamptz default now() not null,
  created_at timestamptz default now() not null
);

alter table public.transactions add column if not exists customer_id uuid;
alter table public.transactions add column if not exists order_id text;
alter table public.transactions add column if not exists type varchar(50);
alter table public.transactions add column if not exists amount numeric(12, 2);
alter table public.transactions add column if not exists order_total numeric(12, 2);
alter table public.transactions add column if not exists description text;
alter table public.transactions add column if not exists available_at timestamptz;
alter table public.transactions add column if not exists activated_at timestamptz;
alter table public.transactions add column if not exists timestamp timestamptz default now();
alter table public.transactions add column if not exists created_at timestamptz default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transactions'
      and column_name = 'id'
      and data_type = 'uuid'
  ) then
    alter table public.transactions alter column id set default gen_random_uuid();
  end if;
end $$;

create index if not exists transactions_customer_id_idx on public.transactions (customer_id);
create index if not exists transactions_timestamp_idx on public.transactions (timestamp desc);
create index if not exists transactions_order_id_idx on public.transactions (order_id);
create index if not exists transactions_pending_available_idx on public.transactions (available_at)
  where type = 'pending_deposit';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_customer_id_fkey'
  ) then
    alter table public.transactions
      add constraint transactions_customer_id_fkey
      foreign key (customer_id) references public.customers(id) on delete cascade;
  end if;
end $$;

-- --------------------------------------------------------------------
-- iiko plugin delivery log
-- --------------------------------------------------------------------
create table if not exists public.iiko_operation_logs (
  id bigserial primary key,
  order_id text not null,
  customer_id uuid references public.customers(id) on delete set null,
  status varchar(32) not null,
  duplicate boolean default false not null,
  discount_amount numeric(12, 2) default 0 not null,
  earned_bonus numeric(12, 2) default 0 not null,
  order_total numeric(12, 2) default 0 not null,
  cashback_percent numeric(6, 2),
  balance numeric(12, 2),
  error_message text,
  payload jsonb,
  created_at timestamptz default now() not null
);

alter table public.iiko_operation_logs add column if not exists order_id text;
alter table public.iiko_operation_logs add column if not exists customer_id uuid;
alter table public.iiko_operation_logs add column if not exists status varchar(32);
alter table public.iiko_operation_logs add column if not exists duplicate boolean default false;
alter table public.iiko_operation_logs add column if not exists discount_amount numeric(12, 2) default 0;
alter table public.iiko_operation_logs add column if not exists earned_bonus numeric(12, 2) default 0;
alter table public.iiko_operation_logs add column if not exists order_total numeric(12, 2) default 0;
alter table public.iiko_operation_logs add column if not exists cashback_percent numeric(6, 2);
alter table public.iiko_operation_logs add column if not exists balance numeric(12, 2);
alter table public.iiko_operation_logs add column if not exists error_message text;
alter table public.iiko_operation_logs add column if not exists payload jsonb;
alter table public.iiko_operation_logs add column if not exists created_at timestamptz default now();

create index if not exists iiko_operation_logs_created_at_idx on public.iiko_operation_logs (created_at desc);
create index if not exists iiko_operation_logs_order_id_idx on public.iiko_operation_logs (order_id);
create index if not exists iiko_operation_logs_status_idx on public.iiko_operation_logs (status);

-- --------------------------------------------------------------------
-- Admin / bonus settings
-- value stays TEXT because backend stores numbers, strings, arrays, objects.
-- JSON objects are stored as JSON strings and parsed by settings.js.
-- --------------------------------------------------------------------
create table if not exists public.settings (
  key varchar(120) primary key,
  value text not null,
  updated_at timestamptz default now() not null
);

alter table public.settings add column if not exists updated_at timestamptz default now();

insert into public.settings (key, value) values
  ('base_cashback_percent', '3'),
  ('tier_silver_th', '50000'),
  ('tier_silver_cb', '5'),
  ('tier_gold_th', '150000'),
  ('tier_gold_cb', '7'),
  ('tier_platinum_th', '300000'),
  ('tier_platinum_cb', '10'),
  ('max_discount_percent', '50'),
  ('bonus_mode', 'cashback'),
  ('bonus_activation', '{"enabled":true,"delay_days":0,"first_transaction_bonus":0,"first_transaction_notification":""}'),
  ('bonus_expiration', '{"enabled":true,"expiration_days":90,"notify_before_days":30,"auto_write_off":true}'),
  ('bonus_birthday', '{"enabled":true,"bonus_amount":500,"expiration_days":14,"message":"С днем рождения! Дарим бонусы от Bulka."}'),
  ('bonus_promocodes', '[]'),
  ('bonus_cross', '{"enabled":false,"new_clients_bonus":0,"loyal_clients_bonus":0,"period":"none","city":"Все города","min_check":0}'),
  ('bonus_referral', '{"enabled":false,"inviter_bonus":300,"friend_bonus":300,"min_first_order":0}'),
  ('bonus_automailing', '{"enabled":false,"inactive_days":30,"message":"Мы скучаем! Возвращайтесь за свежей выпечкой и бонусами."}'),
  ('bonus_card_media', '{"banner_url":"","logo_url":"","card_title":"Bulka Bonus"}'),
  ('bonus_corporate', '{"enabled":false,"company_name":"","monthly_limit":0,"employee_cashback_percent":5}')
on conflict (key) do nothing;

-- --------------------------------------------------------------------
-- Stories / ads in mobile app
-- Code uses lowercase coverurl/contenturl.
-- --------------------------------------------------------------------
create table if not exists public.stories (
  id bigint primary key,
  title varchar(255) not null,
  coverurl text not null,
  contenturl text not null,
  description text,
  duration integer default 15,
  created_at timestamptz default now() not null
);

alter table public.stories add column if not exists coverurl text;
alter table public.stories add column if not exists contenturl text;
alter table public.stories add column if not exists description text;
alter table public.stories add column if not exists duration integer default 15;
alter table public.stories add column if not exists created_at timestamptz default now();

-- Stories are managed only from the admin panel. Do not seed default rows here,
-- otherwise deleted admin stories come back when this schema is rerun.

-- --------------------------------------------------------------------
-- Instagram-style news feed in mobile app
-- --------------------------------------------------------------------
create table if not exists public.news (
  id bigserial primary key,
  title varchar(255) not null,
  imageurl text not null,
  description text,
  created_at timestamptz default now() not null
);

alter table public.news add column if not exists title varchar(255);
alter table public.news add column if not exists imageurl text;
alter table public.news add column if not exists description text;
alter table public.news add column if not exists created_at timestamptz default now();

create index if not exists news_created_at_idx on public.news (created_at desc);

-- --------------------------------------------------------------------
-- Apple Wallet push registrations
-- --------------------------------------------------------------------
create table if not exists public.wallet_registrations (
  id bigserial primary key,
  serial_number varchar(140) not null,
  push_token text not null,
  device_id text,
  pass_type_id text,
  created_at timestamptz default now() not null,
  unique(serial_number, push_token)
);

alter table public.wallet_registrations add column if not exists device_id text;
alter table public.wallet_registrations add column if not exists pass_type_id text;
alter table public.wallet_registrations add column if not exists created_at timestamptz default now();

create index if not exists wallet_registrations_serial_idx on public.wallet_registrations (serial_number);
create unique index if not exists wallet_registrations_device_serial_unique
  on public.wallet_registrations (device_id, serial_number)
  where device_id is not null;

-- --------------------------------------------------------------------
-- Atomic balance and idempotent order application
-- --------------------------------------------------------------------
create or replace function public.increment_customer_balance(
  p_customer_id uuid,
  p_amount_change numeric
)
returns table(balance numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.customers
  set
    balance = balance + p_amount_change,
    updated_at = now()
  where id = p_customer_id
    and balance + p_amount_change >= 0
  returning customers.balance into balance;

  if not found then
    raise exception 'customer not found or insufficient balance';
  end if;

  return next;
end;
$$;

drop function if exists public.apply_loyalty_transaction(uuid, text, numeric, numeric, numeric, numeric);

create or replace function public.apply_loyalty_transaction(
  p_customer_id uuid,
  p_order_id text,
  p_discount_amount numeric,
  p_earned_bonus numeric,
  p_order_total numeric,
  p_real_money_paid numeric,
  p_activation_delay_days integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_total_spent numeric;
  v_active_bonus numeric := 0;
  v_pending_bonus numeric := 0;
  v_available_at timestamptz;
begin
  if p_order_id is null or btrim(p_order_id) = '' then
    raise exception 'order_id is required';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_order_id));

  if exists (
    select 1
    from public.transactions
    where order_id = p_order_id
      and type in ('withdrawal', 'deposit', 'pending_deposit')
  ) then
    select balance, total_spent
      into v_balance, v_total_spent
    from public.customers
    where id = p_customer_id;

    return jsonb_build_object(
      'duplicate', true,
      'balance', v_balance,
      'total_spent', v_total_spent,
      'pending_bonus', 0,
      'available_at', null
    );
  end if;

  if coalesce(p_earned_bonus, 0) > 0 and coalesce(p_activation_delay_days, 0) > 0 then
    v_pending_bonus := coalesce(p_earned_bonus, 0);
    v_available_at := now() + make_interval(days => p_activation_delay_days);
  else
    v_active_bonus := coalesce(p_earned_bonus, 0);
  end if;

  update public.customers
  set
    balance = balance - coalesce(p_discount_amount, 0) + v_active_bonus,
    total_spent = total_spent + coalesce(p_real_money_paid, 0),
    updated_at = now()
  where id = p_customer_id
    and balance - coalesce(p_discount_amount, 0) >= 0
  returning balance, total_spent
    into v_balance, v_total_spent;

  if not found then
    raise exception 'customer not found or insufficient balance';
  end if;

  if coalesce(p_discount_amount, 0) > 0 then
    insert into public.transactions (customer_id, order_id, type, amount, order_total, description)
    values (p_customer_id, p_order_id, 'withdrawal', p_discount_amount, p_order_total, 'Оплата бонусами');
  end if;

  if coalesce(p_earned_bonus, 0) > 0 then
    if v_pending_bonus > 0 then
      insert into public.transactions (customer_id, order_id, type, amount, order_total, description, available_at)
      values (p_customer_id, p_order_id, 'pending_deposit', v_pending_bonus, p_real_money_paid, 'Кэшбэк ожидает активации', v_available_at);
    else
      insert into public.transactions (customer_id, order_id, type, amount, order_total, description)
      values (p_customer_id, p_order_id, 'deposit', v_active_bonus, p_real_money_paid, 'Кэшбэк за покупку');
    end if;
  end if;

  return jsonb_build_object(
    'duplicate', false,
    'balance', v_balance,
    'total_spent', v_total_spent,
    'pending_bonus', v_pending_bonus,
    'available_at', v_available_at
  );
end;
$$;

create or replace function public.activate_pending_bonus_transactions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_amount numeric := 0;
begin
  with due as (
    update public.transactions
    set
      type = 'deposit',
      activated_at = now(),
      description = coalesce(description, '') || ' / активирован'
    where type = 'pending_deposit'
      and available_at is not null
      and available_at <= now()
    returning customer_id, amount
  ),
  due_totals as (
    select customer_id, sum(amount) as amount
    from due
    group by customer_id
  ),
  updated_customers as (
    update public.customers c
    set
      balance = balance + t.amount,
      updated_at = now()
    from due_totals t
    where c.id = t.customer_id
    returning t.amount
  )
  select count(*), coalesce(sum(amount), 0)
    into v_count, v_amount
    from due;

  return jsonb_build_object('activated_count', v_count, 'activated_amount', v_amount);
end;
$$;

grant execute on function public.increment_customer_balance(uuid, numeric) to service_role;
grant execute on function public.apply_loyalty_transaction(uuid, text, numeric, numeric, numeric, numeric, integer) to service_role;
grant execute on function public.activate_pending_bonus_transactions() to service_role;

-- --------------------------------------------------------------------
-- WhatsApp / OTP session storage
-- --------------------------------------------------------------------
create table if not exists public.whatsapp_sessions (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- --------------------------------------------------------------------
-- Storage bucket for admin story uploads
-- --------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stories', 'stories', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- --------------------------------------------------------------------
-- RLS
-- Backend must use SUPABASE_SERVICE_ROLE_KEY. service_role bypasses RLS.
-- No public anon access to database tables.
-- Public read is enabled only for storage objects in the public stories bucket.
-- --------------------------------------------------------------------
alter table public.customers enable row level security;
alter table public.transactions enable row level security;
alter table public.settings enable row level security;
alter table public.stories enable row level security;
alter table public.news enable row level security;
alter table public.wallet_registrations enable row level security;
alter table public.whatsapp_sessions enable row level security;
alter table public.iiko_operation_logs enable row level security;

drop policy if exists "Allow all access for Service Role" on public.customers;
drop policy if exists "Allow all access for Service Role" on public.transactions;
drop policy if exists "Allow all access for Service Role" on public.settings;
drop policy if exists "Allow all access for Service Role" on public.stories;
drop policy if exists "Allow all access for Service Role" on public.news;
drop policy if exists "Allow all access for Service Role" on public.wallet_registrations;
drop policy if exists "service_role_all_customers" on public.customers;
drop policy if exists "service_role_all_transactions" on public.transactions;
drop policy if exists "service_role_all_settings" on public.settings;
drop policy if exists "service_role_all_stories" on public.stories;
drop policy if exists "service_role_all_news" on public.news;
drop policy if exists "service_role_all_wallet" on public.wallet_registrations;
drop policy if exists "service_role_all_whatsapp" on public.whatsapp_sessions;
drop policy if exists "service_role_all_iiko_logs" on public.iiko_operation_logs;

create policy "service_role_all_customers" on public.customers for all to service_role using (true) with check (true);
create policy "service_role_all_transactions" on public.transactions for all to service_role using (true) with check (true);
create policy "service_role_all_settings" on public.settings for all to service_role using (true) with check (true);
create policy "service_role_all_stories" on public.stories for all to service_role using (true) with check (true);
create policy "service_role_all_news" on public.news for all to service_role using (true) with check (true);
create policy "service_role_all_wallet" on public.wallet_registrations for all to service_role using (true) with check (true);
create policy "service_role_all_whatsapp" on public.whatsapp_sessions for all to service_role using (true) with check (true);
create policy "service_role_all_iiko_logs" on public.iiko_operation_logs for all to service_role using (true) with check (true);

drop policy if exists "Public read stories bucket" on storage.objects;
create policy "Public read stories bucket"
on storage.objects for select
to public
using (bucket_id = 'stories');

drop policy if exists "Service role manage stories bucket" on storage.objects;
create policy "Service role manage stories bucket"
on storage.objects for all
to service_role
using (bucket_id = 'stories')
with check (bucket_id = 'stories');

-- --------------------------------------------------------------------
-- Updated_at trigger
-- --------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

drop trigger if exists settings_set_updated_at on public.settings;
create trigger settings_set_updated_at
before update on public.settings
for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------
-- Smoke-check
-- --------------------------------------------------------------------
select
  'Bulka Supabase setup complete' as status,
  (select count(*) from public.settings) as settings_count,
  (select count(*) from public.stories) as stories_count,
  (select count(*) from public.news) as news_count;
