const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260813100000_yandex_business_api.sql'),
  'utf8',
);
const service = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'yandex-delivery.service.js'),
  'utf8',
);

test('Yandex Business migration expands jobs without storing credentials', () => {
  assert.match(
    migration,
    /add column if not exists api_family varchar\(32\) not null default 'cargo_v2'/i,
  );
  assert.match(migration, /api_family in \('cargo_v2', 'business_v2'\)/i);
  assert.match(migration, /add column if not exists external_offer_id text/i);
  assert.match(migration, /alter column external_claim_id type text/i);
  assert.match(migration, /projection_guarded boolean not null default false/i);
  assert.match(service, /projection_guarded: true/);
  assert.match(migration, /add column if not exists quoted_at timestamptz/i);
  assert.match(migration, /add column if not exists authorized_max_price numeric\(12, 2\)/i);
  assert.match(migration, /authorized_max_price is null or authorized_max_price >= 0/i);
  assert.match(migration, /add column if not exists quote_fingerprint char\(64\)/i);
  assert.match(migration, /quote_fingerprint ~ '\^\[a-f0-9\]\{64\}\$'/i);
  assert.match(migration, /add column if not exists external_client_id text/i);
  assert.match(migration, /add column if not exists external_user_id text/i);
  assert.match(migration, /add column if not exists provider_message text/i);
  assert.match(migration, /add column if not exists request_payload_ciphertext text/i);
  assert.match(
    migration,
    /add column if not exists reconciliation_attempts smallint not null default 0/i,
  );
  assert.match(migration, /add column if not exists reconciliation_next_at timestamptz/i);
  assert.match(migration, /reconciliation_attempts between 0 and 8/i);
  assert.doesNotMatch(migration, /YANDEX_(?:DELIVERY|BUSINESS)_API_TOKEN/);
  assert.doesNotMatch(migration, /authorization\s*:/i);
});

test('Yandex Business migration keeps expired jobs active and syncable', () => {
  for (const indexName of [
    'delivery_jobs_one_active_per_order_idx',
    'delivery_jobs_sync_queue_idx',
  ]) {
    const definition = migration.match(
      new RegExp(`create (?:unique )?index ${indexName}([\\s\\S]*?);`, 'i'),
    )?.[1];
    assert.ok(definition, `${indexName} must be recreated`);
    for (const status of ['complete', 'finished', 'cancelled', 'failed']) {
      assert.match(definition, new RegExp(`'${status}'`, 'i'));
    }
    assert.doesNotMatch(definition, /'expired'/i);
  }
});

test('Yandex active and sync indexes isolate terminal statuses by API family', () => {
  for (const indexName of [
    'delivery_jobs_one_active_per_order_idx',
    'delivery_jobs_sync_queue_idx',
  ]) {
    const definition = migration.match(
      new RegExp(`create (?:unique )?index ${indexName}([\\s\\S]*?);`, 'i'),
    )?.[1];
    assert.ok(definition, `${indexName} must be recreated`);
    assert.match(
      definition,
      /api_family = 'cargo_v2'[\s\S]*?provider_status not in \([\s\S]*?'delivered'[\s\S]*?\)/i,
    );
    assert.match(
      definition,
      /api_family = 'business_v2'[\s\S]*?provider_status not in \('complete', 'finished', 'cancelled', 'failed'\)/i,
    );
  }
});

test('Yandex Business migration leaves delivery job table RLS and grants unchanged', () => {
  assert.doesNotMatch(migration, /row level security/i);
  assert.doesNotMatch(migration, /\b(?:create|drop)\s+policy\b/i);
  assert.doesNotMatch(
    migration,
    /\b(?:grant|revoke)\b[^;]*?\bon\s+(?:table\s+)?public\.delivery_jobs\b/i,
  );
});

test('Yandex reservation guards use one lock order and cover status reactivation', () => {
  const externalGuard = migration.match(
    /create or replace function public\.guard_delivery_job_provider_reservation\(\)([\s\S]*?)\n\$\$;/i,
  )?.[1];
  assert.ok(externalGuard, 'external reservation guard must exist');
  assert.match(externalGuard, /security definer/i);
  assert.match(externalGuard, /set search_path = pg_catalog, public/i);
  const newReservationLocking = externalGuard.match(/select \* into v_order([\s\S]*)/i)?.[1];
  assert.ok(newReservationLocking, 'new reservation locking block must exist');
  assert.ok(
    newReservationLocking.indexOf('for update') <
      newReservationLocking.indexOf('pg_advisory_xact_lock'),
    'new external reservation must lock the order row before the advisory key',
  );
  assert.match(externalGuard, /tg_op = 'UPDATE'/i);
  assert.match(externalGuard, /v_was_active[\s\S]*old\.order_id = new\.order_id/i);
  assert.match(
    migration,
    /before insert or update of order_id, provider, api_family, provider_status, internal_status on public\.delivery_jobs/i,
  );
});

