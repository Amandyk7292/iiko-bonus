import { batchLabel, type LabelProduct } from './price-label-batch';
import { LABELS_PER_SHEET, LABEL_SHEET, labelSheetPosition } from './price-label-sheet';
import { svgSheetsZip } from './svg-sheets-zip';

export async function generatePriceLabelsCorel(
  products: LabelProduct[],
  background: string,
  includeQr: boolean,
  textColor: string,
  progress: (done: number) => void,
) {
  if (!products.length) throw new Error('Нет товаров вне стоп-листа для печати.');
  const sheets: string[] = [];
  let labels: string[] = [];
  for (const [index, product] of products.entries()) {
    const svg = batchLabel(product, background, includeQr, textColor).svg;
    // Flatten the outer label viewport so text and shapes remain editable in CorelDRAW.
    const content = svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'));
    const { x, y } = labelSheetPosition(index);
    labels.push(
      `<g id="label-${index + 1}" transform="translate(${x * 10} ${y * 10})">${content}<rect width="1000" height="600" fill="none" stroke="#40261A" stroke-width="0.9" stroke-opacity="0.5"/></g>`,
    );
    if (labels.length === LABELS_PER_SHEET || index === products.length - 1) {
      sheets.push(
        `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL_SHEET.width}mm" height="${LABEL_SHEET.height}mm" viewBox="0 0 2100 2970"><title>Ценники Bulka · ${sheets.length + 1}</title><rect width="2100" height="2970" fill="#FFFFFF"/>${labels.join('\n')}</svg>`,
      );
      labels = [];
    }
    progress(index + 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { bytes: svgSheetsZip(sheets) };
}
