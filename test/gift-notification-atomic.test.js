const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
let realtimeEvents = 0;
class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.values = [];
  }
  select() {
    return this;
  }
  eq(column, value) {
    this.values.push(value);
    this.filters.push(column + '=$' + this.values.length);
    return this;
  }
  is(column, value) {
    assert.equal(value, null);
    this.filters.push(column + ' is null');
    return this;
  }
  or() {
    this.filters.push('(delivery_at is null or delivery_at<=now())');
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  then(resolve, reject) {
    return db
      .query(
        'select * from ' +
          this.table +
          (this.filters.length ? ' where ' + this.filters.join(' and ') : ''),
        this.values,
      )
      .then((r) => ({ data: r.rows, error: null }))
      .then(resolve, reject);
  }
}
const client = {
  from: (table) => new Query(table),
  async rpc(name, args) {
    assert.equal(name, 'deliver_gift_certificate_notification');
    try {
      return {
        data: (
          await db.query('select deliver_gift_certificate_notification($1) r', [args.p_purchase_id])
        ).rows[0].r,
        error: null,
      };
    } catch (error) {
      return { data: null, error };
    }
  },
};
function actualWorker() {
  const path = require.resolve('../src/services/gift-certificate-purchase.service');
  const fromService = createRequire(path),
    result = { exports: {} };
  const scopedRequire = (name) => {
    if (name === '../config/supabase') return { supabase: client };
    if (name === './realtime.service')
      return {
        publish() {
          realtimeEvents++;
        },
      };
    if (
      ['./forte.service', './forte-widget.service', './payment-operations.service'].includes(name)
    )
      return {};
    return fromService(name);
  };
  vm.runInNewContext(
    '(function(require,module,exports){' + readFileSync(path, 'utf8') + '\n})',
    { console, process, Date, Buffer },
    { filename: path },
  )(scopedRequire, result, result.exports);
  return result.exports;
}
async function one(sql, args = []) {
  return (await db.query(sql, args)).rows[0];
}
test('gift delivery atomically creates inbox and push outbox, survives an outage/restart and never duplicates after a lost response', async () => {
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table customers(id uuid primary key,phone text,deleted_at timestamptz,fcm_token text);
      create table gift_cards(id uuid primary key,recipient_customer_id uuid references customers(id),code_last4 text);
      create table gift_certificate_purchases(id uuid primary key,gift_card_id uuid references gift_cards(id),status text,amount numeric,
        recipient_phone text,recipient_name text,recipient_notified_at timestamptz,delivery_at timestamptz,updated_at timestamptz);
      create table customer_notifications(id uuid primary key,customer_id uuid references customers(id),title text,body text,type text,payload jsonb,created_at timestamptz default now());
      create table customer_push_tokens(customer_id uuid,token text);
      create table push_notification_outbox(id uuid default gen_random_uuid(),dedupe_key text unique,customer_id uuid references customers(id),title text,body text,payload jsonb,pending_tokens jsonb,status text default 'queued');
      create table outage(enabled boolean);insert into outage values(true);
      create function fail_queue() returns trigger language plpgsql as $$ begin if (select enabled from outage) then raise exception 'injected durable queue outage';end if;return new;end $$;
      create trigger queue_outage before insert on push_notification_outbox for each row execute function fail_queue();`);
    const customer = randomUUID(),
      card = randomUUID(),
      purchase = randomUUID();
    await db.query("insert into customers values($1,'+77750000001',null,'fallback-token')", [
      customer,
    ]);
    await db.query("insert into customer_push_tokens values($1,'device-token')", [customer]);
    await db.query("insert into gift_cards values($1,$2,'ABCD')", [card, customer]);
    // Old claims must remain unchanged during a live deployment migration;
    // only the post-promotion repair can distinguish abandoned claims safely.
    await db.query(
      "insert into gift_certificate_purchases(id,gift_card_id,status,amount,recipient_phone,recipient_name,recipient_notified_at) values($1,$2,'active',5000,'+77750000001','Recipient',now())",
      [purchase, card],
    );
    const completed = randomUUID(),
      inactive = randomUUID(),
      completedNotice = randomUUID();
    await db.query(
      "insert into gift_certificate_purchases(id,gift_card_id,status,amount,recipient_phone,recipient_notified_at) values($1,$3,'active',3000,'+77750000001',now()),($2,$3,'refunded',3000,'+77750000001',now())",
      [completed, inactive, card],
    );
    await db.query(
      "insert into customer_notifications(id,customer_id,title,body,type,payload) values($1,$2,'Completed','Completed','gift',jsonb_build_object('giftPurchaseId',$3::text))",
      [completedNotice, customer, completed],
    );
    const completedMarker = (
      await one('select recipient_notified_at from gift_certificate_purchases where id=$1', [
        completed,
      ])
    ).recipient_notified_at;
    await db.exec(
      readFileSync('supabase/migrations/20261004104000_atomic_gift_notifications.sql', 'utf8'),
    );
    assert.ok(
      (
        await one('select recipient_notified_at from gift_certificate_purchases where id=$1', [
          purchase,
        ])
      ).recipient_notified_at,
    );
    assert.equal(Number((await one('select repair_incomplete_gift_notifications() n')).n), 1);
    assert.equal(Number((await one('select repair_incomplete_gift_notifications() n')).n), 0);
    assert.deepEqual(
      (
        await one('select recipient_notified_at from gift_certificate_purchases where id=$1', [
          completed,
        ])
      ).recipient_notified_at,
      completedMarker,
    );
    assert.ok(
      (
        await one('select recipient_notified_at from gift_certificate_purchases where id=$1', [
          inactive,
        ])
      ).recipient_notified_at,
    );
    assert.equal(
      (
        await one('select recipient_notified_at from gift_certificate_purchases where id=$1', [
          purchase,
        ])
      ).recipient_notified_at,
      null,
    );
    await assert.rejects(
      actualWorker().deliverDueGiftCertificates(),
      /injected durable queue outage/,
    );
    assert.equal(
      (
        await one('select recipient_notified_at from gift_certificate_purchases where id=$1', [
          purchase,
        ])
      ).recipient_notified_at,
      null,
    );
    assert.equal(Number((await one('select count(*) n from customer_notifications')).n), 1);
    assert.equal(Number((await one('select count(*) n from push_notification_outbox')).n), 0);
    await db.exec('update outage set enabled=false');
    assert.equal(await actualWorker().deliverDueGiftCertificates(), 1);
    assert.ok(
      (
        await one('select recipient_notified_at from gift_certificate_purchases where id=$1', [
          purchase,
        ])
      ).recipient_notified_at,
    );
    const queued = await one('select * from push_notification_outbox');
    assert.equal(queued.status, 'queued');
    assert.equal(queued.customer_id, customer);
    assert.deepEqual([...queued.pending_tokens].sort(), ['device-token', 'fallback-token']);
    assert.equal(queued.payload.giftPurchaseId, purchase);
    assert.equal(
      queued.payload.notificationId,
      (
        await one("select id from customer_notifications where payload->>'giftPurchaseId'=$1", [
          purchase,
        ])
      ).id,
    );
    assert.equal(realtimeEvents, 1);
    // Simulate the HTTP response being lost after SQL committed; the original
    // caller can retry without creating another inbox or push message.
    assert.equal(
      (await one('select deliver_gift_certificate_notification($1) r', [purchase])).r.status,
      'already_delivered',
    );
    assert.equal(await actualWorker().deliverDueGiftCertificates(), 0);
    assert.equal(Number((await one('select count(*) n from customer_notifications')).n), 2);
    assert.equal(Number((await one('select count(*) n from push_notification_outbox')).n), 1);
    const future = randomUUID();
    await db.query(
      "insert into gift_certificate_purchases(id,gift_card_id,status,amount,recipient_phone,delivery_at) values($1,$2,'active',5000,'+77750000001',now()+interval '1 day')",
      [future, card],
    );
    assert.equal(
      (await one('select deliver_gift_certificate_notification($1) r', [future])).r.status,
      'not_due',
    );
    for (const role of ['anon', 'authenticated']) {
      assert.equal(
        (
          await one('select has_function_privilege($1,$2,$3) allowed', [
            role,
            'deliver_gift_certificate_notification(uuid)',
            'EXECUTE',
          ])
        ).allowed,
        false,
      );
      assert.equal(
        (
          await one('select has_function_privilege($1,$2,$3) allowed', [
            role,
            'repair_incomplete_gift_notifications()',
            'EXECUTE',
          ])
        ).allowed,
        false,
      );
    }
    assert.equal(
      (
        await one('select has_function_privilege($1,$2,$3) allowed', [
          'service_role',
          'repair_incomplete_gift_notifications()',
          'EXECUTE',
        ])
      ).allowed,
      true,
    );
  } finally {
    await db.close();
  }
});