test('Yandex reservation guard narrowly repairs legacy post-handoff Business terminals', () => {
  const externalGuard = migration.match(
    /create or replace function public\.guard_delivery_job_provider_reservation\(\)([\s\S]*?)\n\$\$;/i,
  )?.[1];
  assert.ok(externalGuard, 'external reservation guard must exist');
  assert.match(externalGuard, /old\.id = new\.id/i);
  assert.match(externalGuard, /old\.order_id = new\.order_id/i);
  assert.match(externalGuard, /old\.provider = 'yandex'[\s\S]*?new\.provider = 'yandex'/i);
  assert.match(
    externalGuard,
    /old\.api_family = 'business_v2'[\s\S]*?new\.api_family = 'business_v2'/i,
  );
  assert.match(
    externalGuard,
    /old\.provider_status in \('failed', 'cancelled'\)[\s\S]*?new\.provider_status = 'cancelled_items_unresolved'/i,
  );
  assert.match(
    externalGuard,
    /old\.external_claim_id is not null[\s\S]*?new\.external_claim_id = old\.external_claim_id/i,
  );
  assert.match(externalGuard, /v_order\.courier_id is null/i);
  assert.match(externalGuard, /delivery_status[\s\S]*?in \('assigned', 'picked_up', 'en_route'\)/i);
  assert.match(
    externalGuard,
    /refund_status[\s\S]*?not in \('processing', 'unknown', 'succeeded'\)/i,
  );
  assert.match(externalGuard, /fulfillment_status[\s\S]*?not in \('cancelled', 'completed'\)/i);
});

test('Yandex reservation guards block incompatible order delivery projections and closure', () => {
  const orderGuard = migration.match(
    /create or replace function public\.guard_internal_courier_provider_reservation\(\)([\s\S]*?)\n\$\$;/i,
  )?.[1];
  assert.ok(orderGuard, 'order reservation guard must exist');
  assert.match(orderGuard, /security definer/i);
  assert.match(orderGuard, /set search_path = pg_catalog, public/i);
  assert.match(orderGuard, /new\.courier_id is distinct from old\.courier_id/i);
  assert.match(orderGuard, /new\.delivery_status is distinct from old\.delivery_status/i);
  assert.match(
    orderGuard,
    /select j\.internal_status, j\.projection_guarded[\s\S]*?into v_active_internal_status, v_projection_guarded/i,
  );
  assert.match(orderGuard, /new\.refund_status[\s\S]*?'processing', 'unknown', 'succeeded'/i);
  assert.match(orderGuard, /new\.fulfillment_status[\s\S]*?= 'cancelled'/i);
  assert.doesNotMatch(
    orderGuard,
    /new\.fulfillment_status[\s\S]*?in \('cancelled', 'completed'\)/i,
  );
  assert.match(orderGuard, /api_family = 'cargo_v2'[\s\S]*?'delivered'/i);
  assert.match(
    orderGuard,
    /api_family = 'business_v2'[\s\S]*?'complete', 'finished', 'cancelled', 'failed'/i,
  );
  assert.match(
    migration,
    /before update of courier_id, refund_status, fulfillment_status, delivery_status on public\.kaspi_orders/i,
  );
  assert.match(
    orderGuard,
    /v_active_internal_status[\s\S]*?when 'assigned' then 'assigned'[\s\S]*?when 'picked_up' then 'picked_up'[\s\S]*?when 'en_route' then 'en_route'[\s\S]*?when 'delivered' then 'delivered'[\s\S]*?when 'cancelled' then 'unassigned'/i,
  );
  assert.match(orderGuard, /else '__delivery_projection_blocked__'/i);
  assert.match(orderGuard, /if v_projection_guarded and v_changes_delivery_status/i);
  assert.doesNotMatch(orderGuard, /pg_current_xact_id|xmin/i);
  assert.match(migration, /message = 'DELIVERY_ACTIVE_JOB_CONFLICT'/i);
});

