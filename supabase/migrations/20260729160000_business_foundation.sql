-- Customer business foundation: stock alerts, paid gift certificates and
-- one-time pickup handoff credentials. This migration is immutable.

create table if not exists public.customer_stock_subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  product_id text not null check (char_length(product_id) between 1 and 128),
  branch_id uuid not null references public.bulka_locations(id) on delete cascade,
  product_name varchar(160),
  status text not null default 'active'
    check (status in ('active', 'notified', 'cancelled')),
  notified_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_stock_subscriptions_active_unique_idx
  on public.customer_stock_subscriptions(customer_id, branch_id, product_id)
  where status = 'active';
create index if not exists customer_stock_subscriptions_inventory_idx
  on public.customer_stock_subscriptions(branch_id, product_id, status);
create index if not exists customer_stock_subscriptions_customer_idx
  on public.customer_stock_subscriptions(customer_id, created_at desc);

alter table public.kaspi_orders
  add column if not exists order_kind text not null default 'product';

alter table public.gift_card_transactions
  add column if not exists order_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'kaspi_orders_order_kind_check'
      and conrelid = 'public.kaspi_orders'::regclass
  ) then
    alter table public.kaspi_orders
      add constraint kaspi_orders_order_kind_check
      check (order_kind in ('product', 'gift_certificate')) not valid;
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conname = 'gift_card_transactions_order_id_fkey'
      and conrelid = 'public.gift_card_transactions'::regclass
  ) then
    alter table public.gift_card_transactions
      add constraint gift_card_transactions_order_id_fkey
      foreign key (order_id) references public.kaspi_orders(id)
      on delete set null not valid;
  end if;
end $$;

alter table public.kaspi_orders
  validate constraint kaspi_orders_order_kind_check;
alter table public.gift_card_transactions
  validate constraint gift_card_transactions_order_id_fkey;

create table if not exists public.gift_certificate_purchases (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  request_id uuid not null,
  request_fingerprint varchar(64) not null
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  amount numeric(12,2) not null check (amount between 500 and 1000000),
  currency char(3) not null default 'KZT' check (currency = 'KZT'),
  recipient_phone varchar(32) not null,
  recipient_name varchar(160),
  message varchar(500),
  locale varchar(2) not null default 'ru' check (locale in ('ru', 'kk', 'en')),
  delivery_at timestamptz,
  payment_provider text not null check (payment_provider in ('kaspi', 'forte')),
  status text not null default 'pending_payment'
    check (
      status in (
        'pending_payment',
        'active',
        'refund_processing',
        'failed',
        'expired',
        'refunded'
      )
    ),
  payment_order_id uuid unique references public.kaspi_orders(id) on delete set null,
  provider_operation_id varchar(160),
  gift_card_id uuid not null unique references public.gift_cards(id) on delete restrict,
  code_ciphertext text not null check (char_length(code_ciphertext) between 40 and 2000),
  paid_at timestamptz,
  activated_at timestamptz,
  recipient_notified_at timestamptz,
  refund_previous_status text
    check (refund_previous_status in ('pending_payment', 'active')),
  failed_at timestamptz,
  last_error varchar(1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, request_id)
);

create index if not exists gift_certificate_purchases_payment_idx
  on public.gift_certificate_purchases(payment_order_id)
  where payment_order_id is not null;
create index if not exists gift_certificate_purchases_customer_idx
  on public.gift_certificate_purchases(customer_id, created_at desc);
create index if not exists gift_certificate_purchases_pending_idx
  on public.gift_certificate_purchases(status, updated_at)
  where status = 'pending_payment';

create table if not exists public.pickup_order_handoffs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.kaspi_orders(id) on delete cascade,
  token_hash varchar(64) not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  pin_hash varchar(64) not null check (pin_hash ~ '^[0-9a-f]{64}$'),
  token_ciphertext text not null check (char_length(token_ciphertext) between 40 and 2000),
  pin_ciphertext text not null check (char_length(pin_ciphertext) between 40 and 2000),
  expires_at timestamptz not null,
  used_at timestamptz,
  verified_by varchar(160),
  pin_failed_attempts integer not null default 0
    check (pin_failed_attempts between 0 and 5),
  pin_locked_until timestamptz,
  last_pin_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pickup_order_handoffs_expiry_check check (expires_at > created_at)
);

create index if not exists pickup_order_handoffs_active_idx
  on public.pickup_order_handoffs(expires_at)
  where used_at is null;

