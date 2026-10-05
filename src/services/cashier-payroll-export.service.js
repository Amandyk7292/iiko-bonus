const AdmZip = require('adm-zip');
const { reportWorkbook } = require('./iiko-dashboard-export');

const summaryColumns = {
  employeeId: { name: 'ID сотрудника' },
  name: { name: 'ФИО' },
  city: { name: 'Город' },
  branchName: { name: 'Точка начисления' },
  completed: { name: 'Регистрации' },
  rewardAmount: { name: 'Начислено, ₸' },
  paidAmount: { name: 'Выплачено, ₸' },
  outstandingAmount: { name: 'К выплате, ₸' },
  status: { name: 'Статус' },
  archived: { name: 'Кадровая запись' },
};
const paymentColumns = {
  employeeId: { name: 'ID сотрудника' },
  name: { name: 'ФИО' },
  city: { name: 'Город' },
  branchName: { name: 'Точка начисления' },
  registrations: { name: 'Регистрации' },
  amount: { name: 'Выплачено, ₸' },
  paidAt: { name: 'Отмечено (Казахстан, UTC+5)' },
  paidBy: { name: 'Отметил выплату' },
  id: { name: 'Номер записи выплаты' },
};

function filterPayrollItems(items, { city, pointId, search } = {}) {
  const needle = String(search || '')
    .trim()
    .toLocaleLowerCase('ru');
  return items.filter(
    (row) =>
      (!city || row.city === city) &&
      (!pointId || (pointId === '__unassigned__' ? !row.pointId : row.pointId === pointId)) &&
      (!needle ||
        `${row.name} ${row.id} ${row.branchName} ${row.city}`
          .toLocaleLowerCase('ru')
          .includes(needle)),
  );
}

function paymentTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('ru-KZ', {
        timeZone: 'Asia/Almaty',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).format(date);
}

// Reuse the project's OOXML writer: all names are inline strings, including
// values beginning with =, + or @; user data can never become Excel formulas.
function styledSheet(columns, rows, numericColumns, totalRow = false) {
  const zip = new AdmZip(reportWorkbook({ columns, rows }));
  let xml = zip.readAsText('xl/worksheets/sheet1.xml');
  xml = xml.replace(
    '<sheetView workbookViewId="0">',
    '<sheetView workbookViewId="0" showGridLines="0">',
  );
  xml = xml.replace(/<row r="(\d+)">([\s\S]*?)<\/row>/g, (_match, row, body) => {
    const header = row === '1';
    const total = totalRow && Number(row) === rows.length + 1;
    return `<row r="${row}" ht="${header ? 34 : 29}" customHeight="1">${body.replace(
      /<c r="([A-Z]+\d+)"/g,
      (_cell, ref) => {
        const numeric = numericColumns.includes(ref.replace(/\d/g, ''));
        const style = header ? 1 : total ? (numeric ? 4 : 3) : numeric ? 2 : 0;
        return `<c r="${ref}" s="${style}"`;
      },
    )}</row>`;
  });
  xml = xml.replace('width="26"', 'width="19"');
  xml = xml.replace(/(<col min="2"[^>]*width=")26"/, (_match, prefix) => `${prefix}38"`);
  xml = xml.replace(/(<col min="4"[^>]*width=")26"/, (_match, prefix) => `${prefix}32"`);
  return xml;
}

function payrollWorkbook(statement, filters = {}) {
  const items = filterPayrollItems(statement.items, filters);
  const rows = items.map((row) => ({
    ...row,
    employeeId: row.id,
    status:
      row.outstandingAmount === 0
        ? 'Выплачено'
        : row.paidAmount > 0
          ? 'Частично выплачено'
          : 'Начислено',
    archived: row.isArchived ? 'В архиве' : 'Действует',
  }));
  const total = {
    name: 'Итого',
    completed: 0,
    rewardAmount: 0,
    paidAmount: 0,
    outstandingAmount: 0,
  };
  for (const row of rows)
    for (const key of Object.keys(total).filter((key) => key !== 'name')) total[key] += row[key];
  const history = items.flatMap((row) =>
    row.payments.map((payment) => ({
      ...payment,
      employeeId: row.id,
      name: row.name,
      city: row.city,
      branchName: row.branchName,
      paidAt: paymentTime(payment.paidAt),
    })),
  );
  const zip = new AdmZip(reportWorkbook({ columns: summaryColumns, rows: [...rows, total] }));
  zip.updateFile(
    'xl/worksheets/sheet1.xml',
    Buffer.from(styledSheet(summaryColumns, [...rows, total], ['E', 'F', 'G', 'H'], true)),
  );
  zip.addFile(
    'xl/worksheets/sheet2.xml',
    Buffer.from(styledSheet(paymentColumns, history, ['E', 'F'])),
  );
  zip.updateFile(
    'xl/workbook.xml',
    Buffer.from(
      zip
        .readAsText('xl/workbook.xml')
        .replace('name="iiko"', `name="Премии ${statement.month}"`)
        .replace('</sheets>', '<sheet name="История выплат" sheetId="2" r:id="rId2"/></sheets>'),
    ),
  );
  zip.updateFile(
    'xl/_rels/workbook.xml.rels',
    Buffer.from(
      zip
        .readAsText('xl/_rels/workbook.xml.rels')
        .replace(
          '</Relationships>',
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
            '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
        ),
    ),
  );
  zip.updateFile(
    '[Content_Types].xml',
    Buffer.from(
      zip
        .readAsText('[Content_Types].xml')
        .replace(
          '</Types>',
          '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
        ),
    ),
  );
  zip.addFile(
    'xl/styles.xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><color rgb="FF40291D"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF40291D"/><name val="Calibri"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE6A3"/><bgColor indexed="64"/></patternFill></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="center" wrapText="1"/></xf>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf>' +
        '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment vertical="center"/></xf>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>' +
        '<xf numFmtId="3" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"><alignment vertical="center"/></xf></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    ),
  );
  return zip.toBuffer();
}
module.exports = { filterPayrollItems, payrollWorkbook };
