const { decodeReceipt, parseReceiptQr, receiptError } = require('./fortune-receipt-qr');
const { lookupFiscalReceipt } = require('./fortune-receipt-provider');
const { loadFortuneReceiptReport } = require('./fortune-receipt-iiko');
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unavailable = () =>
  receiptError('FORTUNE_RECEIPT_UNAVAILABLE', 'Филиал пока не подключён к проверке чеков', 503);
const mismatch = () => receiptError('FORTUNE_RECEIPT_NOT_FOUND', 'Чек этой точки не найден в iiko');
const localDay = (time) => new Date(time + 5 * 3600000).toISOString().slice(0, 10);
const cents = (value) => {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return null;
  const amount = Number(value) * 100;
  return Math.abs(amount - Math.round(amount)) < 0.00001 ? Math.round(amount) : null;
};
const invalid = () => receiptError('FORTUNE_RECEIPT_INVALID', 'Проверку чека нужно повторить');
const qrFields = [
  'provider',
  'fiscalSign',
  'registrationNumber',
  'totalCents',
  'total',
  'closedAt',
  'localClosedAt',
  'receiptIdentity',
];
const providerOrigins = {
  wofd: 'https://consumer.wofd.kz/',
  oofd: 'https://consumer.oofd.kz/',
  ttk: 'https://ofd1.kz/',
  webkassa: 'https://my.webkassa.kz/',
};
const oofdWebkassa = (receipt) =>
  receipt.provider === 'oofd' && /^SWK\d{8}$/.test(receipt.registerSerial || '');

function exactRegister(row, receipt) {
  const serial = String(row['CashRegisterName.CashRegisterSerialNumber'] || '').toUpperCase();
  // Webkassa reports the full SWK serial to OOFD, while this iiko driver stores
  // its numeric suffix as FR serial. Require the full exact register name as a
  // second identity, never accept an arbitrary number or a name substring.
  if (!oofdWebkassa(receipt)) return serial === receipt.registerSerial;
  return (
    String(row.CashRegisterName || '').toUpperCase() === receipt.registerSerial &&
    (serial === receipt.registerSerial ||
      serial === String(Number(receipt.registerSerial.slice(3))))
  );
}

function canonicalFiscalQr(value, strict = false) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.provider !== 'string' ||
    !Object.hasOwn(providerOrigins, value.provider) ||
    typeof value.fiscalSign !== 'string' ||
    typeof value.registrationNumber !== 'string' ||
    typeof value.localClosedAt !== 'string' ||
    !Number.isSafeInteger(value.totalCents) ||
    value.totalCents <= 0 ||
    value.totalCents > 1000000000 ||
    (strict &&
      (Object.keys(value).length !== qrFields.length ||
        Object.keys(value).some((key) => !qrFields.includes(key))))
  )
    throw invalid();
  const url = new URL(providerOrigins[value.provider]);
  url.searchParams.set('i', value.fiscalSign);
  url.searchParams.set('f', value.registrationNumber);
  url.searchParams.set('s', (value.totalCents / 100).toFixed(2));
  url.searchParams.set('t', value.localClosedAt.replace(/[-:]/g, ''));
  let canonical;
  try {
    canonical = parseReceiptQr(url.href);
  } catch {
    throw invalid();
  }
  if (qrFields.some((field) => canonical[field] !== value[field])) throw invalid();
  return canonical;
}

async function loadReceiptBinding(branchId, { db = require('../config/supabase').supabase } = {}) {
  const { data, error } = await db
    .from('cashier_iiko_production_bindings')
    .select('server_id,department_id')
    .eq('branch_id', branchId)
    .maybeSingle();
  if (error) throw unavailable();
  // Production enable/post flags control stock acts, not receipt validation.
  // A missing branch mapping must not silently select another iiko department.
  return data ? { serverId: data.server_id, departmentId: data.department_id } : null;
}

