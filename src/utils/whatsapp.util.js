function phoneDigitsFromJid(jid) {
  const value = String(jid || '');
  const separator = value.indexOf('@');
  if (separator < 1) return '';

  const server = value.slice(separator + 1);
  if (!['s.whatsapp.net', 'hosted', 'c.us'].includes(server)) return '';

  return value
    .slice(0, separator)
    .split(':')[0]
    .split('_')[0]
    .replace(/[^0-9]/g, '');
}

async function resolveWhatsAppSenderDigits(key = {}, lidMapping = null) {
  const candidates = [key.participantAlt, key.remoteJidAlt, key.participant, key.remoteJid].filter(
    Boolean,
  );

  for (const jid of candidates) {
    const digits = phoneDigitsFromJid(jid);
    if (digits) return digits;
  }

  const lid = candidates.find(
    (jid) => String(jid).endsWith('@lid') || String(jid).endsWith('@hosted.lid'),
  );
  if (!lid || typeof lidMapping?.getPNForLID !== 'function') return '';

  try {
    return phoneDigitsFromJid(await lidMapping.getPNForLID(lid));
  } catch {
    return '';
  }
}

module.exports = { phoneDigitsFromJid, resolveWhatsAppSenderDigits };
