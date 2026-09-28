// iiko represents internal transfers as incoming invoices from a store supplier.
// Use its metadata, not names: external suppliers may also have "цех" in their name.
function isInternalSupplier(supplier) {
  if (!supplier) return false;
  const flag = String(supplier.representsStore ?? '')
    .trim()
    .toLowerCase();
  const storeId = String(supplier.representedStoreId ?? '').trim();
  return (
    flag === 'true' ||
    flag === '1' ||
    (/^[a-f0-9-]{36}$/i.test(storeId) && storeId !== '00000000-0000-0000-0000-000000000000')
  );
}

module.exports = { isInternalSupplier };
