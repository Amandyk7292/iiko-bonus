const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { payrollWorkbook, filterPayrollItems } = require('../src/services/cashier-payroll-export.service');
const parser = new XMLParser({ ignoreAttributes: false });
const item = (overrides = {}) => ({
  id: '810', name: '=HYPERLINK("https://example.invalid", "имя")',
  city: 'Астана', branchName: 'Хайвел & <точка>', pointId: '24',
  completed: 3, rewardAmount: 900, paidAmount: 600, outstandingAmount: 300,
  isArchived: true, payments: [{ id: 'batch-1', amount: 600, registrations: 2,
    paidAt: '2026-10-05T05:00:00Z', paidBy: '@admin' }], ...overrides,
});
test('payroll Excel is a valid two-sheet OOXML workbook with numeric totals, safe text and payment audit', () => {
  const workbook = payrollWorkbook({ month: '2026-10', items: [item(), item({ id: 'other', city: 'Актау', rewardAmount: 99999 })] }, { city: 'Астана' });
  assert.equal(workbook.subarray(0, 2).toString(), 'PK');
  const zip = new AdmZip(workbook);
  for (const entry of zip.getEntries()) assert.equal(XMLValidator.validate(entry.getData().toString()), true, entry.entryName);
  const book = parser.parse(zip.readAsText('xl/workbook.xml'));
  assert.deepEqual(book.workbook.sheets.sheet.map((sheet) => sheet['@_name']), ['Премии 2026-10', 'История выплат']);
  const xml = zip.readAsText('xl/worksheets/sheet1.xml');
  assert.ok(!xml.includes('<f>'));
  const sheet = parser.parse(xml).worksheet;
  assert.equal(sheet.sheetViews.sheetView.pane['@_ySplit'], '1');
  assert.equal(sheet.sheetData.row.length, 3);
  const cells = sheet.sheetData.row[1].c;
  assert.equal(cells[1]['@_t'], 'inlineStr');
  assert.equal(cells[1].is.t['#text'], item().name);
  assert.equal(cells[3].is.t['#text'], item().branchName);
  assert.equal(cells[5].v, 900);
  assert.equal(cells[7].v, 300);
  assert.equal(sheet.sheetData.row[2].c[7].v, 300);
  assert.equal(cells[8].is.t['#text'], 'Частично выплачено');
  assert.equal(cells[9].is.t['#text'], 'В архиве');
  const history = parser.parse(zip.readAsText('xl/worksheets/sheet2.xml')).worksheet.sheetData.row[1].c;
  assert.equal(history[5].v, 600);
  assert.match(history[6].is.t['#text'], /05\.10\.2026.*10:00:00/);
  assert.equal(history[7].is.t['#text'], '@admin');
  assert.equal(history[8].is.t['#text'], 'batch-1');
});
test('export respects combined city, stable point ID and search; empty reports keep headers and zero totals', () => {
  const rows = [item(), item({ id: '811', pointId: '25' }), item({ id: '812', pointId: null })];
  assert.deepEqual(filterPayrollItems(rows, { city: 'Астана', pointId: '24', search: '810' }).map((row) => row.id), ['810']);
  assert.deepEqual(filterPayrollItems(rows, { pointId: '__unassigned__' }).map((row) => row.id), ['812']);
  assert.equal(filterPayrollItems(rows, { city: 'Актау', pointId: '24' }).length, 0);
  assert.equal(filterPayrollItems([item({ name: 'Алия Кассир' })], { search: 'кассир 810' }).length, 1);
  const zip = new AdmZip(payrollWorkbook({ month: '2026-10', items: [] }));
  const summary = parser.parse(zip.readAsText('xl/worksheets/sheet1.xml')).worksheet.sheetData.row;
  assert.equal(summary.length, 2);
  assert.equal(summary[1].c[4].v, 0);
});
