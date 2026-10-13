export interface VirtualPosProduct {
  id: string;
  name: string;
  price: number;
  unit: string;
  quantityStep: number;
  paymentTypeIds: string[];
  available: boolean;
  unavailableReason?: string;
}

export interface VirtualPosPaymentType {
  id: string;
  name: string;
  kind: string;
  isFiscal: boolean;
  selectable: boolean;
  reason?: string;
}

export interface VirtualPosCatalog {
  branch: { id: string; name: string; address: string; city: string };
  terminal: { id: string; name: string; connected: boolean } | null;
  cashShift: { id: string | null; isOpen: boolean; number?: number | string } | null;
  revision: string | null;
  products: VirtualPosProduct[];
  paymentTypes: VirtualPosPaymentType[];
  canSell: boolean;
  unavailableReason?: string;
}

export interface VirtualPosSaleRequest {
  requestId: string;
  terminalId: string;
  snapshotRevision: string;
  cashShiftId: string;
  paymentTypeId: string;
  items: Array<{ productId: string; quantity: number }>;
  expectedTotal: number;
}

export type VirtualPosSaleStatus =
  | 'queued' | 'claimed' | 'creating' | 'created' | 'payment_started'
  | 'completed' | 'rejected' | 'needs_reconciliation';

export interface VirtualPosSale {
  id: string;
  status: VirtualPosSaleStatus;
  total: number;
  frontOrderId?: string;
  frontOrderNumber?: string | number;
  cashShiftId?: string;
  error?: string;
}

export interface VirtualPosCartLine {
  productId: string;
  name: string;
  quantity: string;
  price: number;
  unit: string;
}

export interface PendingVirtualPosSale {
  request: VirtualPosSaleRequest;
  cart: VirtualPosCartLine[];
  paymentName: string;
  branchName: string;
  sale?: VirtualPosSale;
}

export const virtualPosPendingKey = (username: string, branchId: string) =>
  `bulkaVirtualPosPending:${encodeURIComponent(username)}:${encodeURIComponent(branchId)}`;

const requestKey = (username: string, branchId: string, requestId: string) =>
  `${virtualPosPendingKey(username, branchId)}:request:${encodeURIComponent(requestId)}`;

function parsePendingVirtualPosSale(raw: string | null): PendingVirtualPosSale | null {
  try {
    const value = JSON.parse(raw || 'null');
    if (!value || !value.request || typeof value.request.requestId !== 'string' ||
      !Array.isArray(value.request.items) || !Array.isArray(value.cart)) return null;
    return value;
  } catch { return null; }
}

export function readPendingVirtualPosSale(username: string, branchId: string): PendingVirtualPosSale | null {
  try {
    const key = virtualPosPendingKey(username, branchId);
    const current = parsePendingVirtualPosSale(localStorage.getItem(key));
    if (current) return current;
    const prefix = `${key}:request:`;
    for (let index = 0; index < localStorage.length; index++) {
      const candidateKey = localStorage.key(index);
      if (!candidateKey?.startsWith(prefix)) continue;
      const candidate = parsePendingVirtualPosSale(localStorage.getItem(candidateKey));
      if (candidate) return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

export function savePendingVirtualPosSale(username: string, branchId: string, operation: PendingVirtualPosSale) {
  const raw = JSON.stringify(operation);
  // Each request has its own recovery record, so a delayed response in another tab
  // cannot erase a newer request even if the shared branch pointer changes.
  localStorage.setItem(requestKey(username, branchId, operation.request.requestId), raw);
  localStorage.setItem(virtualPosPendingKey(username, branchId), raw);
}

export function removePendingVirtualPosSale(username: string, branchId: string, requestId: string) {
  localStorage.removeItem(requestKey(username, branchId, requestId));
  const key = virtualPosPendingKey(username, branchId);
  const current = parsePendingVirtualPosSale(localStorage.getItem(key));
  if (current?.request.requestId === requestId) localStorage.removeItem(key);
  return readPendingVirtualPosSale(username, branchId);
}

export function validVirtualPosQuantity(value: string, product: VirtualPosProduct) {
  if (!/^\d+(?:[.,]\d{1,3})?$/.test(value)) return false;
  const quantity = Number(value.replace(',', '.'));
  const step = product.quantityStep;
  return Number.isFinite(quantity) && quantity > 0 && quantity <= 9999 &&
    Number.isFinite(step) && step > 0 && Math.abs(quantity / step - Math.round(quantity / step)) < 0.000001;
}

export function virtualPosLineTotal(price: number, quantity: string) {
  const cents = Math.round(price * 100);
  const thousandths = Math.round(Number(quantity.replace(',', '.')) * 1000);
  return Math.floor((cents * thousandths + 500) / 1000) / 100;
}

export function compatibleVirtualPosPayments(catalog: VirtualPosCatalog, cart: VirtualPosCartLine[]) {
  return catalog.paymentTypes.filter((payment) => payment.selectable && !payment.isFiscal &&
    cart.every((line) => catalog.products.find((product) => product.id === line.productId)
      ?.paymentTypeIds.includes(payment.id)));
}
