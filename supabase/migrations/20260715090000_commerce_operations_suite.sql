-- Commerce and operations suite: configurable products, personalization,
-- partial refunds, dispatch, marketing, RBAC, privacy, reviews and kitchen.

create table if not exists public.product_configurations (
  product_id text primary key,
  product_kind text not null default 'standard'
    check (product_kind in ('standard', 'cake', 'bakery')),
  enabled boolean not null default true,
  allow_inscription boolean not null default false,
  inscription_max_length integer not null default 80 check (inscription_max_length between 1 and 240),
  allow_candles boolean not null default false,
  allow_reference_upload boolean not null default false,
  min_lead_hours integer not null default 0 check (min_lead_hours between 0 and 720),
  max_advance_days integer not null default 30 check (max_advance_days between 1 and 365),
  weight_options jsonb not null default '[]'::jsonb,
  filling_options jsonb not null default '[]'::jsonb,
  design_options jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint product_configuration_arrays check (
    jsonb_typeof(weight_options) = 'array'
    and jsonb_typeof(filling_options) = 'array'
    and jsonb_typeof(design_options) = 'array'
  )
);

create table if not exists public.product_modifier_groups (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  code text not null,
  title_translations jsonb not null default '{}'::jsonb,
  selection_type text not null default 'single' check (selection_type in ('single', 'multiple')),
  required boolean not null default false,
  min_selected integer not null default 0 check (min_selected >= 0),
  max_selected integer not null default 1 check (max_selected >= 1),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, code),
  constraint modifier_selection_bounds check (min_selected <= max_selected)
);

create index if not exists product_modifier_groups_product_idx
  on public.product_modifier_groups(product_id, active, sort_order);

create table if not exists public.product_modifier_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.product_modifier_groups(id) on delete cascade,
  code text not null,
  title_translations jsonb not null default '{}'::jsonb,
  price_delta numeric(12,2) not null default 0 check (price_delta >= 0),
  is_default boolean not null default false,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, code)
);

create index if not exists product_modifier_options_group_idx
  on public.product_modifier_options(group_id, active, sort_order);

create table if not exists public.customer_favorites (
  customer_id uuid not null references public.customers(id) on delete cascade,
  product_id text not null,
  created_at timestamptz not null default now(),
  primary key (customer_id, product_id)
);

create table if not exists public.customer_recent_products (
  customer_id uuid not null references public.customers(id) on delete cascade,
  product_id text not null,
  view_count integer not null default 1 check (view_count > 0),
  viewed_at timestamptz not null default now(),
  primary key (customer_id, product_id)
);

create index if not exists customer_recent_products_time_idx
  on public.customer_recent_products(customer_id, viewed_at desc);

create table if not exists public.customer_cart_snapshots (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  branch_id uuid references public.bulka_locations(id) on delete set null,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  total numeric(12,2) not null default 0 check (total >= 0),
  updated_at timestamptz not null default now(),
  abandoned_notified_at timestamptz,
  converted_order_id uuid references public.kaspi_orders(id) on delete set null
);

create table if not exists public.order_partial_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.kaspi_orders(id) on delete cascade,
  idempotency_key uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  reason text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'failed')),
  kaspi_reference text,
  error text,
  requested_by text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (order_id, idempotency_key)
);

create index if not exists order_partial_refunds_order_idx
  on public.order_partial_refunds(order_id, status, created_at desc);

create table if not exists public.order_partial_refund_items (
  refund_id uuid not null references public.order_partial_refunds(id) on delete cascade,
  line_key text not null,
  product_id text not null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_amount numeric(12,2) not null check (unit_amount >= 0),
  refund_amount numeric(12,2) not null check (refund_amount >= 0),
  primary key (refund_id, line_key)
);

create table if not exists public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  code text not null unique,
  active boolean not null default true,
  reward_referrer numeric(12,2) not null default 0 check (reward_referrer >= 0),
  reward_friend numeric(12,2) not null default 0 check (reward_friend >= 0),
  max_uses integer check (max_uses is null or max_uses > 0),
  uses_count integer not null default 0 check (uses_count >= 0),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (customer_id)
);

