const test = require('node:test');
const assert = require('node:assert/strict');
const { parseReceiptQr } = require('../src/services/fortune-receipt-qr');
const {
  lookupFiscalReceipt,
  verifiedWofdTicket,
  verifiedOofdTicket,
} = require('../src/services/fortune-receipt-provider');
const qr = 'https://consumer.wofd.kz/?i=527035232&f=090500022375&s=3007.50&t=20261010T191800';
const receipt = parseReceiptQr(qr);
const payload = () => ({
  found: 1,
  ticket: [
    { style: 0, text: 'Bulka' },
    { style: 0, text: 'ПРОДАЖА' },
    { style: 0, text: 'ЗНМ: SWK00534409' },
    { style: 2, text: qr },
  ],
});
const response = (body, status = 200, type = 'application/json') => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: () => type },
  text: async () => JSON.stringify(body),
});

test('WOFD authoritative response must corroborate all QR fields and exactly one sale serial', () => {
  assert.equal(verifiedWofdTicket(payload(), receipt).registerSerial, 'SWK00534409');
  for (const body of [
    { ...payload(), found: 0 },
    { ...payload(), found: 2 },
    { ...payload(), ticket: payload().ticket.filter((line) => !line.text.startsWith('https:')) },
    {
      ...payload(),
      ticket: payload().ticket.map((line) => ({
        ...line,
        text: line.text.replace('3007.50', '180.00'),
      })),
    },
    {
      ...payload(),
      ticket: payload().ticket.map((line) => ({
        ...line,
        text: line.text.replace('191800', '191801'),
      })),
    },
    {
      ...payload(),
      ticket: payload().ticket.map((line) => ({
        ...line,
        text: line.text.replace('ПРОДАЖА', 'ВОЗВРАТ'),
      })),
    },
    { ...payload(), ticket: payload().ticket.concat({ text: 'ВОЗВРАТ' }) },
  ])
    assert.throws(() => verifiedWofdTicket(body, receipt), { code: 'FORTUNE_RECEIPT_NOT_FOUND' });
  const duplicate = payload();
  duplicate.ticket.push({ text: 'ЗНМ: SWK11111111' });
  assert.throws(() => verifiedWofdTicket(duplicate, receipt), {
    code: 'FORTUNE_RECEIPT_UNAVAILABLE',
  });
  assert.throws(() => verifiedWofdTicket({ found: 1, ticket: '<script>bad</script>' }, receipt));
  const numbered = payload();
  numbered.ticket.push({ text: 'ЧЕК № 3784' });
  assert.equal(verifiedWofdTicket(numbered, receipt).fiscalOrdinal, '3784');
});

test('lookup uses only the fixed official endpoint, validated fields and no redirects', async () => {
  let calls = 0;
  const result = await lookupFiscalReceipt(receipt, {
    fetchImpl: async (url, options) => {
      calls++;
      const target = new URL(url);
      assert.equal(target.origin, 'https://cabinet.wofd.kz');
      assert.equal(target.pathname, '/api/tickets');
      assert.equal(target.searchParams.get('registrationNumber'), receipt.registrationNumber);
      assert.equal(target.searchParams.get('ticketNumber'), receipt.fiscalSign);
      assert.equal(target.searchParams.get('ticketDate'), '2026-10-10');
      assert.equal(options.redirect, 'error');
      assert.equal(options.method, 'GET');
      assert.equal(options.size, 256 * 1024);
      return response(payload());
    },
  });
  assert.equal(result.source, 'wofd');
  assert.equal(calls, 1);
});

test('provider outage, malformed or HTML result never becomes a verified receipt', async () => {
  const cases = [
    response({}, 500),
    response({}, 302),
    response({}, 200, 'text/html'),
    { ...response({}), text: async () => '{' },
    { ...response({}), text: async () => 'x'.repeat(256 * 1024 + 1) },
  ];
  for (const value of cases)
    await assert.rejects(() => lookupFiscalReceipt(receipt, { fetchImpl: async () => value }), {
      code: 'FORTUNE_RECEIPT_UNAVAILABLE',
    });
  await assert.rejects(
    () =>
      lookupFiscalReceipt(receipt, {
        fetchImpl: async () => {
          throw new Error('upstream URL');
        },
      }),
    { code: 'FORTUNE_RECEIPT_UNAVAILABLE' },
  );
  for (const status of [400, 404])
    await assert.rejects(
      () => lookupFiscalReceipt(receipt, { fetchImpl: async () => response({}, status) }),
      { code: 'FORTUNE_RECEIPT_NOT_FOUND' },
    );
});

