const test = require('node:test');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const {
  bindings,
  loadOutgoingDocuments,
  normalizeDocuments,
} = require('../src/services/iiko-outgoing-documents');
const { IikoOutgoingSync } = require('../src/services/iiko-outgoing-sync.service');

const id = (n) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const branch = id(1),
  department = id(2),
  store = id(3),
  product = id(4),
  unit = id(5),
  invoiceId = id(6);
const server = { id: 'aktau-chain', city: 'aktau' };
const mapping = { [branch]: { serverId: server.id, departmentId: department } };
const invoice = (changes = {}) => ({
  id: invoiceId,
  documentNumber: '000042',
  status: 'PROCESSED',
  dateIncoming: '2026-09-26T13:00:00',
  defaultStoreId: store,
  items: { item: [{ productId: product, amount: '2' }] },
  ...changes,
});
const dataset = (documents = [invoice()]) => ({
  documents,
  stores: [{ id: store, parentId: department }],
  products: [{ id: product, mainUnit: unit }],
  units: [{ id: unit, name: 'шт.' }],
});

test('outgoing mapping accepts explicit overrides, removal and separate server identities', () => {
  const configured = bindings({
    IIKO_OUTGOING_BRANCHES_JSON: JSON.stringify({ [branch]: mapping[branch] }),
  });
  assert.deepEqual(configured[branch], mapping[branch]);
  const disabled = Object.fromEntries(Object.keys(bindings({})).map((key) => [key, null]));
  assert.deepEqual(bindings({ IIKO_OUTGOING_BRANCHES_JSON: JSON.stringify(disabled) }), {});
  for (const input of [
    [],
    { [branch]: { serverId: 'invalid server', departmentId: department } },
    { [branch]: { serverId: server.id, departmentId: 'not-an-id' } },
  ]) {
    assert.throws(() => bindings({ IIKO_OUTGOING_BRANCHES_JSON: JSON.stringify(input) }), {
      code: 'IIKO_OUTGOING_INVALID',
    });
  }
  assert.throws(
    () =>
      bindings({
        IIKO_OUTGOING_BRANCHES_JSON: JSON.stringify({
          [branch]: mapping[branch],
          [id(7)]: mapping[branch],
        }),
      }),
    { code: 'IIKO_OUTGOING_INVALID' },
  );
});

test('outgoing normalizer preserves invoice identity, branch and UTC+05 time without guessing names', () => {
  const [result] = normalizeDocuments(dataset(), server, mapping);
  assert.deepEqual(result, {
    id: invoiceId,
    number: '000042',
    postedAt: '2026-09-26T08:00:00.000Z',
    status: 'PROCESSED',
    items: [{ branchId: branch, productId: product, quantity: 2, unit: 'шт' }],
  });
  const [utc] = normalizeDocuments(
    dataset([invoice({ dateIncoming: '2026-09-26T08:00:00Z' })]),
    server,
    mapping,
  );
  assert.equal(utc.postedAt, result.postedAt);
});

test('outgoing quantities aggregate once by branch and support fractional kg with city namespacing', () => {
  const data = dataset([
    invoice({
      items: {
        item: [
          { productId: product, amount: '0.125' },
          { productId: product, amount: '0.250' },
        ],
      },
    }),
  ]);
  data.units[0].name = 'кг';
  const [result] = normalizeDocuments(data, { ...server, city: 'astana' }, mapping);
  assert.deepEqual(result.items, [
    { branchId: branch, productId: `astana:${product}`, quantity: 0.375, unit: 'кг' },
  ]);
});

test('outgoing XML singleton items and duplicate identical documents are handled once', () => {
  const document = invoice({ items: { item: { productId: product, amount: '3' } } });
  const result = normalizeDocuments(
    dataset([document, structuredClone(document)]),
    server,
    mapping,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].items[0].quantity, 3);
  assert.throws(
    () =>
      normalizeDocuments(
        dataset([document, invoice({ documentNumber: 'changed' })]),
        server,
        mapping,
      ),
    { code: 'IIKO_OUTGOING_INVALID' },
  );
});

test('outgoing draft/deletion remain tombstones while unrelated mapped-server departments do not affect stock', () => {
  for (const status of ['NEW', 'DELETED']) {
    const [result] = normalizeDocuments(
      dataset([invoice({ status, items: undefined })]),
      server,
      mapping,
    );
    assert.equal(result.status, status);
    assert.deepEqual(result.items, []);
  }
  assert.deepEqual(
    normalizeDocuments(dataset(), { ...server, id: 'different-server' }, mapping)[0].items,
    [],
  );
  assert.deepEqual(
    normalizeDocuments(dataset(), server, {
      [branch]: { serverId: server.id, departmentId: id(10) },
    })[0].items,
    [],
  );
});

