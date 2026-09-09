const { getFrontInventoryStatus } = require('./front-inventory.service');

async function branchCatalogSource(iiko, branchId) {
  const frontSync = branchId ? await getFrontInventoryStatus(branchId) : { configured: false };
  const rawMenu = await iiko.getMenu({ strict: true });
  // A branch connected directly to Front must never inherit another terminal's
  // stop list or be overwritten by the slower cloud snapshot.
  const stopIds = frontSync.configured
    ? new Set()
    : await iiko.getStopListProductIds(undefined, { strict: true });
  return { rawMenu, stopIds, frontSync };
}

function branchProductAvailable(inventory, productId) {
  const item = inventory.get(String(productId));
  if (item) return item.isAvailable !== false;
  return !inventory.frontSync?.configured || inventory.frontSync.connected;
}

module.exports = { branchCatalogSource, branchProductAvailable };
