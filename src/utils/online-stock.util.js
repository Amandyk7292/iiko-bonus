// Keep one counted unit for walk-in sales. Unknown/unlimited stock stays null.
// The same rule is enforced under the inventory row lock by the checkout RPCs.
const ONLINE_STOCK_BUFFER = 1;

function onlineAvailableQuantity(sourceQuantity, reserved = 0) {
  return sourceQuantity == null
    ? null
    : Math.max(0, Number(sourceQuantity) - Number(reserved) - ONLINE_STOCK_BUFFER);
}

module.exports = { ONLINE_STOCK_BUFFER, onlineAvailableQuantity };