test('outgoing invalid mapped quantities or unknown references fail the entire document', () => {
  for (const amount of ['0', '-1', '1.0001', 'NaN', '100001', '1e3']) {
    assert.throws(
      () =>
        normalizeDocuments(
          dataset([invoice({ items: { item: { productId: product, amount } } })]),
          server,
          mapping,
        ),
      { code: 'IIKO_OUTGOING_INVALID' },
    );
  }
  for (const field of ['stores', 'products', 'units']) {
    const data = dataset();
    data[field] = [];
    assert.throws(() => normalizeDocuments(data, server, mapping), {
      code: 'IIKO_OUTGOING_INVALID',
    });
  }
  const data = dataset();
  data.units[0].name = 'x'.repeat(41);
  assert.throws(() => normalizeDocuments(data, server, mapping), { code: 'IIKO_OUTGOING_INVALID' });
});

test('outgoing explicit invoice units are retained instead of different product base units', () => {
  const data = dataset([
    invoice({ items: { item: { productId: product, amount: '2', amountUnit: id(8) } } }),
  ]);
  data.units.push({ id: id(8), name: 'кг' });
  assert.equal(normalizeDocuments(data, server, mapping)[0].items[0].unit, 'кг');
  data.documents[0].items.item = [
    data.documents[0].items.item,
    { productId: product, amount: '1' },
  ];
  assert.throws(() => normalizeDocuments(data, server, mapping), { code: 'IIKO_OUTGOING_INVALID' });
});

test('outgoing ingredient measures and fractional quantities reach tracked-stock validation unchanged', () => {
  const data = dataset([invoice({ items: { item: { productId: product, amount: '0.125' } } })]);
  data.units[0].name = 'Литр';
  assert.deepEqual(normalizeDocuments(data, server, mapping)[0].items[0], {
    branchId: branch,
    productId: product,
    quantity: 0.125,
    unit: 'литр',
  });
  data.units[0].name = 'шт.';
  assert.equal(normalizeDocuments(data, server, mapping)[0].items[0].quantity, 0.125);
});

test('outgoing invalid calendar dates never normalize silently to a different stock day', () => {
  assert.throws(
    () =>
      normalizeDocuments(
        dataset([invoice({ dateIncoming: '2026-02-30T12:00:00' })]),
        server,
        mapping,
      ),
    { code: 'IIKO_OUTGOING_INVALID' },
  );
});

test('outgoing conflicting reference IDs cannot silently override product units or store departments', () => {
  for (const [field, row] of [
    ['units', { id: unit, name: 'кг' }],
    ['products', { id: product, mainUnit: id(8) }],
    ['stores', { id: store, parentId: id(9) }],
  ]) {
    const data = dataset();
    data.units.push({ id: id(8), name: 'кг' });
    data[field].push(row);
    assert.throws(() => normalizeDocuments(data, server, mapping), {
      code: 'IIKO_OUTGOING_INVALID',
    });
  }
});

test('outgoing loader fetches every counteragent with complete directories and no supplier filter', async () => {
  const calls = [];
  const data = dataset();
  const result = await loadOutgoingDocuments(
    async (path, body, format) => {
      calls.push(path);
      assert.equal(body, undefined);
      if (path.startsWith('documents/')) {
        assert.equal(format, 'xml');
        const params = new URLSearchParams(path.split('?')[1]);
        assert.deepEqual(
          [...params],
          [
            ['from', '2026-09-01'],
            ['to', '2026-09-26'],
          ],
        );
        return { outgoingInvoiceDtoes: { document: data.documents[0] } };
      }
      if (path === 'corporation/stores')
        return { corporateItemDtoes: { corporateItemDto: data.stores[0] } };
      return path.includes('products/list') ? data.products : data.units;
    },
    '2026-09-01',
    '2026-09-26',
  );
  assert.deepEqual(result, data);
  assert.equal(calls.length, 4);
});

