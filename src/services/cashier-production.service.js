const { supabase } = require('../config/supabase');
const { service: reporting } = require('./iiko-dashboard.service');
const { cashierBranch } = require('./cashier-catalog.service');
const { validQuantity } = require('../utils/quantity.util');
const bindings = require('./cashier-production-binding.service');
const activeSends = new Set();

const messages = {
  IIKO_PRODUCTION_BINDING_MISSING: 'Администратор ещё не настроил акт для этой точки',
  IIKO_PRODUCTION_DISABLED: 'Отправка актов для этой точки отключена',
  IIKO_PRODUCTION_PRODUCT_UNMAPPED: 'Блюдо отсутствует в справочнике выбранного сервера iiko',
  IIKO_PRODUCTION_UNIT_MISMATCH: 'Единица отчёта не совпадает с основной единицей блюда в iiko',
  IIKO_PRODUCTION_QUANTITY_INVALID: 'Количество не соответствует единице блюда',
  IIKO_PRODUCTION_SOURCE_UNAVAILABLE: 'Не удалось проверить справочники iiko. Обновите отчёт',
  IIKO_PRODUCTION_EVENTS_CHANGED:
    'Выбранные добавления уже отправлены или отчёт изменился. Обновите отчёт',
  IIKO_PRODUCTION_REQUEST_CONFLICT: 'Этот запрос уже использован для другого набора добавлений',
  IIKO_PRODUCTION_BINDING_CHANGED: 'Настройка точки изменилась. Обновите отчёт',
  IIKO_PRODUCTION_PRODUCTS_CHANGED: 'Блюда изменились. Обновите отчёт',
  IIKO_PRODUCTION_DATE_INVALID: 'Выберите корректную дату отчёта',
  IIKO_PRODUCTION_UNCONFIRMED:
    'iiko ещё не подтвердил создание акта. Повторная отправка заблокирована',
  IIKO_PRODUCTION_SEND_IN_PROGRESS:
    'Дождитесь завершения обработки запроса в iiko перед подтверждением отсутствия акта',
  IIKO_PRODUCTION_INPUT_INVALID: 'Проверьте данные запроса',
};
const fail = (code, message = messages[code], status = 409) =>
  bindings.productionError(code, message || 'Не удалось создать акт приготовления', status);
