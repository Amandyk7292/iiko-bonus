const { supabase } = require('../config/supabase');
const { hasGlobalBranchAccess } = require('../utils/admin-scope.util');

const failure = (message, statusCode = 409, code = 'VIRTUAL_POS_UNAVAILABLE') =>
  Object.assign(new Error(message), { statusCode, code });
const ROLES = new Set(['employee', 'cashier', 'branch_manager', 'owner', 'admin']);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function staffContext(admin, explicitBranch) {
  if (!ROLES.has(admin?.role))
    throw failure('Недостаточно прав для кассы', 403, 'VIRTUAL_POS_FORBIDDEN');
  const branchId = String(explicitBranch || '')
    .trim()
    .toLowerCase();
  if (!GUID.test(branchId))
    throw failure('Выберите один филиал', 400, 'VIRTUAL_POS_BRANCH_REQUIRED');
  if (!hasGlobalBranchAccess(admin) && !(admin.branchIds || []).map(String).includes(branchId))
    throw failure('Филиал не входит в область доступа', 403, 'VIRTUAL_POS_FORBIDDEN');
  const actor = String(admin.username || admin.sub || '').trim();
  if (!actor || actor.length > 200)
    throw failure('Не удалось определить сотрудника', 403, 'VIRTUAL_POS_FORBIDDEN');
  return { branchId, actor, global: hasGlobalBranchAccess(admin) };
}

async function rpc(db, name, params) {
  const { data, error } = await db.rpc(name, params);
  if (error) throw error;
  if (data?.error)
    throw Object.assign(
      failure(data.message || 'Касса временно недоступна', data.status || 409, data.error),
      {
        safelyRejected: data.safelyRejected === true,
      },
    );
  return data;
}

async function catalog(admin, explicitBranch, db = supabase) {
  const { branchId } = staffContext(admin, explicitBranch);
  const [{ data: branch, error }, { data: config, error: configError }] = await Promise.all([
    db
      .from('bulka_locations')
      .select('id,name,address,city')
      .eq('id', branchId)
      .eq('active', true)
      .maybeSingle(),
    db
      .from('virtual_pos_terminals')
      .select('terminal_id,enabled')
      .eq('branch_id', branchId)
      .maybeSingle(),
  ]);
  if (error || configError) throw error || configError;
  if (!branch) throw failure('Филиал недоступен', 403, 'VIRTUAL_POS_FORBIDDEN');
  let snapshot = null;
  let approved = false;
  if (config?.enabled) {
    const [snapshotResult, deviceResult] = await Promise.all([
      db
        .from('virtual_pos_snapshots')
        .select('snapshot,received_at')
        .eq('branch_id', branchId)
        .eq('terminal_id', config.terminal_id)
        .maybeSingle(),
      db
        .from('pos_devices')
        .select('terminal_id')
        .eq('branch_id', branchId)
        .eq('terminal_id', config.terminal_id)
        .eq('active', true)
        .eq('device_role', 'register')
        .maybeSingle(),
    ]);
    if (snapshotResult.error || deviceResult.error)
      throw snapshotResult.error || deviceResult.error;
    approved = Boolean(deviceResult.data);
    snapshot = approved ? snapshotResult.data : null;
  }
  const current = snapshot?.snapshot;
  const connected = Boolean(current && Date.parse(snapshot.received_at) > Date.now() - 45000);
  const verified = current?.profile?.nonFiscalNoPaperVerified === true;
  const open = current?.cashShift?.isOpen === true && Boolean(current?.cashShift?.id);
  const paymentTypes = (current?.paymentTypes || []).map((payment) => ({
    ...payment,
    selectable: payment.selectable && !payment.isFiscal && verified,
    reason: payment.isFiscal ? 'Доступна только нефискальная оплата' : payment.reason,
  }));
  const unavailableReason =
    !config?.enabled || !approved
      ? 'Касса филиала ещё не подключена'
      : !connected
        ? 'Нет связи с кассой iikoFront'
        : !verified
          ? current.profile.reason || 'Режим без печати ещё не подтверждён'
          : !open
            ? 'Откройте кассовую смену в iikoFront'
            : !paymentTypes.some((payment) => payment.selectable)
              ? 'Нет доступного нефискального типа оплаты'
              : null;
  return {
    branch,
    terminal: config
      ? { id: config.terminal_id, name: current?.terminalName || '', connected }
      : null,
    cashShift: current?.cashShift || null,
    revision: current?.revision || null,
    products: current?.products || [],
    paymentTypes,
    canSell: !unavailableReason,
    unavailableReason,
  };
}

