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
  last_name varchar(160),
  gender varchar(20),
  email varchar(255),
  region varchar(160),
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
alter table public.customers add column if not exists last_name varchar(160);
alter table public.customers add column if not exists gender varchar(20);
alter table public.customers add column if not exists email varchar(255);
alter table public.customers add column if not exists region varchar(160);
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
alter table public.transactions add column if not exists items jsonb;
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
-- Configurable cashback / loyalty tiers
-- A tier owns a lower spending boundary. Its effective upper boundary
-- is the next active tier's min_spend, so ranges can never overlap.
-- --------------------------------------------------------------------
create table if not exists public.loyalty_tiers (
  id uuid primary key default gen_random_uuid(),
  code varchar(32) not null,
  name_ru varchar(80) not null,
  name_kk varchar(80) not null,
  name_en varchar(80) not null,
  description_ru varchar(240) not null,
  description_kk varchar(240) not null,
  description_en varchar(240) not null,
  min_spend numeric(14, 2) not null,
  cashback_percent numeric(5, 2) not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_tiers_code_format check (code ~ '^[a-z][a-z0-9_-]{1,31}$'),
  constraint loyalty_tiers_min_spend_range check (min_spend >= 0 and min_spend <= 1000000000000),
  constraint loyalty_tiers_cashback_range check (cashback_percent >= 0 and cashback_percent <= 100),
  constraint loyalty_tiers_sort_order_range check (sort_order >= 0 and sort_order <= 1000000),
  constraint loyalty_tiers_name_ru_not_blank check (btrim(name_ru) <> ''),
  constraint loyalty_tiers_name_kk_not_blank check (btrim(name_kk) <> ''),
  constraint loyalty_tiers_name_en_not_blank check (btrim(name_en) <> ''),
  constraint loyalty_tiers_description_ru_not_blank check (btrim(description_ru) <> ''),
  constraint loyalty_tiers_description_kk_not_blank check (btrim(description_kk) <> ''),
  constraint loyalty_tiers_description_en_not_blank check (btrim(description_en) <> '')
);

alter table public.loyalty_tiers add column if not exists code varchar(32);
alter table public.loyalty_tiers add column if not exists name_ru varchar(80);
alter table public.loyalty_tiers add column if not exists name_kk varchar(80);
alter table public.loyalty_tiers add column if not exists name_en varchar(80);
alter table public.loyalty_tiers add column if not exists description_ru varchar(240);
alter table public.loyalty_tiers add column if not exists description_kk varchar(240);
alter table public.loyalty_tiers add column if not exists description_en varchar(240);
alter table public.loyalty_tiers add column if not exists min_spend numeric(14, 2);
alter table public.loyalty_tiers add column if not exists cashback_percent numeric(5, 2);
alter table public.loyalty_tiers add column if not exists sort_order integer default 0;
alter table public.loyalty_tiers add column if not exists is_active boolean default true;
alter table public.loyalty_tiers add column if not exists created_at timestamptz default now();
alter table public.loyalty_tiers add column if not exists updated_at timestamptz default now();

create unique index if not exists loyalty_tiers_code_unique
  on public.loyalty_tiers (code);
create unique index if not exists loyalty_tiers_min_spend_unique
  on public.loyalty_tiers (min_spend);
create index if not exists loyalty_tiers_active_threshold_idx
  on public.loyalty_tiers (is_active, min_spend);
create index if not exists loyalty_tiers_sort_order_idx
  on public.loyalty_tiers (sort_order, min_spend);

