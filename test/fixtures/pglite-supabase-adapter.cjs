// Adapter translates the real service's PostgREST operations into SQL. It does
// not grade, authorize, calculate XP, or emulate any learning business rules.
const identifier = (value) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('Invalid fixture SQL identifier');
  return `"${value}"`;
};
const encoded = (column, value) =>
  ['modules', 'questions', 'answers'].includes(column) && value != null
    ? JSON.stringify(value)
    : value;
const normalized = (row) =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date
        ? key === 'start_date'
          ? value.toISOString().slice(0, 10)
          : value.toISOString()
        : value,
    ]),
  );

function createSupabaseAdapter(pg) {
  class Query {
    constructor(table) {
      this.table = identifier(table);
      this.filters = [];
      this.orders = [];
      this.columns = '*';
    }
    select(columns = '*') {
      this.columns = columns === '*' ? '*' : columns.split(',').map(identifier).join(',');
      return this;
    }
    eq(column, value) {
      this.filters.push([column, '=', value]);
      return this;
    }
    is(column, value) {
      this.filters.push([column, 'is', value]);
      return this;
    }
    gt(column, value) {
      this.filters.push([column, '>', value]);
      return this;
    }
    order(column, options = {}) {
      this.orders.push(`${identifier(column)} ${options.ascending === false ? 'desc' : 'asc'}`);
      return this;
    }
    range(start, end) {
      this.offset = start;
      this.limitCount = end - start + 1;
      return this;
    }
    limit(value) {
      this.limitCount = value;
      return this;
    }
    maybeSingle() {
      this.singleRow = true;
      return this;
    }
    single() {
      this.singleRow = true;
      return this;
    }
    insert(input) {
      this.operation = 'insert';
      this.input = input;
      return this;
    }
    upsert(input, options = {}) {
      this.operation = 'upsert';
      this.input = input;
      this.conflict = options.onConflict || 'id';
      return this;
    }
    update(input) {
      this.operation = 'update';
      this.input = input;
      return this;
    }
    delete() {
      this.operation = 'delete';
      return this;
    }
    async execute() {
      const parameters = [];
      const bind = (column, value) => {
        parameters.push(encoded(column, value));
        return `$${parameters.length}`;
      };
      const where = () =>
        this.filters.length
          ? ` where ${this.filters
              .map(([column, operator, value]) =>
                operator === 'is' && value == null
                  ? `${identifier(column)} is null`
                  : `${identifier(column)} ${operator === 'is' ? '=' : operator} ${bind(column, value)}`,
              )
              .join(' and ')}`
          : '';
      let sql;
      if (this.operation === 'insert' || this.operation === 'upsert') {
        const columns = Object.keys(this.input);
        sql = `insert into ${this.table} (${columns.map(identifier).join(',')}) values (${columns.map((key) => bind(key, this.input[key])).join(',')})`;
        if (this.operation === 'upsert')
          sql += ` on conflict (${identifier(this.conflict)}) do update set ${columns
            .filter((key) => key !== this.conflict)
            .map((key) => `${identifier(key)}=excluded.${identifier(key)}`)
            .join(',')}`;
        sql += ` returning ${this.columns}`;
      } else if (this.operation === 'update') {
        sql = `update ${this.table} set ${Object.entries(this.input)
          .map(([column, value]) => `${identifier(column)}=${bind(column, value)}`)
          .join(',')}${where()} returning ${this.columns}`;
      } else if (this.operation === 'delete')
        sql = `delete from ${this.table}${where()} returning ${this.columns}`;
      else
        sql = `select ${this.columns} from ${this.table}${where()}${this.orders.length ? ` order by ${this.orders.join(',')}` : ''}${this.limitCount != null ? ` limit ${bind('limit', this.limitCount)}` : ''}${this.offset ? ` offset ${bind('offset', this.offset)}` : ''}`;
      try {
        const result = await pg.query(sql, parameters);
        const rows = result.rows.map(normalized);
        return { data: this.singleRow ? rows[0] || null : rows, error: null };
      } catch (error) {
        return { data: null, error: { code: error.code, message: error.message } };
      }
    }
    then(resolve, reject) {
      return this.execute().then(resolve, reject);
    }
  }
  return {
    from: (table) => new Query(table),
    rpc: async (name, args) => {
      try {
        identifier(name);
        const entries = Object.entries(args || {});
        const values = entries.map(([key, value]) =>
          key === 'p_answers' ? JSON.stringify(value) : value,
        );
        const call = `${identifier(name)}(${entries.map(([key], index) => `${identifier(key)}=>$${index + 1}`).join(',')})`;
        const setResult = name === 'get_cashier_auth_record';
        const result = await pg.query(
          setResult ? `select * from ${call}` : `select ${call} as result`,
          values,
        );
        return {
          data: setResult ? result.rows.map(normalized) : result.rows[0].result,
          error: null,
        };
      } catch (error) {
        return { data: null, error: { code: error.code, message: error.message } };
      }
    },
  };
}

module.exports = { createSupabaseAdapter };
