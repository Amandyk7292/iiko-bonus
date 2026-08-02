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
  preferred_language varchar(2) not null default 'ru'
    check (preferred_language in ('ru', 'kk', 'en')),
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
alter table public.customers add column if not exists preferred_language varchar(2) not null default 'ru';
alter table public.customers drop constraint if exists customers_preferred_language_check;
alter table public.customers add constraint customers_preferred_language_check
  check (preferred_language in ('ru', 'kk', 'en'));
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

-- Passwords are kept outside the customer profile row so wildcard profile
-- queries cannot expose password hashes.
create table if not exists public.customer_credentials (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  password_hash text not null,
  auth_version integer not null default 1,
  password_set_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_credentials_password_hash_check check (
    password_hash ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'
  ),
  constraint customer_credentials_auth_version_check check (auth_version between 1 and 2147483647)
);

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
create unique index if not exists transactions_refund_reversal_unique_idx
  on public.transactions(order_id)
  where type = 'refund_reversal';

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
  ('bonus_corporate', '{"enabled":false,"company_name":"","monthly_limit":0,"employee_cashback_percent":5}'),
  ('site_access', '{"enabled":false,"allowed_ips":[]}')
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

create table if not exists public.bulka_locations (
  id uuid primary key default gen_random_uuid(),
  two_gis_id varchar(32) unique,
  name varchar(160) not null,
  city varchar(100) not null default 'Актау',
  address varchar(300) not null,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  hours jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  pickup_enabled boolean not null default true,
  preorder_enabled boolean not null default true,
  delivery_enabled boolean not null default false,
  delivery_radius_km numeric(8, 2),
  delivery_fee numeric(12, 2),
  delivery_min_order numeric(12, 2),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bulka_locations_coordinates_check check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  ),
  constraint bulka_locations_delivery_rules_check check (
    delivery_enabled = false
    or (
      latitude is not null
      and longitude is not null
      and delivery_radius_km > 0
      and delivery_fee >= 0
      and delivery_min_order >= 0
    )
  )
);

alter table public.bulka_locations add column if not exists two_gis_id varchar(32);
alter table public.bulka_locations add column if not exists latitude numeric(10, 7);
alter table public.bulka_locations add column if not exists longitude numeric(10, 7);
alter table public.bulka_locations add column if not exists hours jsonb not null default '{}'::jsonb;
alter table public.bulka_locations add column if not exists active boolean not null default true;
alter table public.bulka_locations add column if not exists pickup_enabled boolean not null default true;
alter table public.bulka_locations add column if not exists preorder_enabled boolean not null default true;
alter table public.bulka_locations add column if not exists delivery_enabled boolean not null default false;
alter table public.bulka_locations add column if not exists delivery_radius_km numeric(8, 2);
alter table public.bulka_locations add column if not exists delivery_fee numeric(12, 2);
alter table public.bulka_locations add column if not exists delivery_min_order numeric(12, 2);
alter table public.bulka_locations
  add column if not exists delivery_zones jsonb not null default '[]'::jsonb;
alter table public.bulka_locations add column if not exists sort_order integer not null default 0;
alter table public.bulka_locations add column if not exists updated_at timestamptz not null default now();
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bulka_locations_coordinates_check'
      and conrelid = 'public.bulka_locations'::regclass
  ) then
    alter table public.bulka_locations
      add constraint bulka_locations_coordinates_check check (
        (latitude is null and longitude is null)
        or (latitude between -90 and 90 and longitude between -180 and 180)
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'bulka_locations_delivery_rules_check'
      and conrelid = 'public.bulka_locations'::regclass
  ) then
    alter table public.bulka_locations
      add constraint bulka_locations_delivery_rules_check check (
        delivery_enabled = false
        or (
          latitude is not null and longitude is not null
          and delivery_radius_km > 0
          and delivery_fee >= 0
          and delivery_min_order >= 0
        )
      );
  end if;
end
$$;
delete from public.bulka_locations
where id = 'ca99b62c-50ce-4c60-b36c-649bba035441'::uuid
  and city = 'Актау' and name = 'тест' and address = 'Актау';
create unique index if not exists bulka_locations_two_gis_id_unique_idx
  on public.bulka_locations(two_gis_id);

insert into public.bulka_locations (
  id,
  two_gis_id,
  city,
  name,
  address,
  latitude,
  longitude,
  hours,
  sort_order
)
values
  ('48f71218-aa08-51bf-a6d9-2497c4a1e55b', '70000001037780404', 'Актау', 'ЖК Дукат', '17-й микрорайон, 1', 43.669440, 51.136929, '{"daily":{"open":"08:00","close":"24:00"}}', 10),
  ('a18ea0f1-ac22-5530-a56a-65d810181a12', '70000001059727546', 'Актау', 'ЖК Ақеспе', '17-й микрорайон, 95', 43.671533, 51.147920, '{"daily":{"open":"08:00","close":"21:00"}}', 20),
  ('dc180678-d414-54bd-a077-959e72b7afe5', '70000001094869111', 'Актау', 'ТД Promenade', '28-й микрорайон, 59/3', 43.673225, 51.164858, '{"daily":{"open":"08:00","close":"21:00"}}', 30),
  ('48a835eb-b78d-548e-a450-7789189d5785', '70000001095138965', 'Актау', '19-й микрорайон', '19-й микрорайон, 33/1', 43.679557, 51.153351, '{"daily":{"open":"08:00","close":"21:00"}}', 40),
  ('cb2b13f5-6c4e-5592-adc7-8908bacddabd', '70000001084017190', 'Актау', 'ЖК B-Group Plaza', '16-й микрорайон, 85', 43.674274, 51.153663, '{"daily":{"open":"08:00","close":"21:00"}}', 50),
  ('18ab2d90-7187-5b0b-a245-9c819a67a605', '70000001035248862', 'Актау', '5-й микрорайон', '5-й микрорайон, 20/20', 43.640354, 51.155575, '{"daily":{"open":"08:00","close":"21:00"}}', 60),
  ('7f073eb5-d112-5121-a132-68d8519b1188', '70000001105107971', 'Актау', 'ЖК Premium Plaza', '18A микрорайон, 1', 43.677412, 51.137680, '{"daily":{"open":"08:00","close":"21:00"}}', 70),
  ('b49c5f6f-e051-553f-aa7a-968fef73e62a', '70000001110611288', 'Актау', '26-й микрорайон', '26-й микрорайон, 19/3', 43.662499, 51.164725, '{"daily":{"open":"08:00","close":"21:00"}}', 80),
  ('dcd47584-8559-574d-a223-467ce30069e6', '70000001047301817', 'Актау', 'ТЦ Ardager', '9-й микрорайон, 30/3', 43.647952, 51.155753, '{"daily":{"open":"09:00","close":"21:00"}}', 90),
  ('ea829279-4b48-5e9f-a763-e8ef06a53e57', '70000001110611275', 'Актау', 'ЖК Central Park', '40-й микрорайон, 2', 43.687678, 51.148924, '{"daily":{"open":"08:00","close":"21:00"}}', 100),
  ('07788c1e-8ef0-5f24-ae46-0cbb9109e3eb', '70000001084017199', 'Актау', 'ЖК Green Plaza', '17-й микрорайон, 6', 43.674585, 51.136410, '{"daily":{"open":"08:00","close":"21:00"}}', 110),
  ('92a71bf8-74b2-56a6-ae83-6d08f030ae6d', '70000001115593449', 'Актау', 'ЖК Комфорт', '17-й микрорайон, 55', 43.669455, 51.146964, '{"daily":{"open":"08:00","close":"21:00"}}', 120)
