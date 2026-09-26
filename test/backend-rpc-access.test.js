const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const targets = [
  ['admin_scoped_customers', 'uuid[],text,integer,integer'],
  ['claim_partial_refund', 'uuid,uuid,uuid,numeric,text,text,jsonb'],
  ['fail_partial_refund', 'uuid,text,boolean'],
  ['complete_courier_delivery', 'uuid,uuid,uuid,text,text,numeric,numeric'],
  ['claim_stock_subscription_notification', 'uuid'],
  ['rotate_branch_pos_credential', 'uuid,text,text'],
  ['verify_pickup_order_handoff', 'uuid,text,text,text'],
];
const excluded = [
  ['complete_employee_assignment', 'uuid,uuid,uuid'],
  ...[
    'can_read_task_assignees',
    'create_task_atomic',
    'update_task_atomic',
    'soft_delete_task',
  ].map((name) => [name, '']),
];
const functionSql = (filename, name) => {
  const source = readFileSync(`supabase/migrations/${filename}.sql`, 'utf8');
  const start = source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('$$;', start) + 3);
};

test('backend RPC ACLs block API roles, preserve service functions and leave shared-app RPCs alone', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create role untrusted_role;
      grant usage on schema public to anon,authenticated,service_role,untrusted_role;
      alter default privileges in schema public grant execute on functions to anon,authenticated;
      create table customers(id uuid primary key,name text,phone text,created_at timestamptz,total_spent numeric);
      create table kaspi_orders(customer_id uuid,branch_id uuid,amount numeric,refund_amount numeric,created_at timestamptz,status text);
      create table bulka_locations(id uuid primary key,active boolean);
      create table branch_pos_credentials(branch_id uuid primary key,token_hash text,version integer,active boolean,rotated_by text,rotated_at timestamptz,updated_at timestamptz);`);
    const actual = {
      admin_scoped_customers: functionSql(
        '20260715120000_financial_branch_courier_hardening',
        'admin_scoped_customers',
      ),
      rotate_branch_pos_credential: functionSql(
        '20260729160000_business_foundation',
        'rotate_branch_pos_credential',
      ),
    };
    for (const [name, args] of [...targets, ...excluded]) {
      await db.exec(
        actual[name] ||
          `create function public.${name}(${args}) returns jsonb language sql security definer as $$ select '{}'::jsonb $$;`,
      );
    }
    // Reproduce the historical revoke-PUBLIC-only policy with explicit API grants still present.
    for (const [name, args] of targets) {
      await db.exec(`revoke all on function public.${name}(${args}) from public`);
      assert.equal(
        (
          await db.query("select has_function_privilege('anon',$1,'EXECUTE') allowed", [
            `public.${name}(${args})`,
          ])
        ).rows[0].allowed,
        true,
      );
    }
    const migration = readFileSync(
      'supabase/migrations/20260926120000_backend_rpc_access.sql',
      'utf8',
    );
    await db.exec(migration);
    await db.exec(migration);
    const branch = randomUUID(),
      customer = randomUUID(),
      tokenHash = 'a'.repeat(64);
    await db.query('insert into bulka_locations values($1,true)', [branch]);
    await db.query("insert into customers values($1,'Fixture','test',now(),100)", [customer]);
    await db.query("insert into kaspi_orders values($1,$2,100,0,now(),'paid')", [customer, branch]);
    for (const role of ['anon', 'authenticated', 'untrusted_role']) {
      await db.exec(`set role ${role}`);
      try {
        for (const [name, args] of targets) {
          const nulls = args
            .split(',')
            .map((type) => `null::${type}`)
            .join(',');
          await assert.rejects(db.query(`select public.${name}(${nulls})`), { code: '42501' });
        }
        // Known branch/customer identifiers cannot bypass the application's authorization.
        await assert.rejects(db.query("select admin_scoped_customers($1,'',50,0)", [[branch]]), {
          code: '42501',
        });
        await assert.rejects(
          db.query("select rotate_branch_pos_credential($1,$2,'fixture')", [branch, tokenHash]),
          { code: '42501' },
        );
      } finally {
        await db.exec('reset role');
      }
    }
    assert.equal(
      (await db.query('select count(*)::integer count from branch_pos_credentials')).rows[0].count,
      0,
    );
    for (const [name, args] of excluded) {
      for (const role of ['anon', 'authenticated']) {
        assert.equal(
          (
            await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [
              role,
              `public.${name}(${args})`,
            ])
          ).rows[0].allowed,
          true,
          `shared app: ${name}`,
        );
      }
    }
    await db.exec('set role service_role');
    try {
      for (const [name, args] of targets) {
        assert.equal(
          (
            await db.query("select has_function_privilege(current_user,$1,'EXECUTE') allowed", [
              `public.${name}(${args})`,
            ])
          ).rows[0].allowed,
          true,
        );
      }
      const list = (await db.query("select admin_scoped_customers($1,'',50,0) result", [[branch]]))
        .rows[0].result;
      assert.equal(list.total, 1);
      assert.equal(list.customers[0].id, customer);
      const credential = (
        await db.query("select rotate_branch_pos_credential($1,$2,'fixture') result", [
          branch,
          tokenHash,
        ])
      ).rows[0].result;
      assert.equal(credential.version, 1);
    } finally {
      await db.exec('reset role');
    }
    assert.equal(
      (await db.query('select token_hash from branch_pos_credentials where branch_id=$1', [branch]))
        .rows[0].token_hash,
      tokenHash,
    );
  } finally {
    await db.close();
  }
});
