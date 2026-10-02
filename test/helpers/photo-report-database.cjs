const assert = require('node:assert/strict');
// Exercise the production SQL and services together, with a small PostgREST adapter.
function database(pg) {
  return {
    rpc: async (name, args) => {
      try {
        const values = Object.values(args);
        const placeholders = Object.keys(args).map((key, i) => `${key} => $${i + 1}`);
        const sql =
          name === 'claim_branch_closing_photo_cleanup'
            ? `select * from ${name}(${placeholders})`
            : `select ${name}(${placeholders}) as result`;
        const result = await pg.query(
          sql,
          values.map((value) => (Array.isArray(value) ? JSON.stringify(value) : value)),
        );
        return {
          data: name === 'claim_branch_closing_photo_cleanup' ? result.rows : result.rows[0].result,
        };
      } catch (error) {
        return { error };
      }
    },
    from(table) {
      let fields = '*',
        update,
        insert,
        upsert,
        single = false,
        limit = '',
        order = [];
      const conditions = [],
        values = [];
      const value = (v) => {
        values.push(v);
        return `$${values.length}`;
      };
      const query = {
        select(v) {
          fields = v;
          return this;
        },
        eq(k, v) {
          conditions.push(`${k} = ${value(v)}`);
          return this;
        },
        is(k, v) {
          assert.equal(v, null);
          conditions.push(`${k} is null`);
          return this;
        },
        in(k, v) {
          conditions.push(`${k} in (${v.map(value).join(',')})`);
          return this;
        },
        gte(k, v) {
          conditions.push(`${k} >= ${value(v)}`);
          return this;
        },
        lte(k, v) {
          conditions.push(`${k} <= ${value(v)}`);
          return this;
        },
        order(k) {
          order.push(k);
          return this;
        },
        range(a, b) {
          limit = `limit ${b - a + 1} offset ${a}`;
          return this;
        },
        update(v) {
          update = v;
          return this;
        },
        insert(v) {
          insert = v;
          return this;
        },
        upsert(v) {
          insert = v;
          upsert = true;
          return this;
        },
        single() {
          single = true;
          return this;
        },
        maybeSingle() {
          single = true;
          return this;
        },
        then(resolve, reject) {
          let sql;
          if (insert)
            sql = `insert into ${table}(${Object.keys(insert)}) values(${Object.values(insert).map(value)}) ${upsert ? 'on conflict do nothing' : ''} returning *`;
          else if (update)
            sql = `update ${table} set ${Object.entries(update).map(([k, v]) => `${k}=${value(v)}`)} ${conditions.length ? `where ${conditions.join(' and ')}` : ''} returning *`;
          else
            sql = `select ${fields} from ${table} ${conditions.length ? `where ${conditions.join(' and ')}` : ''} ${order.length ? `order by ${order}` : ''} ${limit}`;
          return pg
            .query(sql, values)
            .then(
              (result) => {
                const rows = result.rows.map((row) =>
                  Object.fromEntries(
                    Object.entries(row).map(([key, val]) => [
                      key,
                      val instanceof Date
                        ? key === 'business_date'
                          ? val.toISOString().slice(0, 10)
                          : val.toISOString()
                        : val,
                    ]),
                  ),
                );
                return { data: single ? (rows[0] ?? null) : rows };
              },
              (error) => ({ error }),
            )
            .then(resolve, reject);
        },
      };
      return query;
    },
  };
}

module.exports = { database };