function exactIikoSale(report, receipt, binding) {
  if (!Array.isArray(report?.rows) || report.rows.length > 25000) throw unavailable();
  const matches = [];
  const groups = new Map();
  for (const row of report.rows) {
    const id = String(row['UniqOrderId.Id'] || '').toLowerCase();
    if (!guid.test(id)) throw unavailable();
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }
  for (const [id, rows] of groups) {
    const metadata = [
      'Department.Id',
      'CashRegisterName.CashRegisterSerialNumber',
      'CloseTime',
      'OpenDate.Typed',
      'SessionID',
    ];
    if (oofdWebkassa(receipt)) metadata.push('CashRegisterName');
    if (receipt.fiscalOrdinal && rows.some((row) => String(row.FiscalChequeNumber ?? '').trim()))
      metadata.push('FiscalChequeNumber');
    if (metadata.some((field) => new Set(rows.map((row) => String(row[field] ?? ''))).size !== 1))
      throw unavailable();
    const first = rows[0];
    const closed = String(first.CloseTime || '');
    if (!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?$/.test(closed)) continue;
    const fiscalTime = Date.parse(`${receipt.localClosedAt}Z`);
    const closeTime = Date.parse(`${closed}Z`);
    const issueDelay = fiscalTime - closeTime;
    if (
      String(first['Department.Id']).toLowerCase() !== binding.departmentId.toLowerCase() ||
      !exactRegister(first, receipt) ||
      !Number.isFinite(issueDelay) ||
      issueDelay < -5000 ||
      issueDelay > 15000
    )
      continue;
    if (
      receipt.fiscalOrdinal &&
      first.FiscalChequeNumber != null &&
      String(first.FiscalChequeNumber).trim()
    ) {
      const ordinals = String(first.FiscalChequeNumber).trim();
      if (!/^[1-9]\d{0,9}(?:\s*,\s*[1-9]\d{0,9})*$/.test(ordinals)) throw unavailable();
      if (
        !ordinals
          .split(',')
          .map((value) => value.trim())
          .includes(receipt.fiscalOrdinal)
      )
        continue;
    }
    if (rows.some((row) => row.OrderDeleted !== 'NOT_DELETED' || row.Storned !== 'FALSE')) continue;
    // A removed zero-value item remains in SALES for an otherwise paid sale.
    // Ignore only that explicit non-writeoff state; never hide a charged,
    // written-off or unknown deletion, cancelled order or refund row.
    if (
      rows.some(
        (row) =>
          row.DeletedWithWriteoff !== 'NOT_DELETED' &&
          (row.DeletedWithWriteoff !== 'DELETED_WITHOUT_WRITEOFF' ||
            cents(row.DishDiscountSumInt) !== 0),
      )
    )
      continue;
    const amounts = rows
      .filter((row) => row.DeletedWithWriteoff === 'NOT_DELETED')
      .map((row) => cents(row.DishDiscountSumInt));
    if (amounts.some((amount) => amount === null)) throw unavailable();
    const totalCents = amounts.reduce((sum, amount) => sum + amount, 0);
    if (
      totalCents !== receipt.totalCents ||
      totalCents <= 0 ||
      !guid.test(String(first.SessionID || ''))
    )
      continue;
    matches.push({
      saleGuid: id,
      accountingDate: first['OpenDate.Typed'],
      verificationMethod: 'provider_correlated',
    });
  }
  if (matches.length === 0) throw mismatch();
  if (matches.length !== 1)
    throw receiptError('FORTUNE_RECEIPT_AMBIGUOUS', 'Чек требует проверки. Попробуйте другой чек');
  return matches[0];
}