on conflict (two_gis_id) do update set
  city = excluded.city,
  name = excluded.name,
  address = excluded.address,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  hours = excluded.hours,
  sort_order = excluded.sort_order,
  updated_at = now();

create table if not exists public.bulka_cities (
  id uuid primary key default gen_random_uuid(),
  name varchar(100) not null,
  center_latitude numeric(10, 7),
  center_longitude numeric(10, 7),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bulka_cities_center_check check (
    (center_latitude is null and center_longitude is null)
    or (
      center_latitude between -90 and 90
      and center_longitude between -180 and 180
    )
  )
);
create unique index if not exists bulka_cities_name_unique_idx
  on public.bulka_cities ((lower(btrim(name))));
alter table public.bulka_locations add column if not exists city_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bulka_locations_city_id_fkey'
      and conrelid = 'public.bulka_locations'::regclass
  ) then
    alter table public.bulka_locations
      add constraint bulka_locations_city_id_fkey
      foreign key (city_id) references public.bulka_cities(id) on delete restrict;
  end if;
end
$$;
insert into public.bulka_cities (name, center_latitude, center_longitude)
select
  min(btrim(location.city)),
  case when count(location.latitude) > 0 then round(avg(location.latitude), 7) end,
  case when count(location.longitude) > 0 then round(avg(location.longitude), 7) end
from public.bulka_locations location
where btrim(location.city) <> ''
group by lower(btrim(location.city))
on conflict ((lower(btrim(name)))) do update set
  center_latitude = coalesce(public.bulka_cities.center_latitude, excluded.center_latitude),
  center_longitude = coalesce(public.bulka_cities.center_longitude, excluded.center_longitude),
  updated_at = now();
update public.bulka_locations location
set city_id = city.id
from public.bulka_cities city
where location.city_id is null
  and lower(btrim(location.city)) = lower(btrim(city.name));
create index if not exists bulka_locations_city_id_sort_idx
  on public.bulka_locations(city_id, sort_order, name);
alter table public.bulka_cities enable row level security;
drop policy if exists "service role manages bulka cities" on public.bulka_cities;
create policy "service role manages bulka cities"
  on public.bulka_cities for all to service_role using (true) with check (true);
revoke all on public.bulka_cities from public, anon, authenticated;
grant all on public.bulka_cities to service_role;

delete from public.points point
using public.cities city
where point.city_id = city.id
  and city.name = 'Актау'
  and point.name = 'Ардагер'
  and point.address = '11 мкр'
  and point.latitude is null
  and point.longitude is null;
delete from public.cities city
where city.name = 'Астана'
  and not exists (select 1 from public.points point where point.city_id = city.id);

create index if not exists bulka_locations_active_sort_idx
  on public.bulka_locations(active, sort_order, name);
alter table public.bulka_locations enable row level security;
drop policy if exists "service role manages bulka locations" on public.bulka_locations;
create policy "service role manages bulka locations"
  on public.bulka_locations for all to service_role using (true) with check (true);
revoke all on public.bulka_locations from public, anon, authenticated;
grant all on public.bulka_locations to service_role;

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
  v_customer_ids uuid[] := '{}'::uuid[];
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
    returning c.id, t.amount
  )
  select
    count(*),
    coalesce(sum(amount), 0),
    coalesce((select array_agg(id) from updated_customers), '{}'::uuid[])
    into v_count, v_amount, v_customer_ids
    from due;

  return jsonb_build_object(
    'activated_count', v_count,
    'activated_amount', v_amount,
    'customer_ids', to_jsonb(v_customer_ids)
  );
end;
$$;

