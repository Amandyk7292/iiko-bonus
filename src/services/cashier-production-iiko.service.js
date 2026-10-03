const { service: reporting } = require('./iiko-dashboard.service');
const { XMLBuilder } = require('fast-xml-parser');

const guid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const invalid = () =>
  Object.assign(new Error('Некорректный акт приготовления'), {
    code: 'IIKO_PRODUCTION_INPUT_INVALID',
    statusCode: 422,
  });
const confirmed = (value) => value === true || value === 'true';
const denied = (value) => value === false || value === 'false';
const numberFor = (act) => `BLK-${String(act.id).replaceAll('-', '').toUpperCase()}`;
const unknown = () => ({
  status: 'unknown',
  errorCode: 'IIKO_PRODUCTION_CONFIRMATION_REQUIRED',
  error: 'Результат не подтверждён. Проверьте акт в iiko перед повторной отправкой.',
});

function buildProductionXml(act) {
  const items = act.manifest?.items;
  if (
    !guid.test(act.id) ||
    !guid.test(act.branch_id) ||
    !guid.test(act.source_store_id) ||
    !guid.test(act.target_store_id) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(act.business_date) ||
    !Array.isArray(items) ||
    !items.length ||
    items.length > 1000 ||
    typeof act.manifest.postImmediately !== 'boolean'
  )
    throw invalid();
  const created = new Date(act.created_at);
  if (!Number.isFinite(created.getTime())) throw invalid();
  const localClock = new Date(created.getTime() + 300 * 60_000).toISOString().slice(11, 19);
  const grouped = new Map();
  for (const item of items) {
    const amount = Number(item.quantity);
    if (
      !guid.test(item.productId) ||
      !guid.test(item.amountUnit) ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > 100000 ||
      Math.abs(amount * 1000 - Math.round(amount * 1000)) > 0.000001
    )
      throw invalid();
    const product = item.productId.toLowerCase();
    const amountUnit = item.amountUnit.toLowerCase();
    const existing = grouped.get(product);
    if (existing && existing.amountUnit !== amountUnit) throw invalid();
    const milli = (existing?.milli || 0) + Math.round(amount * 1000);
    if (milli > 100000000) throw invalid();
    grouped.set(product, { product, amountUnit, milli });
  }
  const rows = [...grouped.values()].map((item, index) => ({
    amount: (item.milli / 1000).toFixed(3),
    product: item.product,
    num: index + 1,
    amountUnit: item.amountUnit,
  }));
  // Official productionDocument schema uses these names and their order. It has
  // no ID or ingredients field: the server calculates recipes in the main unit.
  const xml = new XMLBuilder({ ignoreAttributes: false, format: false }).build({
    document: {
      status: act.manifest.postImmediately ? 'PROCESSED' : 'NEW',
      comment: `Bulka production ${act.id}; branch ${act.branch_id}; report ${act.business_date}`,
      documentNumber: numberFor(act),
      dateIncoming: `${act.business_date}T${localClock}`,
      storeTo: act.target_store_id.toLowerCase(),
      storeFrom: act.source_store_id.toLowerCase(),
      items: { item: rows },
    },
  });
  return `<?xml version="1.0" encoding="UTF-8"?>${xml}`;
}

function classifyProductionResponse(response, act) {
  const result = response?.documentValidationResult;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return unknown();
  // An explicit rejection means no successful import. Warnings or ambiguous
  // responses require a human check; a second document is never sent blindly.
  if (denied(result.valid))
    return {
      status: 'failed',
      errorCode: 'IIKO_PRODUCTION_REJECTED',
      error: 'iiko отклонил акт. Проверьте блюда, единицы и склады.',
    };
  const errors = result.error || result.errors;
  const diagnostics = ['errorMessage', 'additionalInfo', 'otherSuggestedNumber'].some(
    (field) => String(result[field] || '').trim().length > 0,
  );
  const documentNumber = String(result.documentNumber || '').trim();
  if (
    !confirmed(result.valid) ||
    !denied(result.warning) ||
    diagnostics ||
    (errors && !(typeof errors === 'object' && !Object.keys(errors).length)) ||
    documentNumber !== numberFor(act)
  )
    return unknown();
  return { status: 'created', documentNumber };
}

async function createProductionDocument(act, { reports = reporting, beforeSend } = {}) {
  let xml;
  try {
    xml = buildProductionXml(act);
  } catch {
    return {
      status: 'failed',
      errorCode: 'IIKO_PRODUCTION_INPUT_INVALID',
      error: 'Проверьте блюда, единицы и общее количество. Акт не отправлен.',
    };
  }
  try {
    return await reports.client.withSession(act.server_id, async (request) => {
      if (typeof beforeSend === 'function' && (await beforeSend()) !== true) return unknown();
      const result = await request('documents/import/productionDocument', xml, 'xml', 'xml');
      return classifyProductionResponse(result, act);
    });
  } catch {
    // Connection/HTTP failure does not prove whether a server committed a write.
    return unknown();
  }
}

async function findProductionDocument() {
  // Public iikoServer documentation does not expose a verified production-act
  // search including drafts. Do not invent an export endpoint or resubmit XML.
  return unknown();
}
module.exports = {
  createProductionDocument,
  findProductionDocument,
  buildProductionXml,
  classifyProductionResponse,
  numberFor,
};
