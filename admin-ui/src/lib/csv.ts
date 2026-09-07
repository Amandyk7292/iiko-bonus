export function csvCell(value: unknown): string {
  let text = String(value ?? '');
  // Quoting alone does not stop spreadsheets from executing string formulas.
  // Keep actual numeric amounts numeric, including negative adjustments.
  if (typeof value === 'string' && /^[\s\uFEFF]*[=+\-@\t\r\n]/u.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}
