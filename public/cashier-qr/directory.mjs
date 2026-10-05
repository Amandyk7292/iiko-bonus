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
export function filterCashiers(items, city, search, pointId = '') {
  const words = search.normalize('NFKC').toLocaleLowerCase('ru').trim().split(/\s+/).filter(Boolean);
  return items.filter((row) => (!city || row.city === city) && (!pointId || row.pointId === pointId) && words.every((word) =>
    `${row.name} ${row.branchName} ${row.city}`.normalize('NFKC').toLocaleLowerCase('ru').includes(word)));
}
export function cashierPoints(items, city) {
  if (!city) return [];
  const points = new Map();
  for (const row of items) {
    if (row.city === city && typeof row.pointId === 'string' && row.pointId) {
      points.set(row.pointId, row.branchName);
    }
  }
  const names = new Map();
  for (const name of points.values()) names.set(name, (names.get(name) || 0) + 1);
  return [...points].map(([id, name]) => ({ id, name: names.get(name) > 1 ? `${name} · № ${id}` : name })).sort((a, b) =>
    a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id));
}
export function qrImageUrl(token) {
  if (!tokenPattern.test(token)) throw new Error('Некорректный QR');
  return `/api/public/cashier-invites/${token}/qr`;
}