test('unimplemented fiscal provider fails closed without external requests', async () => {
  await assert.rejects(
    () =>
      lookupFiscalReceipt(
        { ...receipt, provider: 'webkassa' },
        {
          fetchImpl: () => {
            throw new Error('must not call');
          },
        },
      ),
    { code: 'FORTUNE_RECEIPT_UNAVAILABLE' },
  );
});

const oofdPayload = () => ({
  kkmFnsId: receipt.registrationNumber,
  kkmSerialNumber: 'SWK00534409',
  ticket: {
    type: 'TICKET',
    operationType: 2,
    cancelDate: null,
    transactionDate: receipt.localClosedAt + '.000',
    fiscalId: receipt.fiscalSign,
    offlineFiscalId: null,
    totalSum: receipt.total,
    items: [
      {
        itemType: 1,
        commodity: { quantity: 2, sum: receipt.total, taxes: [{ inTotalSum: true, sum: 322.23 }] },
      },
    ],
    discount: null,
    markup: null,
    options: { children: [{ name: 'printedDocumentNumber', value: '3784' }] },
  },
});

test('OOFD structured official ticket corroborates RNM, FP, local time, sale, line totals and register', () => {
  const fiscal = verifiedOofdTicket(oofdPayload(), { ...receipt, provider: 'oofd' });
  assert.equal(fiscal.registerSerial, 'SWK00534409');
  assert.equal(fiscal.fiscalOrdinal, '3784');
  for (const change of [
    { operationType: 3 },
    { cancelDate: '2026-10-10T20:00:00' },
    { cancelDate: undefined },
    { fiscalId: '1' },
    { transactionDate: '2026-10-10T19:18:01.000' },
    { totalSum: 180 },
    { items: [{ itemType: 1, commodity: { quantity: 1, sum: 180 } }] },
  ])
    assert.throws(
      () =>
        verifiedOofdTicket(
          { ...oofdPayload(), ticket: { ...oofdPayload().ticket, ...change } },
          receipt,
        ),
      { code: 'FORTUNE_RECEIPT_NOT_FOUND' },
    );
  assert.throws(() => verifiedOofdTicket({ ...oofdPayload(), kkmFnsId: '090500022376' }, receipt), {
    code: 'FORTUNE_RECEIPT_NOT_FOUND',
  });
  assert.throws(() => verifiedOofdTicket({ ...oofdPayload(), kkmSerialNumber: '' }, receipt), {
    code: 'FORTUNE_RECEIPT_UNAVAILABLE',
  });
});

test('OOFD discounted sale line totals reconcile and official lookup preserves validated HTTPS', async () => {
  const payload = oofdPayload();
  payload.ticket.items = [
    { itemType: 1, commodity: { quantity: 1, sum: 3107.5, taxes: [] } },
    { itemType: 5, discount: { sum: 100 } },
  ];
  assert.equal(verifiedOofdTicket(payload, receipt).total, 3007.5);
  const result = await lookupFiscalReceipt(
    { ...receipt, provider: 'oofd' },
    {
      fetchImpl: async (url, options) => {
        const target = new URL(url);
        assert.equal(target.origin, 'https://consumer.oofd.kz');
        assert.equal(target.pathname, '/api/consumer-proxy/api/tickets/get-by-url');
        assert.deepEqual(Object.fromEntries(target.searchParams), {
          f: receipt.registrationNumber,
          i: receipt.fiscalSign,
          s: '3007.50',
          t: '20261010T191800',
        });
        assert.equal(options.redirect, 'error');
        if (options.agent) assert.equal(options.agent.options.rejectUnauthorized, true);
        return response(payload);
      },
    },
  );
  assert.equal(result.source, 'oofd');
  await assert.rejects(
    () =>
      lookupFiscalReceipt(
        { ...receipt, provider: 'oofd' },
        {
          fetchImpl: async () => {
            const error = new Error('unable to verify the first certificate');
            error.code = 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';
            throw error;
          },
        },
      ),
    { code: 'FORTUNE_RECEIPT_UNAVAILABLE' },
  );
});
