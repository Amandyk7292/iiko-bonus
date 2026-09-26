const { branchBindings } = require('../config/bought-together-branches');
const { list } = require('./iiko-dashboard-barters');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = () =>
  Object.assign(new Error('Invalid outgoing invoice data or mapping'), {
    code: 'IIKO_OUTGOING_INVALID',
  });
const identity = (value) => String(value || '').toLowerCase();
const measure = (value) => {
  const name = String(value || '')
    .trim()
    .toLowerCase();
  return /^(шт\.?|штука|штуки)$/.test(name) ? 'шт' : name;
};

function references(rows, select) {
  if (!Array.isArray(rows)) throw invalid();
  const result = new Map();
  for (const row of rows) {
    if (!row || !uuid.test(row.id)) throw invalid();
    const key = identity(row.id),
      value = select(row);
    if (result.has(key) && result.get(key) !== value) throw invalid();
    result.set(key, value);
  }
  return result;
}

function bindings(env = process.env) {
  // These defaults are verified department IDs, not name or city guesses.
  const configured = JSON.parse(env.IIKO_OUTGOING_BRANCHES_JSON || '{}');
  if (!configured || Array.isArray(configured) || typeof configured !== 'object') throw invalid();
  const result = { ...branchBindings({}), ...configured };
  const seen = new Set();
  for (const [branchId, row] of Object.entries(result)) {
    if (row === null) {
      delete result[branchId];
      continue;
    }
    if (
      !uuid.test(branchId) ||
      !row ||
      !uuid.test(row.departmentId) ||
      !/^[a-z0-9-]{1,100}$/.test(row.serverId)
    )
      throw invalid();
    const key = `${row.serverId}:${identity(row.departmentId)}`;
    if (seen.has(key)) throw invalid();
    seen.add(key);
  }
  return result;
}

async function loadOutgoingDocuments(request, from, to) {
  const xml = async (path, root, child) => {
    const value = await request(path, undefined, 'xml');
    if (!Object.hasOwn(value || {}, root)) throw invalid();
    if (
      value[root] !== '' &&
      value[root] != null &&
      (typeof value[root] !== 'object' || Array.isArray(value[root]))
    )
      throw invalid();
    return list(value[root]?.[child]);
  };
  // All outgoing invoices: barter does not depend on the spelling of a supplier name.
  const documents = await xml(
    `documents/export/outgoingInvoice?${new URLSearchParams({ from, to })}`,
    'outgoingInvoiceDtoes',
    'document',
  );
  if (!documents.length) return { documents, stores: [], products: [], units: [] };
  const stores = await xml('corporation/stores', 'corporateItemDtoes', 'corporateItemDto');
  const products = await request('v2/entities/products/list?includeDeleted=true');
  const units = await request('v2/entities/list?rootType=MeasureUnit&includeDeleted=true');
  if (!Array.isArray(products) || !Array.isArray(units)) throw invalid();
  return { documents, stores, products, units };
}

function normalizeDocuments(data, server, mapping) {
  const departments = new Map(
    Object.entries(mapping)
      .filter(([, row]) => row.serverId === server.id)
      .map(([branch, row]) => [identity(row.departmentId), identity(branch)]),
  );
  const stores = references(data.stores, (row) => identity(row.parentId));
  const units = references(data.units, (row) => measure(row.name));
  const products = references(data.products, (row) => identity(row.mainUnit));
  const normalized = new Map();
  for (const document of data.documents) {
    if (!uuid.test(document.id) || !['PROCESSED', 'NEW', 'DELETED'].includes(document.status))
      throw invalid();
    // iiko may omit a timezone. Both supported cities use UTC+05:00.
    const raw = String(document.dateIncoming || '');
    const timestamp = raw + (/([+-]\d\d:\d\d|Z)$/i.test(raw) ? '' : '+05:00');
    if (
      !/^\d{4}-\d\d-\d\dT/.test(raw) ||
      !Number.isFinite(Date.parse(timestamp)) ||
      new Date(`${raw.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== raw.slice(0, 10)
    )
      throw invalid();
    const items = new Map();
    if (document.status === 'PROCESSED')
      for (const item of list(document.items?.item)) {
        const storeId = identity(item.storeId || document.defaultStoreId);
        if (!stores.has(storeId)) throw invalid();
        const branchId = departments.get(stores.get(storeId));
        if (!branchId) continue;
        const amount = String(item.amount ?? '');
        // amountUnit describes this invoice line; never silently relabel kg as
        // pieces using product.mainUnit. SQL checks units/steps for tracked stock,
        // while valid untracked ingredients (e.g. litres) remain harmless.
        const unit = units.get(identity(item.amountUnit) || products.get(identity(item.productId)));
        if (
          !uuid.test(item.productId) ||
          !unit ||
          unit.length > 40 ||
          [...unit].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
          !/^\d{1,6}(\.\d{1,3})?$/.test(amount) ||
          Number(amount) <= 0
        )
          throw invalid();
        const productId = `${server.city === 'astana' ? 'astana:' : ''}${identity(item.productId)}`;
        const key = `${branchId}:${productId}`;
        if (items.has(key) && items.get(key).unit !== unit) throw invalid();
        const quantity =
          Math.round(((items.get(key)?.quantity || 0) + Number(amount)) * 1000) / 1000;
        if (quantity > 100000) throw invalid();
        items.set(key, { branchId, productId, quantity, unit });
      }
    const row = {
      id: identity(document.id),
      number: String(document.documentNumber || '').slice(0, 100),
      postedAt: new Date(timestamp).toISOString(),
      status: document.status,
      items: [...items.values()].sort((a, b) =>
        `${a.branchId}:${a.productId}`.localeCompare(`${b.branchId}:${b.productId}`),
      ),
    };
    if (normalized.has(row.id) && JSON.stringify(normalized.get(row.id)) !== JSON.stringify(row))
      throw invalid();
    normalized.set(row.id, row);
  }
  return [...normalized.values()].sort(
    (a, b) => a.postedAt.localeCompare(b.postedAt) || a.id.localeCompare(b.id),
  );
}
module.exports = { bindings, loadOutgoingDocuments, normalizeDocuments };
