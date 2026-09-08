const words = {
  high_discount: 'Высокая скидка',
  large_return: 'Крупный возврат',
  repeat_returns: '3+ возврата за день',
  review_increase: 'Проверить увеличение',
  reduce_batch: 'Проверить размер партии',
  review_decline: 'Спрос снизился — проверить план',
  review_no_sales: 'Нет продаж — проверить наличие',
  keep: 'Сохранить и наблюдать',
  short_period: 'Выберите минимум 7 дней',
  fast: 'Высокий',
  slow: 'Низкий',
  regular: 'Средний',
  no_sales: 'Нет продаж',
};
function controlsExport(report, input) {
  return {
    ...report,
    rows: report.rows
      .filter(
        (row) =>
          (!input.flaggedOnly || row.Flags) &&
          (!input.adviceOnly || !['keep', 'short_period'].includes(row.Advice)),
      )
      .map((row) => ({
        ...row,
        ...(report.columns.Flags
          ? {
              Flags: String(row.Flags || '')
                .split('|')
                .filter(Boolean)
                .map((code) => words[code] || code)
                .join(' · '),
            }
          : {}),
        ...(report.columns.Advice
          ? { Advice: words[row.Advice] || row.Advice, Pace: words[row.Pace] || row.Pace }
          : {}),
      })),
  };
}
module.exports = { controlsExport };
