-- Durable payment creation claims, auditable legal consent, and Forte token
-- key rotation envelopes.

create table if not exists public.payment_creation_claims (
  id uuid primary key default gen_random_uuid(),
  provider varchar(24) not null,
  customer_id uuid not null references public.customers(id) on delete cascade,
  client_request_id uuid not null,
  request_fingerprint char(64) not null,
  amount numeric(12, 2) not null,
  status varchar(24) not null default 'creating',
  provider_operation_id varchar(160),
  order_id uuid references public.kaspi_orders(id) on delete set null,
  order_payload jsonb not null default '{}'::jsonb,
  last_error varchar(1000),
  lease_expires_at timestamptz not null default (now() + interval '2 minutes'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_creation_claims_provider_check
    check (provider in ('kaspi')),
  constraint payment_creation_claims_fingerprint_check
    check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint payment_creation_claims_amount_check
    check (amount > 0 and amount <= 10000000),
  constraint payment_creation_claims_status_check
    check (status in ('creating', 'provider_created', 'unknown', 'completed', 'failed_safe')),
  unique (customer_id, client_request_id)
);

create index if not exists payment_creation_claims_recovery_idx
  on public.payment_creation_claims(provider, status, created_at)
  where order_id is null;

create index if not exists payment_creation_claims_customer_guard_idx
  on public.payment_creation_claims(provider, customer_id, status, updated_at desc)
  where status in ('creating', 'provider_created', 'unknown');

alter table public.payment_creation_claims enable row level security;
drop policy if exists service_role_all_payment_creation_claims
  on public.payment_creation_claims;
create policy service_role_all_payment_creation_claims
  on public.payment_creation_claims for all to service_role
  using (true) with check (true);
revoke all on table public.payment_creation_claims from public, anon, authenticated;
grant all on table public.payment_creation_claims to service_role;

create or replace function public.claim_payment_creation(
  p_provider varchar,
  p_customer_id uuid,
  p_client_request_id uuid,
  p_amount numeric,
  p_request_fingerprint text,
  p_order_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.payment_creation_claims%rowtype;
  v_blocker public.payment_creation_claims%rowtype;
begin
  if p_provider <> 'kaspi'
    or p_customer_id is null
    or p_client_request_id is null
    or p_amount <= 0
    or p_amount > 10000000
    or p_request_fingerprint !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(coalesce(p_order_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid payment creation claim';
  end if;

  -- Serialize all create attempts for one customer/provider, including attempts
  -- that use a fresh client_request_id after an ambiguous provider timeout.
  perform pg_advisory_xact_lock(
    hashtextextended(p_provider || ':' || p_customer_id::text, 0)
  );

  select *
  into v_claim
  from public.payment_creation_claims
  where customer_id = p_customer_id
    and client_request_id = p_client_request_id
  for update;

  if v_claim.id is not null then
    if v_claim.request_fingerprint <> p_request_fingerprint
      or v_claim.provider <> p_provider
      or v_claim.amount <> p_amount then
      return jsonb_build_object('id', v_claim.id, 'status', 'fingerprint_mismatch');
    end if;

    if v_claim.status = 'creating' and v_claim.lease_expires_at <= now() then
      update public.payment_creation_claims
      set
        status = 'unknown',
        last_error = coalesce(last_error, 'Creation lease expired before provider result was saved'),
        updated_at = now()
      where id = v_claim.id
      returning * into v_claim;
    end if;

    if v_claim.status <> 'failed_safe' then
      return jsonb_build_object(
        'id', v_claim.id,
        'status', v_claim.status,
        'orderId', v_claim.order_id,
        'providerOperationId', v_claim.provider_operation_id
      );
    end if;
  end if;

  -- A timed-out create is ambiguous: the bank may have created a payable
  -- invoice even though no response reached us. Keep that guard for 24 hours,
  -- while known provider-created operations remain blocked until reconciliation
  -- attaches an order or an operator confirms cancellation (failed_safe).
  update public.payment_creation_claims
  set
    status = 'unknown',
    last_error = coalesce(last_error, 'Creation lease expired before provider result was saved'),
    updated_at = now()
  where provider = p_provider
    and customer_id = p_customer_id
    and status = 'creating'
    and lease_expires_at <= now()
    and (v_claim.id is null or id <> v_claim.id);

  select *
  into v_blocker
  from public.payment_creation_claims
  where provider = p_provider
    and customer_id = p_customer_id
    and (v_claim.id is null or id <> v_claim.id)
    and (
      (status = 'creating' and lease_expires_at > now())
      or (status = 'provider_created' and order_id is null)
      or (
        status = 'unknown'
        and (
          provider_operation_id is not null
          or updated_at >= now() - interval '24 hours'
        )
      )
    )
  order by
    case status when 'provider_created' then 0 when 'unknown' then 1 else 2 end,
    updated_at desc
  limit 1;

  if v_blocker.id is not null then
    return jsonb_build_object(
      'id', v_blocker.id,
      'status', 'customer_active_unknown',
      'blockingStatus', v_blocker.status,
      'blockingRequestId', v_blocker.client_request_id,
      'providerOperationId', v_blocker.provider_operation_id
    );
  end if;

  if v_claim.id is not null then
    update public.payment_creation_claims
    set
      status = 'creating',
      order_payload = p_order_payload,
      provider_operation_id = null,
      order_id = null,
      last_error = null,
      completed_at = null,
      lease_expires_at = now() + interval '2 minutes',
      updated_at = now()
    where id = v_claim.id
    returning * into v_claim;
    return jsonb_build_object('id', v_claim.id, 'status', 'claimed');
  end if;

  insert into public.payment_creation_claims (
    provider,
    customer_id,
    client_request_id,
    request_fingerprint,
    amount,
    order_payload
  )
  values (
    p_provider,
    p_customer_id,
    p_client_request_id,
    p_request_fingerprint,
    p_amount,
    p_order_payload
  )
  returning * into v_claim;
  return jsonb_build_object('id', v_claim.id, 'status', 'claimed');
end;
$$;

revoke all on function public.claim_payment_creation(varchar, uuid, uuid, numeric, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_payment_creation(varchar, uuid, uuid, numeric, text, jsonb)
  to service_role;

create table if not exists public.customer_legal_consents (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  offer_version varchar(32) not null,
  offer_sha256 char(64) not null,
  privacy_version varchar(32) not null,
  privacy_sha256 char(64) not null,
  locale varchar(8) not null,
  channel varchar(24) not null,
  client_accepted_at timestamptz,
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint customer_legal_consents_hash_check
    check (
      offer_sha256 ~ '^[a-f0-9]{64}$'
      and privacy_sha256 ~ '^[a-f0-9]{64}$'
    ),
  constraint customer_legal_consents_locale_check
    check (locale in ('ru', 'kk', 'en')),
  constraint customer_legal_consents_channel_check
    check (channel in ('web', 'android', 'ios', 'mobile_app', 'mobile_api'))
);

create index if not exists customer_legal_consents_version_idx
  on public.customer_legal_consents(
    customer_id,
    offer_version,
    offer_sha256,
    privacy_version,
    privacy_sha256
  );

alter table public.customer_legal_consents enable row level security;
drop policy if exists service_role_all_customer_legal_consents
  on public.customer_legal_consents;
create policy service_role_all_customer_legal_consents
  on public.customer_legal_consents for all to service_role
  using (true) with check (true);
revoke all on table public.customer_legal_consents from public, anon, authenticated;
grant all on table public.customer_legal_consents to service_role;

create or replace function public.record_customer_legal_consent(
  p_customer_id uuid,
  p_offer_version varchar,
  p_offer_sha256 text,
  p_privacy_version varchar,
  p_privacy_sha256 text,
  p_locale varchar,
  p_channel varchar,
  p_client_accepted_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_customer_id is null
    or p_offer_version is null
    or p_privacy_version is null
    or p_offer_sha256 !~ '^[a-f0-9]{64}$'
    or p_privacy_sha256 !~ '^[a-f0-9]{64}$'
    or p_locale not in ('ru', 'kk', 'en')
    or p_channel not in ('web', 'android', 'ios', 'mobile_app', 'mobile_api')
    or (
      p_client_accepted_at is not null
      and (
        p_client_accepted_at > now() + interval '5 minutes'
        or p_client_accepted_at < now() - interval '24 hours'
      )
    ) then
    raise exception 'invalid legal consent';
  end if;

  insert into public.customer_legal_consents (
    customer_id,
    offer_version,
    offer_sha256,
    privacy_version,
    privacy_sha256,
    locale,
    channel,
    client_accepted_at
  )
  values (
    p_customer_id,
    p_offer_version,
    p_offer_sha256,
    p_privacy_version,
    p_privacy_sha256,
    p_locale,
    p_channel,
    p_client_accepted_at
  )
  returning id into v_id;

  update public.customers
  set privacy_consent_at = now()
  where id = p_customer_id;

  return v_id;
end;
$$;

revoke all on function public.record_customer_legal_consent(
  uuid, varchar, text, varchar, text, varchar, varchar, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_customer_legal_consent(
  uuid, varchar, text, varchar, text, varchar, varchar, timestamptz
) to service_role;

alter table public.kaspi_orders
  drop constraint if exists kaspi_orders_provider_checkout_token_ciphertext_check;
alter table public.kaspi_orders
  add constraint kaspi_orders_provider_checkout_token_ciphertext_check
  check (
    provider_checkout_token_ciphertext is null
    or (
      char_length(provider_checkout_token_ciphertext) between 40 and 2000
      and (
        provider_checkout_token_ciphertext like 'v1.%'
        or provider_checkout_token_ciphertext like 'v2.%'
      )
    )
  );

alter table public.customer_payment_methods
  drop constraint if exists customer_payment_methods_token_ciphertext_check;
alter table public.customer_payment_methods
  add constraint customer_payment_methods_token_ciphertext_check
  check (
    (
      status = 'active'
      and token_ciphertext is not null
      and char_length(token_ciphertext) between 40 and 2000
      and (token_ciphertext like 'v1.%' or token_ciphertext like 'v2.%')
    )
    or (status <> 'active' and token_ciphertext is null)
  );

alter table public.customer_payment_method_setups
  drop constraint if exists customer_payment_method_setups_token_check;
alter table public.customer_payment_method_setups
  add constraint customer_payment_method_setups_token_check
  check (
    (
      status = 'pending'
      and char_length(checkout_token_ciphertext) between 40 and 2000
      and (
        checkout_token_ciphertext like 'v1.%'
        or checkout_token_ciphertext like 'v2.%'
      )
    )
    or (status <> 'pending' and checkout_token_ciphertext is null)
  );

-- An ambiguous partial refund must remain a first-class financial operation.
-- Older code marked the refund row as failed while the order became unknown,
-- which made the operation impossible to reconcile automatically.
alter table public.order_partial_refunds
  add column if not exists provider_reference varchar(160),
  add column if not exists provider_request_id uuid,
  add column if not exists reconciliation_attempts integer not null default 0,
  add column if not exists last_reconciled_at timestamptz,
  add column if not exists next_reconcile_at timestamptz,
  add column if not exists adjustments_applied_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.order_partial_refunds
  drop constraint if exists order_partial_refunds_status_check;
alter table public.order_partial_refunds
  add constraint order_partial_refunds_status_check
  check (status in ('pending', 'processing', 'unknown', 'succeeded', 'failed'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_partial_refunds_reconciliation_attempts_check'
      and conrelid = 'public.order_partial_refunds'::regclass
  ) then
    alter table public.order_partial_refunds
      add constraint order_partial_refunds_reconciliation_attempts_check
      check (reconciliation_attempts >= 0);
  end if;
end
$$;

update public.order_partial_refunds
set provider_reference = kaspi_reference
where provider_reference is null
  and kaspi_reference is not null;

-- Repair rows produced by the former fail_partial_refund(..., true) path.
update public.order_partial_refunds refunds
set
  status = 'unknown',
  provider_request_id = coalesce(refunds.provider_request_id, refunds.id),
  next_reconcile_at = coalesce(refunds.next_reconcile_at, now()),
  completed_at = null,
  updated_at = now()
from public.kaspi_orders orders
where orders.id = refunds.order_id
  and orders.refund_status = 'unknown'
  and refunds.status = 'failed'
  and refunds.id = (
    select candidate.id
    from public.order_partial_refunds candidate
    where candidate.order_id = refunds.order_id
      and candidate.status = 'failed'
    order by candidate.created_at desc, candidate.id desc
    limit 1
  );

create index if not exists order_partial_refunds_reconciliation_idx
  on public.order_partial_refunds(status, next_reconcile_at, created_at)
  where status = 'unknown'
    or (status = 'succeeded' and adjustments_applied_at is null);

create or replace function public.mark_partial_refund_unknown(
  p_refund_id uuid,
  p_error text,
  p_provider_reference text default null,
  p_provider_request_id uuid default null
)
returns public.kaspi_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund public.order_partial_refunds%rowtype;
  v_order public.kaspi_orders%rowtype;
  v_reference varchar(160);
begin
  select * into v_refund
  from public.order_partial_refunds
  where id = p_refund_id
  for update;
  if v_refund.id is null then raise exception 'refund not found'; end if;

  select * into v_order
  from public.kaspi_orders
  where id = v_refund.order_id
  for update;
  if v_order.id is null then raise exception 'order not found'; end if;

  if v_refund.status = 'succeeded' then return v_order; end if;
  if v_refund.status not in ('processing', 'unknown') then
    raise exception 'refund state conflict';
  end if;

  v_reference := left(
    coalesce(
      nullif(btrim(p_provider_reference), ''),
      v_refund.provider_reference,
      v_refund.kaspi_reference
    ),
    160
  );

  update public.order_partial_refunds
  set
    status = 'unknown',
    provider_reference = v_reference,
    kaspi_reference = coalesce(kaspi_reference, v_reference),
    provider_request_id = coalesce(
      p_provider_request_id,
      provider_request_id,
      v_refund.id
    ),
    error = left(
      coalesce(nullif(btrim(p_error), ''), 'Refund result requires reconciliation'),
      1000
    ),
    completed_at = null,
    next_reconcile_at = now(),
    updated_at = now()
  where id = v_refund.id;

  update public.kaspi_orders
  set
    refund_status = 'unknown',
    refund_reference = coalesce(v_reference, refund_reference),
    refund_error = left(
      coalesce(nullif(btrim(p_error), ''), 'Refund result requires reconciliation'),
      1000
    ),
    last_error = 'Результат частичного возврата проверяется автоматически',
    updated_at = now()
  where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.mark_partial_refund_unknown(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.mark_partial_refund_unknown(uuid, text, text, uuid)
  to service_role;

create or replace function public.decline_partial_refund(
  p_refund_id uuid,
  p_error text
)
returns public.kaspi_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund public.order_partial_refunds%rowtype;
  v_order public.kaspi_orders%rowtype;
  v_succeeded numeric(12,2) := 0;
begin
  select * into v_refund
  from public.order_partial_refunds
  where id = p_refund_id
  for update;
  if v_refund.id is null then raise exception 'refund not found'; end if;

  select * into v_order
  from public.kaspi_orders
  where id = v_refund.order_id
  for update;
  if v_order.id is null then raise exception 'order not found'; end if;

  if v_refund.status = 'succeeded' then return v_order; end if;
  if v_refund.status not in ('processing', 'unknown', 'failed') then
    raise exception 'refund state conflict';
  end if;

  update public.order_partial_refunds
  set
    status = 'failed',
    error = left(
      coalesce(nullif(btrim(p_error), ''), 'Provider declined the refund'),
      1000
    ),
    completed_at = coalesce(completed_at, now()),
    last_reconciled_at = now(),
    next_reconcile_at = null,
    updated_at = now()
  where id = v_refund.id;

  select coalesce(sum(amount), 0) into v_succeeded
  from public.order_partial_refunds
  where order_id = v_order.id
    and status = 'succeeded';

  update public.kaspi_orders
  set
    refund_status = case when v_succeeded > 0 then 'partial' else 'failed' end,
    refund_error = left(
      coalesce(nullif(btrim(p_error), ''), 'Provider declined the refund'),
      1000
    ),
    last_error = null,
    updated_at = now()
  where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.decline_partial_refund(uuid, text)
  from public, anon, authenticated;
grant execute on function public.decline_partial_refund(uuid, text)
  to service_role;

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
  v_refund public.order_partial_refunds%rowtype;
  v_order public.kaspi_orders%rowtype;
  v_next_refunded numeric(12,2);
  v_reference varchar(160);
begin
  select * into v_refund
  from public.order_partial_refunds
  where id = p_refund_id
  for update;
  if v_refund.id is null then raise exception 'refund not found'; end if;

  select * into v_order
  from public.kaspi_orders
  where id = v_refund.order_id
  for update;
  if v_order.id is null then raise exception 'order not found'; end if;

  if v_refund.status = 'succeeded' then return v_order; end if;
  if v_refund.status not in ('processing', 'unknown') then
    raise exception 'refund state conflict';
  end if;
  if coalesce(v_order.refund_status, '') not in ('processing', 'unknown') then
    raise exception 'order refund state conflict';
  end if;

  v_next_refunded := coalesce(v_order.partially_refunded_amount, 0) + v_refund.amount;
  if v_next_refunded > v_order.amount then raise exception 'refund exceeds order amount'; end if;
  v_reference := left(
    coalesce(
      nullif(btrim(p_kaspi_reference), ''),
      v_refund.provider_reference,
      v_refund.kaspi_reference
    ),
    160
  );

  update public.order_partial_refunds
  set
    status = 'succeeded',
    kaspi_reference = v_reference,
    provider_reference = v_reference,
    error = null,
    completed_at = now(),
    last_reconciled_at = case when v_refund.status = 'unknown' then now() else last_reconciled_at end,
    next_reconcile_at = null,
    updated_at = now()
  where id = v_refund.id;

  update public.kaspi_orders
  set
    partially_refunded_amount = v_next_refunded,
    refund_amount = v_next_refunded,
    refund_status = case when v_next_refunded >= amount then 'succeeded' else 'partial' end,
    refund_reference = coalesce(v_reference, refund_reference),
    refunded_at = case when v_next_refunded >= amount then now() else refunded_at end,
    status = case when v_next_refunded >= amount then 'refunded' else status end,
    fulfillment_status = case when v_next_refunded >= amount then 'cancelled' else fulfillment_status end,
    kitchen_status = case when v_next_refunded >= amount then 'cancelled' else kitchen_status end,
    refund_error = null,
    last_error = null,
    updated_at = now()
  where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.complete_partial_refund(uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_partial_refund(uuid, text)
  to service_role;
