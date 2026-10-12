const { buildReport } = require('./iiko-dashboard.service');
const { receiptError } = require('./fortune-receipt-qr');
const unavailable = () =>
  receiptError('FORTUNE_RECEIPT_UNAVAILABLE', 'Проверка кассового чека пока недоступна', 503);

function receiptReportBody(query, columns) {
  const range = query.closeTimeRange;
  const timestamp = /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/;
  if (
    !columns.CloseTime?.filteringAllowed ||
    !range ||
    !timestamp.test(range.from) ||
    !timestamp.test(range.to)
  )
    throw unavailable();
  const duration = Date.parse(`${range.to}Z`) - Date.parse(`${range.from}Z`);
  if (!Number.isFinite(duration) || duration < 1 || duration > 60000) throw unavailable();
  const body = buildReport(query, columns);
  body.filters.CloseTime = {
    filterType: 'DateRange',
    periodType: 'CUSTOM',
    from: range.from,
    to: range.to,
    includeLow: true,
    includeHigh: true,
  };
  return body;
}

async function loadFortuneReceiptReport(reports, query, columns) {
  const body = receiptReportBody(query, columns);
  // Keep the existing dashboard contract unchanged. Receipt validation uses an
  // uncached, internally constructed request bounded by the actual close time.
  if (typeof reports.client?.withSession === 'function') {
    const response = await reports.client.withSession(query.serverId, (request) =>
      request('v2/reports/olap', body),
    );
    if (!Array.isArray(response?.data) || response.data.length > 25000) throw unavailable();
    return { rows: response.data };
  }
  // Injected report adapters must be uncached too; never fall back to report().
  if (typeof reports.loadReport !== 'function') throw unavailable();
  const response = await reports.loadReport(query);
  if (!Array.isArray(response?.rows) || response.rows.length > 25000) throw unavailable();
  return response;
}

module.exports = { loadFortuneReceiptReport, receiptReportBody };
