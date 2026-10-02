export const LABELS_PER_SHEET = 8;
export const LABEL_SHEET = { width: 210, height: 297, labelWidth: 100, labelHeight: 60 };

export function labelSheetPosition(index: number) {
  const slot = index % LABELS_PER_SHEET;
  return { x: 3.5 + (slot % 2) * 103, y: 24 + Math.floor(slot / 2) * 63 };
}
