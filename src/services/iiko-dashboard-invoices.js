const { failure } = require('./iiko-dashboard-client');
const { servers } = require('../config/iiko-dashboard');
const { list } = require('./iiko-dashboard-barters');

const column = (name, type = 'STRING') => ({ name, type });
const columns = {
  Supplier: column('Поставщик'),
  Department: column('Филиал'),
  Store: column('Склад'),
  Document: column('Накладная №'),
  Date: column('Дата и время', 'DATE_TIME'),
  Products: column('Товары'),
  Product: column('Товар'),
  Article: column('Артикул'),
  Unit: column('Единица'),
  Quantity: column('Количество', 'AMOUNT'),
  Price: column('Цена, ₸', 'MONEY'),
  Vat: column('НДС, ₸', 'MONEY'),
  Total: column('Сумма, ₸', 'MONEY'),
  Comment: column('Комментарий'),
};
const label = (value) => String(value ?? '').trim();
const numeric = (value) =>
  value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const mapById = (rows) => new Map(rows.map((row) => [row.id, row]));
const sum = (rows, field) =>
  rows.every((row) => row[field] !== null)
    ? Math.round(rows.reduce((total, row) => total + row[field], 0) * 100) / 100
    : null;

function invoiceReport(data, input) {
  if (!servers.some((server) => server.id === input.serverId))
    throw failure('IIKO_REPORT_SERVER', 400);
  const suppliers = mapById(data.suppliers);
  const stores = mapById(data.stores);
  const departments = mapById(data.departments);
  const products = mapById(data.products);
  const units = mapById(data.units);
  const seen = new Set();
  const invoices = [];
  for (const document of data.documents) {
    if (document.status !== 'PROCESSED' || !document.id || seen.has(document.id)) continue;
    const date = label(document.dateIncoming || document.incomingDate);
    const number = label(document.documentNumber || document.incomingDocumentNumber);
    if (!number || !Number.isFinite(Date.parse(date))) throw failure('IIKO_REPORT_RESPONSE');
    if (date.slice(0, 10) < input.from || date.slice(0, 10) > input.to) continue;
    seen.add(document.id);
    const items = list(document.items?.item)
      .map((item) => {
        const store = stores.get(item.store || document.defaultStore);
        const department = departments.get(store?.parentId);
        const product = products.get(item.product);
        return {
          Department: label(department?.name || store?.name),
          Store: label(store?.name),
          Product: label(product?.name || item.productArticle || item.product),
          Article: label(item.productArticle || product?.num),
          Unit: label(units.get(item.amountUnit || product?.mainUnit)?.name),
          Quantity: numeric(item.actualAmount ?? item.amount),
          Price: numeric(item.price),
          Vat: numeric(item.vatSum),
          Total: numeric(item.sum),
        };
      })
      .filter((item) => !input.department || item.Department === input.department);
    if (!items.length) continue;
    invoices.push({
      identity: label(document.id),
      Supplier: label(suppliers.get(document.supplier)?.name || document.supplier),
      Department: [...new Set(items.map((item) => item.Department).filter(Boolean))].join(' · '),
      Store: [...new Set(items.map((item) => item.Store).filter(Boolean))].join(' · '),
      Document: number,
      Date: date,
      Products: items.length,
      Total: sum(items, 'Total'),
      Vat: sum(items, 'Vat'),
      Comment: label(document.comment),
      items,
    });
  }
  const selectedInvoices = input.supplier
    ? invoices.filter((invoice) => invoice.Supplier === input.supplier)
    : invoices;
  const rows = selectedInvoices.flatMap(({ items, ...invoice }) =>
    items.map((item) => ({ ...invoice, ...item })),
  );
  if (rows.length > 25000) throw failure('IIKO_REPORT_TOO_LARGE', 422);
  selectedInvoices.sort((a, b) => Date.parse(b.Date) - Date.parse(a.Date));
  return {
    rows,
    invoices: selectedInvoices,
    columns,
    summary: {
      invoices: selectedInvoices.length,
      suppliers: new Set(selectedInvoices.map((row) => row.Supplier).filter(Boolean)).size,
      productLines: rows.length,
      total: sum(selectedInvoices, 'Total'),
    },
    serverId: input.serverId,
    period: { from: input.from, to: input.to },
    fetchedAt: new Date().toISOString(),
  };
}

async function invoices(service, input) {
  const data = await service.reports.get(
    `invoice-documents:${JSON.stringify([input.serverId, input.from, input.to])}`,
    () =>
      service.client.withSession(input.serverId, (request) =>
        require('./iiko-dashboard-invoice-documents').loadInvoiceDocuments(request, input),
      ),
  );
  return invoiceReport(data, input);
}

module.exports = { invoices, invoiceReport, columns };
