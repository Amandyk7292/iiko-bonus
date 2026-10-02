// Store-only ZIP keeps SVG sheets editable and works without a server or extra dependencies.
export function svgSheetsZip(sheets: string[]) {
  if (!sheets.length || sheets.length > 65535) throw new Error('Некорректное число листов.');
  const encoder = new TextEncoder();
  const table = Uint32Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    return value >>> 0;
  });
  const files = sheets.map((svg, index) => {
    const name = encoder.encode(`bulka-labels-${String(index + 1).padStart(3, '0')}.svg`);
    const data = encoder.encode(svg);
    let crc = 0xffffffff;
    for (const byte of data) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
    return { name, data, crc: (crc ^ 0xffffffff) >>> 0 };
  });
  const fileBytes = files.reduce(
    (total, file) => total + 30 + file.name.length + file.data.length,
    0,
  );
  const directoryBytes = files.reduce((total, file) => total + 46 + file.name.length, 0);
  const bytes = new Uint8Array(fileBytes + directoryBytes + 22);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  const offsets: number[] = [];
  for (const file of files) {
    offsets.push(offset);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0x0800, true);
    view.setUint16(offset + 12, 0x0021, true); // 1980-01-01, valid DOS date.
    view.setUint32(offset + 14, file.crc, true);
    view.setUint32(offset + 18, file.data.length, true);
    view.setUint32(offset + 22, file.data.length, true);
    view.setUint16(offset + 26, file.name.length, true);
    bytes.set(file.name, offset + 30);
    bytes.set(file.data, offset + 30 + file.name.length);
    offset += 30 + file.name.length + file.data.length;
  }
  for (const [index, file] of files.entries()) {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, 0x0800, true);
    view.setUint16(offset + 14, 0x0021, true);
    view.setUint32(offset + 16, file.crc, true);
    view.setUint32(offset + 20, file.data.length, true);
    view.setUint32(offset + 24, file.data.length, true);
    view.setUint16(offset + 28, file.name.length, true);
    view.setUint32(offset + 42, offsets[index], true);
    bytes.set(file.name, offset + 46);
    offset += 46 + file.name.length;
  }
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 8, files.length, true);
  view.setUint16(offset + 10, files.length, true);
  view.setUint32(offset + 12, directoryBytes, true);
  view.setUint32(offset + 16, fileBytes, true);
  return bytes;
}
