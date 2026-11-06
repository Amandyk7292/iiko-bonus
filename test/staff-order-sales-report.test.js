const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { orderReportPeriod } = require('../src/utils/order-report-period.util');
const { unlinkPosDevice } = require('../src/services/pos-pairing.service');
test('cashier can revoke only the device in the selected branch', async () => {
  const branch='00000000-0000-4000-8000-000000000001';
  const terminal='00000000-0000-4000-8000-000000000002';
  let deviceBranch=branch;
  const db={from(table) {
    const filters={};
    const query={select(){return query;},update(value){assert.deepEqual(value,{active:false});return query;},
      eq(key,value){filters[key]=value;return query;},
      async maybeSingle(){return {data: table==='bulka_locations' ? {id:branch,name:'Branch'} :
        filters.branch_id===deviceBranch && filters.terminal_id===terminal ? {terminal_id:terminal} : null};}};
    return query;
  }};
  const cashier={role:'cashier',branchIds:[branch]};
  assert.deepEqual(await unlinkPosDevice(cashier,terminal,db),{terminalId:terminal});
  deviceBranch='00000000-0000-4000-8000-000000000003';
  await assert.rejects(unlinkPosDevice(cashier,terminal,db),{statusCode:404});
  await assert.rejects(unlinkPosDevice({role:'customer',branchIds:[branch]},terminal,db),{statusCode:403});
});
test('Kazakhstan period includes the whole last day and rejects invalid dates', () => {
  assert.deepEqual(orderReportPeriod('2026-11-06','2026-11-06'), {
    start:'2026-11-05T19:00:00.000Z',end:'2026-11-06T19:00:00.000Z',
  });
  for (const args of [['2026-02-30','2026-03-01'],['2026-11-07','2026-11-06'],['2026-11-06',null],['2020-01-01','2026-01-01']]) {
    assert.throws(() => orderReportPeriod(...args), {statusCode:400});
  }
});
test('report aggregates every matching order, scopes branches and deducts refunds', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table kaspi_orders(branch_id uuid,created_at timestamptz,fulfillment_type text,status text,fulfillment_status text,amount numeric,refund_amount numeric,refund_status text);`);
    await db.exec(fs.readFileSync('supabase/migrations/20261106130000_staff_order_sales_report.sql','utf8'));
    await db.exec(`insert into kaspi_orders values
      ('00000000-0000-4000-8000-000000000001','2026-11-05 19:00Z','delivery','paid','completed',1000,200,'succeeded'),
      ('00000000-0000-4000-8000-000000000001','2026-11-06 18:59Z','pickup','paid','completed',500,null,null),
      ('00000000-0000-4000-8000-000000000001','2026-11-06 19:00Z','pickup','paid','completed',999,null,null),
      ('00000000-0000-4000-8000-000000000002','2026-11-06 12:00Z','pickup','paid','completed',999,null,null),
      ('00000000-0000-4000-8000-000000000001','2026-11-06 12:00Z','pickup','pending','completed',999,null,null),
      ('00000000-0000-4000-8000-000000000001','2026-11-06 12:00Z','pickup','paid','cancelled',999,null,null);`);
    const period = orderReportPeriod('2026-11-06','2026-11-06');
    const result = await db.query('select staff_order_sales_report($1,$2,$3) as report',[period.start,period.end,['00000000-0000-4000-8000-000000000001']]);
    assert.equal(result.rows[0].report.revenue,1300);
    assert.equal(result.rows[0].report.orders,2);
  } finally { await db.close(); }
});
