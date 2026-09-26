// Replay an ambiguous admin request against the real SQL function in memory.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
require('node:test')(
  'manual adjustment retries return the original balance and reject changed payloads',
  async () => {
    const db = new PGlite();
    try {
      await db.exec(
        'create role anon;create role authenticated;create role service_role;create table bulka_locations(id uuid primary key);create table customers(id uuid primary key,balance numeric,updated_at timestamptz,deleted_at timestamptz);create table transactions(customer_id uuid,order_id text,branch_id uuid,type text,amount numeric,description text);',
      );
      const source = readFileSync(
        'supabase/migrations/20260725120000_customer_access_hardening.sql',
        'utf8',
      );
      await db.exec(source.slice(0, source.indexOf('$$;') + 3));
      await db.exec(
        readFileSync('supabase/migrations/20260926111000_manual_bonus_idempotency.sql', 'utf8'),
      );
      await db.exec(
        'create table loyalty_reservations(customer_id uuid,discount_amount numeric,status text,expires_at timestamptz)',
      );
      for (const amount of [100, -100]) {
        const customer = randomUUID();
        await db.query('insert into customers(id,balance) values($1,1000)', [customer]);
        // First transaction commits but its HTTP reply is lost; user retries.
        const payload = [randomUUID(), customer, amount, 'Audit correction'];
        await db.query('select apply_manual_bonus_once($1,$2,$3,$4)', payload);
        await db.query('select apply_manual_bonus_once($1,$2,$3,$4)', payload);
        const result = (
          await db.query(
            'select balance,(select count(*)::int from transactions where customer_id=$1) as transactions from customers where id=$1',
            [customer],
          )
        ).rows[0];
        assert.equal(Number(result.balance), 1000 + amount);
        assert.equal(result.transactions, 1);
        const duplicate = (await db.query('select apply_manual_bonus_once($1,$2,$3,$4) r', payload))
          .rows[0].r;
        assert.equal(duplicate.duplicate, true);
        assert.equal(duplicate.balance, 1000 + amount);
        await assert.rejects(
          db.query('select apply_manual_bonus_once($1,$2,$3,$4)', [
            payload[0],
            customer,
            amount * 2,
            payload[3],
          ]),
          /idempotency conflict/,
        );
        await assert.rejects(
          db.query('select apply_manual_bonus_once($1,$2,$3,$4)', [
            payload[0],
            customer,
            amount,
            'Changed reason',
          ]),
          /idempotency conflict/,
        );
        await assert.rejects(
          db.query('select apply_manual_bonus_once($1,$2,$3,$4)', [
            payload[0],
            randomUUID(),
            amount,
            payload[3],
          ]),
          /idempotency conflict/,
        );
        await assert.rejects(
          db.query('select apply_manual_bonus_once($1,$2,$3,$4,$5)', [...payload, randomUUID()]),
          /idempotency conflict/,
        );
        await db.query('select apply_manual_bonus_once($1,$2,$3,$4)', [
          randomUUID(),
          customer,
          amount,
          payload[3],
        ]);
        assert.equal(
          Number(
            (await db.query('select balance from customers where id=$1', [customer])).rows[0]
              .balance,
          ),
          1000 + amount * 2,
        );
      }
      const heldCustomer = randomUUID();
      await db.query('insert into customers(id,balance) values($1,1000)', [heldCustomer]);
      await db.query("insert into loyalty_reservations values($1,900,'active','infinity')", [
        heldCustomer,
      ]);
      await assert.rejects(
        db.query('select apply_manual_bonus_once($1,$2,-101,$3)', [
          randomUUID(),
          heldCustomer,
          'Reserved balance test',
        ]),
        /balance is reserved/,
      );
      await db.query('select apply_manual_bonus_once($1,$2,-100,$3)', [
        randomUUID(),
        heldCustomer,
        'Available balance test',
      ]);
      assert.equal(
        Number(
          (await db.query('select balance from customers where id=$1', [heldCustomer])).rows[0]
            .balance,
        ),
        900,
      );
      const rolledBack = randomUUID();
      await assert.rejects(
        db.query('select apply_manual_bonus_once($1,$2,50,$3,$4)', [
          rolledBack,
          heldCustomer,
          'Unknown branch test',
          randomUUID(),
        ]),
        /foreign key/,
      );
      assert.equal(
        Number(
          (await db.query('select balance from customers where id=$1', [heldCustomer])).rows[0]
            .balance,
        ),
        900,
      );
      assert.equal(
        (
          await db.query(
            'select count(*)::int count from manual_bonus_operations where operation_id=$1',
            [rolledBack],
          )
        ).rows[0].count,
        0,
      );
    } finally {
      await db.close();
    }
  },
);