-- Seed from legacy settings so applying this migration preserves the
-- cashback percentages and thresholds already configured by an operator.
insert into public.loyalty_tiers (
  code,
  name_ru,
  name_kk,
  name_en,
  description_ru,
  description_kk,
  description_en,
  min_spend,
  cashback_percent,
  sort_order,
  is_active
) values
  (
    'bronze', 'Бронза', 'Қола', 'Bronze',
    'Стартовый уровень программы лояльности',
    'Адалдық бағдарламасының бастапқы деңгейі',
    'Starting loyalty level',
    0,
    least(100, greatest(0, coalesce((select case when value ~ '^[0-9]+([.][0-9]+)?$' then value::numeric end from public.settings where key = 'base_cashback_percent'), 3))),
    0, true
  ),
  (
    'silver', 'Серебро', 'Күміс', 'Silver',
    'Повышенный кэшбэк для постоянных гостей',
    'Тұрақты қонақтарға арналған жоғары кэшбэк',
    'Increased cashback for returning guests',
    least(999999999999.99, greatest(0, coalesce((select case when value ~ '^[0-9]+([.][0-9]+)?$' then value::numeric end from public.settings where key = 'tier_silver_th'), 50000))),
    least(100, greatest(0, coalesce((select case when value ~ '^[0-9]+([.][0-9]+)?$' then value::numeric end from public.settings where key = 'tier_silver_cb'), 5))),
    1, true
  ),
  (
    'gold', 'Золото', 'Алтын', 'Gold',
    'Высокий кэшбэк для лояльных гостей',
    'Адал қонақтарға арналған жоғары кэшбэк',
    'High cashback for loyal guests',
    least(999999999999.99, greatest(0, coalesce((select case when value ~ '^[0-9]+([.][0-9]+)?$' then value::numeric end from public.settings where key = 'tier_gold_th'), 150000))),
    least(100, greatest(0, coalesce((select case when value ~ '^[0-9]+([.][0-9]+)?$' then value::numeric end from public.settings where key = 'tier_gold_cb'), 7))),
    2, true
  ),
  (
    'platinum', 'Платина', 'Платина', 'Platinum',
    'Максимальный кэшбэк для самых преданных гостей',
    'Ең адал қонақтарға арналған ең жоғары кэшбэк',
    'Maximum cashback for the most loyal guests',
    least(999999999999.99, greatest(0, coalesce((select case when value ~ '^[0-9]+([.][0-9]+)?$' then value::numeric end from public.settings where key = 'tier_platinum_th'), 300000))),
    least(100, greatest(0, coalesce((select case when value ~ '^[0-9]+([.][0-9]+)?$' then value::numeric end from public.settings where key = 'tier_platinum_cb'), 10))),
    3, true
  )
on conflict do nothing;

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
alter table public.stories add column if not exists group_id text;
alter table public.stories add column if not exists group_title text;
alter table public.stories add column if not exists group_coverurl text;
alter table public.stories add column if not exists sort_order integer default 0;
alter table public.stories add column if not exists created_at timestamptz default now();

-- Stories are managed only from the admin panel. Do not seed default rows here,
-- otherwise deleted admin stories come back when this schema is rerun.

-- --------------------------------------------------------------------
-- Instagram-style news feed in mobile app
-- --------------------------------------------------------------------
create table if not exists public.news (
  id bigserial primary key,
  title varchar(255) not null,
  imageurl text,
  description text,
  created_at timestamptz default now() not null
);

alter table public.news add column if not exists title varchar(255);
alter table public.news add column if not exists imageurl text;
alter table public.news add column if not exists description text;
alter table public.news add column if not exists created_at timestamptz default now();
alter table public.news alter column imageurl drop not null;

create index if not exists news_created_at_idx on public.news (created_at desc);

-- --------------------------------------------------------------------
-- Cities and service points
-- --------------------------------------------------------------------
create table if not exists public.cities (
  id bigserial primary key,
  name varchar(160) not null,
  i18n jsonb default '{}'::jsonb not null,
  created_at timestamptz default now() not null
);

create table if not exists public.points (
  id bigserial primary key,
  city_id bigint not null references public.cities(id) on delete cascade,
  name varchar(200) not null,
  address text not null,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  i18n jsonb default '{}'::jsonb not null,
  created_at timestamptz default now() not null
);

create index if not exists points_city_id_idx on public.points(city_id);

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
drop index if exists public.wallet_registrations_device_serial_unique;
delete from public.wallet_registrations newer
using public.wallet_registrations older
where newer.id > older.id
  and newer.device_id is not distinct from older.device_id
  and newer.serial_number = older.serial_number;
create unique index wallet_registrations_device_serial_unique
  on public.wallet_registrations (device_id, serial_number);

