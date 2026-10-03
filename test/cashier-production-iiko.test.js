const test = require('node:test');
const assert = require('node:assert/strict');
const { XMLParser } = require('fast-xml-parser');
const {
  buildProductionXml,
  classifyProductionResponse,
  createProductionDocument,
  findProductionDocument,
  numberFor,
} = require('../src/services/cashier-production-iiko.service');
const act = {
  id: '11111111-1111-4111-8111-111111111111',
  branch_id: '22222222-2222-4222-8222-222222222222',
  source_store_id: 'bc1334bf-2eb0-8b09-0167-6366b33b000d',
  target_store_id: '33333333-3333-4333-8333-333333333333',
  business_date: '2026-10-03',
  created_at: '2026-10-03T18:05:30Z',
  server_id: 'aktau-chain',
  manifest: {
    postImmediately: false,
    items: [
      {
        productId: '44444444-4444-4444-8444-444444444444',
        productName: 'Кекс & <Milk>',
        amountUnit: '55555555-5555-4555-8555-555555555555',
        quantity: 1.125,
      },
    ],
  },
};
const accepted = {
  documentValidationResult: { valid: 'true', warning: 'false', documentNumber: numberFor(act) },
};
test('official cooking schema contains exact stores, main units, quantities and ordered fields', () => {
  const xml = buildProductionXml(act);
  const parsed = new XMLParser({ parseTagValue: false }).parse(xml).document;
  assert.deepEqual(Object.keys(parsed), [
    'status',
    'comment',
    'documentNumber',
    'dateIncoming',
    'storeTo',
    'storeFrom',
    'items',
  ]);
  assert.equal(parsed.status, 'NEW');
  assert.equal(parsed.dateIncoming, '2026-10-03T23:05:30');
  assert.equal(parsed.storeFrom, act.source_store_id);
  assert.equal(parsed.storeTo, act.target_store_id);
  assert.deepEqual(parsed.items.item, {
    amount: '1.125',
    product: act.manifest.items[0].productId,
    num: '1',
    amountUnit: act.manifest.items[0].amountUnit,
  });
  assert.ok(parsed.comment.includes(act.id));
  assert.ok(!xml.includes('Кекс') && !xml.includes('<id>') && !xml.includes('<ingredients>'));
  assert.equal(
    new XMLParser().parse(
      buildProductionXml({ ...act, manifest: { ...act.manifest, postImmediately: true } }),
    ).document.status,
    'PROCESSED',
  );
});
test('invalid, fractional overprecision and conflicting units cannot reach iiko', () => {
  for (const quantity of [0, -1, 100001, 1.0001, NaN, Infinity])
    assert.throws(() =>
      buildProductionXml({
        ...act,
        manifest: { ...act.manifest, items: [{ ...act.manifest.items[0], quantity }] },
      }),
    );
  assert.throws(() => buildProductionXml({ ...act, source_store_id: '<unsafe>' }));
  assert.throws(() => buildProductionXml({ ...act, created_at: 'not-date' }));
  assert.throws(() =>
    buildProductionXml({
      ...act,
      manifest: {
        ...act.manifest,
        items: [
          act.manifest.items[0],
          { ...act.manifest.items[0], amountUnit: act.target_store_id },
        ],
      },
    }),
  );
});
test('canonical main-unit aliases combine without float drift and preflight failure writes nothing', async () => {
  const aliases = {
    ...act,
    manifest: {
      ...act.manifest,
      items: [
        { ...act.manifest.items[0], quantity: 0.1, unit: 'шт' },
        { ...act.manifest.items[0], quantity: 0.2, unit: 'шт.' },
      ],
    },
  };
  const document = new XMLParser({ parseTagValue: false }).parse(
    buildProductionXml(aliases),
  ).document;
  assert.equal(document.items.item.amount, '0.300');
  let sessions = 0;
  const reports = {
    client: {
      withSession: async () => {
        sessions++;
      },
    },
  };
  const tooMuch = {
    ...act,
    manifest: {
      ...act.manifest,
      items: [
        { ...act.manifest.items[0], quantity: 60000 },
        { ...act.manifest.items[0], quantity: 60000 },
      ],
    },
  };
  assert.equal((await createProductionDocument(tooMuch, { reports })).status, 'failed');
  assert.equal(sessions, 0);
});
test('only explicit successful acknowledgement matching the frozen document number is created', () => {
  assert.deepEqual(classifyProductionResponse(accepted, act), {
    status: 'created',
    documentNumber: numberFor(act),
  });
  assert.equal(
    classifyProductionResponse({ documentValidationResult: { valid: false } }, act).status,
    'failed',
  );
  for (const response of [
    {},
    { documentValidationResult: { valid: true } },
    { documentValidationResult: { ...accepted.documentValidationResult, warning: true } },
    { documentValidationResult: { ...accepted.documentValidationResult, error: 'error' } },
    { documentValidationResult: { ...accepted.documentValidationResult, errorMessage: 'invalid' } },
    {
      documentValidationResult: { ...accepted.documentValidationResult, additionalInfo: 'changed' },
    },
    {
      documentValidationResult: {
        ...accepted.documentValidationResult,
        otherSuggestedNumber: 'other',
      },
    },
    { documentValidationResult: { ...accepted.documentValidationResult, documentNumber: 'other' } },
  ])
    assert.equal(classifyProductionResponse(response, act).status, 'unknown');
});
test('import uses documented XML endpoint and network uncertainty never triggers another write', async () => {
  const calls = [];
  const reports = {
    client: {
      withSession: async (server, work) => {
        calls.push(['session', server]);
        return work(async (...args) => {
          calls.push(args);
          return accepted;
        });
      },
    },
  };
  assert.equal((await createProductionDocument(act, { reports })).status, 'created');
  assert.equal(calls[1][0], 'documents/import/productionDocument');
  assert.equal(calls[1][2], 'xml');
  assert.equal(calls[1][3], 'xml');
  const uncertain = {
    client: {
      withSession: async () => {
        throw Error('https://host?key=secret');
      },
    },
  };
  const result = await createProductionDocument(act, { reports: uncertain });
  assert.equal(result.status, 'unknown');
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.equal((await findProductionDocument(act, { reports })).status, 'unknown');
  assert.equal(calls.length, 2);
});
test('a delayed queued import rechecks its durable send permission before writing', async () => {
  const calls = [];
  const reports = {
    client: {
      withSession: async (_server, work) =>
        work(async () => {
          calls.push('write');
          return accepted;
        }),
    },
  };
  const deniedResult = await createProductionDocument(act, {
    reports,
    beforeSend: async () => {
      calls.push('guard');
      return false;
    },
  });
  assert.equal(deniedResult.status, 'unknown');
  assert.deepEqual(calls, ['guard']);
  calls.length = 0;
  await createProductionDocument(act, {
    reports,
    beforeSend: async () => {
      calls.push('guard');
      return true;
    },
  });
  assert.deepEqual(calls, ['guard', 'write']);
});