async function createSale(admin, explicitBranch, input, db = supabase) {
  const { branchId, actor } = staffContext(admin, explicitBranch);
  const request = {
    ...input,
    items: [...input.items].sort((a, b) => a.productId.localeCompare(b.productId)),
  };
  if (new Set(request.items.map((item) => item.productId)).size !== request.items.length)
    throw failure('Объедините одинаковые товары', 400, 'VIRTUAL_POS_DUPLICATE_PRODUCT');
  return rpc(db, 'create_virtual_pos_sale', {
    p_branch: branchId,
    p_actor: actor,
    p_request: request,
  });
}

async function getSale(admin, explicitBranch, id, db = supabase) {
  const { branchId, actor, global } = staffContext(admin, explicitBranch);
  let query = db
    .from('virtual_pos_sales')
    .select('id,status,total,front_order_id,front_order_number,cash_shift_id,error')
    .eq('id', id)
    .eq('branch_id', branchId);
  if (!global) query = query.eq('actor_id', actor);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) {
    let rejectedQuery = db
      .from('virtual_pos_rejected_requests')
      .select('request_id,request_payload,rejection')
      .eq('request_id', id)
      .eq('branch_id', branchId);
    if (!global) rejectedQuery = rejectedQuery.eq('actor_id', actor);
    const { data: rejected, error: rejectedError } = await rejectedQuery.maybeSingle();
    if (rejectedError) throw rejectedError;
    if (!rejected) throw failure('Продажа не найдена', 404, 'VIRTUAL_POS_SALE_NOT_FOUND');
    return {
      id: rejected.request_id,
      status: 'rejected',
      total: Number(rejected.request_payload.expectedTotal),
      cashShiftId: rejected.request_payload.cashShiftId,
      error: rejected.rejection.message || 'Продажа отклонена до регистрации в iiko',
    };
  }
  return {
    id: data.id,
    status: data.status,
    total: Number(data.total),
    frontOrderId: data.front_order_id,
    frontOrderNumber: data.front_order_number,
    cashShiftId: data.cash_shift_id,
    error: data.error,
  };
}

function nativeTerminal(req) {
  const terminalId = String(req.body?.terminalId || req.query?.terminalId || '').toLowerCase();
  const header = String(req.headers?.['x-bulka-terminal-id'] || '').toLowerCase();
  if (
    !req.pairedPos ||
    !GUID.test(terminalId) ||
    terminalId !== header ||
    terminalId !== req.pairedPos.terminal_id
  )
    throw failure('Касса не соответствует привязке', 403, 'VIRTUAL_POS_TERMINAL_FORBIDDEN');
  return terminalId;
}

async function snapshot(req, db = supabase) {
  const terminalId = nativeTerminal(req);
  const input = req.body;
  if (
    new Set(input.products.map((item) => item.id)).size !== input.products.length ||
    new Set(input.paymentTypes.map((item) => item.id)).size !== input.paymentTypes.length
  )
    throw failure('Дублирующиеся идентификаторы каталога', 400, 'VIRTUAL_POS_INVALID_SNAPSHOT');
  return rpc(db, 'publish_virtual_pos_snapshot', {
    p_branch: req.posBranchId,
    p_terminal: terminalId,
    p_snapshot: input,
  });
}
const poll = (req, db = supabase) =>
  rpc(db, 'claim_virtual_pos_sale', { p_branch: req.posBranchId, p_terminal: nativeTerminal(req) });
const action = (req, db = supabase) =>
  rpc(db, 'advance_virtual_pos_sale', {
    p_branch: req.posBranchId,
    p_terminal: nativeTerminal(req),
    p_action: req.body,
  });

async function configureTerminal(admin, explicitBranch, input, db = supabase) {
  const { branchId } = staffContext(admin, explicitBranch);
  if (!hasGlobalBranchAccess(admin))
    throw failure('Подключить кассу может только администратор', 403, 'VIRTUAL_POS_FORBIDDEN');
  const [{ data: branch, error: branchError }, { data: terminal, error: terminalError }] =
    await Promise.all([
      db.from('bulka_locations').select('id').eq('id', branchId).eq('active', true).maybeSingle(),
      db
        .from('pos_devices')
        .select('terminal_id,name')
        .eq('terminal_id', input.terminalId)
        .eq('branch_id', branchId)
        .eq('active', true)
        .eq('device_role', 'register')
        .maybeSingle(),
    ]);
  if (branchError || terminalError) throw branchError || terminalError;
  if (!branch || !terminal)
    throw failure(
      'Выберите действующую кассу этого филиала',
      403,
      'VIRTUAL_POS_TERMINAL_FORBIDDEN',
    );
  const { error } = await db.from('virtual_pos_terminals').upsert(
    {
      branch_id: branchId,
      terminal_id: terminal.terminal_id,
      enabled: input.enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'branch_id' },
  );
  if (error) throw error;
  return { terminal: { id: terminal.terminal_id, name: terminal.name }, enabled: input.enabled };
}

module.exports = {
  staffContext,
  catalog,
  createSale,
  getSale,
  nativeTerminal,
  snapshot,
  poll,
  action,
  configureTerminal,
};
