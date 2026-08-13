-- Expand the existing Yandex delivery job ledger for the employee-centric
-- Yandex Go for Business API while keeping Cargo v2 rows backward compatible.

alter table public.delivery_jobs
  add column if not exists api_family varchar(32) not null default 'cargo_v2',
  add column if not exists external_offer_id text,
  add column if not exists quoted_at timestamptz,
  add column if not exists authorized_max_price numeric(12, 2),
  add column if not exists quote_fingerprint char(64),
  add column if not exists external_client_id text,
  add column if not exists external_user_id text,
  add column if not exists provider_message text,
  add column if not exists request_payload_ciphertext text,
  add column if not exists projection_guarded boolean not null default false,
  add column if not exists reconciliation_attempts smallint not null default 0,
  add column if not exists reconciliation_next_at timestamptz;

-- Business order identifiers are documented as opaque strings and the API
-- contract permits up to 160 characters. The legacy Cargo column was varchar(128).
alter table public.delivery_jobs
  alter column external_claim_id type text;

-- Business API creation requires an explicit fresh-price confirmation, so a
-- kitchen acceptance can intentionally pause the automatic dispatcher.
-- migration-safety: allow-destructive reason=replace courier dispatch status check to add awaiting_confirmation without dropping data
alter table public.kaspi_orders
  drop constraint if exists kaspi_orders_courier_dispatch_status_check;