test('outgoing loader distinguishes an empty export from malformed or incomplete data', async () => {
  let count = 0;
  assert.deepEqual(
    await loadOutgoingDocuments(
      async () => {
        count++;
        return { outgoingInvoiceDtoes: '' };
      },
      '2026-09-01',
      '2026-09-26',
    ),
    { documents: [], stores: [], products: [], units: [] },
  );
  assert.equal(count, 1);
  await assert.rejects(
    loadOutgoingDocuments(async () => ({}), '2026-09-01', '2026-09-26'),
    { code: 'IIKO_OUTGOING_INVALID' },
  );
  await assert.rejects(
    loadOutgoingDocuments(
      async (path) => {
        if (path.startsWith('documents/')) return { outgoingInvoiceDtoes: { document: invoice() } };
        if (path === 'corporation/stores') return { corporateItemDtoes: '' };
        return {};
      },
      '2026-09-01',
      '2026-09-26',
    ),
    { code: 'IIKO_OUTGOING_INVALID' },
  );
});

function workerFixture({
  startedAt = '2026-09-26T00:00:00Z',
  scanDate = '2026-09-26',
  now = '2026-09-26T10:00:00Z',
  documents = [],
  locked = false,
} = {}) {
  const state = { started_at: startedAt, scan_date: scanDate };
  const calls = [],
    ranges = [],
    ledgerReads = [],
    published = [],
    warnings = [],
    applied = new Map();
  const options = { failFetch: false, loseApplyReply: false, failLedger: false };
  const db = {
    from: (table) => {
      assert.equal(table, 'iiko_outgoing_stock_documents');
      assert.equal(calls[0]?.name, 'claim_iiko_outgoing_sync');
      const query = {};
      return {
        select(columns, options) {
          assert.equal(columns, 'document_id,payload');
          assert.deepEqual(options, { count: 'exact' });
          return this;
        },
        eq(column, value) {
          assert.equal(column, 'city');
          query.city = value;
          return this;
        },
        in(column, ids) {
          assert.equal(column, 'document_id');
          query.ids = ids;
          return this;
        },
        abortSignal(signal) {
          assert.ok(signal instanceof AbortSignal);
          query.signal = signal;
          return this;
        },
        async limit(limit) {
          assert.equal(limit, query.ids.length);
          assert.equal(query.city, server.city);
          assert.ok(limit <= 100);
          ledgerReads.push(query);
          if (query.signal.aborted) return { error: { message: 'fixture ledger request aborted' } };
          if (options.failLedger) return { error: { message: 'fixture ledger unavailable' } };
          const data = query.ids
            .filter((id) => applied.has(id))
            .map((id) => ({ document_id: id, payload: applied.get(id) }));
          if (options.ledgerResponse) return options.ledgerResponse(data);
          return { data, count: data.length };
        },
      };
    },
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'claim_iiko_outgoing_sync') return { data: locked ? null : { ...state } };
      if (name === 'finish_iiko_outgoing_sync') {
        if (args.p_next_date !== null) state.scan_date = args.p_next_date;
        return { data: null };
      }
      assert.equal(name, 'apply_iiko_outgoing_invoice');
      const key = args.p_document.id;
      const duplicate = isDeepStrictEqual(applied.get(key), args.p_document);
      if (!duplicate) applied.set(key, args.p_document);
      if (options.loseApplyReply) {
        options.loseApplyReply = false;
        return { error: { message: 'fixture response lost after database commit' } };
      }
      return { data: { changed: !duplicate, duplicate, branchIds: [branch], shortage: true } };
    },
  };
  const client = {
    listServers: async () => [{ ...server, active: true, configured: true }],
    withSession: async (serverId, callback) => {
      assert.equal(serverId, server.id);
      return callback(async (path) => {
        if (path.startsWith('documents/')) {
          const params = new URLSearchParams(path.split('?')[1]);
          const range = { from: params.get('from'), to: params.get('to') };
          ranges.push(range);
          if (options.failFetch)
            throw Object.assign(new Error('fixture offline'), { code: 'OFFLINE' });
          const rows = typeof documents === 'function' ? documents(range) : documents;
          return { outgoingInvoiceDtoes: { document: rows } };
        }
        const data = dataset();
        if (path === 'corporation/stores')
          return { corporateItemDtoes: { corporateItemDto: data.stores } };
        return path.includes('products/list') ? data.products : data.units;
      });
    },
  };
  const worker = new IikoOutgoingSync({
    db,
    client,
    env: { IIKO_OUTGOING_CITIES: 'aktau' },
    now: () => new Date(now),
    publish: (...args) => published.push(args),
    log: { error: () => {}, warn: (...args) => warnings.push(args) },
  });
  return { worker, state, calls, ranges, ledgerReads, published, warnings, applied, options };
}

