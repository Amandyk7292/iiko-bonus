const AdmZip = require('adm-zip');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

function list(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    if ('#text' in value) return String(value['#text']);
    if ('t' in value) return list(value.t).map(text).join('');
    if ('r' in value) return list(value.r).map(text).join('');
  }
  return String(value);
}

function columnIndex(reference) {
  const letters =
    String(reference || '')
      .match(/^[A-Z]+/i)?.[0]
      ?.toUpperCase() || '';
  return [...letters].reduce((result, letter) => result * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function xmlEntry(zip, name) {
  const entry = zip.getEntry(name);
  return entry ? parser.parse(entry.getData().toString('utf8')) : null;
}

function sharedStrings(zip) {
  const document = xmlEntry(zip, 'xl/sharedStrings.xml');
  return list(document?.sst?.si).map(text);
}

function firstWorksheetPath(zip) {
  const workbook = xmlEntry(zip, 'xl/workbook.xml');
  const relationships = xmlEntry(zip, 'xl/_rels/workbook.xml.rels');
  const firstSheet = list(workbook?.workbook?.sheets?.sheet)[0];
  const relationId = firstSheet?.['r:id'];
  const relation = list(relationships?.Relationships?.Relationship).find(
    (item) => item.Id === relationId,
  );
  if (!relation?.Target) throw new Error('В Excel не найден первый лист.');
  return `xl/${String(relation.Target)
    .replace(/^\/?xl\//, '')
    .replace(/^\//, '')}`;
}

function cellValue(cell, strings) {
  if (cell.t === 's') return strings[Number(cell.v)] || '';
  if (cell.t === 'inlineStr') return text(cell.is);
  if (cell.t === 'b') return String(cell.v) === '1';
  return cell.v == null ? '' : String(cell.v);
}

function rowsFromWorkbook(buffer) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error('Не удалось открыть Excel. Загрузите файл .xlsx.');
  }
  const strings = sharedStrings(zip);
  const worksheet = xmlEntry(zip, firstWorksheetPath(zip));
  const rows = list(worksheet?.worksheet?.sheetData?.row).map((row) => {
    const result = [];
    for (const cell of list(row.c)) result[columnIndex(cell.r)] = cellValue(cell, strings);
    return result;
  });
  if (!rows.length) throw new Error('Excel не содержит строк.');
  const headers = rows[0].map((value) =>
    String(value || '')
      .trim()
      .toLowerCase(),
  );
  const find = (...names) => headers.findIndex((header) => names.includes(header));
  const indexes = {
    name: find('наименование', 'название', 'товар'),
    composition: find('состав', 'описание'),
    price: find('цена', 'стоимость'),
    expiry: find('срок годности', 'срок'),
    barcode: find('штрихкод', 'штрих-код', 'barcode'),
  };
  if (indexes.name < 0 || indexes.barcode < 0)
    throw new Error('Нужны колонки «Наименование» и «Штрихкод».');
  return rows
    .slice(1)
    .map((row, offset) => ({
      id: String(row[0] || offset + 1),
      name: String(row[indexes.name] || '').trim(),
      composition: indexes.composition < 0 ? '' : String(row[indexes.composition] || '').trim(),
      price: indexes.price < 0 ? '' : String(row[indexes.price] || '').trim(),
      expiry: indexes.expiry < 0 ? '' : String(row[indexes.expiry] || '').trim(),
      barcode: String(row[indexes.barcode] || '')
        .trim()
        .replace(/\.0$/, ''),
    }))
    .filter((row) => row.name || row.barcode);
}

module.exports = { rowsFromWorkbook };