alter table public.kaspi_orders
  add constraint kaspi_orders_courier_dispatch_status_check
  check (
    courier_dispatch_status is null
    or courier_dispatch_status in (
      'pending', 'processing', 'retrying', 'awaiting_confirmation', 'succeeded', 'failed'
    )
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.delivery_jobs'::regclass
      and conname = 'delivery_jobs_api_family_check'
  ) then
    alter table public.delivery_jobs
      add constraint delivery_jobs_api_family_check
      check (api_family in ('cargo_v2', 'business_v2'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.delivery_jobs'::regclass
      and conname = 'delivery_jobs_authorized_max_price_check'
  ) then
    alter table public.delivery_jobs
      add constraint delivery_jobs_authorized_max_price_check
      check (authorized_max_price is null or authorized_max_price >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.delivery_jobs'::regclass
      and conname = 'delivery_jobs_quote_fingerprint_check'
  ) then
    alter table public.delivery_jobs
      add constraint delivery_jobs_quote_fingerprint_check
      check (quote_fingerprint is null or quote_fingerprint ~ '^[a-f0-9]{64}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.delivery_jobs'::regclass
      and conname = 'delivery_jobs_reconciliation_attempts_check'
  ) then
    alter table public.delivery_jobs
      add constraint delivery_jobs_reconciliation_attempts_check
      check (reconciliation_attempts between 0 and 8);
  end if;
end
$$;

-- Existing rows must be safe before the new guards start enforcing future
-- writes. Abort the deployment instead of silently preserving a dual courier,
-- a refund race, or an uncreated job attached to a non-free order.
do $$
begin
  if exists (
    select 1
    from public.delivery_jobs job
    inner join public.kaspi_orders orders on orders.id = job.order_id
    where job.provider = 'yandex'
      and (
        (job.api_family = 'cargo_v2' and job.provider_status not in (
          'estimating_failed', 'performer_not_found', 'delivered', 'delivered_finish',
          'returned', 'returned_finish', 'failed', 'cancelled', 'cancelled_with_payment',
          'cancelled_by_taxi', 'cancelled_with_items_on_hands'
        ))
        or
        (job.api_family = 'business_v2' and job.provider_status not in (
          'complete', 'finished', 'cancelled', 'failed'
        ))
      )
      and (
        orders.courier_id is not null
        or coalesce(orders.refund_status, '') in ('processing', 'unknown', 'succeeded')
        or coalesce(orders.fulfillment_status, '') in ('cancelled', 'completed')
        or coalesce(orders.delivery_status, 'unassigned') in ('delivered', 'cancelled')
        or (
          job.external_claim_id is null
          and coalesce(orders.delivery_status, 'unassigned') <> 'unassigned'
        )
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'DELIVERY_EXISTING_RESERVATION_CONFLICT';
  end if;
end
$$;

-- Both API families share the same order-level exclusion so switching the
-- configured adapter cannot accidentally dispatch two active couriers.
drop index if exists public.delivery_jobs_one_active_per_order_idx;
create unique index delivery_jobs_one_active_per_order_idx
  on public.delivery_jobs(order_id, provider)
  where (
    api_family = 'cargo_v2'
    and provider_status not in (
      'estimating_failed', 'performer_not_found', 'delivered', 'delivered_finish',
      'returned', 'returned_finish', 'failed', 'cancelled', 'cancelled_with_payment',
      'cancelled_by_taxi', 'cancelled_with_items_on_hands'
    )
  ) or (
    api_family = 'business_v2'
    and provider_status not in ('complete', 'finished', 'cancelled', 'failed')
  );

drop index if exists public.delivery_jobs_sync_queue_idx;
create index delivery_jobs_sync_queue_idx
  on public.delivery_jobs(provider, last_synced_at, created_at)
  where external_claim_id is not null
    and (
      (
        api_family = 'cargo_v2'
        and provider_status not in (
          'estimating_failed', 'performer_not_found', 'delivered', 'delivered_finish',
          'returned', 'returned_finish', 'failed', 'cancelled', 'cancelled_with_payment',
          'cancelled_by_taxi', 'cancelled_with_items_on_hands'
        )
      ) or (
        api_family = 'business_v2'
        and provider_status not in ('complete', 'finished', 'cancelled', 'failed')
      )
    );

comment on column public.delivery_jobs.api_family is
  'Yandex API contract used for this immutable job: cargo_v2 or business_v2.';
comment on column public.delivery_jobs.request_payload is
  'Sanitized delivery metadata only; retryable create payloads and credentials must not be stored here.';
comment on column public.delivery_jobs.request_payload_ciphertext is
  'Authenticated ciphertext for an idempotent Business API create retry; never plaintext or an API token.';

-- Serialize the internal-courier and external-provider reservations on the
-- same order. The row checks alone are insufficient because delivery_jobs and
-- kaspi_orders are separate tables and two operators can otherwise win both
-- updates concurrently.
create or replace function public.guard_delivery_job_provider_reservation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.kaspi_orders%rowtype;
  v_is_active boolean;
  v_was_active boolean := false;
begin
  v_is_active := new.provider = 'yandex' and (
    (
      new.api_family = 'cargo_v2'
      and new.provider_status not in (
        'estimating_failed', 'performer_not_found', 'delivered', 'delivered_finish',
        'returned', 'returned_finish', 'failed', 'cancelled', 'cancelled_with_payment',
        'cancelled_by_taxi', 'cancelled_with_items_on_hands'
      )
    )
    or (
      new.api_family = 'business_v2'
      and new.provider_status not in ('complete', 'finished', 'cancelled', 'failed')
    )
  );

  if not v_is_active then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_was_active := old.provider = 'yandex' and (
      (
        old.api_family = 'cargo_v2'
        and old.provider_status not in (
          'estimating_failed', 'performer_not_found', 'delivered', 'delivered_finish',
          'returned', 'returned_finish', 'failed', 'cancelled', 'cancelled_with_payment',
          'cancelled_by_taxi', 'cancelled_with_items_on_hands'
        )
      )
      or (
        old.api_family = 'business_v2'
        and old.provider_status not in ('complete', 'finished', 'cancelled', 'failed')
      )
    );

    -- An already-active job owns the reservation for this order. Only a new
    -- reservation (including a terminal-to-active transition) must re-check it.
    -- Do not acquire the cross-table advisory lock here: an active job UPDATE
    -- already holds the job tuple, while an order UPDATE already holds the
    -- order tuple. Taking the lock from both directions would create a cycle.
    if v_was_active and old.order_id = new.order_id then
      return new;
    end if;
  end if;

  -- The UPDATE statement assigning an internal courier already owns this row
  -- before its trigger runs. Take the order row first here too, then the shared
  -- advisory lock, so the two reservation paths cannot deadlock by reversing
  -- their lock order.
  select * into v_order
  from public.kaspi_orders
  where id = new.order_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'DELIVERY_ORDER_NOT_FOUND';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('delivery-provider:' || new.order_id::text, 0)
  );

  -- Older application versions could persist the provider's terminal
  -- failed/cancelled status before recording that the courier already held the
  -- items. Permit only that same immutable Business job to become the synthetic
  -- unresolved state; the partial unique index still rejects a second active job.
  if tg_op = 'UPDATE'
     and old.id = new.id
     and old.order_id = new.order_id
     and old.provider = 'yandex'
     and new.provider = 'yandex'
     and old.api_family = 'business_v2'
     and new.api_family = 'business_v2'
     and old.provider_status in ('failed', 'cancelled')
     and new.provider_status = 'cancelled_items_unresolved'
     and old.external_claim_id is not null
     and new.external_claim_id = old.external_claim_id
     and v_order.courier_id is null
     and coalesce(v_order.delivery_status, 'unassigned') in ('assigned', 'picked_up', 'en_route')
     and coalesce(v_order.refund_status, '') not in ('processing', 'unknown', 'succeeded')
     and coalesce(v_order.fulfillment_status, '') not in ('cancelled', 'completed') then
    return new;
  end if;

  if v_order.courier_id is not null
     or coalesce(v_order.delivery_status, 'unassigned') <> 'unassigned'
     or coalesce(v_order.refund_status, '') in ('processing', 'unknown', 'succeeded')
     or coalesce(v_order.fulfillment_status, '') in ('cancelled', 'completed') then
    raise exception using errcode = 'P0001', message = 'DELIVERY_PROVIDER_RESERVATION_CONFLICT';
  end if;
  return new;
end
$$;

create or replace function public.guard_internal_courier_provider_reservation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_assigns_courier boolean;
  v_closes_order boolean;
  v_changes_delivery_status boolean;
  v_active_internal_status text;
  v_projection_guarded boolean := false;
  v_has_active_job boolean := false;
begin
  v_assigns_courier := new.courier_id is not null
    and new.courier_id is distinct from old.courier_id;
  v_closes_order := (
    new.refund_status is distinct from old.refund_status
    and coalesce(new.refund_status, '') in ('processing', 'unknown', 'succeeded')
  ) or (
    new.fulfillment_status is distinct from old.fulfillment_status
    -- Provider delivery completion is deliberately projected onto the order
    -- before the job ledger becomes terminal. The application separately
    -- requires delivery_status = 'delivered' for a completed transition.
    and coalesce(new.fulfillment_status, '') = 'cancelled'
  );
  v_changes_delivery_status := new.delivery_status is distinct from old.delivery_status;

  if not v_assigns_courier and not v_closes_order and not v_changes_delivery_status then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('delivery-provider:' || new.id::text, 0)
  );
  select j.internal_status, j.projection_guarded
  into v_active_internal_status, v_projection_guarded
    from public.delivery_jobs j
    where j.order_id = new.id
      and j.provider = 'yandex'
      and (
        (j.api_family = 'cargo_v2' and j.provider_status not in (
          'estimating_failed', 'performer_not_found', 'delivered', 'delivered_finish',
          'returned', 'returned_finish', 'failed', 'cancelled', 'cancelled_with_payment',
          'cancelled_by_taxi', 'cancelled_with_items_on_hands'
        ))
        or
        (j.api_family = 'business_v2' and j.provider_status not in (
          'complete', 'finished', 'cancelled', 'failed'
        ))
      )
    order by j.created_at desc, j.id desc
    limit 1;
  v_has_active_job := found;

  if v_has_active_job then
    if v_assigns_courier then
      raise exception using errcode = 'P0001', message = 'DELIVERY_PROVIDER_RESERVATION_CONFLICT';
    end if;
    if v_closes_order then
      raise exception using errcode = 'P0001', message = 'DELIVERY_ACTIVE_JOB_CONFLICT';
    end if;
    if v_projection_guarded and v_changes_delivery_status
       and coalesce(new.delivery_status, 'unassigned') <> (
         case coalesce(v_active_internal_status, '')
           when 'unassigned' then 'unassigned'
           when 'assigned' then 'assigned'
           when 'picked_up' then 'picked_up'
           when 'en_route' then 'en_route'
           when 'delivered' then 'delivered'
           -- A provider cancellation releases the external projection back
           -- to the neutral order state.
           when 'cancelled' then 'unassigned'
           else '__delivery_projection_blocked__'
         end
       ) then
      raise exception using errcode = 'P0001', message = 'DELIVERY_ACTIVE_JOB_CONFLICT';
    end if;
  end if;
  return new;
end
$$;

create or replace function public.project_yandex_delivery_status(
  p_job_id uuid,
  p_expected_provider_status text,
  p_internal_status text
)
returns public.delivery_jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.delivery_jobs%rowtype;
  v_order_id uuid;
  v_order_status text;
begin
  if p_internal_status not in (
    'unassigned', 'assigned', 'picked_up', 'en_route', 'delivered', 'cancelled'
  ) then
    raise exception using errcode = '22023', message = 'DELIVERY_PROJECTION_STATUS_INVALID';
  end if;

  -- Read the immutable order reference, then take the order row before the job
  -- tuple. This is the same lock order used by reservation and courier writes.
  select order_id into v_order_id
  from public.delivery_jobs
  where id = p_job_id
    and provider = 'yandex';

  if not found then
    raise exception using errcode = 'P0001', message = 'DELIVERY_PROJECTION_JOB_CONFLICT';
  end if;

  perform 1
  from public.kaspi_orders
  where id = v_order_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DELIVERY_PROJECTION_ORDER_CONFLICT';
  end if;

  select * into v_job
  from public.delivery_jobs
  where id = p_job_id
    and order_id = v_order_id
    and provider = 'yandex'
    and provider_status = p_expected_provider_status
    and (
      (api_family = 'cargo_v2' and provider_status not in (
        'estimating_failed', 'performer_not_found', 'delivered', 'delivered_finish',
        'returned', 'returned_finish', 'failed', 'cancelled', 'cancelled_with_payment',
        'cancelled_by_taxi', 'cancelled_with_items_on_hands'
      ))
      or
      (api_family = 'business_v2' and provider_status not in (
        'complete', 'finished', 'cancelled', 'failed'
      ))
    )
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DELIVERY_PROJECTION_JOB_CONFLICT';
  end if;

  update public.delivery_jobs
  set internal_status = p_internal_status,
      projection_guarded = true
  where id = v_job.id
  returning * into v_job;

  v_order_status := case p_internal_status
    when 'cancelled' then 'unassigned'
    else p_internal_status
  end;

  update public.kaspi_orders
  set delivery_status = v_order_status
  where id = v_order_id
    and courier_id is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'DELIVERY_PROJECTION_ORDER_CONFLICT';
  end if;

  return v_job;
end
$$;

drop trigger if exists guard_delivery_job_provider_reservation on public.delivery_jobs;
create trigger guard_delivery_job_provider_reservation
before insert or update of order_id, provider, api_family, provider_status, internal_status on public.delivery_jobs
for each row execute function public.guard_delivery_job_provider_reservation();

drop trigger if exists guard_internal_courier_provider_reservation on public.kaspi_orders;
create trigger guard_internal_courier_provider_reservation
before update of courier_id, refund_status, fulfillment_status, delivery_status on public.kaspi_orders
for each row execute function public.guard_internal_courier_provider_reservation();

revoke all on function public.guard_delivery_job_provider_reservation() from public, anon, authenticated;
revoke all on function public.guard_internal_courier_provider_reservation() from public, anon, authenticated;
revoke all on function public.project_yandex_delivery_status(uuid,text,text) from public, anon, authenticated;
grant execute on function public.project_yandex_delivery_status(uuid,text,text) to service_role;

-- Reuse the staff-order alert outbox for financial and item-custody incidents.
-- Only a small, typed operational object is stored; customer delivery data is
-- deliberately excluded from this queue and its webhook contract.
alter table public.staff_order_alerts
  add column if not exists details jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.staff_order_alerts'::regclass
      and conname = 'staff_order_alerts_details_check'
  ) then
    alter table public.staff_order_alerts
      add constraint staff_order_alerts_details_check
      check (
        jsonb_typeof(details) = 'object'
        and pg_catalog.octet_length(details::text) <= 2048
        and (
          (
            alert_type not in (
              'yandex_price_overrun', 'yandex_items_unresolved', 'yandex_create_uncertain'
            )
            and details = '{}'::jsonb
          )
          or (
            alert_type = 'yandex_price_overrun'
            and details ?& array[
              'deliveryJobId', 'actualPriceKzt', 'authorizedMaxPriceKzt', 'currency'
            ]
            and details - array[
              'deliveryJobId', 'actualPriceKzt', 'authorizedMaxPriceKzt', 'currency'
            ]::text[] = '{}'::jsonb
            and details ->> 'deliveryJobId'
              ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            and jsonb_typeof(details -> 'actualPriceKzt') = 'number'
            and jsonb_typeof(details -> 'authorizedMaxPriceKzt') = 'number'
            and details ->> 'currency' = 'KZT'
          )
          or (
            alert_type = 'yandex_items_unresolved'
            and details ?& array['deliveryJobId', 'providerReportedStatus']
            and details - array[
              'deliveryJobId', 'providerReportedStatus'
            ]::text[] = '{}'::jsonb
            and details ->> 'deliveryJobId'
              ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            and details ->> 'providerReportedStatus' ~ '^[a-z0-9_]{1,80}$'
          )
          or (
            alert_type = 'yandex_create_uncertain'
            and details ?& array['deliveryJobId', 'attemptCount']
            and details - array[
              'deliveryJobId', 'attemptCount'
            ]::text[] = '{}'::jsonb
            and details ->> 'deliveryJobId'
              ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            and jsonb_typeof(details -> 'attemptCount') = 'number'
            and (details ->> 'attemptCount')::integer between 1 and 8
          )
        )
      );
  end if;