const deps = (options = {}) => ({
  db: supabase,
  reports: reporting,
  create: (...args) =>
    require('./cashier-production-iiko.service').createProductionDocument(...args),
  find: (...args) => require('./cashier-production-iiko.service').findProductionDocument(...args),
  now: Date.now(),
  ...options,
});
const publicAct = (a) => ({
  id: a.id,
  date: a.business_date,
  eventIds: a.manifest.eventIds,
  status: a.status,
  documentNumber: a.document_number || null,
  createdAt: a.created_at,
  postImmediately: a.manifest.postImmediately === true,
  requestedDocumentNumber: `BLK-${String(a.id).replaceAll('-', '').toUpperCase()}`,
  ...(a.verification && { verification: a.verification }),
  ...(a.error && { error: a.error, errorCode: a.error_code }),
});
async function rpc(d, name, args) {
  const { data, error } = await d.db.rpc(name, args);
  if (error) {
    const code = error.message?.match(/IIKO_PRODUCTION_[A-Z_]+/)?.[0];
    if (code) throw fail(code);
    throw error;
  }
  return data;
}
async function finish(act, outcome, d) {
  const status = ['created', 'failed'].includes(outcome?.status) ? outcome.status : 'unknown';
  return rpc(d, 'finish_cashier_production_send', {
    p_branch: act.branch_id,
    p_request: act.id,
    p_status: status,
    p_number: outcome?.documentNumber || null,
    p_error: status === 'created' ? null : outcome?.error || messages.IIKO_PRODUCTION_UNCONFIRMED,
    p_error_code: status === 'created' ? null : outcome?.errorCode || 'IIKO_PRODUCTION_UNCONFIRMED',
  });
}
async function reconcile(act, d) {
  if (activeSends.has(act.id)) return act;
  if (act.status === 'sending') {
    if (d.now - Date.parse(act.updated_at) < 60000) return act;
    act = await finish(act, { status: 'unknown' }, d);
  }
  if (act.status !== 'unknown') return act;
  try {
    const result = await d.find(act);
    // An empty lookup is not proof that a timed-out write never committed.
    if (result?.status === 'created') return await finish(act, result, d);
  } catch {
    // Preserve the durable unknown result; no write retry or alternate UUID.
  }
  return act;
}
const unitKey = (value) => {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  if (/^(шт\.?|штука|штуки|штук|pcs|pieces?)$/.test(v)) return 'шт';
  if (/^(кг\.?|килограмм|килограммы|kg)$/.test(v)) return 'кг';
  return v;
};
async function productReferences(binding, branchId, d) {
  const { server } = await bindings.productionServer(branchId, binding.server_id, d);
  const directory = await bindings.loadProductionDirectory(binding.server_id, d);
  bindings.validateDirectoryBinding(
    {
      departmentId: binding.department_id,
      sourceStoreId: binding.source_store_id,
      targetStoreId: binding.target_store_id,
    },
    directory,
  );
  return d.reports.client.withSession(binding.server_id, async (request) => {
    const products = await request('v2/entities/products/list?includeDeleted=false');
    const units = await request('v2/entities/list?rootType=MeasureUnit&includeDeleted=false');
    if (!Array.isArray(products) || !Array.isArray(units))
      throw fail('IIKO_PRODUCTION_SOURCE_UNAVAILABLE');
    const measures = new Map(
      units
        .filter((u) => bindings.guid.test(u.id) && !u.deleted)
        .map((u) => [String(u.id).toLowerCase(), unitKey(u.name)]),
    );
    const result = new Map();
    for (const p of products) {
      if (!bindings.guid.test(p.id) || p.deleted || !bindings.guid.test(p.mainUnit)) continue;
      const id = String(p.id).toLowerCase(),
        amountUnit = String(p.mainUnit).toLowerCase();
      const key = `${server.city === 'astana' ? 'astana:' : ''}${id}`;
      result.set(key, { productId: id, amountUnit, unit: measures.get(amountUnit) });
    }
    return result;
  });
}
async function candidates(branch, date, d) {
  const data = await rpc(d, 'cashier_production_candidates', { p_branch: branch, p_date: date });
  const binding = await bindings.readBindingRow(branch, d);
  let unavailableReasonCode = !binding
    ? 'IIKO_PRODUCTION_BINDING_MISSING'
    : !binding.enabled
      ? 'IIKO_PRODUCTION_DISABLED'
      : null;
  let refs = new Map();
  if (!unavailableReasonCode) {
    try {
      refs = await productReferences(binding, branch, d);
    } catch (error) {
      unavailableReasonCode = error.code?.startsWith('IIKO_PRODUCTION_')
        ? error.code
        : 'IIKO_PRODUCTION_SOURCE_UNAVAILABLE';
    }
  }
  const products = data.products.map((p) => {
    const ref = refs.get(String(p.productId).toLowerCase());
    const reasonCode =
      unavailableReasonCode ||
      (!ref
        ? 'IIKO_PRODUCTION_PRODUCT_UNMAPPED'
        : ref.unit !== unitKey(p.unit)
          ? 'IIKO_PRODUCTION_UNIT_MISMATCH'
          : !validQuantity(Number(p.quantity), {
                max: 100000,
                step: unitKey(p.unit) === 'шт' ? 1 : 0.001,
              })
            ? 'IIKO_PRODUCTION_QUANTITY_INVALID'
            : null);
    return {
      ...p,
      quantity: Number(p.quantity),
      eligible: !reasonCode,
      ...(reasonCode && {
        reasonCode,
        reason: messages[reasonCode] || 'Проверьте настройку точки в iiko',
      }),
    };
  });
  return {
    ...data,
    products,
    binding,
    refs,
    enabled: !unavailableReasonCode,
    ...(unavailableReasonCode && {
      unavailableReasonCode,
      unavailableReason: messages[unavailableReasonCode] || 'Проверьте настройку точки в iiko',
    }),
  };
}
async function getCashierProductionReport(admin, date, options = {}) {
  const d = deps(options),
    branch = cashierBranch(admin);
  const data = await candidates(branch, date, d);
  const acts = [];
  for (const act of data.acts) acts.push(publicAct(await reconcile(act, d)));
  return {
    date: data.date,
    branch: data.branch,
    enabled: data.enabled,
    products: data.products,
    acts,
    ...(data.unavailableReasonCode && {
      unavailableReasonCode: data.unavailableReasonCode,
      unavailableReason: data.unavailableReason,
    }),
  };
}
async function submitCashierProductionAct(admin, input, options = {}) {
  const d = deps(options),
    branch = cashierBranch(admin);
  const ids = [...input.eventIds].map((id) => id.toLowerCase()).sort();
  if (new Set(ids).size !== ids.length) throw fail('IIKO_PRODUCTION_INPUT_INVALID');
  const { data: previous, error } = await d.db
    .from('cashier_iiko_production_acts')
    .select('*')
    .eq('id', input.requestId)
    .maybeSingle();
  if (error) throw error;
  let act = previous;
  if (act) {
    if (
      act.branch_id !== branch ||
      act.business_date !== input.date ||
      JSON.stringify(act.manifest.eventIds) !== JSON.stringify(ids)
    )
      throw fail('IIKO_PRODUCTION_REQUEST_CONFLICT');
  } else {
    const data = await candidates(branch, input.date, d);
    if (!data.enabled) throw fail(data.unavailableReasonCode, data.unavailableReason);
    const products = data.products.filter((p) => p.eventIds.some((id) => ids.includes(id)));
    if (
      products.some((p) => !p.eligible) ||
      ids.some((id) => !products.some((p) => p.eventIds.includes(id)))
    )
      throw fail('IIKO_PRODUCTION_EVENTS_CHANGED');
    act = await rpc(d, 'claim_cashier_production_act', {
      p_branch: branch,
      p_date: input.date,
      p_request: input.requestId,
      p_actor: String(admin.sub || 'cashier').slice(0, 160),
      p_event_ids: ids,
      p_products: products.map((p) => ({
        localProductId: p.productId,
        unit: p.unit,
        productId: data.refs.get(String(p.productId).toLowerCase()).productId,
        amountUnit: data.refs.get(String(p.productId).toLowerCase()).amountUnit,
      })),
      p_binding_revision: data.binding.updated_at,
    });
  }
  if (act.status !== 'pending') return { act: publicAct(await reconcile(act, d)) };
  const sending = await rpc(d, 'begin_cashier_production_send', {
    p_branch: branch,
    p_request: act.id,
  });
  if (!sending) {
    const { data: current, error: readError } = await d.db
      .from('cashier_iiko_production_acts')
      .select('*')
      .eq('id', act.id)
      .eq('branch_id', branch)
      .single();
    if (readError) throw readError;
    return { act: publicAct(current) };
  }
  let outcome;
  activeSends.add(sending.id);
  try {
    outcome = await d.create(sending, {
      beforeSend: () =>
        rpc(d, 'start_cashier_production_http', { p_branch: branch, p_request: sending.id }),
    });
  } catch {
    outcome = { status: 'unknown', errorCode: 'IIKO_PRODUCTION_UNCONFIRMED' };
  } finally {
    activeSends.delete(sending.id);
  }
  return { act: publicAct(await finish(sending, outcome, d)) };
}
async function listUnconfirmedProductionActs(branchId, options = {}) {
  const d = deps(options);
  const { data, error } = await d.db
    .from('cashier_iiko_production_acts')
    .select('*')
    .eq('branch_id', branchId)
    .in('status', ['sending', 'unknown'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  const acts = [];
  for (const act of data || []) {
    const current = await reconcile(act, d);
    if (['sending', 'unknown'].includes(current.status))
      acts.push({
        ...publicAct(current),
        serverId: current.server_id,
        departmentId: current.department_id,
        sourceStoreId: current.source_store_id,
        targetStoreId: current.target_store_id,
        items: current.manifest.items.map((item) => ({
          productName: item.productName,
          productId: item.productId,
          quantity: Number(item.quantity),
          unit: item.unit,
        })),
      });
  }
  return acts;
}
async function resolveProductionAct(branchId, actId, input, { actor = 'admin', ...options } = {}) {
  if (
    input.confirmed !== true ||
    !['created', 'not_created'].includes(input.action) ||
    (input.action === 'created' &&
      (!String(input.documentNumber || '').trim() || String(input.documentNumber).length > 100)) ||
    (input.action === 'not_created' && input.documentNumber != null)
  )
    throw fail('IIKO_PRODUCTION_INPUT_INVALID');
  const d = deps(options);
  const act = await rpc(d, 'resolve_cashier_production_act', {
    p_branch: branchId,
    p_request: actId,
    p_action: input.action,
    p_number: input.action === 'created' ? String(input.documentNumber).trim() : null,
    p_confirmed: true,
    p_actor: String(actor).slice(0, 160),
  });
  return publicAct(act);
}
module.exports = {
  getCashierProductionReport,
  submitCashierProductionAct,
  productReferences,
  publicAct,
  listUnconfirmedProductionActs,
  resolveProductionAct,
};
