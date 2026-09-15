const { failure } = require('./iiko-dashboard-client');
const { list } = require('./iiko-dashboard-barters');

const xmlList = async (request, path, root, item) => {
  const result = await request(path, undefined, 'xml');
  if (!Object.hasOwn(result || {}, root)) throw failure('IIKO_REPORT_RESPONSE');
  return list(result[root]?.[item]);
};

async function mapConcurrent(values, concurrency, work) {
  const result = [];
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (index < values.length) {
        const current = values[index++];
        result.push(...(await work(current)));
      }
    }),
  );
  return result;
}

async function loadInvoiceDocuments(request, input) {
  // Archiving a supplier must not remove its posted documents from historical reports.
  const suppliers = (await xmlList(request, 'suppliers', 'employees', 'employee')).filter(
    (supplier) => /^[a-f0-9-]{36}$/i.test(String(supplier.id || '')),
  );
  const documents = await mapConcurrent(suppliers, 3, async (supplier) => {
    const query = new URLSearchParams({
      from: input.from,
      to: input.to,
      supplierId: supplier.id,
    });
    return xmlList(
      request,
      `documents/export/incomingInvoice?${query}`,
      'incomingInvoiceDtoes',
      'document',
    );
  });
  const data = { suppliers, documents, stores: [], departments: [], products: [], units: [] };
  if (!documents.length) return data;
  [data.stores, data.departments, data.products, data.units] = await Promise.all([
    xmlList(request, 'corporation/stores', 'corporateItemDtoes', 'corporateItemDto'),
    xmlList(request, 'corporation/departments', 'corporateItemDtoes', 'corporateItemDto'),
    request('v2/entities/products/list?includeDeleted=true'),
    request('v2/entities/list?rootType=MeasureUnit&includeDeleted=true'),
  ]);
  if (!Array.isArray(data.products) || !Array.isArray(data.units))
    throw failure('IIKO_REPORT_RESPONSE');
  return data;
}

module.exports = { loadInvoiceDocuments, mapConcurrent };