-- --------------------------------------------------------------------
-- Atomic balance and idempotent order application
-- --------------------------------------------------------------------
create or replace function public.increment_customer_balance(
  p_customer_id uuid,
  p_amount_change numeric
)
returns table(new_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_customer_id is null or p_amount_change is null then
    raise exception 'customer_id and amount_change are required';
  end if;
  update public.customers
  set
    balance = customers.balance + p_amount_change,
    updated_at = now()
  where id = p_customer_id
    and customers.balance + p_amount_change >= 0
  returning customers.balance into new_balance;

  if not found then
    raise exception 'customer not found or insufficient balance';
  end if;

  return next;
end;
$$;

drop function if exists public.apply_loyalty_transaction(uuid, text, numeric, numeric, numeric, numeric);
drop function if exists public.apply_loyalty_transaction(uuid, text, numeric, numeric, numeric, numeric, integer);
drop function if exists public.apply_loyalty_transaction(uuid, text, numeric, numeric, numeric, numeric, integer, jsonb);

create or replace function public.apply_loyalty_transaction(
  p_customer_id uuid,
  p_order_id text,
  p_discount_amount numeric,
  p_earned_bonus numeric,
  p_order_total numeric default 0,
  p_real_money_paid numeric default 0,
  p_activation_delay_days integer default 0,
  p_items jsonb default null
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
  v_existing_customer_id uuid;
begin
  if p_order_id is null or btrim(p_order_id) = '' then
    raise exception 'order_id is required';
  end if;

  if p_customer_id is null
    or coalesce(p_discount_amount, 0) < 0
    or coalesce(p_earned_bonus, 0) < 0
    or coalesce(p_order_total, 0) < 0
    or coalesce(p_real_money_paid, 0) < 0
    or coalesce(p_activation_delay_days, 0) < 0
    or coalesce(p_discount_amount, 0) > coalesce(p_order_total, 0)
    or abs((coalesce(p_order_total, 0) - coalesce(p_discount_amount, 0)) - coalesce(p_real_money_paid, 0)) > 0.01 then
    raise exception 'invalid loyalty transaction values';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_order_id));

  select customer_id
    into v_existing_customer_id
    from public.transactions
    where order_id = p_order_id
      and type in ('withdrawal', 'deposit', 'pending_deposit', 'order')
    limit 1;

  if v_existing_customer_id is not null then
    if v_existing_customer_id <> p_customer_id then
      raise exception 'order_id already belongs to another customer';
    end if;
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
    insert into public.transactions (customer_id, order_id, type, amount, order_total, description, items)
    values (p_customer_id, p_order_id, 'withdrawal', p_discount_amount, p_order_total, 'Оплата бонусами', p_items);
  end if;

  if coalesce(p_earned_bonus, 0) > 0 then
    if v_pending_bonus > 0 then
      insert into public.transactions (customer_id, order_id, type, amount, order_total, description, available_at, items)
      values (p_customer_id, p_order_id, 'pending_deposit', v_pending_bonus, p_real_money_paid, 'Кэшбэк ожидает активации', v_available_at, p_items);
    else
      insert into public.transactions (customer_id, order_id, type, amount, order_total, description, items)
      values (p_customer_id, p_order_id, 'deposit', v_active_bonus, p_real_money_paid, 'Кэшбэк за покупку', p_items);
    end if;
  end if;

  if coalesce(p_discount_amount, 0) = 0 and coalesce(p_earned_bonus, 0) = 0 then
    insert into public.transactions (customer_id, order_id, type, amount, order_total, description, items)
    values (p_customer_id, p_order_id, 'order', 0, p_real_money_paid, 'Покупка без движения бонусов', p_items);
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