test('outgoing worker obeys lease ownership and uses the same lease through apply and finish', async () => {
  const busy = workerFixture({ locked: true });
  await busy.worker.syncSource(server, mapping);
  assert.equal(busy.ranges.length, 0);
  assert.equal(busy.calls.length, 1);
  const own = workerFixture({ documents: [invoice()] });
  await own.worker.syncSource(server, mapping);
  const lease = own.calls[0].args.p_lease;
  assert(own.calls.every(({ args }) => args.p_lease === lease && args.p_city === server.city));
  assert.equal(own.published.length, 1);
  assert.equal(own.published[0][1].branchId, branch);
  assert.equal(own.warnings.length, 1);
});

test('outgoing first context does not export pre-installation history across local midnight', async () => {
  const context = workerFixture({
    startedAt: '2026-09-25T20:30:00Z',
    scanDate: '2026-09-01',
    now: '2026-09-26T01:00:00Z',
  });
  await context.worker.syncSource(server, mapping);
  assert.deepEqual(context.ranges, [{ from: '2026-09-26', to: '2026-09-26' }]);
  assert.equal(context.state.scan_date, '2026-09-26');
});

test('outgoing catch-up gives fresh data priority then advances a durable bounded seven-day sweep', async () => {
  const context = workerFixture({ startedAt: '2026-09-01T00:00:00Z', scanDate: '2026-09-08' });
  await context.worker.syncSource(server, mapping);
  assert.deepEqual(context.ranges, [
    { from: '2026-09-25', to: '2026-09-26' },
    { from: '2026-09-08', to: '2026-09-14' },
  ]);
  assert.equal(context.state.scan_date, '2026-09-15');
  context.ranges.length = 0;
  await context.worker.syncSource(server, mapping);
  assert.deepEqual(context.ranges[1], { from: '2026-09-15', to: '2026-09-21' });
  assert.equal(context.state.scan_date, '2026-09-22');
});

test('outgoing offline releases its lease without advancing cursor and resumes the missed range', async () => {
  const context = workerFixture({ startedAt: '2026-09-01T00:00:00Z', scanDate: '2026-09-08' });
  context.options.failFetch = true;
  await assert.rejects(context.worker.syncSource(server, mapping), { code: 'OFFLINE' });
  assert.equal(context.calls.at(-1).name, 'finish_iiko_outgoing_sync');
  assert.equal(context.calls.at(-1).args.p_next_date, null);
  assert.equal(context.state.scan_date, '2026-09-08');
  context.options.failFetch = false;
  context.ranges.length = 0;
  await context.worker.syncSource(server, mapping);
  assert.deepEqual(context.ranges[1], { from: '2026-09-08', to: '2026-09-14' });
});

test('outgoing response loss after apply reads the durable identity without another apply RPC', async () => {
  const context = workerFixture({ documents: [invoice()] });
  context.options.loseApplyReply = true;
  await assert.rejects(context.worker.syncSource(server, mapping), {
    code: 'IIKO_OUTGOING_STORAGE',
  });
  assert.equal(context.applied.size, 1);
  assert.equal(context.calls.at(-1).args.p_next_date, null);
  await context.worker.syncSource(server, mapping);
  assert.equal(
    context.calls.filter(({ name }) => name === 'apply_iiko_outgoing_invoice').length,
    1,
  );
  assert.equal(context.applied.size, 1);
  assert.equal(context.published.length, 0);
  assert.equal(context.warnings.length, 0);
});

test('outgoing ledger prefilter uses bounded city-scoped reads and ignores JSONB key order', async () => {
  const documents = Array.from({ length: 205 }, (_, index) => invoice({ id: id(index + 100) }));
  const context = workerFixture({ documents });
  const reorder = (value) =>
    Array.isArray(value)
      ? value.map(reorder)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, item]) => [key, reorder(item)]),
          )
        : value;
  for (const document of normalizeDocuments(dataset(documents), server, mapping))
    context.applied.set(document.id, reorder(document));
  await context.worker.syncSource(server, mapping);
  assert.deepEqual(
    context.ledgerReads.map(({ city, ids }) => [city, ids.length]),
    [
      ['aktau', 100],
      ['aktau', 100],
      ['aktau', 5],
    ],
  );
  assert.deepEqual(
    context.calls.map(({ name }) => name),
    ['claim_iiko_outgoing_sync', 'finish_iiko_outgoing_sync'],
  );
  assert.equal(context.calls.at(-1).args.p_next_date, '2026-09-26');
});

