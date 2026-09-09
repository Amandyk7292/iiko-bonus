export interface CashierProduct {
  id: string;
  name: string;
  price: number;
  imageUrl: string;
  category: string;
  sourceQuantity: number | null;
  availableQuantity: number | null;
  reserved: number;
  manualStop: boolean;
  revision: number;
  blockedBy: 'admin' | 'iiko' | null;
  stockSource?: 'iiko' | 'manual';
  isIikoProduct?: boolean;
  frontQuantity?: number | null;
}
export interface CashierCatalog {
  branchId: string;
  branch: { id: string; name: string; address: string; city: string };
  products: CashierProduct[];
  frontSync?: { configured: boolean; connected: boolean; lastSyncedAt: string | null };
}
export interface CashierStockChange {
  expectedRevision: number;
  sourceQuantity?: number;
  manualStop?: boolean;
  useIiko?: true;
}
export const isCashierProductStopped = (p: CashierProduct) =>
  p.manualStop || !!p.blockedBy || p.availableQuantity === 0;