create or replace function public.expire_customer_bonus(
  p_customer_id uuid,
  p_expected_balance numeric,
  p_order_id text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired numeric;
begin
  if p_customer_id is null or coalesce(p_expected_balance, 0) <= 0 or p_order_id is null then
    raise exception 'invalid expiration arguments';
  end if;

  update public.customers
  set balance = 0, updated_at = now()
  where id = p_customer_id and balance = p_expected_balance and balance > 0
  returning p_expected_balance into v_expired;

  if v_expired is null then return 0; end if;

  insert into public.transactions(customer_id, order_id, type, amount, description)
  values (p_customer_id, p_order_id, 'expiration', v_expired, 'Автоматическое сгорание бонусов');
  return v_expired;
end;
$$;

create or replace function public.apply_manual_bonus(
  p_customer_id uuid,
  p_amount_change numeric,
  p_reason text default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
begin
  if p_customer_id is null or p_amount_change is null or abs(p_amount_change) > 100000000 then
    raise exception 'invalid manual bonus arguments';
  end if;
  update public.customers
  set balance = balance + p_amount_change, updated_at = now()
  where id = p_customer_id and balance + p_amount_change >= 0
  returning balance into v_balance;
  if v_balance is null then raise exception 'customer not found or insufficient balance'; end if;

  insert into public.transactions(customer_id, order_id, type, amount, description)
  values (
    p_customer_id,
    'MANUAL-' || gen_random_uuid()::text,
    case when p_amount_change >= 0 then 'manual_deposit' else 'manual_withdrawal' end,
    abs(p_amount_change),
    nullif(btrim(coalesce(p_reason, '')), '')
  );
  return v_balance;
end;
$$;

create or replace function public.reorder_loyalty_tiers(p_ids uuid[])
returns setof public.loyalty_tiers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected_count integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'tier ids are required';
  end if;

  select count(*) into v_expected_count from public.loyalty_tiers;
  if cardinality(p_ids) <> v_expected_count
    or (select count(distinct value) from unnest(p_ids) as supplied(value)) <> v_expected_count
    or exists (
      select 1
      from unnest(p_ids) as supplied(value)
      left join public.loyalty_tiers tiers on tiers.id = supplied.value
      where tiers.id is null
    ) then
    raise exception 'ids must contain every loyalty tier exactly once';
  end if;

  with requested_order as (
    select value as id, (ordinality - 1)::integer as sort_order
    from unnest(p_ids) with ordinality as supplied(value, ordinality)
  )
  update public.loyalty_tiers tiers
  set sort_order = requested_order.sort_order,
      updated_at = now()
  from requested_order
  where tiers.id = requested_order.id;

  return query
    select *
    from public.loyalty_tiers
    order by sort_order asc, min_spend asc;
end;
$$;

revoke all on function public.increment_customer_balance(uuid, numeric) from public, anon, authenticated;
revoke all on function public.apply_loyalty_transaction(uuid, text, numeric, numeric, numeric, numeric, integer, jsonb) from public, anon, authenticated;
revoke all on function public.activate_pending_bonus_transactions() from public, anon, authenticated;
revoke all on function public.expire_customer_bonus(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.apply_manual_bonus(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.reorder_loyalty_tiers(uuid[]) from public, anon, authenticated;
grant execute on function public.increment_customer_balance(uuid, numeric) to service_role;
grant execute on function public.apply_loyalty_transaction(uuid, text, numeric, numeric, numeric, numeric, integer, jsonb) to service_role;
grant execute on function public.activate_pending_bonus_transactions() to service_role;
grant execute on function public.expire_customer_bonus(uuid, numeric, text) to service_role;
grant execute on function public.apply_manual_bonus(uuid, numeric, text) to service_role;
grant execute on function public.reorder_loyalty_tiers(uuid[]) to service_role;

-- --------------------------------------------------------------------
-- WhatsApp / OTP session storage
-- --------------------------------------------------------------------
create table if not exists public.whatsapp_sessions (
  id text primary key,
  data jsonb not null,
  expires_at timestamptz,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);
alter table public.whatsapp_sessions add column if not exists expires_at timestamptz;
create index if not exists whatsapp_sessions_expires_at_idx on public.whatsapp_sessions(expires_at) where expires_at is not null;

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
-- Public database access is limited to active loyalty tiers; all sensitive
-- customer, transaction and configuration tables stay service-role only.
-- The stories storage bucket remains publicly readable for app media.
-- --------------------------------------------------------------------
alter table public.customers enable row level security;
alter table public.transactions enable row level security;
alter table public.settings enable row level security;
alter table public.loyalty_tiers enable row level security;
alter table public.stories enable row level security;
alter table public.news enable row level security;
alter table public.wallet_registrations enable row level security;
alter table public.whatsapp_sessions enable row level security;
alter table public.iiko_operation_logs enable row level security;
alter table public.cities enable row level security;
alter table public.points enable row level security;

drop policy if exists "Allow all access for Service Role" on public.customers;
drop policy if exists "Allow all access for Service Role" on public.transactions;
drop policy if exists "Allow all access for Service Role" on public.settings;
drop policy if exists "Allow all access for Service Role" on public.loyalty_tiers;
drop policy if exists "Allow all access for Service Role" on public.stories;
drop policy if exists "Allow all access for Service Role" on public.news;
drop policy if exists "Allow all access for Service Role" on public.wallet_registrations;
drop policy if exists "service_role_all_customers" on public.customers;
drop policy if exists "service_role_all_transactions" on public.transactions;
drop policy if exists "service_role_all_settings" on public.settings;
drop policy if exists "service_role_all_loyalty_tiers" on public.loyalty_tiers;
drop policy if exists "public_read_active_loyalty_tiers" on public.loyalty_tiers;
drop policy if exists "service_role_all_stories" on public.stories;
drop policy if exists "service_role_all_news" on public.news;
drop policy if exists "service_role_all_wallet" on public.wallet_registrations;
drop policy if exists "service_role_all_whatsapp" on public.whatsapp_sessions;
drop policy if exists "service_role_all_iiko_logs" on public.iiko_operation_logs;
drop policy if exists "service_role_all_cities" on public.cities;
drop policy if exists "service_role_all_points" on public.points;

create policy "service_role_all_customers" on public.customers for all to service_role using (true) with check (true);
create policy "service_role_all_transactions" on public.transactions for all to service_role using (true) with check (true);
create policy "service_role_all_settings" on public.settings for all to service_role using (true) with check (true);
create policy "service_role_all_loyalty_tiers" on public.loyalty_tiers for all to service_role using (true) with check (true);
create policy "public_read_active_loyalty_tiers" on public.loyalty_tiers for select to anon, authenticated using (is_active = true);
create policy "service_role_all_stories" on public.stories for all to service_role using (true) with check (true);
create policy "service_role_all_news" on public.news for all to service_role using (true) with check (true);
create policy "service_role_all_wallet" on public.wallet_registrations for all to service_role using (true) with check (true);
create policy "service_role_all_whatsapp" on public.whatsapp_sessions for all to service_role using (true) with check (true);
create policy "service_role_all_iiko_logs" on public.iiko_operation_logs for all to service_role using (true) with check (true);
create policy "service_role_all_cities" on public.cities for all to service_role using (true) with check (true);
create policy "service_role_all_points" on public.points for all to service_role using (true) with check (true);

revoke all on table public.loyalty_tiers from public, anon, authenticated;
grant select on table public.loyalty_tiers to anon, authenticated;
grant all on table public.loyalty_tiers to service_role;

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

drop trigger if exists loyalty_tiers_set_updated_at on public.loyalty_tiers;
create trigger loyalty_tiers_set_updated_at
before update on public.loyalty_tiers
for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------
-- Customer notification centre
-- --------------------------------------------------------------------
create table if not exists public.customer_notifications (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  title varchar(160) not null,
  body text not null,
  type varchar(40) not null default 'broadcast',
  payload jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists customer_notifications_customer_created_idx
  on public.customer_notifications (customer_id, created_at desc);

alter table public.customer_notifications enable row level security;
drop policy if exists "service role manages customer notifications" on public.customer_notifications;
create policy "service role manages customer notifications"
  on public.customer_notifications for all to service_role using (true) with check (true);

-- --------------------------------------------------------------------
-- Kaspi Orders
-- --------------------------------------------------------------------
create table if not exists public.kaspi_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  operation_id varchar(100) not null,
  amount numeric(12, 2) not null,
  phone varchar(32) not null,
  status varchar(50) default 'pending' not null,
  cart_items jsonb default '[]'::jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists kaspi_orders_customer_id_idx on public.kaspi_orders(customer_id);
create index if not exists kaspi_orders_operation_id_idx on public.kaspi_orders(operation_id);

alter table public.kaspi_orders enable row level security;
drop policy if exists "service role manages kaspi orders" on public.kaspi_orders;
create policy "service role manages kaspi orders"
  on public.kaspi_orders for all to service_role using (true) with check (true);

drop trigger if exists kaspi_orders_set_updated_at on public.kaspi_orders;
create trigger kaspi_orders_set_updated_at
before update on public.kaspi_orders
for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------
-- Smoke-check
-- --------------------------------------------------------------------
select
  'Bulka Supabase setup complete' as status,
  (select count(*) from public.settings) as settings_count,
  (select count(*) from public.loyalty_tiers) as loyalty_tiers_count,
  (select count(*) from public.customer_notifications) as notifications_count,
  (select count(*) from public.stories) as stories_count,
  (select count(*) from public.news) as news_count;