end
$$;

-- migration-safety: allow-destructive reason=replace staff alert type check to add bounded Yandex operational incidents without deleting rows
alter table public.staff_order_alerts
  drop constraint if exists staff_order_alerts_alert_type_check;
alter table public.staff_order_alerts
  add constraint staff_order_alerts_alert_type_check
  check (alert_type in (
    'no_active_ipad', 'delivery_failed', 'delivery_uncertain', 'order_unaccepted',
    'yandex_price_overrun', 'yandex_items_unresolved', 'yandex_create_uncertain'
  ));

create or replace function public.enqueue_yandex_business_staff_alert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_branch_id uuid;
  v_order_number bigint;
  v_reported_status text;
  v_overrun_amount numeric;
begin
  if new.provider <> 'yandex' or new.api_family <> 'business_v2' then
    return new;
  end if;

  select orders.branch_id, orders.order_number
  into v_branch_id, v_order_number
  from public.kaspi_orders orders
  where orders.id = new.order_id;

  -- Historical orders without a branch cannot be represented by the existing
  -- staff alert contract. Fail closed on dispatch elsewhere, but do not make a
  -- provider status update fail after it has already happened externally.
  if v_branch_id is null or v_order_number is null then
    return new;
  end if;

  if new.raw_response -> 'priceOverrun' = 'true'::jsonb
     and new.currency = 'KZT'
     and new.authorized_max_price is not null
     and new.authorized_max_price between 0 and 9999999999.99
     and pg_catalog.jsonb_typeof(new.raw_response -> 'priceOverrunAmount') = 'number' then
    v_overrun_amount := (new.raw_response ->> 'priceOverrunAmount')::numeric;
  end if;

  if v_overrun_amount between 0 and 9999999999.99
     and v_overrun_amount > new.authorized_max_price then
    insert into public.staff_order_alerts(
      order_id, branch_id, order_number, alert_type, dedupe_key, event_at, details
    ) values (
      new.order_id,
      v_branch_id,
      v_order_number,
      'yandex_price_overrun',
      'yandex-price-overrun:' || new.id::text || ':' ||
        pg_catalog.md5(
          pg_catalog.trim_scale(v_overrun_amount)::text || ':' ||
          pg_catalog.trim_scale(new.authorized_max_price)::text
        ),
      now(),
      pg_catalog.jsonb_build_object(
        'deliveryJobId', new.id,
        'actualPriceKzt', v_overrun_amount,
        'authorizedMaxPriceKzt', new.authorized_max_price,
        'currency', 'KZT'
      )
    )
    on conflict (dedupe_key) do nothing;
  end if;

  if new.provider_status = 'cancelled_items_unresolved' then
    v_reported_status := new.raw_response ->> 'providerReportedStatus';
    if v_reported_status is null or v_reported_status !~ '^[a-z0-9_]{1,80}$' then
      v_reported_status := 'unknown';
    end if;
    insert into public.staff_order_alerts(
      order_id, branch_id, order_number, alert_type, dedupe_key, event_at, details
    ) values (
      new.order_id,
      v_branch_id,
      v_order_number,
      'yandex_items_unresolved',
      'yandex-items-unresolved:' || new.id::text,
      now(),
      pg_catalog.jsonb_build_object(
        'deliveryJobId', new.id,
        'providerReportedStatus', v_reported_status
      )
    )
    on conflict (dedupe_key) do nothing;
  end if;

  if new.provider_status = 'creating_exhausted' then
    insert into public.staff_order_alerts(
      order_id, branch_id, order_number, alert_type, dedupe_key, event_at, details
    ) values (
      new.order_id,
      v_branch_id,
      v_order_number,
      'yandex_create_uncertain',
      'yandex-create-uncertain:' || new.id::text,
      now(),
      pg_catalog.jsonb_build_object(
        'deliveryJobId', new.id,
        'attemptCount', new.reconciliation_attempts
      )
    )
    on conflict (dedupe_key) do nothing;
  end if;

  return new;
