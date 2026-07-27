function normalizeKazakhstanPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const normalized =
    digits.length === 11 && digits.startsWith('8') ? `7${digits.slice(1)}` : digits;
  return /^7\d{10}$/.test(normalized) ? `+${normalized}` : null;
}

module.exports = { normalizeKazakhstanPhone };