test('provider workers serialize and persist projection intent before terminal order updates', () => {
  const externalGuard = migration.match(
    /create or replace function public\.guard_delivery_job_provider_reservation\(\)([\s\S]*?)\n\$\$;/i,
  )?.[1];
  assert.ok(externalGuard, 'external reservation guard must exist');
  assert.match(
    migration,
    /before insert or update of order_id, provider, api_family, provider_status, internal_status on public\.delivery_jobs/i,
  );
  assert.match(
    externalGuard,
    /v_was_active[\s\S]*?old\.order_id = new\.order_id[\s\S]*?pg_advisory_xact_lock/i,
  );

  const serviceSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'yandex-delivery.service.js'),
    'utf8',
  );
  assert.match(
    serviceSource,
    /businessApi\.isBusinessTerminalStatus\(effectiveProviderStatus\)[\s\S]*?persistOrderProjectionIntent\(job, internalStatus\)[\s\S]*?updateOrderFromJob[\s\S]*?updateJob\(job\.id, updates\)/,
  );
  assert.match(
    serviceSource,
    /const projectionJob = await persistOrderProjectionIntent\(job, internalStatus\)[\s\S]*?updateJob\(job\.id, \{ \.\.\.updates, internal_status: projectionJob\.internal_status \}\)[\s\S]*?markOrderExternalDispatchActive/,
  );
  assert.match(
    migration,
    /create or replace function public\.project_yandex_delivery_status\([\s\S]*?security definer[\s\S]*?provider_status = p_expected_provider_status[\s\S]*?for update[\s\S]*?update public\.delivery_jobs[\s\S]*?update public\.kaspi_orders/i,
  );
  assert.match(
    migration,
    /update public\.delivery_jobs[\s\S]*?projection_guarded = true[\s\S]*?update public\.kaspi_orders/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.project_yandex_delivery_status\(uuid,text,text\) from public, anon, authenticated/i,
  );
  assert.match(
    serviceSource,
    /supabase\.rpc\('project_yandex_delivery_status',[\s\S]*?p_job_id: job\.id[\s\S]*?p_expected_provider_status: job\.provider_status[\s\S]*?p_internal_status: projectedStatus/,
  );
  assert.match(
    serviceSource,
    /job = await persistOrderProjectionIntent\(job, finalInternalStatus\)[\s\S]*?updateOrderFromJob[\s\S]*?compareAndSetBusinessItemsStatus/,
  );
});

test('Yandex reservation trigger functions are not directly executable by API roles', () => {
  for (const functionName of [
    'guard_delivery_job_provider_reservation',
    'guard_internal_courier_provider_reservation',
  ]) {
    assert.match(
      migration,
      new RegExp(
        `revoke all on function public\\.${functionName}\\(\\) from public, anon, authenticated`,
        'i',
      ),
    );
  }
});

