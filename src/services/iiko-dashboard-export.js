const AdmZip = require('adm-zip');
const escape = (value) =>
  String(value ?? '')
    .split('')
    .filter((character) => character.charCodeAt(0) >= 32 || ['\t', '\n', '\r'].includes(character))
    .join('')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const col = (n) => {
  let result = '';
  for (n++; n; n = Math.floor((n - 1) / 26))
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
  return result;
};

function reportWorkbook(report) {
  const fields = Object.keys(report.columns);
  const rows = [
    fields.map((key) => report.columns[key]?.name || key),
    ...report.rows.map((row) => fields.map((key) => row[key])),
  ];
  const xmlRows = rows
    .map(
      (row, y) =>
        `<row r="${y + 1}">${row
          .map((value, x) => {
            const ref = `${col(x)}${y + 1}`;
            return typeof value === 'number' && Number.isFinite(value)
              ? `<c r="${ref}"><v>${value}</v></c>`
              : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
          })
          .join('')}</row>`,
    )
    .join('');
  const zip = new AdmZip();
  const add = (name, body) =>
    zip.addFile(
      name,
      Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`),
    );
  add(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  );
  add(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  add(
    'xl/workbook.xml',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="iiko" sheetId="1" r:id="rId1"/></sheets></workbook>',
  );
  add(
    'xl/_rels/workbook.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  add(
    'xl/worksheets/sheet1.xml',
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${fields.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="26" customWidth="1"/>`).join('')}</cols><sheetData>${xmlRows}</sheetData><autoFilter ref="A1:${col(fields.length - 1)}${rows.length}"/></worksheet>`,
  );
  return zip.toBuffer();
}
function balanceReport(data, query) {
  const products = new Map(data.products.map((item) => [item.id, item]));
  const stores = new Map(data.stores.map((item) => [item.id, item.name]));
  const groups = new Map(data.groups.map((item) => [item.id, item.name]));
  const rows = data.rows
    .map((row) => {
      const product = products.get(row.product);
      const level = product?.storeBalanceLevels?.find((item) => item.storeId === row.store);
      return {
        ...row,
        productName: product?.name || row.product,
        groupId: product?.parent || '',
        group: groups.get(product?.parent) || '',
        storeName: stores.get(row.store) || row.store,
        min: level?.minBalanceLevel ?? null,
        max: level?.maxBalanceLevel ?? null,
      };
    })
    .filter(
      (row) =>
        (!query.store || row.store === query.store) &&
        (!query.group || row.groupId === query.group) &&
        (query.filter === 'negative'
          ? row.amount < 0
          : query.filter === 'below'
            ? row.min !== null && row.amount < row.min
            : query.filter === 'above'
              ? row.max !== null && row.amount > row.max
              : true),
    );
  return {
    rows,
    columns: {
      productName: { name: 'Товар' },
      group: { name: 'Группа' },
      storeName: { name: 'Склад' },
      amount: { name: 'Количество' },
      sum: { name: 'Стоимость' },
      min: { name: 'Минимум' },
      max: { name: 'Максимум' },
    },
  };
}
module.exports = { reportWorkbook, balanceReport };