create table if not exists public.branch_pos_credentials (
  branch_id uuid primary key references public.bulka_locations(id) on delete cascade,
  token_hash varchar(64) not null check (token_hash ~ '^[0-9a-f]{64}$'),
  version integer not null default 1 check (version between 1 and 2147483647),
  active boolean not null default true,
  rotated_by varchar(160),
  rotated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gift_card_pos_reservations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  gift_card_id uuid not null references public.gift_cards(id) on delete restrict,
  branch_id uuid not null references public.bulka_locations(id) on delete restrict,
  iiko_order_id varchar(200) not null,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'active'
    check (status in ('active', 'committed', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  commit_request_id uuid unique,
  cancel_request_id uuid unique,
  balance_after numeric(12,2) check (balance_after is null or balance_after >= 0),
  committed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gift_card_pos_reservations_expiry_check check (expires_at > created_at)
);

create index if not exists gift_card_pos_reservations_order_idx
  on public.gift_card_pos_reservations(branch_id, iiko_order_id, created_at desc);
create index if not exists gift_card_pos_reservations_active_idx
  on public.gift_card_pos_reservations(gift_card_id, expires_at)
  where status = 'active';

alter table public.gift_card_transactions
  add column if not exists pos_reservation_id uuid;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'gift_card_transactions_pos_reservation_id_fkey'
      and conrelid = 'public.gift_card_transactions'::regclass
  ) then
    alter table public.gift_card_transactions
      add constraint gift_card_transactions_pos_reservation_id_fkey
      foreign key (pos_reservation_id)
      references public.gift_card_pos_reservations(id)
      on delete set null not valid;
  end if;
end $$;
alter table public.gift_card_transactions
  validate constraint gift_card_transactions_pos_reservation_id_fkey;
create unique index if not exists gift_card_transactions_pos_reservation_unique_idx
  on public.gift_card_transactions(pos_reservation_id)
  where pos_reservation_id is not null;

create or replace function public.activate_gift_certificate_purchase(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  purchase public.gift_certificate_purchases%rowtype;
  payment_order public.kaspi_orders%rowtype;
begin
  select *
    into payment_order
  from public.kaspi_orders
  where id = p_order_id
  for update;

  if payment_order.id is null
     or payment_order.order_kind <> 'gift_certificate'
     or payment_order.status <> 'paid' then
    raise exception 'gift certificate payment is not paid';
  end if;

  select *
    into purchase
  from public.gift_certificate_purchases
  where payment_order_id = p_order_id
     or (
       payment_order_id is null
       and customer_id = payment_order.customer_id
       and request_id::text = payment_order.client_request_id
     )
  order by case when payment_order_id = p_order_id then 0 else 1 end
  limit 1
  for update;

  if purchase.id is null then
    raise exception 'gift certificate purchase not found';
  end if;
  if purchase.customer_id <> payment_order.customer_id
     or purchase.amount <> payment_order.amount
     or (
       purchase.payment_provider = 'kaspi'
       and coalesce(payment_order.payment_method, '') not in ('kaspi', 'invoice', 'qr')
     )
     or (
       purchase.payment_provider = 'forte'
       and payment_order.payment_method is distinct from 'forte_card'
     ) then
    raise exception 'gift certificate payment does not match purchase';
  end if;

  if purchase.status = 'active' then
    return jsonb_build_object(
      'status', 'already_active',
      'purchaseId', purchase.id,
      'giftCardId', purchase.gift_card_id
    );
  end if;

  if purchase.status <> 'pending_payment' then
    raise exception 'gift certificate purchase is not activatable';
  end if;

  update public.gift_cards
  set active = true
  where id = purchase.gift_card_id
    and active = false;

  insert into public.gift_card_transactions(gift_card_id, customer_id, order_id, type, amount)
  select purchase.gift_card_id, purchase.customer_id, payment_order.id, 'issue', purchase.amount
  where not exists (
    select 1
    from public.gift_card_transactions gift_tx
    where gift_tx.gift_card_id = purchase.gift_card_id
      and gift_tx.type = 'issue'
  );

  update public.gift_certificate_purchases
  set status = 'active',
      payment_order_id = coalesce(payment_order_id, payment_order.id),
      paid_at = coalesce(paid_at, now()),
      activated_at = coalesce(activated_at, now()),
      provider_operation_id = coalesce(provider_operation_id, payment_order.operation_id),
      last_error = null,
      updated_at = now()
  where id = purchase.id
  returning * into purchase;

  update public.kaspi_orders
  set fulfillment_status = 'completed',
      fulfilled_at = coalesce(fulfilled_at, now()),
      kitchen_status = 'handed_over',
      earned_bonus = 0,
      bonus_awarded_at = coalesce(bonus_awarded_at, now()),
      updated_at = now()
  where id = payment_order.id
    and status = 'paid';

  return jsonb_build_object(
    'status', 'active',
    'purchaseId', purchase.id,
    'giftCardId', purchase.gift_card_id,
    'activatedAt', purchase.activated_at
  );
end;
$$;

revoke all on function public.activate_gift_certificate_purchase(uuid) from public;
grant execute on function public.activate_gift_certificate_purchase(uuid) to service_role;

create or replace function public.claim_stock_subscription_notification(
  p_subscription_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  subscription public.customer_stock_subscriptions%rowtype;
  inventory public.branch_product_inventory%rowtype;
  reserved_quantity integer := 0;
  notification_id uuid;
  notification_title text := 'Снова в наличии';
  notification_body text;
begin
  select *
    into subscription
  from public.customer_stock_subscriptions
  where id = p_subscription_id
  for update;

  if subscription.id is null or subscription.status <> 'active' then
    return jsonb_build_object('status', 'already_processed');
  end if;

  select *
    into inventory
  from public.branch_product_inventory
  where branch_id = subscription.branch_id
    and product_id = subscription.product_id
  for update;

  if inventory.branch_id is not null then
    select coalesce(sum(quantity), 0)::integer
      into reserved_quantity
    from public.inventory_reservations
    where branch_id = subscription.branch_id
      and product_id = subscription.product_id
      and (
        status = 'committed'
        or (status = 'active' and expires_at > now())
      );
    if inventory.manual_stop
       or (
         inventory.source_quantity is not null
         and inventory.source_quantity - reserved_quantity <= 0
       ) then
      return jsonb_build_object('status', 'unavailable');
    end if;
  end if;

  notification_body :=
    coalesce(nullif(subscription.product_name, ''), nullif(inventory.product_name, ''), 'Товар')
    || ' снова можно заказать в выбранной точке.';

  insert into public.customer_notifications(customer_id, title, body, type, payload)
  values (
    subscription.customer_id,
    notification_title,
    notification_body,
    'stock',
    jsonb_build_object(
      'messageKey', 'product_back_in_stock',
      'productId', subscription.product_id,
      'branchId', subscription.branch_id
    )
  )
  returning id into notification_id;

  update public.customer_stock_subscriptions
  set status = 'notified',
      notified_at = now(),
      updated_at = now()
  where id = subscription.id
    and status = 'active';

  if not found then
    raise exception 'stock subscription claim conflict';
  end if;

  return jsonb_build_object(
    'status', 'notified',
    'subscriptionId', subscription.id,
    'customerId', subscription.customer_id,
    'productId', subscription.product_id,
    'branchId', subscription.branch_id,
    'productName',
      coalesce(nullif(subscription.product_name, ''), nullif(inventory.product_name, ''), 'Товар'),
    'notificationId', notification_id,
    'title', notification_title,
    'body', notification_body
  );
end;
$$;

revoke all on function public.claim_stock_subscription_notification(uuid) from public;
grant execute on function public.claim_stock_subscription_notification(uuid) to service_role;

create or replace function public.prepare_gift_certificate_refund(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_order public.kaspi_orders%rowtype;
  purchase public.gift_certificate_purchases%rowtype;
  card public.gift_cards%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('gift-refund:' || p_order_id::text, 0));

  select *
    into payment_order
  from public.kaspi_orders
  where id = p_order_id
  for update;

  if payment_order.id is null or payment_order.order_kind <> 'gift_certificate' then
    raise exception 'gift certificate order not found';
  end if;
  if payment_order.status <> 'paid' then
    raise exception 'gift certificate order is not refundable';
  end if;

  select *
    into purchase
  from public.gift_certificate_purchases
  where payment_order_id = p_order_id
  for update;

  if purchase.id is null then
    raise exception 'gift certificate purchase not found';
  end if;
  if purchase.status = 'refunded' then
    return jsonb_build_object('status', 'already_refunded', 'purchaseId', purchase.id);
  end if;
  if purchase.status not in ('pending_payment', 'active', 'refund_processing') then
    raise exception 'gift certificate purchase is not refundable';
  end if;

  select *
    into card
  from public.gift_cards
  where id = purchase.gift_card_id
  for update;

  update public.gift_card_pos_reservations
  set status = 'expired', updated_at = now()
  where gift_card_id = card.id
    and status = 'active'
    and expires_at <= now();

  if card.id is null
     or card.balance <> purchase.amount
     or card.initial_balance <> purchase.amount
     or exists (
       select 1
       from public.gift_card_transactions
       where gift_card_id = card.id
         and type = 'redeem'
     )
     or exists (
       select 1
       from public.gift_card_pos_reservations
       where gift_card_id = card.id
         and status in ('active', 'committed')
     ) then
    raise exception 'gift certificate has already been used';
  end if;

  update public.gift_cards
  set active = false
  where id = card.id;

  update public.gift_certificate_purchases
  set status = 'refund_processing',
      refund_previous_status = case
        when status in ('pending_payment', 'active') then status
        else refund_previous_status
      end,
      updated_at = now(),
      last_error = null
  where id = purchase.id
  returning * into purchase;

  return jsonb_build_object(
    'status', 'refund_processing',
    'purchaseId', purchase.id,
    'giftCardId', purchase.gift_card_id
  );
end;
$$;

revoke all on function public.prepare_gift_certificate_refund(uuid) from public;
grant execute on function public.prepare_gift_certificate_refund(uuid) to service_role;

create or replace function public.rollback_gift_certificate_refund(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  purchase public.gift_certificate_purchases%rowtype;
  card public.gift_cards%rowtype;
  payment_order public.kaspi_orders%rowtype;
  previous_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended('gift-refund:' || p_order_id::text, 0));

  select *
    into payment_order
  from public.kaspi_orders
  where id = p_order_id
  for update;

  if payment_order.id is null
     or payment_order.order_kind <> 'gift_certificate'
     or payment_order.status <> 'paid'
     or coalesce(payment_order.refund_status, '') <> 'failed' then
    raise exception 'gift certificate refund rollback is not allowed';
  end if;

  select *
    into purchase
  from public.gift_certificate_purchases
  where payment_order_id = p_order_id
  for update;

  if purchase.id is null then
    raise exception 'gift certificate purchase not found';
  end if;
  if purchase.status <> 'refund_processing' then
    return jsonb_build_object('status', purchase.status, 'purchaseId', purchase.id);
  end if;

  select *
    into card
  from public.gift_cards
  where id = purchase.gift_card_id
  for update;

  if card.balance <> purchase.amount
     or exists (
       select 1
       from public.gift_card_transactions
       where gift_card_id = card.id
         and type = 'redeem'
     ) then
    raise exception 'gift certificate refund rollback conflict';
  end if;

  previous_status := coalesce(
    purchase.refund_previous_status,
    case when purchase.activated_at is null then 'pending_payment' else 'active' end
  );
  update public.gift_cards
  set active = case when previous_status = 'active' then true else false end
  where id = card.id;

  update public.gift_certificate_purchases
  set status = previous_status,
      refund_previous_status = null,
      updated_at = now()
  where id = purchase.id
  returning * into purchase;

  return jsonb_build_object('status', previous_status, 'purchaseId', purchase.id);
end;
$$;

revoke all on function public.rollback_gift_certificate_refund(uuid) from public;
grant execute on function public.rollback_gift_certificate_refund(uuid) to service_role;

create or replace function public.finalize_gift_certificate_refund(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  purchase public.gift_certificate_purchases%rowtype;
  card public.gift_cards%rowtype;
  payment_order public.kaspi_orders%rowtype;
begin
  perform pg_advisory_xact_l…351 tokens truncated…= 'refunded',
      refund_previous_status = null,
      updated_at = now(),
      last_error = null
  where id = purchase.id
  returning * into purchase;

  return jsonb_build_object(
    'status', 'refunded',
    'purchaseId', purchase.id,
    'giftCardId', purchase.gift_card_id
  );
end;
$$;

revoke all on function public.finalize_gift_certificate_refund(uuid) from public;
grant execute on function public.finalize_gift_certificate_refund(uuid) to service_role;

create or replace function public.rotate_branch_pos_credential(
  p_branch_id uuid,
  p_token_hash text,
  p_rotated_by text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  credential public.branch_pos_credentials%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid branch POS token hash';
  end if;
  if not exists (
    select 1
    from public.bulka_locations
    where id = p_branch_id
      and active = true
  ) then
    raise exception 'branch not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('branch-pos:' || p_branch_id::text, 0));

  insert into public.branch_pos_credentials(
    branch_id,
    token_hash,
    version,
    active,
    rotated_by,
    rotated_at,
    updated_at
  )
  values (
    p_branch_id,
    p_token_hash,
    1,
    true,
    left(nullif(btrim(p_rotated_by), ''), 160),
    now(),
    now()
  )
  on conflict (branch_id) do update
  set token_hash = excluded.token_hash,
      version = public.branch_pos_credentials.version + 1,
      active = true,
      rotated_by = excluded.rotated_by,
      rotated_at = now(),
      updated_at = now()
  returning * into credential;

  return jsonb_build_object(
    'branchId', credential.branch_id,
    'version', credential.version,
    'rotatedAt', credential.rotated_at
  );
end;
$$;

revoke all on function public.rotate_branch_pos_credential(uuid, text, text) from public;
grant execute on function public.rotate_branch_pos_credential(uuid, text, text) to service_role;

create or replace function public.verify_pickup_order_handoff(
  p_order_id uuid,
  p_token_hash text,
  p_pin_hash text,
  p_verified_by text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  handoff public.pickup_order_handoffs%rowtype;
  payment_order public.kaspi_orders%rowtype;
  next_pin_attempts integer;
  next_lock_until timestamptz;
begin
  select *
    into handoff
  from public.pickup_order_handoffs
  where order_id = p_order_id
  for update;

  if handoff.id is null then
    raise exception 'pickup handoff not found';
  end if;
  if handoff.used_at is not null then
    raise exception 'pickup handoff already used';
  end if;
  if handoff.expires_at <= now() then
    raise exception 'pickup handoff expired';
  end if;
  if (p_token_hash is null) = (p_pin_hash is null) then
    return jsonb_build_object('status', 'invalid');
  end if;

  if p_pin_hash is not null then
    if handoff.pin_locked_until is not null and handoff.pin_locked_until > now() then
      return jsonb_build_object(
        'status', 'locked',
        'retryAt', handoff.pin_locked_until
      );
    end if;
    if handoff.pin_locked_until is not null and handoff.pin_locked_until <= now() then
      update public.pickup_order_handoffs
      set pin_failed_attempts = 0,
          pin_locked_until = null,
          updated_at = now()
      where id = handoff.id
      returning * into handoff;
    end if;
    if handoff.pin_hash <> p_pin_hash then
      next_pin_attempts := least(5, handoff.pin_failed_attempts + 1);
      next_lock_until :=
        case when next_pin_attempts >= 5 then now() + interval '15 minutes' else null end;
      update public.pickup_order_handoffs
      set pin_failed_attempts = next_pin_attempts,
          pin_locked_until = next_lock_until,
          last_pin_attempt_at = now(),
          updated_at = now()
      where id = handoff.id;
      return jsonb_build_object(
        'status', case when next_lock_until is null then 'invalid' else 'locked' end,
        'attemptsRemaining', greatest(0, 5 - next_pin_attempts),
        'retryAt', next_lock_until
      );
    end if;
  elsif handoff.token_hash <> p_token_hash then
    return jsonb_build_object('status', 'invalid');
  end if;

  select *
    into payment_order
  from public.kaspi_orders
  where id = p_order_id
  for update;

  if payment_order.id is null
     or payment_order.status <> 'paid'
     or payment_order.order_kind <> 'product'
     or payment_order.fulfillment_status <> 'ready'
     or coalesce(payment_order.preorder_fulfillment_type, payment_order.fulfillment_type) = 'delivery'
  then
    raise exception 'order is not ready for pickup handoff';
  end if;

  update public.pickup_order_handoffs
  set used_at = now(),
      verified_by = left(coalesce(p_verified_by, 'unknown'), 160),
      pin_failed_attempts = 0,
      pin_locked_until = null,
      last_pin_attempt_at = case when p_pin_hash is not null then now() else last_pin_attempt_at end,
      updated_at = now()
  where id = handoff.id
    and used_at is null
  returning * into handoff;

  if handoff.used_at is null then
    raise exception 'pickup handoff conflict';
  end if;

  update public.kaspi_orders
  set fulfillment_status = 'completed',
      fulfilled_at = now(),
      kitchen_status = 'handed_over',
      updated_at = now()
  where id = payment_order.id
    and status = 'paid'
    and fulfillment_status = 'ready';

  if not found then
    raise exception 'pickup handoff conflict';
  end if;

  return jsonb_build_object(
    'status', 'verified',
    'handoffId', handoff.id,
    'orderId', p_order_id,
    'verifiedAt', handoff.used_at
  );
end;
$$;

revoke all on function public.verify_pickup_order_handoff(uuid, text, text, text) from public;
grant execute on function public.verify_pickup_order_handoff(uuid, text, text, text)
  to service_role;

create or replace function public.reserve_gift_card_for_iiko(
  p_code_hash text,
  p_branch_id uuid,
  p_iiko_order_id text,
  p_amount numeric,
  p_request_id uuid,
  p_ttl_minutes integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  card public.gift_cards%rowtype;
  existing public.gift_card_pos_reservations%rowtype;
  reservation public.gift_card_pos_reservations%rowtype;
  reserved_amount numeric(12,2);
  available_balance numeric(12,2);
begin
  perform pg_advisory_xact_lock(hashtextextended('gift-reserve:' || p_request_id::text, 0));

  select *
    into existing
  from public.gift_card_pos_reservations
  where request_id = p_request_id;

  if existing.id is not null then
    select * into card from public.gift_cards where id = existing.gift_card_id;
    if card.code_hash <> p_code_hash
       or existing.branch_id <> p_branch_id
       or existing.iiko_order_id <> p_iiko_order_id
       or existing.amount <> p_amount then
      raise exception 'gift card idempotency key already used';
    end if;
    if existing.status = 'active' and existing.expires_at <= now() then
      update public.gift_card_pos_reservations
      set status = 'expired', updated_at = now()
      where id = existing.id and status = 'active'
      returning * into existing;
    end if;
    select coalesce(sum(amount), 0)
      into reserved_amount
    from public.gift_card_pos_reservations
    where gift_card_id = existing.gift_card_id
      and status = 'active'
      and expires_at > now();
    return jsonb_build_object(
      'status', existing.status,
      'duplicate', true,
      'reservationId', existing.id,
      'giftCardId', existing.gift_card_id,
      'amount', existing.amount,
      'expiresAt', existing.expires_at,
      'availableBalance', greatest(0, card.balance - reserved_amount)
    );
  end if;

  if not exists (
    select 1 from public.bulka_locations
    where id = p_branch_id and active = true
  ) then
    raise exception 'gift card branch not found';
  end if;
  if char_length(btrim(coalesce(p_iiko_order_id, ''))) < 1
     or char_length(p_iiko_order_id) > 200 then
    raise exception 'gift card iiko order invalid';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'gift card amount invalid';
  end if;
  if p_ttl_minutes is null or p_ttl_minutes < 5 or p_ttl_minutes > 120 then
    raise exception 'gift card ttl invalid';
  end if;

  select *
    into card
  from public.gift_cards
  where code_hash = p_code_hash
  for update;

  if card.id is null or not card.active then
    raise exception 'gift card not found';
  end if;
  if card.expires_at is not null and card.expires_at <= now() then
    raise exception 'gift card expired';
  end if;

  update public.gift_card_pos_reservations
  set status = 'expired', updated_at = now()
  where gift_card_id = card.id
    and status = 'active'
    and expires_at <= now();

  select coalesce(sum(amount), 0)
    into reserved_amount
  from public.gift_card_pos_reservations
  where gift_card_id = card.id
    and status = 'active'
    and expires_at > now();

  available_balance := greatest(0, card.balance - reserved_amount);
  if available_balance < p_amount then
    raise exception 'gift card insufficient balance';
  end if;

  insert into public.gift_card_pos_reservations(
    request_id,
    gift_card_id,
    branch_id,
    iiko_order_id,
    amount,
    expires_at
  )
  values(
    p_request_id,
    card.id,
    p_branch_id,
    p_iiko_order_id,
    p_amount,
    now() + make_interval(mins => p_ttl_minutes)
  )
  returning * into reservation;

  return jsonb_build_object(
    'status', 'active',
    'duplicate', false,
    'reservationId', reservation.id,
    'giftCardId', card.id,
    'amount', reservation.amount,
    'expiresAt', reservation.expires_at,
    'availableBalance', available_balance - reservation.amount
  );
end;
$$;

revoke all on function public.reserve_gift_card_for_iiko(text, uuid, text, numeric, uuid, integer)
  from public;
grant execute on function public.reserve_gift_card_for_iiko(text, uuid, text, numeric, uuid, integer)
  to service_role;

create or replace function public.commit_gift_card_for_iiko(
  p_reservation_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reservation public.gift_card_pos_reservations%rowtype;
  card public.gift_cards%rowtype;
  next_balance numeric(12,2);
begin
  perform pg_advisory_xact_lock(hashtextextended('gift-commit:' || p_request_id::text, 0));
  if exists (
    select 1
    from public.gift_card_pos_reservations
    where commit_request_id = p_request_id
      and id <> p_reservation_id
  ) then
    raise exception 'gift card commit idempotency conflict';
  end if;

  select *
    into reservation
  from public.gift_card_pos_reservations
  where id = p_reservation_id
  for update;

  if reservation.id is null then
    raise exception 'gift card reservation not found';
  end if;
  if reservation.status = 'committed' then
    if reservation.commit_request_id <> p_request_id then
      raise exception 'gift card commit idempotency conflict';
    end if;
    return jsonb_build_object(
      'status', 'committed',
      'duplicate', true,
      'reservationId', reservation.id,
      'giftCardId', reservation.gift_card_id,
      'amount', reservation.amount,
      'balanceAfter', reservation.balance_after,
      'committedAt', reservation.committed_at
    );
  end if;
  if reservation.status <> 'active' then
    raise exception 'gift card reservation is not active';
  end if;
  if reservation.expires_at <= now() then
    update public.gift_card_pos_reservations
    set status = 'expired', updated_at = now()
    where id = reservation.id;
    raise exception 'gift card reservation expired';
  end if;

  select *
    into card
  from public.gift_cards
  where id = reservation.gift_card_id
  for update;

  if card.id is null or not card.active then
    raise exception 'gift card not found';
  end if;
  if card.expires_at is not null and card.expires_at <= now() then
    raise exception 'gift card expired';
  end if;
  if card.balance < reservation.amount then
    raise exception 'gift card insufficient balance';
  end if;

  next_balance := card.balance - reservation.amount;
  update public.gift_cards
  set balance = next_balance,
      active = next_balance > 0,
      redeemed_at = case when next_balance = 0 then now() else redeemed_at end
  where id = card.id;

  update public.gift_card_pos_reservations
  set status = 'committed',
      commit_request_id = p_request_id,
      balance_after = next_balance,
      committed_at = now(),
      updated_at = now()
  where id = reservation.id
    and status = 'active'
  returning * into reservation;

  if reservation.status <> 'committed' then
    raise exception 'gift card reservation conflict';
  end if;

  insert into public.gift_card_transactions(
    gift_card_id,
    customer_id,
    order_id,
    pos_reservation_id,
    type,
    amount
  )
  values(
    card.id,
    card.recipient_customer_id,
    null,
    reservation.id,
    'redeem',
    reservation.amount
  );

  return jsonb_build_object(
    'status', 'committed',
    'duplicate', false,
    'reservationId', reservation.id,
    'giftCardId', card.id,
    'amount', reservation.amount,
    'balanceAfter', reservation.balance_after,
    'committedAt', reservation.committed_at
  );
end;
$$;

revoke all on function public.commit_gift_card_for_iiko(uuid, uuid) from public;
grant execute on function public.commit_gift_card_for_iiko(uuid, uuid) to service_role;

create or replace function public.cancel_gift_card_for_iiko(
  p_reservation_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reservation public.gift_card_pos_reservations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('gift-cancel:' || p_request_id::text, 0));
  if exists (
    select 1
    from public.gift_card_pos_reservations
    where cancel_request_id = p_request_id
      and id <> p_reservation_id
  ) then
    raise exception 'gift card cancel idempotency conflict';
  end if;

  select *
    into reservation
  from public.gift_card_pos_reservations
  where id = p_reservation_id
  for update;

  if reservation.id is null then
    raise exception 'gift card reservation not found';
  end if;
  if reservation.status = 'cancelled' then
    if reservation.cancel_request_id <> p_request_id then
      raise exception 'gift card cancel idempotency conflict';
    end if;
    return jsonb_build_object(
      'status', 'cancelled',
      'duplicate', true,
      'reservationId', reservation.id,
      'cancelledAt', reservation.cancelled_at
    );
  end if;
  if reservation.status = 'committed' then
    raise exception 'gift card reservation already committed';
  end if;
  if reservation.status not in ('active', 'expired') then
    raise exception 'gift card reservation is not cancellable';
  end if;

  update public.gift_card_pos_reservations
  set status = 'cancelled',
      cancel_request_id = p_request_id,
      cancelled_at = now(),
      updated_at = now()
  where id = reservation.id
  returning * into reservation;

  return jsonb_build_object(
    'status', 'cancelled',
    'duplicate', false,
    'reservationId', reservation.id,
    'cancelledAt', reservation.cancelled_at
  );
end;
$$;

revoke all on function public.cancel_gift_card_for_iiko(uuid, uuid) from public;
grant execute on function public.cancel_gift_card_for_iiko(uuid, uuid) to service_role;

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
  select * into card
  from public.gift_cards
  where code_hash = p_code_hash
  for update;
  if card.id is null or not card.active then raise exception 'Gift card not found'; end if;
  if card.expires_at is not null and card.expires_at <= now() then
    raise exception 'Gift card expired';
  end if;
  if card.balance <= 0 then raise exception 'Gift card already used'; end if;
  if not exists (
    select 1 from public.customers
    where id = p_customer_id and deleted_at is null
  ) then
    raise exception 'Customer not found';
  end if;

  update public.gift_card_pos_reservations
  set status = 'expired', updated_at = now()
  where gift_card_id = card.id
    and status = 'active'
    and expires_at <= now();
  if exists (
    select 1 from public.gift_card_pos_reservations
    where gift_card_id = card.id
      and status = 'active'
      and expires_at > now()
  ) then
    raise exception 'Gift card is reserved at POS';
  end if;

  redeemed_amount := card.balance;
  update public.gift_cards
  set balance = 0,
      active = false,
      recipient_customer_id = p_customer_id,
      redeemed_at = now()
  where id = card.id;
  update public.customers
  set balance = balance + redeemed_amount,
      updated_at = now()
  where id = p_customer_id;
  insert into public.gift_card_transactions(gift_card_id, customer_id, type, amount)
  values(card.id, p_customer_id, 'redeem', redeemed_amount);
  insert into public.transactions(customer_id, order_id, type, amount, description)
  values(
    p_customer_id,
    'GIFT-' || card.id::text,
    'deposit',
    redeemed_amount,
    'Подарочный сертификат'
  );
  return redeemed_amount;
end;
$$;

revoke all on function public.redeem_gift_card(text, uuid) from public;
grant execute on function public.redeem_gift_card(text, uuid) to service_role;

alter table public.customer_stock_subscriptions enable row level security;
alter table public.gift_certificate_purchases enable row level security;
alter table public.pickup_order_handoffs enable row level security;
alter table public.gift_card_pos_reservations enable row level security;
alter table public.branch_pos_credentials enable row level security;

drop policy if exists service_role_all_customer_stock_subscriptions
  on public.customer_stock_subscriptions;
create policy service_role_all_customer_stock_subscriptions
  on public.customer_stock_subscriptions for all to service_role
  using (true) with check (true);

drop policy if exists service_role_all_gift_certificate_purchases
  on public.gift_certificate_purchases;
create policy service_role_all_gift_certificate_purchases
  on public.gift_certificate_purchases for all to service_role
  using (true) with check (true);

drop policy if exists service_role_all_pickup_order_handoffs
  on public.pickup_order_handoffs;
create policy service_role_all_pickup_order_handoffs
  on public.pickup_order_handoffs for all to service_role
  using (true) with check (true);

drop policy if exists service_role_all_gift_card_pos_reservations
  on public.gift_card_pos_reservations;
create policy service_role_all_gift_card_pos_reservations
  on public.gift_card_pos_reservations for all to service_role
  using (true) with check (true);

drop policy if exists service_role_all_branch_pos_credentials
  on public.branch_pos_credentials;
create policy service_role_all_branch_pos_credentials
  on public.branch_pos_credentials for all to service_role
  using (true) with check (true);

revoke all on public.customer_stock_subscriptions from public, anon, authenticated;
revoke all on public.gift_certificate_purchases from public, anon, authenticated;
revoke all on public.pickup_order_handoffs from public, anon, authenticated;
revoke all on public.gift_card_pos_reservations from public, anon, authenticated;
revoke all on public.branch_pos_credentials from public, anon, authenticated;
grant all on public.customer_stock_subscriptions to service_role;
grant all on public.gift_certificate_purchases to service_role;
grant all on public.pickup_order_handoffs to service_role;
grant all on public.gift_card_pos_reservations to service_role;
grant all on public.branch_pos_credentials to service_role;
