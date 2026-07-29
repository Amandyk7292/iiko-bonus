export const ADMIN_ALLOWED_PATHS: Record<string, string[]> = {
  branch_manager: [
    '/operations',
    '/analytics',
    '/customers',
    '/whatsapp',
    '/orders',
    '/menu',
    '/inventory',
    '/couriers',
    '/dispatch',
    '/kitchen',
    '/locations',
    '/reviews',
    '/support',
    '/transactions',
    '/integrations',
  ],
  operator: [
    '/operations',
    '/customers',
    '/whatsapp',
    '/orders',
    '/dispatch',
    '/kitchen',
    '/reviews',
    '/support',
  ],
  marketer: [
    '/operations',
    '/analytics',
    '/customers',
    '/broadcast',
    '/contacts',
    '/stories',
    '/news',
    '/bonus',
    '/tiers',
    '/marketing',
    '/reviews',
    '/support',
  ],
  courier: ['/couriers', '/dispatch'],
  editor: [
    '/operations',
    '/analytics',
    '/customers',
    '/whatsapp',
    '/orders',
    '/menu',
    '/inventory',
    '/couriers',
    '/dispatch',
    '/kitchen',
    '/locations',
    '/reviews',
    '/support',
    '/transactions',
    '/integrations',
    '/broadcast',
    '/contacts',
    '/stories',
    '/news',
    '/bonus',
    '/tiers',
    '/marketing',
  ],
  viewer: [
    '/operations',
    '/analytics',
    '/customers',
    '/whatsapp',
    '/orders',
    '/menu',
    '/inventory',
    '/couriers',
    '/dispatch',
    '/kitchen',
    '/locations',
    '/reviews',
    '/support',
    '/transactions',
    '/integrations',
  ],
  whatsapp_operator: ['/whatsapp'],
};

const ORDER_MUTATION_ROLES = new Set(['owner', 'admin', 'branch_manager', 'operator', 'editor']);
const ORDER_REFUND_ROLES = new Set(['owner', 'admin', 'branch_manager']);
const INVENTORY_MUTATION_ROLES = new Set(['owner', 'admin', 'branch_manager', 'editor']);

export const canMutateOrders = (role: string) => ORDER_MUTATION_ROLES.has(role);
export const canRefundOrders = (role: string) => ORDER_REFUND_ROLES.has(role);
export const canMutateInventory = (role: string) => INVENTORY_MUTATION_ROLES.has(role);

export const ORDER_STATUS_TRANSITIONS: Record<string, string[]> = {
  new: ['accepted', 'preparing', 'ready', 'completed', 'cancelled'],
  accepted: ['preparing', 'ready', 'completed', 'cancelled'],
  preparing: ['ready', 'completed', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};
export const ORDER_STATUSES = Object.keys(ORDER_STATUS_TRANSITIONS);

export function availableOrderStatuses(currentStatus: string, allowCancellation: boolean) {
  const transitions = ORDER_STATUS_TRANSITIONS[currentStatus] ?? [];
  return [
    currentStatus,
    ...transitions.filter((status) => status !== 'cancelled' || allowCancellation),
  ].filter((status, index, values) => Boolean(status) && values.indexOf(status) === index);
}
