const { failure } = require('./iiko-dashboard-client');
const { list } = require('./iiko-dashboard-barters');
const xmlList = async (request, path, root, item) => {
  const result = await request(path, undefined, 'xml');
  if (!Object.hasOwn(result || {}, root)) throw failure('IIKO_REPORT_RESPONSE');
  return list(result[root]?.[item]);
};
async function loadDocuments(request, input) {
  const suppliers = await xmlList(request, 'suppliers', 'employees', 'employee');
  const sources = suppliers
    .filter((supplier) => /^(?:бартер|блогер|блогеры)$/iu.test(String(supplier.name || '').trim()))
    .map(({ id, name }) => ({ id, name }));
  const data = { sources, documents: [], stores: [], departments: [], products: [], units: [] };
  if (!sources.length) return data;
  for (const source of sources) {
    if (!/^[a-f0-9-]{36}$/i.test(source.id)) throw failure('IIKO_REPORT_RESPONSE');
    const query = new URLSearchParams({ from: input.from, to: input.to, supplierId: source.id });
    data.documents.push(
      ...(await xmlList(
        request,
        `documents/export/outgoingInvoice?${query}`,
        'outgoingInvoiceDtoes',
        'document',
      )),
    );
  }
  if (!data.documents.length) return data;
  data.stores = await xmlList(
    request,
    'corporation/stores',
    'corporateItemDtoes',
    'corporateItemDto',
  );
  data.departments = await xmlList(
    request,
    'corporation/departments',
    'corporateItemDtoes',
    'corporateItemDto',
  );
  data.products = await request('v2/entities/products/list?includeDeleted=true');
  data.units = await request('v2/entities/list?rootType=MeasureUnit&includeDeleted=true');
  if (!Array.isArray(data.products) || !Array.isArray(data.units))
    throw failure('IIKO_REPORT_RESPONSE');
  return data;
}
module.exports = { loadDocuments };
