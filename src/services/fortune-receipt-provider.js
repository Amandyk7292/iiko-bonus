const { parseReceiptQr, receiptError, moneyCents } = require('./fortune-receipt-qr');
const tls = require('node:tls');
const https = require('node:https');
// Use the machine's normally trusted certificate authorities as well as Node's
// bundled roots. OOFD's chain is trusted by the OS on our Windows deployment
// workstation. Certificate and hostname verification remain enabled.
const trustedAgent =
  typeof tls.getCACertificates === 'function'
    ? new https.Agent({
        ca: [...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])],
        rejectUnauthorized: true,
      })
    : undefined;

const unavailable = () =>
  receiptError(
    'FORTUNE_RECEIPT_UNAVAILABLE',
    'Проверка этого фискального чека пока недоступна',
    503,
  );
const notFound = () => receiptError('FORTUNE_RECEIPT_NOT_FOUND', 'Фискальный чек не подтверждён');

function verifiedWofdTicket(payload, receipt) {
  if (
    !payload ||
    payload.found !== 1 ||
    !Array.isArray(payload.ticket) ||
    !payload.ticket.length ||
    payload.ticket.length > 500
  )
    throw notFound();
  const lines = payload.ticket.map((line) => {
    if (!line || typeof line.text !== 'string' || line.text.length > 4096) throw unavailable();
    return line.text;
  });
  const qr = [];
  for (const text of lines) {
    if (!/^https?:\/\//i.test(text)) continue;
    try {
      qr.push(parseReceiptQr(text));
    } catch {
      /* Non-fiscal footer links are ignored. */
    }
  }
  if (
    qr.length !== 1 ||
    qr[0].receiptIdentity !== receipt.receiptIdentity ||
    qr[0].localClosedAt !== receipt.localClosedAt ||
    qr[0].totalCents !== receipt.totalCents
  )
    throw notFound();
  const text = lines.join('\n');
  // The official consumer endpoint returns printable lines, not an arbitrary
  // customer HTML upload. Accept only explicit sale headings and one serial.
  if (
    /ВОЗВРАТ|ҚАЙТАРУ|ҚАЙТАРЫМ|REFUND|RETURN|СТОРНО|АННУЛИРОВАН/i.test(text) ||
    !/(?:^|\n)\s*(?:ПРОДАЖА|САТУ|SALE)\s*(?:\n|$)/i.test(text)
  )
    throw notFound();
  const serials = [
    ...text.matchAll(
      /(?:ЗНМ|ЗАВОДСКОЙ НОМЕР(?: ККМ)?|СЕРИЙНЫЙ НОМЕР(?: ККМ)?)\s*[:№]?\s*([A-Z0-9-]{4,40})\b/gi,
    ),
  ].map((match) => match[1].toUpperCase());
  if (serials.length !== 1) throw unavailable();
  const ordinals = [
    ...text.matchAll(/(?:^|\n)\s*(?:ЧЕК|CHECK)\s*№\s*([1-9]\d{0,9})\s*(?:\n|$)/gi),
  ].map((match) => match[1]);
  if (ordinals.length > 1) throw unavailable();
  return {
    ...receipt,
    registerSerial: serials[0],
    source: 'wofd',
    ...(ordinals.length === 1 ? { fiscalOrdinal: ordinals[0] } : {}),
  };
}

function verifiedOofdTicket(payload, receipt) {
  const ticket = payload?.ticket;
  if (
    !ticket ||
    ticket.type !== 'TICKET' ||
    ticket.operationType !== 2 ||
    ticket.cancelDate !== null
  )
    throw notFound();
  const serial = String(payload.kkmSerialNumber || '').toUpperCase();
  const time = String(ticket.transactionDate || '');
  if (
    !/^[A-Z0-9-]{4,40}$/.test(serial) ||
    !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?$/.test(time)
  )
    throw unavailable();
  if (
    String(payload.kkmFnsId) !== receipt.registrationNumber ||
    String(ticket.offlineFiscalId ?? ticket.fiscalId) !== receipt.fiscalSign ||
    time.slice(0, 19) !== receipt.localClosedAt ||
    moneyCents(ticket.totalSum) !== receipt.totalCents
  )
    throw notFound();
  if (!Array.isArray(ticket.items) || !ticket.items.length || ticket.items.length > 500)
    throw unavailable();
  let lineTotal = 0;
  let commodities = 0;
  for (const item of ticket.items) {
    const amount = moneyCents(
      item.itemType === 1
        ? item.commodity?.sum
        : item.itemType === 3
          ? item.markup?.sum
          : item.itemType === 5
            ? item.discount?.sum
            : null,
    );
    if (amount === null || ![1, 3, 5].includes(item.itemType)) throw unavailable();
    if (item.itemType === 1) {
      if (!Number.isFinite(Number(item.commodity.quantity)) || Number(item.commodity.quantity) <= 0)
        throw unavailable();
      commodities++;
      for (const tax of item.commodity.taxes || []) {
        if (tax.inTotalSum !== true && tax.inTotalSum !== false) throw unavailable();
        const taxAmount = moneyCents(tax.sum);
        if (taxAmount === null) throw unavailable();
        if (tax.inTotalSum === false) lineTotal += taxAmount;
      }
    }
    lineTotal += item.itemType === 5 ? -amount : amount;
  }
  for (const [field, direction] of [
    ['discount', -1],
    ['markup', 1],
  ]) {
    if (ticket[field] == null) continue;
    const amount = moneyCents(ticket[field].sum);
    if (amount === null) throw unavailable();
    lineTotal += direction * amount;
  }
  if (!commodities || lineTotal !== receipt.totalCents) throw notFound();
  const children = ticket.options?.children || [];
  if (!Array.isArray(children) || children.length > 50) throw unavailable();
  const ordinals = children.filter((option) => option?.name === 'printedDocumentNumber');
  if (
    ordinals.length > 1 ||
    (ordinals.length === 1 && !/^[1-9]\d{0,9}$/.test(String(ordinals[0].value)))
  )
    throw unavailable();
  return {
    ...receipt,
    registerSerial: serial,
    source: 'oofd',
    ...(ordinals.length === 1 ? { fiscalOrdinal: String(ordinals[0].value) } : {}),
  };
}

async function lookupFiscalReceipt(receipt, { fetchImpl = require('node-fetch') } = {}) {
  if (!['wofd', 'oofd'].includes(receipt.provider)) throw unavailable();
  // These are the anonymous official consumer lookups used by their websites.
  // Never fetch an uploaded QR URL or follow redirects to an arbitrary host.
  const url = new URL(
    receipt.provider === 'wofd'
      ? 'https://cabinet.wofd.kz/api/tickets'
      : 'https://consumer.oofd.kz/api/consumer-proxy/api/tickets/get-by-url',
  );
  const parameters =
    receipt.provider === 'wofd'
      ? {
          registrationNumber: receipt.registrationNumber,
          ticketNumber: receipt.fiscalSign,
          ticketDate: receipt.localClosedAt.slice(0, 10),
        }
      : {
          f: receipt.registrationNumber,
          i: receipt.fiscalSign,
          s: (receipt.totalCents / 100).toFixed(2),
          t: receipt.localClosedAt.replaceAll('-', '').replaceAll(':', ''),
        };
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      redirect: 'error',
      size: 256 * 1024,
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      agent: trustedAgent,
    });
    if (response.status === 400 || response.status === 404) throw notFound();
    if (!response.ok || !/application\/json/i.test(response.headers.get('content-type') || ''))
      throw unavailable();
    const body = await response.text();
    if (Buffer.byteLength(body) > 256 * 1024) throw unavailable();
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      throw unavailable();
    }
    return receipt.provider === 'wofd'
      ? verifiedWofdTicket(payload, receipt)
      : verifiedOofdTicket(payload, receipt);
  } catch (error) {
    if (error.code?.startsWith('FORTUNE_')) throw error;
    throw unavailable();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  lookupFiscalReceipt,
  verifiedWofdTicket,
  verifiedOofdTicket,
  supportedProviderIds: ['wofd', 'oofd'],
};
