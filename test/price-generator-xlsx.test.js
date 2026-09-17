const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const { rowsFromWorkbook } = require('../src/services/price-generator-xlsx.service');

function workbook() {
  const zip = new AdmZip();
  zip.addFile(
    'xl/workbook.xml',
    Buffer.from(
      '<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Data" r:id="rId1"/></sheets></workbook>',
    ),
  );
  zip.addFile(
    'xl/_rels/workbook.xml.rels',
    Buffer.from(
      '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
  );
  zip.addFile(
    'xl/sharedStrings.xml',
    Buffer.from(
      '<?xml version="1.0"?><sst><si><t>Наименование</t></si><si><t>Состав</t></si><si><t>Цена</t></si><si><t>Срок годности</t></si><si><t>Штрихкод</t></si><si><t>Хот дог</t></si><si><t>Состав: тест</t></si></sst>',
    ),
  );
  zip.addFile(
    'xl/worksheets/sheet1.xml',
    Buffer.from(
      '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c><c r="E1" t="s"><v>3</v></c><c r="F1" t="s"><v>4</v></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2" t="s"><v>5</v></c><c r="C2" t="s"><v>6</v></c><c r="D2"><v>600</v></c><c r="E2"><v>1</v></c><c r="F2"><v>2101430000016</v></c></row></sheetData></worksheet>',
    ),
  );
  return zip.toBuffer();
}

test('price generator reads label fields from the first Excel worksheet', () => {
  assert.deepEqual(rowsFromWorkbook(workbook()), [
    {
      id: '1',
      name: 'Хот дог',
      composition: 'Состав: тест',
      price: '600',
      expiry: '1',
      barcode: '2101430000016',
    },
  ]);
});

test('price generator rejects a workbook without required columns', () => {
  const zip = new AdmZip(workbook());
  zip.updateFile(
    'xl/sharedStrings.xml',
    Buffer.from('<?xml version="1.0"?><sst><si><t>Другое</t></si></sst>'),
  );
  assert.throws(() => rowsFromWorkbook(zip.toBuffer()), /Нужны колонки/);
});
