import { PDFDocument, PrintScaling, rgb } from 'pdf-lib';
import { batchLabel, type LabelProduct } from './price-label-batch';
import { LABELS_PER_SHEET, LABEL_SHEET, labelSheetPosition } from './price-label-sheet';
const MM = 72 / 25.4;
export function labelPosition(index: number) {
  const { x, y } = labelSheetPosition(index);
  return {
    x: x * MM,
    y: (LABEL_SHEET.height - y - LABEL_SHEET.labelHeight) * MM,
    width: LABEL_SHEET.labelWidth * MM,
    height: LABEL_SHEET.labelHeight * MM,
  };
}
async function labelPng(svg: string): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 1182;
    canvas.height = 710;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось подготовить изображение ценника.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('Не удалось подготовить PDF.'))),
        'image/png',
      ),
    );
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function generatePriceLabelsPdf(
  products: LabelProduct[],
  background: string,
  includeQr: boolean,
  textColor: string,
  progress: (done: number) => void,
) {
  if (!products.length) throw new Error('Нет товаров вне стоп-листа для печати.');
  const pdf = await PDFDocument.create();
  pdf.setTitle('Ценники Bulka');
  pdf.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None);
  for (const [index, product] of products.entries()) {
    if (index % LABELS_PER_SHEET === 0)
      pdf.addPage([LABEL_SHEET.width * MM, LABEL_SHEET.height * MM]);
    const label = batchLabel(product, background, includeQr, textColor);
    const image = await pdf.embedPng(await labelPng(label.svg));
    pdf.getPages().at(-1)!.drawImage(image, labelPosition(index));
    pdf
      .getPages()
      .at(-1)!
      .drawRectangle({
        ...labelPosition(index),
        borderColor: rgb(0.25, 0.15, 0.1),
        borderWidth: 0.25,
        borderOpacity: 0.5,
      });
    progress(index + 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { bytes: await pdf.save() };
}
