export interface PriceLabelDraft {
  nameRu: string;
  nameKk: string;
  price: string;
  ingredientsRu: string;
  ingredientsKk: string;
  background: string;
}

export const LABEL_BACKGROUND = '#792C14';
export const LABEL_BACKGROUND_KEY = 'bulka-price-label-background-v1';
export const labelHex = (value: string) => {
  const hex = value.trim().replace(/^#/, '');
  return /^[\da-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null;
};
const escapeXml = (value: string) =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!,
    );
type Measure = (text: string, size: number, bold: boolean) => number;

function wrap(text: string, width: number, size: number, bold: boolean, measure: Measure) {
  const lines: string[] = [];
  for (const paragraph of text.trim().split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, size, bold) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      // Long uninterrupted ingredient names also wrap without being cut off.
      for (const char of word) {
        if (line && measure(line + char, size, bold) > width) {
          lines.push(line);
          line = '';
        }
        line += char;
      }
    }
    if (line || !paragraph.trim()) lines.push(line);
  }
  return lines;
}

const textBlock = (
  lines: string[],
  x: number,
  y: number,
  size: number,
  lineHeight: number,
  bold = false,
) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${bold ? 700 : 400}" text-anchor="middle">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? lineHeight : 0}">${escapeXml(line)}</tspan>`).join('')}</text>`;

export function buildPriceLabel(
  draft: PriceLabelDraft,
  measure: Measure,
  qr?: { size: number; data: ArrayLike<number> },
) {
  const hex = labelHex(draft.background) || LABEL_BACKGROUND;
  const luminance = [1, 3, 5]
    .map((offset) => {
      const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const qrColor = luminance > 0.179 ? '#000000' : '#FFFFFF';
  const qrSvg = qr
    ? `<svg x="820" y="20" width="160" height="160" viewBox="0 0 ${qr.size + 8} ${qr.size + 8}" shape-rendering="crispEdges" aria-label="QR-код товара"><path fill="${qrColor}" d="${Array.from(
        qr.data,
      )
        .flatMap((value, index) =>
          value ? [`M${(index % qr.size) + 4} ${Math.floor(index / qr.size) + 4}h1v1h-1z`] : [],
        )
        .join('')}"/></svg>`
    : '';
  const errors: Partial<Record<keyof PriceLabelDraft, string>> = {};
  const background = labelHex(draft.background);
  if (!background) errors.background = 'Введите HEX-код из 6 символов, например #792C14.';
  for (const key of ['nameRu', 'nameKk', 'ingredientsRu', 'ingredientsKk'] as const) {
    if (!draft[key].trim()) errors[key] = 'Заполните это поле.';
  }
  const numericPrice = draft.price.trim().replace(',', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(numericPrice))
    errors.price = 'Введите цену от 0 до 9 999 999,99.';
  const price = errors.price
    ? ''
    : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(numericPrice));
  let nameSize = 66,
    nameLines: string[] = [];
  for (; nameSize >= 30; nameSize -= 2) {
    nameLines = [draft.nameKk, draft.nameRu].flatMap((name) =>
      wrap(name, qr ? 600 : 880, nameSize, true, measure),
    );
    if (nameLines.length * nameSize * 1.06 <= 140) break;
  }
  if (nameSize < 30)
    errors.nameRu = 'Названия слишком длинные для ценника 10 × 6 см. Сократите их.';
  let priceSize = qr ? 160 : 220;
  while (priceSize > 90 && measure(price, priceSize, true) > 890) priceSize -= 2;
  const composition = (text: string, prefix: string, field: 'ingredientsRu' | 'ingredientsKk') => {
    let size = 27,
      lines: string[] = [];
    for (; size >= 22; size--) {
      lines = wrap(`${prefix} ${text.trim()}`, 400, size, false, measure);
      if (lines.length * size * 1.2 <= 150) break;
    }
    if (size < 22) errors[field] = 'Состав не помещается. Сократите текст для ценника 10 × 6 см.';
    return { lines, size: Math.max(22, size) };
  };
  const ru = composition(draft.ingredientsRu, 'Состав:', 'ingredientsRu');
  const kk = composition(draft.ingredientsKk, 'Құрамы:', 'ingredientsKk');
  const readableNameSize = Math.max(30, nameSize);
  const namesY = 38 + readableNameSize * 0.8;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 1000 600" role="img" aria-label="Ценник 10 на 6 сантиметров">
<rect width="1000" height="600" fill="${background || LABEL_BACKGROUND}"/>
<g fill="#FFFFFF" font-family="Arial, Helvetica, sans-serif">
${textBlock(nameLines, 500, namesY, readableNameSize, readableNameSize * 1.06, true)}
${textBlock([price], 500, 370, priceSize, priceSize, true)}
${textBlock(ru.lines, 250, 445, ru.size, ru.size * 1.2)}
${textBlock(kk.lines, 750, 445, kk.size, kk.size * 1.2)}
</g>${qrSvg}<path d="M500 416 V575" stroke="#CB842E" stroke-width="4" stroke-dasharray="17 10"/>
</svg>`;
  return { svg, errors, fits: Object.keys(errors).length === 0 };
}

export function browserLabelMeasure(): Measure {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) throw new Error('Браузер не поддерживает предварительный просмотр.');
  return (text, size, bold) => {
    context.font = `${bold ? 700 : 400} ${size}px Arial`;
    return context.measureText(text).width;
  };
}

export function printPriceLabel(svg: string, name: string) {
  const page = window.open('', '_blank');
  if (!page)
    throw new Error('Разрешите открытие окна печати для этого сайта и нажмите «Печать» ещё раз.');
  page.opener = null;
  page.document.open();
  page.document
    .write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Ценник ${escapeXml(name)}</title><style>
@page{size:100mm 60mm;margin:0}
*{box-sizing:border-box}html,body{margin:0;padding:0;width:100mm;height:60mm}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}body>svg{display:block;width:100mm;height:60mm}
@media screen{body{margin:24px}}
</style></head><body>${svg}</body></html>`);
  page.document.close();
  void page.document.fonts.ready.then(() => {
    if (!page.closed) {
      page.focus();
      page.print();
    }
  });
}