test('outgoing first cycle skips untracked earlier or exact-boundary documents after checking identities', async () => {
  const context = workerFixture({
    startedAt: '2026-09-26T09:00:00Z',
    documents: [
      invoice(),
      invoice({ id: id(7), dateIncoming: '2026-09-26T14:00:00' }),
      invoice({ id: id(8), dateIncoming: '2026-09-26T14:00:01' }),
    ],
  });
  await context.worker.syncSource(server, mapping);
  assert.equal(context.ledgerReads[0].ids.length, 3);
  assert.deepEqual(
    context.calls
      .filter(({ name }) => name === 'apply_iiko_outgoing_invoice')
      .map(({ args }) => args.p_document.id),
    [id(8)],
  );
  assert.equal(context.applied.size, 1);
});

test('outgoing known revision moved before tracking is still sent to the SQL recount guard', async () => {
  const changed = invoice({ dateIncoming: '2026-09-26T13:00:00' });
  const context = workerFixture({ startedAt: '2026-09-26T09:00:00Z', documents: [changed] });
  context.applied.set(
    invoiceId,
    normalizeDocuments(
      dataset([invoice({ dateIncoming: '2026-09-26T14:30:00' })]),
      server,
      mapping,
    )[0],
  );
  const original = context.worker.db.rpc;
  context.worker.db.rpc = async (name, args) =>
    name === 'apply_iiko_outgoing_invoice'
      ? { error: { message: 'Outgoing invoice date crossed a physical count; recount required' } }
      : original(name, args);
  await assert.rejects(context.worker.syncSource(server, mapping), {
    code: 'IIKO_OUTGOING_RECOUNT_REQUIRED',
  });
  assert.equal(context.calls.at(-1).args.p_next_date, null);
  assert.equal(context.published.length, 0);
});

test('outgoing delayed edits with the same timestamp, cancellations and item removals reach apply', async () => {
  for (const revised of [
    invoice({ items: { item: { productId: product, amount: '3' } } }),
    invoice({ status: 'DELETED', items: undefined }),
    invoice({ status: 'NEW', items: undefined }),
    invoice({ items: undefined }),
  ]) {
    const context = workerFixture({
      startedAt: '2026-09-01T00:00:00Z',
      scanDate: '2026-09-08',
      documents: ({ from }) => (from === '2026-09-25' ? [revised] : []),
    });
    context.applied.set(invoiceId, normalizeDocuments(dataset(), server, mapping)[0]);
    await context.worker.syncSource(server, mapping);
    assert.equal(
      context.calls.filter(({ name }) => name === 'apply_iiko_outgoing_invoice').length,
      1,
    );
    assert.deepEqual(
      context.applied.get(invoiceId),
      normalizeDocuments(dataset([revised]), server, mapping)[0],
    );
    assert.equal(context.published.length, 1);
  }
});

test('outgoing ledger failures and incomplete responses never apply or advance the cursor', async () => {
  for (const response of [
    () => ({ error: { message: 'read failed' } }),
    () => {
      throw new Error('connection lost');
    },
    () => ({ data: null, count: 0 }),
    () => ({ data: [], count: 1 }),
    () => ({ data: [], count: null }),
    () => ({ data: [{ document_id: invoiceId, payload: null }], count: 1 }),
    () => ({ data: [{ document_id: id(999), payload: { id: id(999) } }], count: 1 }),
  ]) {
    const context = workerFixture({
      startedAt: '2026-09-01T00:00:00Z',
      scanDate: '2026-09-08',
      documents: [invoice()],
    });
    context.options.ledgerResponse = response;
    await assert.rejects(context.worker.syncSource(server, mapping), {
      code: 'IIKO_OUTGOING_STORAGE',
    });
    assert.equal(context.applied.size, 0);
    assert.equal(context.calls.at(-1).args.p_next_date, null);
    assert.equal(context.state.scan_date, '2026-09-08');
  }
});

test('outgoing reads every ledger chunk before applying any candidate and retries a failed later chunk', async () => {
  const documents = Array.from({ length: 101 }, (_, index) => invoice({ id: id(index + 100) }));
  const context = workerFixture({ documents });
  context.options.ledgerResponse = (data) =>
    context.ledgerReads.length === 2
      ? { error: { message: 'second chunk unavailable' } }
      : { data, count: data.length };
  await assert.rejects(context.worker.syncSource(server, mapping), {
    code: 'IIKO_OUTGOING_STORAGE',
  });
  assert.equal(context.applied.size, 0);
  assert.equal(context.calls.at(-1).args.p_next_date, null);
  context.options.ledgerResponse = undefined;
  await context.worker.syncSource(server, mapping);
  assert.equal(context.applied.size, 101);
  assert.equal(
    context.calls.filter(({ name }) => name === 'apply_iiko_outgoing_invoice').length,
    101,
  );
});