create table if not exists public.referral_redemptions (
  id uuid primary key default gen_random_uuid(),
  referral_code_id uuid not null references public.referral_codes(id) on delete restrict,
  referred_customer_id uuid not null references public.customers(id) on delete cascade,
  order_id uuid references public.kaspi_orders(id) on delete set null,
  status text not null default 'registered'
    check (status in ('registered', 'qualified', 'rewarded', 'cancelled')),
  created_at timestamptz not null default now(),
  rewarded_at timestamptz,
  unique (referred_customer_id)
);

create table if not exists public.targeted_promotions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  description text,
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value numeric(12,2) not null check (discount_value > 0),
  min_order numeric(12,2) not null default 0 check (min_order >= 0),
  max_discount numeric(12,2) check (max_discount is null or max_discount > 0),
  customer_ids uuid[] not null default '{}',
  customer_tags text[] not null default '{}',
  branch_ids uuid[] not null default '{}',
  usage_limit integer check (usage_limit is null or usage_limit > 0),
  per_customer_limit integer not null default 1 check (per_customer_limit > 0),
  used_count integer not null default 0 check (used_count >= 0),
  active boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.promotion_redemptions (
  promotion_id uuid not null references public.targeted_promotions(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  order_id uuid not null references public.kaspi_orders(id) on delete cascade,
  discount_amount numeric(12,2) not null check (discount_amount >= 0),
  created_at timestamptz not null default now(),
  primary key (promotion_id, order_id)
);

create table if not exists public.gift_cards (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  code_last4 text not null,
  initial_balance numeric(12,2) not null check (initial_balance > 0),
  balance numeric(12,2) not null check (balance >= 0),
  purchaser_customer_id uuid references public.customers(id) on delete set null,
  recipient_customer_id uuid references public.customers(id) on delete set null,
  recipient_name text,
  message text,
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  redeemed_at timestamptz
);

create table if not exists public.gift_card_transactions (
  id uuid primary key default gen_random_uuid(),
  gift_card_id uuid not null references public.gift_cards(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  order_id uuid references public.kaspi_orders(id) on delete set null,
  type text not null check (type in ('issue', 'redeem', 'refund', 'adjustment')),
  amount numeric(12,2) not null,
  created_at timestamptz not null default now()
);

alter table public.transactions
  add column if not exists expires_at timestamptz,
  add column if not exists expired_at timestamptz;

create index if not exists transactions_bonus_expiry_idx
  on public.transactions(expires_at, expired_at)
  where expires_at is not null and expired_at is null and amount > 0;

create table if not exists public.admin_user_profiles (
  username text primary key,
  display_name text,
  role text not null default 'operator'
    check (role in ('owner', 'branch_manager', 'operator', 'marketer', 'courier', 'viewer')),
  branch_ids uuid[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.kaspi_orders(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text,
  status text not null default 'published'
    check (status in ('published', 'hidden', 'requires_attention', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, customer_id)
);

create table if not exists public.order_review_items (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.order_reviews(id) on delete cascade,
  product_id text not null,
  product_name text not null,
  rating integer check (rating between 1 and 5),
  complaint_reason text,
  comment text,
  created_at timestamptz not null default now(),
  unique (review_id, product_id)
);

create table if not exists public.marketing_automations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  trigger_type text not null
    check (trigger_type in ('abandoned_cart', 'birthday', 'inactive', 'bonus_awarded', 'bonus_expiring')),
  title_translations jsonb not null default '{}'::jsonb,
  body_translations jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_deliveries (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.marketing_automations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  deduplication_key text not null,
  channel text not null default 'push' check (channel in ('push', 'in_app', 'telegram', 'whatsapp')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  payload jsonb not null default '{}'::jsonb,
  error text,
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (automation_id, customer_id, deduplication_key, channel)
);

create index if not exists marketing_deliveries_queue_idx
  on public.marketing_deliveries(status, scheduled_at);

create table if not exists public.customer_privacy_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  request_type text not null check (request_type in ('export', 'delete')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'ready', 'completed', 'failed')),
  export_payload jsonb,
  error text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.customers
  add column if not exists deleted_at timestamptz,
  add column if not exists privacy_consent_at timestamptz;

alter table public.kaspi_orders
  add column if not exists kitchen_status text not null default 'queued',
  add column if not exists kitchen_started_at timestamptz,
  add column if not exists kitchen_ready_at timestamptz,
  add column if not exists handed_to_courier_at timestamptz,
  add column if not exists promised_ready_at timestamptz,
  add column if not exists preparation_minutes integer,
  add column if not exists partially_refunded_amount numeric(12,2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'kaspi_orders_kitchen_status_check'
  ) then
    alter table public.kaspi_orders add constraint kaspi_orders_kitchen_status_check
      check (kitchen_status in ('queued', 'preparing', 'ready', 'handed_over', 'cancelled'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'kaspi_orders_partial_refund_amount_check'
  ) then
    alter table public.kaspi_orders add constraint kaspi_orders_partial_refund_amount_check
      check (partially_refunded_amount >= 0 and partially_refunded_amount <= amount);
  end if;
end $$;

create index if not exists kaspi_orders_kitchen_queue_idx
  on public.kaspi_orders(kitchen_status, promised_ready_at, created_at)
  where status = 'paid';

alter table public.couriers
  add column if not exists availability_status text not null default 'offline',
  add column if not exists max_active_orders integer not null default 3,
  add column if not exists last_assigned_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'couriers_availability_status_check'
  ) then
    alter table public.couriers add constraint couriers_availability_status_check
      check (availability_status in ('offline', 'available', 'busy', 'break'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'couriers_max_active_orders_check'
  ) then
    alter table public.couriers add constraint couriers_max_active_orders_check
      check (max_active_orders between 1 and 20);
  end if;
end $$;

create or replace function public.complete_partial_refund(
  p_refund_id uuid,
  p_kaspi_reference text
)
returns public.kaspi_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  refund_row public.order_partial_refunds%rowtype;
  order_row public.kaspi_orders%rowtype;
  next_refunded numeric(12,2);
begin
  select * into refund_row
  from public.order_partial_refunds
  where id = p_refund_id
  for update;
  if refund_row.id is null then raise exception 'Refund not found'; end if;

  select * into order_row
  from public.kaspi_orders
  where id = refund_row.order_id
  for update;
  if order_row.id is null then raise exception 'Order not found'; end if;

  if refund_row.status = 'succeeded' then return order_row; end if;
  if refund_row.status not in ('pending', 'processing') then
    raise exception 'Refund state conflict';
  end if;

  next_refunded := coalesce(order_row.partially_refunded_amount, 0) + refund_row.amount;
  if next_refunded > order_row.amount then raise exception 'Refund exceeds order amount'; end if;

  update public.order_partial_refunds
  set status = 'succeeded', kaspi_reference = p_kaspi_reference,
      error = null, completed_at = now()
  where id = refund_row.id;

  update public.kaspi_orders
  set partially_refunded_amount = next_refunded,
      refund_amount = next_refunded,
      refund_status = case when next_refunded >= amount then 'succeeded' else 'partial' end,
      refund_reference = p_kaspi_reference,
      refunded_at = case when next_refunded >= amount then now() else refunded_at end,
      status = case when next_refunded >= amount then 'refunded' else status end,
      fulfillment_status = case when next_refunded >= amount then 'cancelled' else fulfillment_status end,
      kitchen_status = case when next_refunded >= amount then 'cancelled' else kitchen_status end,
      updated_at = now()
  where id = order_row.id
  returning * into order_row;
  return order_row;
end;
$$;

revoke all on function public.complete_partial_refund(uuid, text) from public;
grant execute on function public.complete_partial_refund(uuid, text) to service_role;

create or replace function public.redeem_gift_card(
  p_code_hash text,
  p_customer_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  card public.gift_cards%rowtype;
  redeemed_amount numeric(12,2);
begin
  select * into card from public.gift_cards
  where code_hash = p_code_hash for update;
  if card.id is null or not card.active then raise exception 'Gift card not found'; end if;
  if card.expires_at is not null and card.expires_at <= now() then raise exception 'Gift card expired'; end if;
  if card.balance <= 0 then raise exception 'Gift card already used'; end if;
  if not exists (select 1 from public.customers where id = p_customer_id and deleted_at is null) then
    raise exception 'Customer not found';
  end if;

  redeemed_amount := card.balance;
  update public.gift_cards
  set balance = 0, active = false, recipient_customer_id = p_customer_id, redeemed_at = now()
  where id = card.id;
  update public.customers
  set balance = balance + redeemed_amount, updated_at = now()
  where id = p_customer_id;
  insert into public.gift_card_transactions(gift_card_id, customer_id, type, amount)
  values(card.id, p_customer_id, 'redeem', redeemed_amount);
  insert into public.transactions(customer_id, order_id, type, amount, description)
  values(p_customer_id, 'GIFT-' || card.id::text, 'deposit', redeemed_amount, 'Подарочный сертификат');
  return redeemed_amount;
end;
$$;

revoke all on function public.redeem_gift_card(text, uuid) from public;
grant execute on function public.redeem_gift_card(text, uuid) to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'product_configurations', 'product_modifier_groups', 'product_modifier_options',
    'customer_favorites', 'customer_recent_products', 'customer_cart_snapshots',
    'order_partial_refunds', 'order_partial_refund_items', 'referral_codes',
    'referral_redemptions', 'targeted_promotions', 'promotion_redemptions',
    'gift_cards', 'gift_card_transactions', 'admin_user_profiles', 'order_reviews',
    'order_review_items', 'marketing_automations', 'marketing_deliveries',
    'customer_privacy_requests'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists "service role manages %s" on public.%I', table_name, table_name);
    execute format(
      'create policy "service role manages %s" on public.%I for all to service_role using (true) with check (true)',
      table_name,
      table_name
    );
  end loop;
end $$;

insert into public.marketing_automations
  (code, trigger_type, title_translations, body_translations, config, active)
values
  ('abandoned_cart_default', 'abandoned_cart',
   '{"ru":"Вы кое-что забыли","kk":"Сіз бір нәрсені ұмыттыңыз","en":"You left something behind"}',
   '{"ru":"Ваша корзина ждёт вас в Bulka","kk":"Себетіңіз Bulka-да күтіп тұр","en":"Your Bulka cart is waiting"}',
   '{"delayMinutes":60,"cooldownHours":24}', true),
  ('birthday_default', 'birthday',
   '{"ru":"С днём рождения!","kk":"Туған күніңізбен!","en":"Happy birthday!"}',
   '{"ru":"Для вас приготовлен подарок от Bulka","kk":"Bulka-дан сізге сыйлық","en":"A Bulka gift is waiting for you"}',
   '{"daysBefore":0}', true),
  ('inactive_default', 'inactive',
   '{"ru":"Мы скучаем","kk":"Біз сізді сағындық","en":"We miss you"}',
   '{"ru":"Загляните за свежей выпечкой","kk":"Жаңа піскен нанға келіңіз","en":"Come back for fresh baking"}',
   '{"inactiveDays":45,"cooldownDays":30}', true),
  ('bonus_expiring_default', 'bonus_expiring',
   '{"ru":"Бонусы скоро сгорят","kk":"Бонустардың мерзімі аяқталады","en":"Your bonuses expire soon"}',
   '{"ru":"Успейте использовать бонусы в Bulka","kk":"Bulka бонустарын пайдаланып үлгеріңіз","en":"Use your Bulka bonuses before they expire"}',
   '{"daysBefore":7,"expirationDays":90}', true),
  ('bonus_awarded_default', 'bonus_awarded',
   '{"ru":"Начислены бонусы","kk":"Бонустар қосылды","en":"Bonuses earned"}',
   '{"ru":"Баланс Bulka пополнен","kk":"Bulka балансы толықтырылды","en":"Your Bulka balance was updated"}',
   '{}', true)
on conflict (code) do nothing;
