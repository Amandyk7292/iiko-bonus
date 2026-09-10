// Keep one counted unit for walk-in sales. Unknown/unlimited stock stays null.
// The same rule is enforced under the inventory row lock by the checkout RPCs.
const ONLINE_STOCK_BUFFER = 1;

function onlineAvailableQuantity(sourceQuantity, reserved = 0, step = ONLINE_STOCK_BUFFER) {
  return sourceQuantity == null
    ? null
    : Math.max(0, Math.round((Number(sourceQuantity) - Number(reserved) - step) * 1000) / 1000);
}

module.exports = { ONLINE_STOCK_BUFFER, onlineAvailableQuantity };