test('Yandex incidents use the durable staff alert outbox with bounded PII-free details', () => {
  assert.match(migration, /add column if not exists details jsonb not null default '\{\}'::jsonb/i);
  assert.match(
    migration,
    /staff_order_alerts_details_check[\s\S]*?jsonb_typeof\(details\) = 'object'[\s\S]*?octet_length\(details::text\) <= 2048/i,
  );
  assert.match(
    migration,
    /staff_order_alerts_alert_type_check[\s\S]*?'yandex_price_overrun'[\s\S]*?'yandex_items_unresolved'[\s\S]*?'yandex_create_uncertain'/i,
  );

  const triggerFunction = migration.match(
    /create or replace function public\.enqueue_yandex_business_staff_alert\(\)([\s\S]*?)\n\$\$;/i,
  )?.[1];
  assert.ok(triggerFunction, 'Business alert trigger function must exist');
  assert.match(triggerFunction, /security definer/i);
  assert.match(triggerFunction, /set search_path = pg_catalog, public/i);
  assert.match(triggerFunction, /new\.api_family <> 'business_v2'/i);
  assert.match(triggerFunction, /raw_response -> 'priceOverrun' = 'true'::jsonb/i);
  assert.match(triggerFunction, /v_overrun_amount > new\.authorized_max_price/i);
  assert.match(
    triggerFunction,
    /'yandex-price-overrun:' \|\| new\.id::text \|\| ':' \|\|[\s\S]*?md5\([\s\S]*?trim_scale\(v_overrun_amount\)::text[\s\S]*?trim_scale\(new\.authorized_max_price\)::text/i,
  );
  assert.match(triggerFunction, /'yandex-items-unresolved:' \|\| new\.id::text/i);
  assert.match(triggerFunction, /'yandex-create-uncertain:' \|\| new\.id::text/i);
  assert.match(triggerFunction, /new\.provider_status = 'creating_exhausted'/i);
  assert.match(triggerFunction, /on conflict \(dedupe_key\) do nothing/gi);
  assert.match(
    triggerFunction,
    /'deliveryJobId'[\s\S]*?'actualPriceKzt'[\s\S]*?'authorizedMaxPriceKzt'[\s\S]*?'currency'/i,
  );
  assert.doesNotMatch(triggerFunction, /courier_(?:name|phone)|customer|address|request_payload/i);
  assert.match(
    migration,
    /after insert or update on public\.delivery_jobs[\s\S]*?execute function public\.enqueue_yandex_business_staff_alert\(\)/i,
  );
});

test('v2 staff alert RPCs include details and revalidate Business incidents safely', () => {
  const claimFunction = migration.match(
    /create or replace function public\.claim_staff_order_alerts_v2\([\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(claimFunction, 'v2 alert claim function must exist');
  assert.match(claimFunction, /alert_details jsonb/i);
  assert.match(claimFunction, /set search_path = pg_catalog, public/i);
  assert.match(
    claimFunction,
    /alert\.alert_type in \([\s\S]*?'yandex_price_overrun'[\s\S]*?'yandex_items_unresolved'[\s\S]*?'yandex_create_uncertain'/i,
  );
  assert.match(claimFunction, /for update of alert skip locked/i);
  assert.doesNotMatch(
    claimFunction,
    /from public\.claim_staff_order_alerts\(p_limit, p_sla_seconds\)/i,
  );

  const legacyClaimFunction = migration.match(
    /create or replace function public\.claim_staff_order_alerts\([\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(legacyClaimFunction, 'rolling-safe legacy alert claim function must exist');
  assert.match(
    legacyClaimFunction,
    /alert\.alert_type in \([\s\S]*?'no_active_ipad'[\s\S]*?'order_unaccepted'/i,
  );
  assert.doesNotMatch(legacyClaimFunction, /yandex_price_overrun|yandex_items_unresolved/i);

  const validateFunction = migration.match(
    /create or replace function public\.validate_staff_order_alert_claim_v2\([\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(validateFunction, 'v2 alert validation function must exist');
  assert.match(validateFunction, /set search_path = pg_catalog, public/i);
  assert.match(
    validateFunction,
    /return public\.validate_staff_order_alert_claim\([\s\S]*?p_sla_seconds/i,
  );
  assert.match(
    validateFunction,
    /v_alert\.alert_type = 'yandex_create_uncertain'[\s\S]*?job\.provider_status = 'creating_exhausted'/i,
  );
  assert.match(validateFunction, /job\.raw_response -> 'priceOverrun' = 'true'::jsonb/i);
  assert.match(validateFunction, /job\.authorized_max_price = v_authorized/i);
  assert.match(validateFunction, /job\.raw_response ->> 'priceOverrunAmount'[\s\S]*?= v_actual/i);
  assert.match(
    validateFunction,
    /job\.provider_status in \([\s\S]*?'cancelled_items_unresolved'[\s\S]*?'items_resolution_returned'[\s\S]*?'items_resolution_delivered'/i,
  );

  const priceValidation = validateFunction.match(
    /if v_alert\.alert_type = 'yandex_price_overrun'([\s\S]*?)elsif v_alert\.alert_type = 'yandex_items_unresolved'/i,
  )?.[1];
  assert.ok(priceValidation, 'price overrun validation branch must exist');
  assert.doesNotMatch(priceValidation, /provider_status/i);
  assert.match(priceValidation, /v_actual > v_authorized/i);

  for (const functionSignature of [
    'claim_staff_order_alerts_v2\\(integer,integer\\)',
    'validate_staff_order_alert_claim_v2\\(uuid,uuid,integer\\)',
  ]) {
    assert.match(
      migration,
      new RegExp(
        `revoke all on function[\\s\\S]*?public\\.${functionSignature}[\\s\\S]*?from public, anon, authenticated`,
        'i',
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `grant execute on function[\\s\\S]*?public\\.${functionSignature}[\\s\\S]*?to service_role`,
        'i',
      ),
    );
  }
});