async function verifyDecodedReceipt(input, decoded, dependencies) {
  const {
    now = () => Date.now(),
    lookup = lookupFiscalReceipt,
    reports = require('./iiko-dashboard.service').service,
    loadBinding = (branchId) => loadReceiptBinding(branchId, { db: dependencies.db }),
  } = dependencies;
  if (!guid.test(String(input?.branchId))) throw unavailable();
  const maximumAge = input.maxAgeDays ?? 7;
  if (!Number.isInteger(maximumAge) || maximumAge < 1 || maximumAge > 30) throw unavailable();
  const receipt = canonicalFiscalQr(decoded);
  const timestamp = Date.parse(receipt.closedAt);
  const current = Number(now());
  if (!Number.isFinite(current)) throw unavailable();
  if (
    !Number.isFinite(timestamp) ||
    timestamp > current + 60000 ||
    timestamp < current - maximumAge * 86400000
  )
    throw receiptError('FORTUNE_RECEIPT_EXPIRED', 'Для участия нужен свежий чек этой точки');
  let binding;
  try {
    binding = await loadBinding(input.branchId);
  } catch {
    throw unavailable();
  }
  if (
    !binding ||
    !/^[a-z0-9-]{1,100}$/.test(binding.serverId) ||
    !guid.test(String(binding.departmentId))
  )
    throw unavailable();
  const fiscal = await lookup(receipt, { fetchImpl: dependencies.fetchImpl });
  if (
    fiscal.receiptIdentity !== receipt.receiptIdentity ||
    fiscal.totalCents !== receipt.totalCents ||
    fiscal.localClosedAt !== receipt.localClosedAt ||
    !/^[A-Z0-9-]{4,40}$/.test(fiscal.registerSerial || '')
  )
    throw mismatch();
  const required = [
    'UniqOrderId.Id',
    'Department.Id',
    'CashRegisterName.CashRegisterSerialNumber',
    'CloseTime',
    'OpenDate.Typed',
    'SessionID',
    'OrderDeleted',
    'DeletedWithWriteoff',
    'Storned',
  ];
  if (oofdWebkassa(fiscal)) required.push('CashRegisterName');
  let columns;
  try {
    ({ columns } = await reports.getSchema({ serverId: binding.serverId, reportType: 'SALES' }));
  } catch {
    throw unavailable();
  }
  if (
    required.some((field) => !columns?.[field]?.groupingAllowed) ||
    !columns?.['Department.Id']?.filteringAllowed ||
    !columns?.[
      oofdWebkassa(fiscal) ? 'CashRegisterName' : 'CashRegisterName.CashRegisterSerialNumber'
    ]?.filteringAllowed ||
    !columns?.CloseTime?.filteringAllowed ||
    !columns?.DishDiscountSumInt?.aggregationAllowed
  )
    throw unavailable();
  if (fiscal.fiscalOrdinal && columns.FiscalChequeNumber?.groupingAllowed)
    required.push('FiscalChequeNumber');
  const query = {
    serverId: binding.serverId,
    reportType: 'SALES',
    // OpenDate.Typed is an accounting day. A long-running shift can place an
    // October purchase in September. The 20-second CloseTime range below bounds
    // real candidates even when the shift's accounting day is months earlier.
    from: localDay(current - 90 * 86400000),
    to: localDay(current),
    filters: [
      { field: 'Department.Id', values: [binding.departmentId] },
      {
        field: oofdWebkassa(fiscal)
          ? 'CashRegisterName'
          : 'CashRegisterName.CashRegisterSerialNumber',
        values: [fiscal.registerSerial],
      },
    ],
    closeTimeRange: {
      from: new Date(Date.parse(`${fiscal.localClosedAt}Z`) - 15000).toISOString().slice(0, -1),
      to: new Date(Date.parse(`${fiscal.localClosedAt}Z`) + 5000).toISOString().slice(0, -1),
    },
    groupBy: required,
    aggregate: ['DishDiscountSumInt'],
  };
  // Do not use 45-second cached SALES values when consuming a prize. Query
  // current source flags, then atomically reserve the globally unique sale GUID.
  let report;
  try {
    report = await loadFortuneReceiptReport(reports, query, columns);
  } catch {
    throw unavailable();
  }
  const sale = exactIikoSale(report, fiscal, binding);
  return {
    ...sale,
    receiptIdentity: receipt.receiptIdentity,
    branchId: input.branchId,
    closedAt: receipt.closedAt,
    total: receipt.total,
    fiscalSign: receipt.fiscalSign,
    registrationNumber: receipt.registrationNumber,
    registerSerial: fiscal.registerSerial,
    serverId: binding.serverId,
    departmentId: binding.departmentId,
    fiscalQr: receipt,
  };
}

async function verifyFortuneReceipt(input, dependencies = {}) {
  if (!guid.test(String(input?.branchId))) throw unavailable();
  const decoded = await (dependencies.decode || decodeReceipt)(input.image);
  return verifyDecodedReceipt(input, decoded, dependencies);
}

async function revalidateFortuneReceipt(input, dependencies = {}) {
  // This entry point accepts only a receipt snapshot loaded by the server from
  // its proof table. Never use request-body receipt metadata as payment proof.
  const stored = input?.receipt;
  if (
    !stored ||
    typeof stored !== 'object' ||
    Array.isArray(stored) ||
    stored.branchId !== input.branchId ||
    !guid.test(String(stored.saleGuid)) ||
    typeof stored.serverId !== 'string' ||
    !/^[a-z0-9-]{1,100}$/.test(stored.serverId) ||
    !guid.test(String(stored.departmentId)) ||
    typeof stored.registerSerial !== 'string' ||
    !/^[A-Z0-9-]{4,40}$/.test(stored.registerSerial)
  )
    throw invalid();
  const decoded = canonicalFiscalQr(stored.fiscalQr, true);
  for (const field of ['receiptIdentity', 'closedAt', 'total', 'fiscalSign', 'registrationNumber'])
    if (stored[field] !== decoded[field]) throw invalid();
  const current = await verifyDecodedReceipt(input, decoded, dependencies);
  for (const field of [
    'saleGuid',
    'branchId',
    'serverId',
    'departmentId',
    'receiptIdentity',
    'closedAt',
    'total',
    'fiscalSign',
    'registrationNumber',
    'registerSerial',
  ])
    if (current[field] !== stored[field]) throw mismatch();
  return current;
}

module.exports = {
  verifyFortuneReceipt,
  revalidateFortuneReceipt,
  exactIikoSale,
  loadReceiptBinding,
};
