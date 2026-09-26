const { supabase } = require('../config/supabase');

const unique = (values) => [...new Set(values.filter(Boolean).map(String))];
const moneyFromMinor = (value) => Number(value || 0) / 100;
const unwrap = (value) => (Array.isArray(value) ? value[0] : value);

function moneyToMinor(value) {
  const amount = Number(value);
  const minor = Math.round(amount * 100);
  if (
    !Number.isFinite(amount) ||
    amount === 0 ||
    Math.abs(amount) > 1_000_000 ||
    Math.abs(amount * 100 - minor) > 0.000001
  ) {
    throw Object.assign(new Error('Некорректная сумма личного счёта'), {
      statusCode: 400,
      code: 'PERSONAL_ACCOUNT_ADJUSTMENT_AMOUNT_INVALID',
    });
  }
  return minor;
}

async function rowsFor(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function getCustomerFinancialDetails(
  customerId,
  { branchIds = [], limit = 100 } = {},
  db = supabase,
) {
  const safeLimit = Math.min(200, Math.max(20, Number(limit) || 100));
  const scopedBranches = unique(Array.isArray(branchIds) ? branchIds : []);
  let bonusQuery = db
    .from('transactions')
    .select('id,type,amount,description,order_id,branch_id,timestamp,expires_at,expired_at')
    .eq('customer_id', customerId)
    .order('timestamp', { ascending: false })
    .limit(safeLimit);
  if (scopedBranches.length) bonusQuery = bonusQuery.in('branch_id', scopedBranches);

  const [customerResult, accountResult, bonusTransactions, accountEntries] = await Promise.all([
    db
      .from('customers')
      .select('id,name,phone,balance,total_spent')
      .eq('id', customerId)
      .is('deleted_at', null)
      .maybeSingle(),
    db
      .from('personal_accounts')
      .select('balance_minor,blocked,updated_at')
      .eq('customer_id', customerId)
      .maybeSingle(),
    rowsFor(bonusQuery),
    rowsFor(
      db
        .from('personal_account_entries')
        .select('id,amount_minor,kind,source_key,order_id,topup_id,description,created_at')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(safeLimit),
    ),
  ]);
  if (customerResult.error) throw customerResult.error;
  if (!customerResult.data) {
    throw Object.assign(new Error('Клиент не найден'), {
      statusCode: 404,
      code: 'CUSTOMER_NOT_FOUND',
    });
  }
  if (accountResult.error) throw accountResult.error;

  const operationIds = unique(
    bonusTransactions
      .map((item) => String(item.order_id || '').match(/^kaspi:([^:]+)/)?.[1])
      .filter(Boolean),
  );
  const orderIds = unique(accountEntries.map((item) => item.order_id));
  const topupIds = unique(accountEntries.map((item) => item.topup_id));
  const [operationOrders, directOrders, topups] = await Promise.all([
    operationIds.length
      ? rowsFor(
          db
            .from('kaspi_orders')
            .select('id,operation_id,order_number,branch_id')
            .in('operation_id', operationIds),
        )
      : [],
    orderIds.length
      ? rowsFor(
          db
            .from('kaspi_orders')
            .select('id,operation_id,order_number,branch_id')
            .in('id', orderIds),
        )
      : [],
    topupIds.length
      ? rowsFor(
          db.from('personal_account_topups').select('id,status,created_at').in('id', topupIds),
        )
      : [],
  ]);
  const allOrders = [...operationOrders, ...directOrders];
  const branchIdsToLoad = unique([
    ...bonusTransactions.map((item) => item.branch_id),
    ...allOrders.map((item) => item.branch_id),
  ]);
  const branches = branchIdsToLoad.length
    ? await rowsFor(db.from('bulka_locations').select('id,name,city').in('id', branchIdsToLoad))
    : [];
  const branchMap = new Map(branches.map((item) => [String(item.id), item]));
  const operationOrderMap = new Map(
    operationOrders.map((item) => [String(item.operation_id), item]),
  );
  const directOrderMap = new Map(directOrders.map((item) => [String(item.id), item]));
  const topupMap = new Map(topups.map((item) => [String(item.id), item]));

  return {
    customer: customerResult.data,
    bonus: {
      balance: Number(customerResult.data.balance || 0),
      entries: bonusTransactions.map((item) => {
        const operationId = String(item.order_id || '').match(/^kaspi:([^:]+)/)?.[1];
        const order = operationId ? operationOrderMap.get(operationId) : null;
        return {
          id: item.id,
          type: item.type,
          amount: Number(item.amount || 0),
          description: item.description || '',
          orderId: item.order_id || null,
          branchId: item.branch_id || null,
          timestamp: item.timestamp,
          expiresAt: item.expires_at || null,
          expiredAt: item.expired_at || null,
          orderNumber: order?.order_number || null,
          branch: branchMap.get(String(item.branch_id || order?.branch_id || '')) || null,
        };
      }),
    },
    personalAccount: {
      balance: moneyFromMinor(accountResult.data?.balance_minor),
      blocked: accountResult.data?.blocked === true,
      updatedAt: accountResult.data?.updated_at || null,
      entries: accountEntries.map((item) => {
        const order = directOrderMap.get(String(item.order_id || ''));
        const topup = topupMap.get(String(item.topup_id || ''));
        const adminAdjustment = String(item.source_key || '').startsWith('admin-adjust:');
        return {
          id: item.id,
          amount: moneyFromMinor(item.amount_minor),
          kind: adminAdjustment
            ? Number(item.amount_minor) > 0
              ? 'manual_credit'
              : 'manual_debit'
            : item.kind,
          sourceKey: item.source_key,
          description: item.description || '',
          createdAt: item.created_at,
          orderNumber: order?.order_number || null,
          branch: branchMap.get(String(order?.branch_id || '')) || null,
          topupStatus: topup?.status || null,
        };
      }),
    },
  };
}

async function adjustPersonalAccount(
  customerId,
  { amount, requestId, reason, adminSubject },
  db = supabase,
) {
  const { data, error } = await db.rpc('admin_adjust_personal_account', {
    p_customer_id: customerId,
    p_amount_minor: moneyToMinor(amount),
    p_request_id: requestId,
    p_reason: String(reason || '').trim(),
    p_admin_subject: String(adminSubject || '').trim(),
  });
  if (error) {
    const insufficient = /insufficient personal account balance/i.test(error.message || '');
    throw Object.assign(
      new Error(
        insufficient ? 'Недостаточно средств на личном счёте' : 'Не удалось изменить личный счёт',
      ),
      {
        statusCode: insufficient ? 409 : error.code === '22023' ? 400 : 503,
        code: insufficient ? 'PERSONAL_ACCOUNT_INSUFFICIENT' : 'PERSONAL_ACCOUNT_ADJUSTMENT_FAILED',
      },
    );
  }
  const result = unwrap(data) || {};
  return {
    entryId: result.entryId || null,
    balance: moneyFromMinor(result.balanceMinor),
    duplicate: result.duplicate === true,
  };
}

module.exports = {
  adjustPersonalAccount,
  getCustomerFinancialDetails,
  moneyFromMinor,
  moneyToMinor,
};