end
$$;

drop trigger if exists enqueue_yandex_business_staff_alert on public.delivery_jobs;
create trigger enqueue_yandex_business_staff_alert
after insert or update on public.delivery_jobs
for each row execute function public.enqueue_yandex_business_staff_alert();

-- Keep the original RPC signature for a safe rolling deployment, but stop old
-- workers from claiming an alert type their legacy validator cannot understand.
create or replace function public.claim_staff_order_alerts(
  p_limit integer default 50,
  p_sla_seconds integer default 120
)
returns table(
  alert_id uuid, lease_token uuid, order_id uuid, branch_id uuid, order_number bigint,
  alert_type text, event_at timestamptz, attempt_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.staff_order_alerts alert
  set status = 'retry', locked_at = null, lease_token = null,
      next_attempt_at = now(), last_error = 'ALERT_LEASE_EXPIRED', updated_at = now()
  where alert.status = 'processing'
    and alert.locked_at < now() - interval '5 minutes';

  return query
  with candidates as (
    select alert.id
    from public.staff_order_alerts alert
    where alert.alert_type in (
        'no_active_ipad', 'delivery_failed', 'delivery_uncertain', 'order_unaccepted'
      )
      and alert.status in ('queued', 'retry', 'config_pending')
      and (alert.status = 'config_pending' or alert.next_attempt_at <= now())
    order by alert.event_at, alert.created_at
    for update of alert skip locked
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ), claimed as (
    update public.staff_order_alerts alert
    set status = 'processing', attempt_count = alert.attempt_count + 1,
        locked_at = now(), lease_token = gen_random_uuid(),
        last_error = null, updated_at = now()
    from candidates
    where alert.id = candidates.id
    returning alert.*
  )
  select claimed.id, claimed.lease_token, claimed.order_id, claimed.branch_id,
         claimed.order_number, claimed.alert_type::text,
         claimed.event_at, claimed.attempt_count
  from claimed;
end;
$$;

-- The v2 worker independently claims every supported type and includes its
-- sanitized details. It cannot wrap the legacy claim above because doing so
-- would strand Business incidents during a rolling deployment.
create or replace function public.claim_staff_order_alerts_v2(
  p_limit integer default 50,
  p_sla_seconds integer default 120
)
returns table(
  alert_id uuid, lease_token uuid, order_id uuid, branch_id uuid, order_number bigint,
  alert_type text, event_at timestamptz, attempt_count integer, alert_details jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.staff_order_alerts alert
  set status = 'retry', locked_at = null, lease_token = null,
      next_attempt_at = now(), last_error = 'ALERT_LEASE_EXPIRED', updated_at = now()
  where alert.status = 'processing'
    and alert.locked_at < now() - interval '5 minutes';

  return query
  with candidates as (
    select alert.id
    from public.staff_order_alerts alert
    where alert.alert_type in (
        'no_active_ipad', 'delivery_failed', 'delivery_uncertain', 'order_unaccepted',
        'yandex_price_overrun', 'yandex_items_unresolved', 'yandex_create_uncertain'
      )
      and alert.status in ('queued', 'retry', 'config_pending')
      and (alert.status = 'config_pending' or alert.next_attempt_at <= now())
    order by alert.event_at, alert.created_at
    for update of alert skip locked
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ), claimed as (
    update public.staff_order_alerts alert
    set status = 'processing', attempt_count = alert.attempt_count + 1,
        locked_at = now(), lease_token = gen_random_uuid(),
        last_error = null, updated_at = now()
    from candidates
    where alert.id = candidates.id
    returning alert.*
  )
  select claimed.id, claimed.lease_token, claimed.order_id, claimed.branch_id,
         claimed.order_number, claimed.alert_type::text, claimed.event_at,
         claimed.attempt_count, claimed.details
  from claimed;
end;
$$;

create or replace function public.validate_staff_order_alert_claim_v2(
  p_alert_id uuid,
  p_lease_token uuid,
  p_sla_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_alert public.staff_order_alerts%rowtype;
  v_valid boolean := false;
  v_actual numeric;
  v_authorized numeric;
begin
  select * into v_alert
  from public.staff_order_alerts
  where id = p_alert_id and status = 'processing' and lease_token = p_lease_token
  for update;
  if not found then return false; end if;

  if v_alert.alert_type not in (
    'yandex_price_overrun', 'yandex_items_unresolved', 'yandex_create_uncertain'
  ) then
    return public.validate_staff_order_alert_claim(
      p_alert_id, p_lease_token, p_sla_seconds
    );
  end if;

  if v_alert.alert_type = 'yandex_price_overrun'
     and pg_catalog.jsonb_typeof(v_alert.details) = 'object'
     and pg_catalog.jsonb_typeof(v_alert.details -> 'actualPriceKzt') = 'number'
     and pg_catalog.jsonb_typeof(v_alert.details -> 'authorizedMaxPriceKzt') = 'number'
     and v_alert.details ->> 'currency' = 'KZT' then
    begin
      v_actual := (v_alert.details ->> 'actualPriceKzt')::numeric;
      v_authorized := (v_alert.details ->> 'authorizedMaxPriceKzt')::numeric;
      if v_actual >= 0 and v_actual <= 9999999999.99
         and v_authorized >= 0 and v_authorized <= 9999999999.99
         and v_actual > v_authorized then
        v_valid := exists (
          select 1
          from public.delivery_jobs job
          where job.id::text = (v_alert.details ->> 'deliveryJobId')
            and job.order_id = v_alert.order_id
            and job.provider = 'yandex'
            and job.api_family = 'business_v2'
            and job.currency = 'KZT'
            and job.raw_response -> 'priceOverrun' = 'true'::jsonb
            and job.authorized_max_price = v_authorized
            and job.raw_response ->> 'priceOverrunAmount' is not null
            and pg_catalog.jsonb_typeof(
              job.raw_response -> 'priceOverrunAmount'
            ) = 'number'
            and (job.raw_response ->> 'priceOverrunAmount')::numeric = v_actual
        );
      end if;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        v_valid := false;
    end;
  elsif v_alert.alert_type = 'yandex_items_unresolved'
        and (v_alert.details ->> 'providerReportedStatus') ~ '^[a-z0-9_]{1,80}$' then
    v_valid := exists (
      select 1
      from public.delivery_jobs job
      where job.id::text = (v_alert.details ->> 'deliveryJobId')
        and job.order_id = v_alert.order_id
        and job.provider = 'yandex'
        and job.api_family = 'business_v2'
        and job.provider_status in (
          'cancelled_items_unresolved',
          'items_resolution_returned',
          'items_resolution_delivered'
        )
    );
  elsif v_alert.alert_type = 'yandex_create_uncertain'
        and pg_catalog.jsonb_typeof(v_alert.details -> 'attemptCount') = 'number'
        and (v_alert.details ->> 'attemptCount')::integer between 1 and 8 then
    v_valid := exists (
      select 1
      from public.delivery_jobs job
      where job.id::text = (v_alert.details ->> 'deliveryJobId')
        and job.order_id = v_alert.order_id
        and job.provider = 'yandex'
        and job.api_family = 'business_v2'
        and job.provider_status = 'creating_exhausted'
        and job.reconciliation_attempts = (v_alert.details ->> 'attemptCount')::integer
    );
  end if;

  if not v_valid then
    update public.staff_order_alerts
    set status = 'resolved', resolved_at = now(), locked_at = null,
        lease_token = null, last_error = null, updated_at = now()
    where id = v_alert.id and status = 'processing' and lease_token = p_lease_token;
  end if;
  return v_valid;
end
$$;

revoke all on function public.enqueue_yandex_business_staff_alert(),
  public.claim_staff_order_alerts(integer,integer),
  public.claim_staff_order_alerts_v2(integer,integer),
  public.validate_staff_order_alert_claim_v2(uuid,uuid,integer)
from public, anon, authenticated;
grant execute on function public.enqueue_yandex_business_staff_alert(),
  public.claim_staff_order_alerts(integer,integer),
  public.claim_staff_order_alerts_v2(integer,integer),
  public.validate_staff_order_alert_claim_v2(uuid,uuid,integer)
to service_role;
