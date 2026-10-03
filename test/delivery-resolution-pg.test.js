const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const sql = (name) => readFileSync(`supabase/migrations/${name}.sql`, 'utf8');
test.before(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table bulka_locations(id uuid primary key,active boolean default true,pickup_enabled boolean default true,
      round_the_clock boolean default true,hours jsonb,slot_minutes integer default 60,
      pickup_slot_capacity integer default 1,delivery_slot_capacity integer default 1,preorder_slot_capacity integer default 1);
    create table kaspi_orders(id uuid primary key,customer_id uuid,branch_id uuid,status text default 'paid',order_number bigint default 100012,
      fulfillment_type text default 'delivery',fulfillment_status text default 'ready',kitchen_status text default 'ready',
      kitchen_ready_at timestamptz default now()-interval '21 minutes',courier_search_started_at timestamptz default now()-interval '25 minutes',
      courier_id uuid,courier_assigned_at timestamptz,delivery_status text default 'unassigned',
      refund_status text,courier_timeout_at timestamptz,courier_timeout_retry_at timestamptz,
      courier_dispatch_status text,scheduled_at timestamptz,pickup_time varchar(40),updated_at timestamptz default now(),created_at timestamptz default now(),
      pos_receipt_due boolean default false,handed_to_courier_at timestamptz,fulfilled_at timestamptz,
      amount numeric default 4500,delivery_fee numeric default 0,bonus_spent numeric default 300,earned_bonus numeric default 100,cart_items jsonb default '[{"id":"bun","quantity":2}]');
    create table delivery_jobs(id uuid primary key default gen_random_uuid(),order_id uuid,provider_status text default 'performer_lookup',
      internal_status text default 'unassigned',courier_name text,courier_phone text,updated_at timestamptz default now());
    create table front_order_inbox_terminals(branch_id uuid,terminal_id uuid,last_seen_at timestamptz,primary key(branch_id,terminal_id));
    create table fulfillment_slot_reservations(id uuid primary key default gen_random_uuid(),customer_id uuid,client_request_id uuid unique,
      branch_id uuid,fulfillment_type varchar,scheduled_at timestamptz,status text,expires_at timestamptz,updated_at timestamptz,order_id uuid);
    create table order_partial_refunds(id uuid primary key,order_id uuid,status text);
    create table order_partial_refund_items(refund_id uuid,line_key text,refund_amount numeric);`);
  await db.exec(sql('20260910233000_fulfillment_partial_windows'));
  await db.exec(sql('20261003160000_delivery_resolution'));
  const feeSql = sql('20261003162000_delivery_fee_loyalty_adjustment');
  const start = feeSql.indexOf('create or replace function public.finish_delivery_resolution(');
  await db.exec(feeSql.slice(start, feeSql.indexOf('$$;', start) + 3));
});
test.after(() => db.close());
async function fixture() {
  const id = randomUUID(),
    customer = randomUUID(),
    branch = randomUUID();
  await db.query('insert into bulka_locations(id) values($1)', [branch]);
  await db.query('insert into kaspi_orders(id,customer_id,branch_id) values($1,$2,$3)', [
    id,
    customer,
    branch,
  ]);
  await db.query('insert into delivery_jobs(order_id) values($1)', [id]);
  return { id, customer, branch };
}
async function order(f) {
  return (await db.query('select * from kaspi_orders where id=$1', [f.id])).rows[0];
}
async function claim() {
  return (await db.query("select * from claim_delivery_resolutions(now()-interval '20 minutes')"))
    .rows;
}
async function choose(f, action = 'pickup', time = null) {
  if (!time && action === 'pickup')
    time = (await db.query("select date_trunc('hour',now())+interval '2 hours' as at")).rows[0].at;
  return (
    await db.query('select choose_delivery_resolution($1,$2,$3,$4) as o', [
      f.id,
      f.customer,
      action,
      time,
    ])
  ).rows[0].o;
}
async function finish(f, status, id = null) {
  return (
    await db.query('select finish_delivery_resolution($1,$2,$3,$4) as o', [
      f.id,
      id || (await order(f)).delivery_resolution.id,
      status,
      'cashier:test',
    ])
  ).rows[0].o;
}
async function readyForReview(f) {
  await claim();
  await choose(f);
  await db.query(
    "update delivery_jobs set provider_status='cancelled',internal_status='cancelled' where order_id=$1",
    [f.id],
  );
  return finish(f, 'pickup_pending_approval');
}
test('20 minutes begin at confirmed readiness and actual search; preparing orders never cancel', async () => {
  const ready = await fixture(),
    preparing = await fixture(),
    search = await fixture();
  await db.query(
    "update kaspi_orders set kitchen_ready_at=now()-interval '19 minutes' where id=$1",
    [ready.id],
  );
  await db.query("update kaspi_orders set fulfillment_status='preparing' where id=$1", [
    preparing.id,
  ]);
  await db.query(
    "update kaspi_orders set courier_search_started_at=now()-interval '19 minutes' where id=$1",
    [search.id],
  );
  let rows = await claim();
  assert.ok(!rows.some((r) => [ready.id, preparing.id, search.id].includes(r.id)));
  await db.query(
    "update kaspi_orders set kitchen_ready_at=now()-interval '21 minutes' where id=$1",
    [ready.id],
  );
  rows = await claim();
  assert.equal(rows.filter((r) => r.id === ready.id).length, 1);
  assert.equal((await order(ready)).delivery_resolution.status, 'pending');
  assert.equal((await order(ready)).refund_status, null);
  assert.equal((await order(ready)).courier_timeout_at, null);
  assert.equal(
    (await claim()).some((r) => r.id === ready.id),
    false,
  );
  assert.equal(
    (await db.query('select * from claim_courier_timeout($1,now())', [preparing.id])).rows.length,
    0,
  );
});
test('assignment winning pending/choice race resumes delivery and releases only replacement slot', async () => {
  for (const duringChoice of [false, true]) {
    const f = await fixture();
    await claim();
    if (duringChoice) await choose(f);
    await db.query(
      "update kaspi_orders set courier_assigned_at=now(),delivery_status='assigned' where id=$1",
      [f.id],
    );
    const o = await order(f);
    assert.equal(o.delivery_resolution.status, 'delivery_resumed');
    assert.equal(o.fulfillment_type, 'delivery');
    assert.equal(o.courier_timeout_at, null);
    await assert.rejects(choose(f), /DELIVERY_RESOLUTION_CONFLICT/);
    assert.equal(
      (
        await db.query(
          "select * from fulfillment_slot_reservations where order_id=$1 and status='committed'",
          [f.id],
        )
      ).rows.length,
      0,
    );
  }
});
test('provider cancellation acknowledgment precedes review; new jobs/staff bypass and late assignment are blocked', async () => {
  const f = await fixture();
  await claim();
  const selected = await choose(f);
  assert.equal(selected.fulfillment_type, 'delivery');
  assert.equal(selected.fulfillment_status, 'ready');
  await assert.rejects(finish(f, 'pickup_pending_approval'), /DELIVERY_RESOLUTION_DELIVERY_ACTIVE/);
  await assert.rejects(
    db.query('insert into delivery_jobs(order_id) values($1)', [f.id]),
    /DELIVERY_RESOLUTION_CONFLICT/,
  );
  await assert.rejects(
    db.query("update kaspi_orders set fulfillment_type='pickup' where id=$1", [f.id]),
    /REVIEW_REQUIRED/,
  );
  await db.query(
    "update delivery_jobs set provider_status='cancelled',internal_status='cancelled' where order_id=$1",
    [f.id],
  );
  const pending = await finish(f, 'pickup_pending_approval');
  assert.equal(pending.fulfillment_type, 'delivery');
  await assert.rejects(
    db.query(
      "update delivery_jobs set provider_status='performer_found',internal_status='assigned' where order_id=$1",
      [f.id],
    ),
    /DELIVERY_RESOLUTION_CONFLICT/,
  );
  await assert.rejects(
    db.query('update kaspi_orders set courier_id=$2 where id=$1', [f.id, randomUUID()]),
    /DELIVERY_RESOLUTION_CONFLICT/,
  );
});
test('paid same-order pickup approval is atomic/idempotent and waits for fee step', async () => {
  const f = await fixture();
  const pending = await readyForReview(f);
  await assert.rejects(finish(f, 'pickup_accepted'), /DELIVERY_RESOLUTION_CONFLICT/);
  const accepting = await finish(f, 'pickup_accepting');
  assert.equal(accepting.fulfillment_type, 'delivery');
  await db.query("update kaspi_orders set refund_status='partial' where id=$1", [f.id]);
  const accepted = await finish(f, 'pickup_accepted');
  assert.equal(accepted.id, f.id);
  assert.equal(accepted.fulfillment_type, 'pickup');
  assert.equal(accepted.branch_id, f.branch);
  assert.equal(accepted.fulfillment_status, 'ready');
  assert.equal(accepted.kitchen_status, 'ready');
  assert.equal(Number(accepted.amount), 4500);
  assert.equal(Number(accepted.bonus_spent), 300);
  assert.equal(Number(accepted.earned_bonus), 100);
  assert.deepEqual(accepted.cart_items, [{ id: 'bun', quantity: 2 }]);
  assert.equal(accepted.scheduled_at, pending.delivery_resolution.pickupTime);
  const duplicate = await finish(f, 'pickup_accepted');
  assert.equal(duplicate.delivery_resolution.reviewedAt, accepted.delivery_resolution.reviewedAt);
  assert.equal((await choose(f, 'pickup', pending.delivery_resolution.pickupTime)).id, f.id);
  await assert.rejects(finish(f, 'pickup_rejecting'), /DELIVERY_RESOLUTION_CONFLICT/);
  await assert.rejects(finish(f, 'pickup_accepted', randomUUID()), /DELIVERY_RESOLUTION_CONFLICT/);
});
test('decision ownership, changed schedule and expired slot are checked on the server', async () => {
  const f = await fixture();
  await claim();
  await assert.rejects(
    db.query("select choose_delivery_resolution($1,$2,'cancel')", [f.id, randomUUID()]),
    /NOT_FOUND/,
  );
  await assert.rejects(
    choose(f, 'pickup', new Date(Date.now() + 25 * 3600000).toISOString()),
    /INVALID_SLOT/,
  );
  await readyForReview(f);
  await db.query('update bulka_locations set pickup_enabled=false where id=$1', [f.branch]);
  await assert.rejects(finish(f, 'pickup_accepting'), /INVALID_SLOT/);
  await db.query('update bulka_locations set pickup_enabled=true where id=$1', [f.branch]);
  const o = await order(f);
  await db.query('update kaspi_orders set delivery_resolution=$2 where id=$1', [
    f.id,
    { ...o.delivery_resolution, pickupTime: new Date(Date.now() - 3600000).toISOString() },
  ]);
  await assert.rejects(finish(f, 'pickup_accepting'), /INVALID_SLOT/);
});
test('pickup conversion cannot complete until delivery fee refund is confirmed, including unknown responses', async () => {
  const f = await fixture(),
    refund = randomUUID();
  await readyForReview(f);
  await finish(f, 'pickup_accepting');
  await db.query('update kaspi_orders set delivery_fee=500 where id=$1', [f.id]);
  const confirmed = async () =>
    (await db.query('select delivery_resolution_fee_refunded($1) confirmed', [f.id])).rows[0]
      .confirmed;
  assert.equal(await confirmed(), false);
  await assert.rejects(finish(f, 'pickup_accepted'), /FEE_REFUND_PENDING/);
  assert.equal(await confirmed(), false);
  await db.query("insert into order_partial_refunds values($1,$2,'unknown')", [refund, f.id]);
  await db.query("insert into order_partial_refund_items values($1,'__delivery_fee__',500)", [
    refund,
  ]);
  await assert.rejects(finish(f, 'pickup_accepted'), /FEE_REFUND_PENDING/);
  assert.equal((await order(f)).fulfillment_type, 'delivery');
  await db.query("update order_partial_refunds set status='succeeded' where id=$1", [refund]);
  assert.equal(await confirmed(), true);
  await db.query("update kaspi_orders set refund_status='partial' where id=$1", [f.id]);
  assert.equal((await finish(f, 'pickup_accepted')).fulfillment_type, 'pickup');
});
test('work leases serialize provider/refund side effects and terminal cancellation waits for confirmed refund', async () => {
  const f = await fixture();
  await claim();
  await choose(f, 'cancel');
  const first = (await db.query('select * from claim_delivery_resolution_work($1)', [f.id])).rows;
  assert.equal(first.length, 1);
  assert.equal(
    (await db.query('select * from claim_delivery_resolution_work($1)', [f.id])).rows.length,
    0,
  );
  await db.query(
    "update delivery_jobs set provider_status='cancelled',internal_status='cancelled' where order_id=$1",
    [f.id],
  );
  await finish(f, 'cancel_refunding');
  await db.query(
    "update kaspi_orders set fulfillment_status='cancelled',refund_status='unknown' where id=$1",
    [f.id],
  );
  await assert.rejects(finish(f, 'cancelled'), /DELIVERY_RESOLUTION_CONFLICT/);
  await db.query(
    "update kaspi_orders set status='refunded',refund_status='succeeded' where id=$1",
    [f.id],
  );
  assert.equal((await finish(f, 'cancelled')).delivery_resolution.status, 'cancelled');
});

test('service recovers real SQL slot expiry after confirmed fee-only cash refund and retries cancellation once', async () => {
  const service = require('../src/services/delivery-resolution.service');
  const f = await fixture(),
    refund = randomUUID();
  await readyForReview(f);
  await finish(f, 'pickup_accepting');
  await db.query(
    "update kaspi_orders set amount=600,delivery_fee=600,bonus_spent=1200,refund_status='partial',delivery_resolution=jsonb_set(delivery_resolution,'{pickupTime}',to_jsonb((now()-interval '1 hour')::text)) where id=$1",
    [f.id],
  );
  await db.query("insert into order_partial_refunds values($1,$2,'succeeded')", [refund, f.id]);
  await db.query("insert into order_partial_refund_items values($1,'__delivery_fee__',600)", [
    refund,
  ]);
  const adapter = {
    async rpc(name, args) {
      try {
        if (name === 'claim_delivery_resolution_work')
          return {
            data: (await db.query('select * from claim_delivery_resolution_work($1)', [f.id])).rows,
          };
        assert.equal(name, 'finish_delivery_resolution');
        return {
          data: (
            await db.query('select finish_delivery_resolution($1,$2,$3,$4) as o', [
              args.p_order,
              args.p_resolution,
              args.p_next,
              args.p_actor,
            ])
          ).rows[0].o,
        };
      } catch (error) {
        return { error };
      }
    },
    from(table) {
      assert.equal(table, 'kaspi_orders');
      const where = ['id=$1'],
        values = [f.id],
        q = {};
      let patch = null;
      q.select = () => q;
      q.eq = (key, value) => {
        const [column, field] = key.split('->>');
        values.push(value);
        where.push(`${field ? `${column}->>'${field}'` : column}=$${values.length}`);
        return q;
      };
      q.update = (value) => {
        patch = value;
        return q;
      };
      const run = async (single) => {
        const params = [...values];
        const set = Object.entries(patch || {})
          .map(([key, value]) => {
            params.push(value);
            return `${key}=$${params.length}`;
          })
          .join(',');
        const result = await db.query(
          patch
            ? `update kaspi_orders set ${set} where ${where.join(' and ')} returning *`
            : `select * from kaspi_orders where ${where.join(' and ')}`,
          params,
        );
        return { data: single ? result.rows[0] : result.rows };
      };
      q.maybeSingle = () => run(true);
      q.then = (ok, bad) => run(false).then(ok, bad);
      return q;
    },
  };
  let cancellations = 0;
  const options = {
    db: adapter,
    resolutionId: (await order(f)).delivery_resolution.id,
    normalize: (o) => o,
    publish() {},
    refundFee: async () => {
      assert.equal(
        (await db.query('select delivery_resolution_fee_refunded($1) ok', [f.id])).rows[0].ok,
        true,
      );
      return { status: 'succeeded' };
    },
    cancel: async (current) => {
      cancellations++;
      assert.equal(Number(current.amount), Number(current.delivery_fee));
      if (cancellations === 1) {
        await db.query(
          "update kaspi_orders set delivery_resolution=jsonb_set(delivery_resolution,'{fullRefundCashSettled}','true'::jsonb) where id=$1",
          [f.id],
        );
        throw new Error('Injected final cancellation outage');
      }
      await db.query(
        "update kaspi_orders set status='refunded',refund_status='succeeded',fulfillment_status='cancelled',kitchen_status='cancelled' where id=$1",
        [f.id],
      );
      await db.query(
        "update fulfillment_slot_reservations set status='released' where order_id=$1",
        [f.id],
      );
    },
  };
  await assert.rejects(service.reviewDeliveryResolution(f.id, 'accept', options), AggregateError);
  const waiting = await order(f);
  assert.equal(waiting.delivery_resolution.status, 'pickup_rejecting');
  assert.equal(waiting.delivery_resolution.rejectionReason, 'pickup_slot_unavailable');
  assert.equal(waiting.delivery_resolution.fullRefundCashSettled, true);
  await db.query(
    "update kaspi_orders set delivery_resolution=jsonb_set(delivery_resolution,'{retryAt}',to_jsonb((now()-interval '1 minute')::text)) where id=$1",
    [f.id],
  );
  const result = await service.reviewDeliveryResolution(f.id, 'reject', options);
  assert.equal(result.delivery_resolution.status, 'pickup_rejected');
  assert.equal(result.status, 'refunded');
  assert.equal(result.fulfillment_type, 'delivery');
  assert.equal(
    (
      await db.query(
        "select count(*) n from fulfillment_slot_reservations where order_id=$1 and status='committed'",
        [f.id],
      )
    ).rows[0].n,
    0,
  );
  await service.reviewDeliveryResolution(f.id, 'reject', options);
  assert.equal(cancellations, 2);
});
test('schedule validator includes tomorrow and midnight continuation, honors closed day and 24/7', async () => {
  const f = await fixture();
  const nextHour = (await db.query("select date_trunc('hour',now())+interval '2 hours' as at"))
    .rows[0].at;
  const valid = () =>
    db.query('select delivery_resolution_valid_pickup($1,$2,300) valid', [f.branch, nextHour]);
  assert.equal((await valid()).rows[0].valid, true);
  await db.query(
    "update bulka_locations set round_the_clock=false,hours='{" +
      '"daily":{"open":"00:00","close":"24:00"}' +
      "}' where id=$1",
    [f.branch],
  );
  assert.equal((await valid()).rows[0].valid, true);
  await db.query(
    "update bulka_locations set hours='{" + '"daily":{"closed":true}' + "}' where id=$1",
    [f.branch],
  );
  assert.equal((await valid()).rows[0].valid, false);
});
test('cashier polling exposes replacement approval in the same point and keeps processing revision visible without new-order alarm', async () => {
  const f = await fixture(),
    terminal = randomUUID();
  await claim();
  const poll = async () =>
    (await db.query('select poll_front_order_board($1,$2) as r', [f.branch, terminal])).rows[0].r;
  const pending = await poll();
  assert.equal(pending.total, 0);
  await readyForReview(f);
  const review = await poll();
  assert.equal(review.total, 1);
  assert.equal(review.newestOrderNumber, 100012);
  assert.equal(review.orders[0].id, f.id);
  assert.notEqual(pending.revision, review.revision);
  await finish(f, 'pickup_accepting');
  await db.query("update kaspi_orders set refund_status='unknown' where id=$1", [f.id]);
  const processing = await poll();
  assert.equal(processing.total, 0);
  assert.notEqual(processing.revision, review.revision);
  assert.equal(processing.newestOrderNumber, 0);
});