create or replace function public.reverse_loyalty_order(
  p_customer_id uuid,
  p_order_id text,
  p_real_money_paid numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund_order_id text := p_order_id || ':refund';
  v_balance numeric;
  v_total_spent numeric;
  v_active_bonus numeric := 0;
  v_pending_bonus numeric := 0;
  v_removed_bonus numeric := 0;
  v_items jsonb;
  v_original_found boolean := false;
begin
  if p_customer_id is null
    or p_order_id is null
    or btrim(p_order_id) = ''
    or coalesce(p_real_money_paid, 0) < 0 then
    raise exception 'invalid loyalty refund values';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_order_id));

  select balance, total_spent
    into v_balance, v_total_spent
    from public.customers
    where id = p_customer_id
    for update;

  if not found then
    raise exception 'customer not found';
  end if;

  if exists (
    select 1
    from public.transactions
    where customer_id = p_customer_id
      and order_id = v_refund_order_id
      and type = 'refund_reversal'
  ) then
    return jsonb_build_object(
      'duplicate', true,
      'balance', v_balance,
      'total_spent', v_total_spent,
      'removed_bonus', 0
    );
  end if;

  select exists (
    select 1
    from public.transactions
    where customer_id = p_customer_id
      and order_id = p_order_id
      and type in ('deposit', 'pending_deposit', 'withdrawal', 'order')
  ) into v_original_found;

  if not v_original_found then
    return jsonb_build_object(
      'duplicate', false,
      'applied', false,
      'balance', v_balance,
      'total_spent', v_total_spent,
      'removed_bonus', 0
    );
  end if;

  select
    coalesce(sum(amount) filter (where type = 'deposit'), 0),
    coalesce(sum(amount) filter (where type = 'pending_deposit'), 0),
    (array_agg(items) filter (where items is not null))[1]
  into v_active_bonus, v_pending_bonus, v_items
  from public.transactions
  where customer_id = p_customer_id
    and order_id = p_order_id;

  v_removed_bonus := least(v_balance, v_active_bonus);

  update public.customers
  set
    balance = greatest(0, balance - v_removed_bonus),
    total_spent = greatest(0, total_spent - coalesce(p_real_money_paid, 0)),
    updated_at = now()
  where id = p_customer_id
  returning balance, total_spent into v_balance, v_total_spent;

  update public.transactions
  set
    type = 'cancelled_deposit',
    activated_at = coalesce(activated_at, now()),
    description = coalesce(description, '') || ' / отменён возвратом'
  where customer_id = p_customer_id
    and order_id = p_order_id
    and type = 'pending_deposit';

  insert into public.transactions (
    customer_id,
    order_id,
    type,
    amount,
    order_total,
    description,
    items
  )
  values (
    p_customer_id,
    v_refund_order_id,
    'refund_reversal',
    v_removed_bonus,
    coalesce(p_real_money_paid, 0),
    case
      when v_removed_bonus < v_active_bonus
        then 'Сторнирование кэшбэка после возврата / часть бонусов уже использована'
      else 'Сторнирование кэшбэка после возврата'
    end,
    v_items
  );

  return jsonb_build_object(
    'duplicate', false,
    'applied', true,
    'balance', v_balance,
    'total_spent', v_total_spent,
    'removed_bonus', v_removed_bonus,
    'cancelled_pending_bonus', v_pending_bonus
  );
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
revoke all on function public.reverse_loyalty_order(uuid, text, numeric) from public, anon, authenticated;
revoke all on function public.expire_customer_bonus(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.apply_manual_bonus(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.reorder_loyalty_tiers(uuid[]) from public, anon, authenticated;
grant execute on function public.increment_customer_balance(uuid, numeric) to service_role;
grant execute on function public.apply_loyalty_transaction(uuid, text, numeric, numeric, numeric, numeric, integer, jsonb) to service_role;
grant execute on function public.activate_pending_bonus_transactions() to service_role;
grant execute on function public.reverse_loyalty_order(uuid, text, numeric) to service_role;
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

create or replace function public.consume_whatsapp_otp(
  p_phone text,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.whatsapp_sessions%rowtype;
  v_payload jsonb;
  v_attempts integer;
begin
  if length(btrim(coalesce(p_phone, ''))) < 10
    or length(btrim(coalesce(p_code, ''))) < 1 then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into v_session
  from public.whatsapp_sessions
  where id = 'otp_' || p_phone
  for update;
  if not found then return jsonb_build_object('status', 'expired'); end if;
  begin
    v_payload := case
      when jsonb_typeof(v_session.data) = 'string' then (v_session.data #>> '{}')::jsonb
      else v_session.data
    end;
  exception when others then
    delete from public.whatsapp_sessions where id = v_session.id;
    return jsonb_build_object('status', 'expired');
  end;
  if coalesce(v_session.expires_at, to_timestamp((v_payload->>'expires')::numeric / 1000)) <= now() then
    delete from public.whatsapp_sessions where id = v_session.id;
    return jsonb_build_object('status', 'expired');
  end if;
  if coalesce(v_payload->>'code', '') <> p_code then
    v_attempts := coalesce((v_payload->>'attempts')::integer, 0) + 1;
    if v_attempts >= 5 then
      delete from public.whatsapp_sessions where id = v_session.id;
      return jsonb_build_object('status', 'attempts_exceeded');
    end if;
    update public.whatsapp_sessions
    set data = v_payload || jsonb_build_object('attempts', v_attempts), updated_at = now()
    where id = v_session.id;
    return jsonb_build_object('status', 'invalid', 'attempts', v_attempts);
  end if;
  delete from public.whatsapp_sessions where id = v_session.id;
  return jsonb_build_object(
    'status',
    'success',
    'payload',
    v_payload - 'code' - 'attempts'
  );
end;
$$;

revoke all on function public.consume_whatsapp_otp(text, text) from public, anon, authenticated;
grant execute on function public.consume_whatsapp_otp(text, text) to service_role;

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
alter table public.customer_credentials enable row level security;
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
drop policy if exists "service_role_all_customer_credentials" on public.customer_credentials;
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
create policy "service_role_all_customer_credentials" on public.customer_credentials for all to service_role using (true) with check (true);
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

revoke all on table public.customer_credentials from public, anon, authenticated;
grant all on table public.customer_credentials to service_role;

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
-- Customer push tokens (one row per app/browser installation)
-- --------------------------------------------------------------------
-- Push tokens are stored per app/browser installation so signing in on a
-- second device does not disable notifications on the first one.
create table if not exists public.customer_push_tokens (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  token text not null unique,
  installation_id varchar(160) not null unique,
  platform varchar(16) not null default 'unknown'
    check (platform in ('android', 'ios', 'web', 'unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint customer_push_tokens_token_length
    check (char_length(token) between 20 and 4096),
  constraint customer_push_tokens_installation_length
    check (char_length(installation_id) between 8 and 160)
);

create index if not exists customer_push_tokens_customer_seen_idx
  on public.customer_push_tokens (customer_id, last_seen_at desc);

alter table public.customer_push_tokens enable row level security;
drop policy if exists "service role manages customer push tokens"
  on public.customer_push_tokens;
create policy "service role manages customer push tokens"
  on public.customer_push_tokens
  for all to service_role
  using (true)
  with check (true);

revoke all on table public.customer_push_tokens from public, anon, authenticated;
grant all on table public.customer_push_tokens to service_role;

insert into public.customer_push_tokens (
  customer_id,
  token,
  installation_id,
  platform,
  created_at,
  updated_at,
  last_seen_at
)
select
  id,
  fcm_token,
  'legacy:' || id::text,
  'unknown',
  coalesce(created_at, now()),
  now(),
  now()
from public.customers
where nullif(trim(fcm_token), '') is not null
on conflict (token) do nothing;

create or replace function public.register_customer_push_token(
  p_customer_id uuid,
  p_token text,
  p_platform text,
  p_installation_id text,
  p_language text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_token text := trim(coalesce(p_token, ''));
  v_installation_id text := trim(coalesce(p_installation_id, ''));
  v_platform text := lower(trim(coalesce(p_platform, 'unknown')));
  v_language text := lower(trim(coalesce(p_language, '')));
begin
  if p_customer_id is null then
    raise exception 'customer id is required';
  end if;
  if char_length(v_token) not between 20 and 4096 then
    raise exception 'invalid push token';
  end if;
  if v_installation_id !~ '^[A-Za-z0-9._:-]{8,160}$' then
    raise exception 'invalid installation id';
  end if;
  if v_platform not in ('android', 'ios', 'web', 'unknown') then
    v_platform := 'unknown';
  end if;
  if v_language = 'kz' then
    v_language := 'kk';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_installation_id, 0));

  delete from public.customer_push_tokens
  where token = v_token or installation_id = v_installation_id;

  insert into public.customer_push_tokens (
    customer_id,
    token,
    installation_id,
    platform,
    created_at,
    updated_at,
    last_seen_at
  )
  values (
    p_customer_id,
    v_token,
    v_installation_id,
    v_platform,
    now(),
    now(),
    now()
  )
  returning id into v_id;

  update public.customers
  set
    fcm_token = v_token,
    preferred_language = case
      when v_language in ('ru', 'kk', 'en') then v_language
      else preferred_language
    end,
    updated_at = now()
  where id = p_customer_id;

  if not found then
    raise exception 'customer not found';
  end if;

  return v_id;
end;
$$;

create or replace function public.unregister_customer_push_token(
  p_customer_id uuid,
  p_installation_id text default null,
  p_token text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed integer := 0;
  v_installation_id text := nullif(trim(coalesce(p_installation_id, '')), '');
  v_token text := nullif(trim(coalesce(p_token, '')), '');
begin
  if p_customer_id is null or (v_installation_id is null and v_token is null) then
    return 0;
  end if;

  delete from public.customer_push_tokens
  where customer_id = p_customer_id
    and (
      (v_installation_id is not null and installation_id = v_installation_id)
      or (v_token is not null and token = v_token)
    );
  get diagnostics v_removed = row_count;

  update public.customers
  set
    fcm_token = (
      select token
      from public.customer_push_tokens
      where customer_id = p_customer_id
      order by last_seen_at desc
      limit 1
    ),
    updated_at = now()
  where id = p_customer_id
    and (v_removed > 0 or (v_token is not null and fcm_token = v_token));

  return v_removed;
end;
$$;

create or replace function public.remove_invalid_customer_push_token(p_token text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_removed integer := 0;
  v_token text := nullif(trim(coalesce(p_token, '')), '');
begin
  if v_token is null then
    return 0;
  end if;

  delete from public.customer_push_tokens
  where token = v_token
  returning customer_id into v_customer_id;

  if found then
    update public.customers
    set
      fcm_token = (
        select token
        from public.customer_push_tokens
        where customer_id = v_customer_id
        order by last_seen_at desc
        limit 1
      ),
      updated_at = now()
    where id = v_customer_id;
    return 1;
  end if;

  update public.customers
  set fcm_token = null, updated_at = now()
  where fcm_token = v_token;
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke all on function public.register_customer_push_token(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.unregister_customer_push_token(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.remove_invalid_customer_push_token(text)
  from public, anon, authenticated;

grant execute on function public.register_customer_push_token(uuid, text, text, text, text)
  to service_role;
grant execute on function public.unregister_customer_push_token(uuid, text, text)
  to service_role;
grant execute on function public.remove_invalid_customer_push_token(text)
  to service_role;


-- --------------------------------------------------------------------
-- Kaspi Orders
-- --------------------------------------------------------------------
create sequence if not exists public.kaspi_order_number_seq start with 100001;

create table if not exists public.kaspi_orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint not null default nextval('public.kaspi_order_number_seq'),
  customer_id uuid references public.customers(id) on delete set null,
  operation_id varchar(100) not null,
  amount numeric(12, 2) not null,
  subtotal numeric(12, 2),
  discount_amount numeric(12, 2) not null default 0,
  promo_code varchar(64),
  phone varchar(32) not null,
  status varchar(50) default 'pending' not null,
  cart_items jsonb default '[]'::jsonb,
  fulfillment_type varchar(20) not null default 'pickup',
  branch_id uuid references public.bulka_locations(id) on delete set null,
  branch_name varchar(160),
  scheduled_at timestamptz,
  pickup_time varchar(40),
  delivery_address jsonb,
  delivery_latitude numeric(10, 7),
  delivery_longitude numeric(10, 7),
  delivery_fee numeric(12, 2) not null default 0,
  additional_phone varchar(32),
  comment varchar(500),
  fulfillment_status varchar(40) not null default 'pending',
  fulfilled_at timestamptz,
  iiko_order_id varchar(100),
  last_error varchar(1000),
  client_request_id uuid,
  payment_method varchar(20),
  qr_token varchar(1000),
  earned_bonus numeric(12, 2),
  bonus_awarded_at timestamptz,
  bonus_reversed_at timestamptz,
  cancellation_reason varchar(500),
  refund_status varchar(24),
  refund_amount numeric(12, 2),
  refund_reference varchar(160),
  refund_requested_at timestamptz,
  refunded_at timestamptz,
  refund_error varchar(1000),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint kaspi_orders_fulfillment_type_check
    check (fulfillment_type in ('pickup', 'delivery', 'preorder')),
  constraint kaspi_orders_delivery_fee_check
    check (delivery_fee >= 0 and delivery_fee <= 100000),
  constraint kaspi_orders_delivery_coordinates_check
    check (
      (delivery_latitude is null and delivery_longitude is null)
      or (
        delivery_latitude between -90 and 90
        and delivery_longitude between -180 and 180
      )
    ),
  constraint kaspi_orders_delivery_metadata_check
    check (
      fulfillment_type <> 'delivery'
      or (
        delivery_address is not null
        and jsonb_typeof(delivery_address) = 'object'
        and delivery_latitude is not null
        and delivery_longitude is not null
      )
    )
);

alter table public.kaspi_orders
  add column if not exists fulfillment_type varchar(20) not null default 'pickup';
alter table public.kaspi_orders add column if not exists branch_id uuid;
alter table public.kaspi_orders add column if not exists scheduled_at timestamptz;
alter table public.kaspi_orders add column if not exists delivery_address jsonb;
alter table public.kaspi_orders add column if not exists delivery_latitude numeric(10, 7);
alter table public.kaspi_orders add column if not exists delivery_longitude numeric(10, 7);
alter table public.kaspi_orders
  add column if not exists delivery_fee numeric(12, 2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'kaspi_orders_branch_id_fkey'
      and conrelid = 'public.kaspi_orders'::regclass
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_branch_id_fkey
      foreign key (branch_id) references public.bulka_locations(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'kaspi_orders_fulfillment_type_check'
      and conrelid = 'public.kaspi_orders'::regclass
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_fulfillment_type_check
      check (fulfillment_type in ('pickup', 'delivery', 'preorder'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'kaspi_orders_delivery_fee_check'
      and conrelid = 'public.kaspi_orders'::regclass
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_delivery_fee_check
      check (delivery_fee >= 0 and delivery_fee <= 100000);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'kaspi_orders_delivery_coordinates_check'
      and conrelid = 'public.kaspi_orders'::regclass
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_delivery_coordinates_check
      check (
        (delivery_latitude is null and delivery_longitude is null)
        or (
          delivery_latitude between -90 and 90
          and delivery_longitude between -180 and 180
        )
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'kaspi_orders_delivery_metadata_check'
      and conrelid = 'public.kaspi_orders'::regclass
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_delivery_metadata_check
      check (
        fulfillment_type <> 'delivery'
        or (
          delivery_address is not null
          and jsonb_typeof(delivery_address) = 'object'
          and delivery_latitude is not null
          and delivery_longitude is not null
        )
      );
  end if;
end
$$;

create index if not exists kaspi_orders_customer_id_idx on public.kaspi_orders(customer_id);
create index if not exists kaspi_orders_operation_id_idx on public.kaspi_orders(operation_id);
create unique index if not exists kaspi_orders_operation_id_unique_idx on public.kaspi_orders(operation_id);
create unique index if not exists kaspi_orders_order_number_unique_idx on public.kaspi_orders(order_number);
create unique index if not exists kaspi_orders_client_request_unique_idx
  on public.kaspi_orders(customer_id, client_request_id)
  where client_request_id is not null;
alter sequence public.kaspi_order_number_seq owned by public.kaspi_orders.order_number;
create index if not exists kaspi_orders_refund_reconcile_idx
  on public.kaspi_orders(status, bonus_reversed_at)
  where status = 'refunded';
create index if not exists kaspi_orders_fulfillment_schedule_idx
  on public.kaspi_orders(fulfillment_type, scheduled_at, fulfillment_status)
  where status = 'paid';
create index if not exists kaspi_orders_branch_schedule_idx
  on public.kaspi_orders(branch_id, scheduled_at)
  where branch_id is not null and status = 'paid';

alter table public.kaspi_orders enable row level security;
drop policy if exists "service role manages kaspi orders" on public.kaspi_orders;
create policy "service role manages kaspi orders"
  on public.kaspi_orders for all to service_role using (true) with check (true);

drop trigger if exists kaspi_orders_set_updated_at on public.kaspi_orders;
create trigger kaspi_orders_set_updated_at
before update on public.kaspi_orders
for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------
-- Customer delivery addresses
-- --------------------------------------------------------------------
create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  label varchar(120),
  address varchar(500) not null,
  city varchar(100) not null,
  latitude numeric(10, 7) not null,
  longitude numeric(10, 7) not null,
  entrance varchar(30),
  floor varchar(20),
  apartment varchar(30),
  comment varchar(300),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_addresses_coordinates_check check (
    latitude between -90 and 90 and longitude between -180 and 180
  )
);
create index if not exists customer_addresses_customer_idx
  on public.customer_addresses(customer_id, created_at desc);
create unique index if not exists customer_addresses_one_default_idx
  on public.customer_addresses(customer_id) where is_default;
alter table public.customer_addresses enable row level security;
drop policy if exists "service role manages customer addresses" on public.customer_addresses;
create policy "service role manages customer addresses"
  on public.customer_addresses for all to service_role using (true) with check (true);
revoke all on public.customer_addresses from public, anon, authenticated;
grant all on public.customer_addresses to service_role;

create or replace function public.save_customer_address(
  p_customer_id uuid,
  p_address_id uuid,
  p_label varchar,
  p_address varchar,
  p_city varchar,
  p_latitude numeric,
  p_longitude numeric,
  p_entrance varchar,
  p_floor varchar,
  p_apartment varchar,
  p_comment varchar,
  p_is_default boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_address public.customer_addresses%rowtype;
  v_make_default boolean;
  v_count integer;
begin
  if p_customer_id is null
    or length(btrim(coalesce(p_address, ''))) < 3
    or length(btrim(coalesce(p_city, ''))) < 1
    or p_latitude is null or p_longitude is null
    or p_latitude not between -90 and 90
    or p_longitude not between -180 and 180 then
    raise exception 'invalid customer address';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  select count(*) into v_count
  from public.customer_addresses where customer_id = p_customer_id;
  if p_address_id is null then
    if v_count >= 10 then raise exception 'address limit reached'; end if;
    v_make_default := coalesce(p_is_default, false) or v_count = 0;
    if v_make_default then
      update public.customer_addresses
      set is_default = false, updated_at = now()
      where customer_id = p_customer_id and is_default;
    end if;
    insert into public.customer_addresses (
      customer_id, label, address, city, latitude, longitude,
      entrance, floor, apartment, comment, is_default
    ) values (
      p_customer_id, nullif(btrim(p_label), ''), btrim(p_address), btrim(p_city),
      p_latitude, p_longitude, nullif(btrim(p_entrance), ''),
      nullif(btrim(p_floor), ''), nullif(btrim(p_apartment), ''),
      nullif(btrim(p_comment), ''), v_make_default
    ) returning * into v_address;
  else
    select * into v_address
    from public.customer_addresses
    where id = p_address_id and customer_id = p_customer_id
    for update;
    if not found then raise exception 'address not found'; end if;
    v_make_default := coalesce(p_is_default, v_address.is_default);
    if v_make_default then
      update public.customer_addresses
      set is_default = false, updated_at = now()
      where customer_id = p_customer_id and id <> p_address_id and is_default;
    end if;
    update public.customer_addresses set
      label = nullif(btrim(p_label), ''), address = btrim(p_address), city = btrim(p_city),
      latitude = p_latitude, longitude = p_longitude,
      entrance = nullif(btrim(p_entrance), ''), floor = nullif(btrim(p_floor), ''),
      apartment = nullif(btrim(p_apartment), ''), comment = nullif(btrim(p_comment), ''),
      is_default = v_make_default, updated_at = now()
    where id = p_address_id and customer_id = p_customer_id
    returning * into v_address;
  end if;
  return to_jsonb(v_address);
end;
$$;

create or replace function public.set_customer_address_default(
  p_customer_id uuid,
  p_address_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_address public.customer_addresses%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  if not exists (
    select 1 from public.customer_addresses
    where id = p_address_id and customer_id = p_customer_id
  ) then
    raise exception 'address not found';
  end if;
  update public.customer_addresses
  set is_default = false, updated_at = now()
  where customer_id = p_customer_id and id <> p_address_id and is_default;
  update public.customer_addresses
  set is_default = true, updated_at = now()
  where id = p_address_id and customer_id = p_customer_id
  returning * into v_address;
  return to_jsonb(v_address);
end;
$$;

create or replace function public.delete_customer_address(
  p_customer_id uuid,
  p_address_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_default boolean;
  v_next_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  select is_default into v_was_default
  from public.customer_addresses
  where id = p_address_id and customer_id = p_customer_id
  for update;
  if not found then raise exception 'address not found'; end if;
  delete from public.customer_addresses
  where id = p_address_id and customer_id = p_customer_id;
  if v_was_default then
    select id into v_next_id
    from public.customer_addresses
    where customer_id = p_customer_id
    order by updated_at desc, created_at desc limit 1;
    if v_next_id is not null then
      update public.customer_addresses
      set is_default = true, updated_at = now()
      where id = v_next_id;
    end if;
  end if;
  return true;
end;
$$;

revoke all on function public.save_customer_address(
  uuid, uuid, varchar, varchar, varchar, numeric, numeric,
  varchar, varchar, varchar, varchar, boolean
) from public, anon, authenticated;
revoke all on function public.set_customer_address_default(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.delete_customer_address(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.save_customer_address(
  uuid, uuid, varchar, varchar, varchar, numeric, numeric,
  varchar, varchar, varchar, varchar, boolean
) to service_role;
grant execute on function public.set_customer_address_default(uuid, uuid) to service_role;
grant execute on function public.delete_customer_address(uuid, uuid) to service_role;

-- --------------------------------------------------------------------
-- Loyalty reservations for concurrent cashier terminals
-- --------------------------------------------------------------------
create table if not exists public.loyalty_reservations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  order_id varchar(200) not null unique,
  order_total numeric(12, 2) not null,
  discount_amount numeric(12, 2) not null,
  status varchar(20) not null default 'active',
  expires_at timestamptz not null,
  committed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_reservations_amounts_check check (
    order_total >= 0 and discount_amount >= 0 and discount_amount <= order_total
  ),
  constraint loyalty_reservations_status_check check (
    status in ('active', 'committed', 'cancelled', 'expired')
  )
);
create index if not exists loyalty_reservations_customer_active_idx
  on public.loyalty_reservations(customer_id, expires_at) where status = 'active';
alter table public.loyalty_reservations enable row level security;
drop policy if exists "service role manages loyalty reservations" on public.loyalty_reservations;
create policy "service role manages loyalty reservations"
  on public.loyalty_reservations for all to service_role using (true) with check (true);
revoke all on public.loyalty_reservations from public, anon, authenticated;
grant all on public.loyalty_reservations to service_role;

create or replace function public.reserve_loyalty_balance(
  p_customer_id uuid,
  p_order_id text,
  p_order_total numeric,
  p_discount_amount numeric,
  p_max_discount_percent numeric,
  p_ttl_hours integer default 24
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.loyalty_reservations%rowtype;
  v_balance numeric;
  v_other_reserved numeric;
  v_available numeric;
  v_max_discount numeric;
  v_duplicate boolean := false;
begin
  if p_customer_id is null
    or length(btrim(coalesce(p_order_id, ''))) < 1
    or length(p_order_id) > 200
    or coalesce(p_order_total, -1) < 0
    or coalesce(p_discount_amount, -1) < 0
    or p_discount_amount > p_order_total
    or coalesce(p_max_discount_percent, -1) < 0
    or p_max_discount_percent > 100
    or p_ttl_hours < 1 or p_ttl_hours > 72 then
    raise exception 'invalid loyalty reservation values';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  select balance into v_balance
  from public.customers where id = p_customer_id for update;
  if not found then raise exception 'customer not found'; end if;
  update public.loyalty_reservations
  set status = 'expired', updated_at = now()
  where customer_id = p_customer_id and status = 'active' and expires_at <= now();
  select * into v_reservation
  from public.loyalty_reservations where order_id = p_order_id for update;
  if found and v_reservation.status = 'active' and v_reservation.expires_at <= now() then
    update public.loyalty_reservations
    set status = 'expired', updated_at = now()
    where id = v_reservation.id
    returning * into v_reservation;
  end if;
  if found then
    if v_reservation.status = 'committed' then
      if v_reservation.customer_id <> p_customer_id then
        raise exception 'order_id already belongs to another customer';
      end if;
      if abs(v_reservation.order_total - p_order_total) > 0.001
        or abs(v_reservation.discount_amount - p_discount_amount) > 0.001 then
        raise exception 'committed reservation values do not match';
      end if;
      select coalesce(sum(discount_amount), 0) into v_other_reserved
      from public.loyalty_reservations
      where customer_id = p_customer_id and status = 'active' and expires_at > now();
      return jsonb_build_object(
        'reservation_id', v_reservation.id,
        'order_id', v_reservation.order_id,
        'customer_id', v_reservation.customer_id,
        'discount_amount', v_reservation.discount_amount,
        'available_balance', greatest(0, v_balance - v_other_reserved),
        'max_discount_percent', p_max_discount_percent,
        'expires_at', v_reservation.expires_at,
        'duplicate', true
      );
    end if;
    if v_reservation.status = 'active'
      and v_reservation.customer_id <> p_customer_id then
      raise exception 'order_id already belongs to another customer';
    end if;
  end if;
  select coalesce(sum(discount_amount), 0) into v_other_reserved
  from public.loyalty_reservations
  where customer_id = p_customer_id
    and status = 'active' and expires_at > now() and order_id <> p_order_id;
  v_available := greatest(0, v_balance - v_other_reserved);
  v_max_discount := least(
    v_available, p_order_total, p_order_total * p_max_discount_percent / 100
  );
  if p_discount_amount > v_max_discount + 0.001 then
    raise exception 'discount exceeds available reserved balance';
  end if;
  if v_reservation.id is null then
    insert into public.loyalty_reservations (
      customer_id, order_id, order_total, discount_amount, status, expires_at
    ) values (
      p_customer_id, p_order_id, p_order_total, p_discount_amount,
      'active', now() + make_interval(hours => p_ttl_hours)
    ) returning * into v_reservation;
  else
    v_duplicate :=
      v_reservation.status = 'active'
      and abs(v_reservation.order_total - p_order_total) <= 0.001
      and abs(v_reservation.discount_amount - p_discount_amount) <= 0.001;
    update public.loyalty_reservations set
      customer_id = p_customer_id,
      order_total = p_order_total,
      discount_amount = p_discount_amount,
      status = 'active',
      expires_at = now() + make_interval(hours => p_ttl_hours),
      committed_at = null,
      cancelled_at = null,
      updated_at = now()
    where id = v_reservation.id returning * into v_reservation;
  end if;
  return jsonb_build_object(
    'reservation_id', v_reservation.id,
    'order_id', v_reservation.order_id,
    'customer_id', v_reservation.customer_id,
    'discount_amount', v_reservation.discount_amount,
    'available_balance', greatest(0, v_available - v_reservation.discount_amount),
    'max_discount_percent', p_max_discount_percent,
    'expires_at', v_reservation.expires_at,
    'duplicate', v_duplicate
  );
end;
$$;

create or replace function public.commit_loyalty_reservation(
  p_customer_id uuid,
  p_order_id text,
  p_reservation_id uuid,
  p_order_total numeric,
  p_earned_bonus numeric,
  p_activation_delay_days integer,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.loyalty_reservations%rowtype;
  v_result jsonb;
  v_balance numeric;
begin
  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  select * into v_reservation
  from public.loyalty_reservations
  where id = p_reservation_id and order_id = p_order_id and customer_id = p_customer_id
  for update;
  if not found then raise exception 'reservation not found'; end if;
  if v_reservation.status = 'committed' then
    select balance into v_balance from public.customers where id = p_customer_id;
    return jsonb_build_object(
      'duplicate', true, 'balance', v_balance,
      'discount_applied', 0, 'earned_bonus', 0
    );
  end if;
  if v_reservation.status <> 'active' or v_reservation.expires_at <= now() then
    if v_reservation.status = 'active' then
      update public.loyalty_reservations
      set status = 'expired', updated_at = now() where id = v_reservation.id;
    end if;
    raise exception 'reservation is not active';
  end if;
  if coalesce(p_order_total, -1) < v_reservation.discount_amount
    or coalesce(p_earned_bonus, -1) < 0
    or coalesce(p_activation_delay_days, -1) < 0 then
    raise exception 'invalid loyalty commit values';
  end if;
  v_result := public.apply_loyalty_transaction(
    p_customer_id,
    p_order_id,
    v_reservation.discount_amount,
    p_earned_bonus,
    p_order_total,
    p_order_total - v_reservation.discount_amount,
    p_activation_delay_days,
    p_items
  );
  update public.loyalty_reservations set
    status = 'committed', order_total = p_order_total,
    committed_at = now(), updated_at = now()
  where id = v_reservation.id;
  return v_result || jsonb_build_object(
    'discount_applied', case
      when coalesce((v_result->>'duplicate')::boolean, false) then 0
      else v_reservation.discount_amount end,
    'earned_bonus', case
      when coalesce((v_result->>'duplicate')::boolean, false) then 0
      else p_earned_bonus end
  );
end;
$$;

create or replace function public.cancel_loyalty_reservation(
  p_customer_id uuid,
  p_order_id text,
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.loyalty_reservations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(p_customer_id::text));
  select * into v_reservation
  from public.loyalty_reservations
  where id = p_reservation_id and order_id = p_order_id and customer_id = p_customer_id
  for update;
  if not found then raise exception 'reservation not found'; end if;
  if v_reservation.status = 'committed' then
    raise exception 'reservation already committed';
  end if;
  if v_reservation.status in ('cancelled', 'expired') then
    return jsonb_build_object('duplicate', true, 'status', v_reservation.status);
  end if;
  update public.loyalty_reservations set
    status = 'cancelled', cancelled_at = now(), updated_at = now()
  where id = v_reservation.id;
  return jsonb_build_object('duplicate', false, 'status', 'cancelled');
end;
$$;

revoke all on function public.reserve_loyalty_balance(uuid, text, numeric, numeric, numeric, integer)
  from public, anon, authenticated;
revoke all on function public.commit_loyalty_reservation(uuid, text, uuid, numeric, numeric, integer, jsonb)
  from public, anon, authenticated;
revoke all on function public.cancel_loyalty_reservation(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_loyalty_balance(uuid, text, numeric, numeric, numeric, integer)
  to service_role;
grant execute on function public.commit_loyalty_reservation(uuid, text, uuid, numeric, numeric, integer, jsonb)
  to service_role;
grant execute on function public.cancel_loyalty_reservation(uuid, text, uuid)
  to service_role;

-- --------------------------------------------------------------------
-- Public contact center managed through the admin panel
-- --------------------------------------------------------------------
create table if not exists public.contact_cards (
  id uuid primary key default gen_random_uuid(),
  display_mode text not null default 'standard'
    check (display_mode in ('standard', 'compact')),
  title_ru varchar(120) not null check (char_length(btrim(title_ru)) between 1 and 120),
  title_kk varchar(120) not null check (char_length(btrim(title_kk)) between 1 and 120),
  title_en varchar(120) not null check (char_length(btrim(title_en)) between 1 and 120),
  icon_key varchar(40) not null default 'bulka',
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contact_actions (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.contact_cards(id) on delete cascade,
  action_type text not null
    check (
      action_type in (
        'phone', 'whatsapp', 'telegram', 'instagram', 'vk',
        'email', 'website', 'online_chat', 'custom_url'
      )
    ),
  label_ru varchar(80) not null check (char_length(btrim(label_ru)) between 1 and 80),
  label_kk varchar(80) not null check (char_length(btrim(label_kk)) between 1 and 80),
  label_en varchar(80) not null check (char_length(btrim(label_en)) between 1 and 80),
  target varchar(500) not null check (char_length(btrim(target)) between 1 and 500),
  icon_key varchar(40) not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contact_cards_public_order_idx
  on public.contact_cards (is_active, sort_order, created_at);
create index if not exists contact_actions_card_order_idx
  on public.contact_actions (card_id, is_active, sort_order, created_at);

alter table public.contact_cards enable row level security;
alter table public.contact_actions enable row level security;
drop policy if exists service_role_all_contact_cards on public.contact_cards;
drop policy if exists service_role_all_contact_actions on public.contact_actions;
create policy service_role_all_contact_cards
  on public.contact_cards for all to service_role using (true) with check (true);
create policy service_role_all_contact_actions
  on public.contact_actions for all to service_role using (true) with check (true);

create or replace function public.reorder_contact_cards(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_count integer := cardinality(coalesce(p_ids, array[]::uuid[]));
  distinct_count integer;
  existing_count integer;
  matching_count integer;
begin
  select count(*) into distinct_count
  from (
    select distinct requested.id
    from unnest(coalesce(p_ids, array[]::uuid[])) as requested(id)
  ) as unique_ids;
  select count(*) into existing_count from public.contact_cards;
  select count(*) into matching_count
  from public.contact_cards
  where id = any(coalesce(p_ids, array[]::uuid[]));
  if requested_count <> distinct_count
    or requested_count <> existing_count
    or requested_count <> matching_count then
    raise exception 'contact card reorder must contain the complete unique id set';
  end if;
  update public.contact_cards as card
  set sort_order = ordered.ordinality - 1
  from unnest(coalesce(p_ids, array[]::uuid[])) with ordinality
    as ordered(id, ordinality)
  where card.id = ordered.id;
end;
$$;

create or replace function public.reorder_contact_actions(p_card_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_count integer := cardinality(coalesce(p_ids, array[]::uuid[]));
  distinct_count integer;
  existing_count integer;
  matching_count integer;
begin
  select count(*) into distinct_count
  from (
    select distinct requested.id
    from unnest(coalesce(p_ids, array[]::uuid[])) as requested(id)
  ) as unique_ids;
  select count(*) into existing_count
  from public.contact_actions
  where card_id = p_card_id;
  select count(*) into matching_count
  from public.contact_actions
  where card_id = p_card_id
    and id = any(coalesce(p_ids, array[]::uuid[]));
  if requested_count <> distinct_count
    or requested_count <> existing_count
    or requested_count <> matching_count then
    raise exception 'contact action reorder must contain the complete unique card id set';
  end if;
  update public.contact_actions as action
  set sort_order = ordered.ordinality - 1
  from unnest(coalesce(p_ids, array[]::uuid[])) with ordinality
    as ordered(id, ordinality)
  where action.card_id = p_card_id
    and action.id = ordered.id;
end;
$$;

revoke all on function public.reorder_contact_cards(uuid[])
  from public, anon, authenticated;
revoke all on function public.reorder_contact_actions(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.reorder_contact_cards(uuid[]) to service_role;
grant execute on function public.reorder_contact_actions(uuid, uuid[])
  to service_role;

drop trigger if exists contact_cards_set_updated_at on public.contact_cards;
create trigger contact_cards_set_updated_at
before update on public.contact_cards
for each row execute function public.set_updated_at();
drop trigger if exists contact_actions_set_updated_at on public.contact_actions;
create trigger contact_actions_set_updated_at
before update on public.contact_actions
for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------
-- Smoke-check
-- --------------------------------------------------------------------
select
  'Bulka Supabase setup complete' as status,
  (select count(*) from public.settings) as settings_count,
  (select count(*) from public.loyalty_tiers) as loyalty_tiers_count,
  (select count(*) from public.bulka_locations) as locations_count,
  (select count(*) from public.customer_addresses) as addresses_count,
  (select count(*) from public.customer_notifications) as notifications_count,
  (select count(*) from public.contact_cards) as contact_cards_count,
  (select count(*) from public.stories) as stories_count,
  (select count(*) from public.news) as news_count;