test('outgoing ledger read has a bounded timeout and an abort releases the lease without advancing', async (t) => {
  let timeouts = 0;
  t.mock.method(AbortSignal, 'timeout', (milliseconds) => {
    assert.equal(milliseconds, 15_000);
    timeouts++;
    const controller = new AbortController();
    controller.abort();
    return controller.signal;
  });
  const context = workerFixture({ documents: [invoice()] });
  await assert.rejects(context.worker.syncSource(server, mapping), {
    code: 'IIKO_OUTGOING_STORAGE',
  });
  assert.equal(timeouts, 1);
  assert.equal(context.ledgerReads[0].signal.aborted, true);
  assert.equal(context.applied.size, 0);
  assert.equal(context.calls.at(-1).name, 'finish_iiko_outgoing_sync');
  assert.equal(context.calls.at(-1).args.p_next_date, null);
});

test('outgoing full export is validated before any mutation or cursor advance', async () => {
  const context = workerFixture({
    documents: [invoice(), invoice({ id: id(12), dateIncoming: '2026-09-25T13:00:00' })],
  });
  await assert.rejects(context.worker.syncSource(server, mapping), { code: 'IIKO_OUTGOING_RANGE' });
  assert.equal(context.applied.size, 0);
  assert.equal(context.calls.at(-1).args.p_next_date, null);
});

test('outgoing configuration rejects missing sources and duplicate feeds for the same city', async () => {
  const context = workerFixture();
  context.worker.client.listServers = async () => [];
  await assert.rejects(context.worker.sync(), { code: 'IIKO_OUTGOING_MAPPING' });
  context.worker.env = {
    IIKO_OUTGOING_BRANCHES_JSON: JSON.stringify({
      [branch]: { serverId: 'aktau-rms', departmentId: department },
    }),
  };
  context.worker.client.listServers = async () => [
    { ...server, active: true, configured: true },
    { ...server, id: 'aktau-rms', active: true, configured: true },
  ];
  await assert.rejects(context.worker.sync(), { code: 'IIKO_OUTGOING_MAPPING' });
  assert.equal(context.calls.length, 0);
});

test('outgoing requires both cities by default but completes available sources before failing health', async () => {
  const context = workerFixture();
  context.worker.env = {};
  const errors = [];
  context.worker.log.error = (entry) => errors.push(entry);
  await assert.rejects(context.worker.sync(), { code: 'IIKO_OUTGOING_MAPPING_INCOMPLETE' });
  assert(context.calls.some(({ name }) => name === 'finish_iiko_outgoing_sync'));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].city, 'astana');
  context.calls.length = 0;
  context.worker.env.IIKO_OUTGOING_CITIES = 'aktau';
  await context.worker.sync();
  assert(context.calls.some(({ name }) => name === 'finish_iiko_outgoing_sync'));
});

test('outgoing required city names must be nonempty, known and unique before any I/O', async () => {
  for (const value of ['', 'aktau,aktau', 'almaty', 'aktau,', 'ASTANA']) {
    const context = workerFixture();
    context.worker.env.IIKO_OUTGOING_CITIES = value;
    context.worker.client.listServers = async () =>
      assert.fail('invalid cities must fail before I/O');
    await assert.rejects(context.worker.sync(), { code: 'IIKO_OUTGOING_MAPPING' });
    assert.equal(context.calls.length, 0);
  }
});

test('outgoing both configured cities each retain their own source and lease', async () => {
  const context = workerFixture();
  context.worker.env = {
    IIKO_OUTGOING_CITIES: 'aktau,astana',
    IIKO_OUTGOING_BRANCHES_JSON: JSON.stringify({
      [id(30)]: { serverId: 'astana-rms', departmentId: id(31) },
    }),
  };
  context.worker.client.listServers = async () => [
    { ...server, active: true, configured: true },
    { id: 'astana-rms', city: 'astana', active: true, configured: true },
  ];
  const sources = [];
  context.worker.syncSource = async (source, mapped) => {
    sources.push(source.id);
    assert.equal(mapped[id(30)].departmentId, id(31));
  };
  await context.worker.sync();
  assert.deepEqual(sources, ['aktau-chain', 'astana-rms']);
});
