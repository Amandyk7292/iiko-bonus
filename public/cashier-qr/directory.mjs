const tokenPattern = /^[a-f0-9]{64}$/;
export function readDirectory(result) {
  if (result?.success !== true || !Array.isArray(result.items)) {
    throw new Error('Не удалось загрузить список кассиров');
  }
  const seen = new Set();
  return result.items.filter((row) => {
    if (!row || typeof row.id !== 'string' || seen.has(row.id) ||
        typeof row.name !== 'string' || !row.name.trim() ||
        typeof row.city !== 'string' || typeof row.branchName !== 'string' ||
        !tokenPattern.test(row.inviteToken) || row.isArchived === true) return false;
    seen.add(row.id);
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}
export function filterCashiers(items, city, search) {
  const words = search.normalize('NFKC').toLocaleLowerCase('ru').trim().split(/\s+/).filter(Boolean);
  return items.filter((row) => (!city || row.city === city) && words.every((word) =>
    `${row.name} ${row.branchName} ${row.city}`.normalize('NFKC').toLocaleLowerCase('ru').includes(word)));
}
export function qrImageUrl(token) {
  if (!tokenPattern.test(token)) throw new Error('Некорректный QR');
  return `/api/public/cashier-invites/${token}/qr`;
}
