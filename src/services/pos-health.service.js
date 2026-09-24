const { supabase } = require('../config/supabase');

const ACTIVE_CASE_STATUSES = ['open', 'retrying'];
const STALE_DEVICE_MS = 2 * 60 * 1000;
const STALE_STOCK_MS = 5 * 60 * 1000;

const parseVersion = (value) =>
  String(value || '')
    .split('.')
    .map((part) => Number(part));

function compareVersions(left, right) {
  if (!/^\d+\.\d+\.\d+$/.test(String(left || '')) || !/^\d+\.\d+\.\d+$/.test(String(right || ''))) {
    return null;
  }
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some((part) => !Number.isInteger(part))) {
    return null;
  }
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

async function getPolicy(db = supabase) {
  const { data, error } = await db
    .from('pos_plugin_policy')
    .select('*')
    .eq('singleton', true)
    .single();
  if (error) throw error;
  return {
    latestVersion: data.latest_version,
    minimumVersion: data.minimum_version,
    enforceMinimum: data.enforce_minimum === true,
    downloadUrl: data.download_url,
    guideUrl: data.guide_url,
    updatedAt: data.updated_at,
  };
}

async function savePolicy(payload, updatedBy, db = supabase) {
  if (compareVersions(payload.minimumVersion, payload.latestVersion) > 0) {
    throw Object.assign(new Error('Минимальная версия не может быть новее последней'), {
      statusCode: 400,
      code: 'POS_PLUGIN_VERSION_ORDER_INVALID',
    });
  }
  const { error } = await db
    .from('pos_plugin_policy')
    .update({
      latest_version: payload.latestVersion,
      minimum_version: payload.minimumVersion,
      enforce_minimum: payload.enforceMinimum,
      download_url: payload.downloadUrl,
      guide_url: payload.guideUrl,
      updated_by: updatedBy || null,
      updated_at: new Date().toISOString(),
    })
    .eq('singleton', true);
  if (error) throw error;
  return getPolicy(db);
}

const caseCopy = {
  personal_account: ['Оплата личным счётом требует сверки', 'critical'],
  front_receipt: ['Кассовый чек не завершён', 'critical'],
  assembly_print: ['Сборочный чек не подтверждён', 'warning'],
  loyalty_queue: ['Начисление или списание ожидает синхронизации', 'warning'],
  offline_receipt: ['Закрытый чек ожидает отправки', 'warning'],
  stock_sync: ['Остатки давно не обновлялись', 'warning'],
  plugin_health: ['Плагин сообщает об ошибке', 'critical'],
};

async function existingCases(sourceKeys, db = supabase) {
  if (!sourceKeys.length) return new Map();
  const { data, error } = await db
    .from('pos_reconciliation_cases')
    .select('id,source_key,status,resolved_at')
    .in('source_key', sourceKeys);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.source_key, row]));
}

async function upsertCases(cases, db = supabase) {
  if (!cases.length) return;
  const now = new Date().toISOString();
  const existing = await existingCases(
    cases.map((item) => item.source_key),
    db,
  );
  const records = cases
    .filter((item) => existing.get(item.source_key)?.status !== 'manual_closed')
    .map((item) => ({
      ...item,
      status: existing.get(item.source_key)?.status === 'retrying' ? 'retrying' : 'open',
      last_seen_at: now,
      updated_at: now,
      resolved_at: null,
      resolved_by: null,
      resolution_note: null,
    }));
  if (!records.length) return;
  const { error } = await db
    .from('pos_reconciliation_cases')
    .upsert(records, { onConflict: 'source_key' });
  if (error) throw error;
}

async function resolveMissingTelemetryCases(terminalId, activeKeys, db = supabase) {
  const prefixes = [
    `device:${terminalId}:loyalty`,
    `device:${terminalId}:offline`,
    `device:${terminalId}:stock`,
    `device:${terminalId}:personal`,
    `device:${terminalId}:plugin`,
  ];
  const { data, error } = await db
    .from('pos_reconciliation_cases')
    .select('id,source_key,status')
    .eq('terminal_id', terminalId)
    .in('status', ACTIVE_CASE_STATUSES);
  if (error) throw error;
  const resolved = (data || []).filter(
    (row) =>
      prefixes.some((prefix) => row.source_key.startsWith(prefix)) &&
      !activeKeys.has(row.source_key),
  );
  if (!resolved.length) return;
  const now = new Date().toISOString();
  const { error: updateError } = await db
    .from('pos_reconciliation_cases')
    .update({
      status: 'resolved',
      resolved_at: now,
      updated_at: now,
      resolution_note: 'Устранено кассой',
    })
    .in(
      'id',
      resolved.map((row) => row.id),
    );
  if (updateError) throw updateError;
}

function telemetryCases(branchId, terminalId, payload) {
  const result = [];
  const add = (kind, suffix, details, extra = {}) => {
    const [title, severity] = caseCopy[kind];
    result.push({
      source_key: `device:${terminalId}:${suffix}`,
      branch_id: branchId,
      terminal_id: terminalId,
      kind,
      severity,
      title,
      details: String(details || '').slice(0, 2000),
      payload: extra,
    });
  };
  const queue = payload.queues;
  if (queue.loyaltyFailed || queue.loyaltyPending > 20)
    add('loyalty_queue', 'loyalty', payload.statuses.loyalty, {
      pending: queue.loyaltyPending,
      failed: queue.loyaltyFailed,
    });
  if (queue.offlineReceipts)
    add('offline_receipt', 'offline', payload.statuses.offlineReceipts, {
      pending: queue.offlineReceipts,
    });
  if (queue.stockPending)
    add('stock_sync', 'stock', payload.statuses.stock, { pending: queue.stockPending });
  if (queue.personalAccountPending)
    add('personal_account', 'personal', payload.statuses.personalAccount, {
      pending: queue.personalAccountPending,
    });
  for (const error of payload.errors) {
    add(error.kind, `plugin:${error.kind}:${error.sourceId || 'general'}`, error.message, {
      sourceId: error.sourceId || null,
    });
  }
  return result;
}

function healthStatus(payload, policy) {
  const versionOrder = compareVersions(payload.pluginVersion, policy.minimumVersion);
  const outdated = versionOrder === null || versionOrder < 0;
  if (
    payload.errors.length ||
    payload.printerStatus === 'error' ||
    (policy.enforceMinimum && outdated)
  ) {
    return 'error';
  }
  if (
    outdated ||
    !payload.connectedToMain ||
    payload.printerStatus === 'missing' ||
    Object.values(payload.queues).some((count) => count > 0)
  ) {
    return 'attention';
  }
  return 'healthy';
}

async function recordHeartbeat(branchId, payload, db = supabase) {
  const policy = await getPolicy(db);
  const cases = telemetryCases(branchId, payload.terminalId, payload);
  const activeKeys = new Set(cases.map((item) => item.source_key));
  const now = new Date().toISOString();
  const status = healthStatus(payload, policy);
  const { data: device, error } = await db
    .from('pos_devices')
    .update({
      plugin_version: payload.pluginVersion,
      plugin_api_version: payload.apiVersion,
      plugin_started_at: payload.startedAt,
      last_health_at: now,
      last_seen_at: now,
      connected_to_main: payload.connectedToMain,
      printer_status: payload.printerStatus,
      health_status: status,
      health_payload: { queues: payload.queues, statuses: payload.statuses },
      last_error: payload.errors[0]?.message || null,
    })
    .eq('terminal_id', payload.terminalId)
    .eq('branch_id', branchId)
    .eq('active', true)
    .select('terminal_id')
    .maybeSingle();
  if (error) throw error;
  if (!device) {
    throw Object.assign(new Error('Касса не привязана к филиалу'), {
      statusCode: 401,
      code: 'POS_DEVICE_UNAUTHORIZED',
    });
  }
  await upsertCases(cases, db);
  await resolveMissingTelemetryCases(payload.terminalId, activeKeys, db);
  const { data: commands, error: commandError } = await db
    .from('pos_reconciliation_cases')
    .select('id,kind,source_key,payload,retry_requested_at')
    .eq('terminal_id', payload.terminalId)
    .eq('status', 'retrying')
    .not('retry_requested_at', 'is', null)
    .order('retry_requested_at')
    .limit(20);
  if (commandError) throw commandError;
  return {
    status,
    policy,
    commands: (commands || []).map((item) => ({
      id: item.id,
      kind: item.kind,
      sourceKey: item.source_key,
      payload: item.payload || {},
    })),
  };
}

async function refreshDatabaseCases(branchIds, db = supabase) {
  let receiptQuery = db
    .from('front_receipt_jobs')
    .select(
      'order_id,branch_id,terminal_id,status,assembly_status,fiscal_due,last_error,updated_at,kaspi_orders(order_number)',
    )
    .neq('status', 'completed')
    .order('updated_at', { ascending: true })
    .limit(500);
  let stockQuery = db
    .from('front_stock_terminals')
    .select('branch_id,terminal_id,last_seen_at,guard_ready,guard_enabled')
    .limit(500);
  if (branchIds.length) {
    receiptQuery = receiptQuery.in('branch_id', branchIds);
    stockQuery = stockQuery.in('branch_id', branchIds);
  }
  const [{ data: jobs, error: jobsError }, { data: terminals, error: terminalsError }] =
    await Promise.all([receiptQuery, stockQuery]);
  if (jobsError) throw jobsError;
  if (terminalsError) throw terminalsError;
  const now = Date.now();
  const cases = [];
  for (const job of jobs || []) {
    const age = now - (Date.parse(job.updated_at) || now);
    const number = job.kaspi_orders?.order_number || '';
    if (job.assembly_status === 'printing' && age > 2 * 60 * 1000) {
      cases.push({
        source_key: `assembly:${job.order_id}`,
        branch_id: job.branch_id,
        terminal_id: job.terminal_id,
        kind: 'assembly_print',
        severity: 'warning',
        title: `Сборочный чек заказа №${number || '—'} не подтверждён`,
        details: job.last_error || 'Печать началась, но касса не подтвердила завершение.',
        payload: { orderId: job.order_id, orderNumber: number },
      });
    }
    if (job.last_error || (job.fiscal_due && age > 15 * 60 * 1000)) {
      cases.push({
        source_key: `front-receipt:${job.order_id}`,
        branch_id: job.branch_id,
        terminal_id: job.terminal_id,
        kind: 'front_receipt',
        severity: 'critical',
        title: `Кассовый чек заказа №${number || '—'} не завершён`,
        details: job.last_error || 'Фискальный чек ожидает кассу более 15 минут.',
        payload: { orderId: job.order_id, orderNumber: number },
      });
    }
  }
  for (const terminal of terminals || []) {
    const age = now - (Date.parse(terminal.last_seen_at) || 0);
    if (terminal.guard_enabled && (!terminal.guard_ready || age > STALE_STOCK_MS)) {
      cases.push({
        source_key: `stock-terminal:${terminal.terminal_id}`,
        branch_id: terminal.branch_id,
        terminal_id: terminal.terminal_id,
        kind: 'stock_sync',
        severity: 'warning',
        title: 'Остатки кассы давно не обновлялись',
        details: terminal.guard_ready
          ? 'Последняя связь с учётом остатков была более 5 минут назад.'
          : 'Касса сообщает, что контроль остатков не готов.',
        payload: { lastSeenAt: terminal.last_seen_at },
      });
    }
  }
  await upsertCases(cases, db);
  let existingQuery = db
    .from('pos_reconciliation_cases')
    .select('id,source_key,status')
    .in('status', ACTIVE_CASE_STATUSES);
  if (branchIds.length) existingQuery = existingQuery.in('branch_id', branchIds);
  const { data: existing, error: existingError } = await existingQuery;
  if (existingError) throw existingError;
  const activeKeys = new Set(cases.map((item) => item.source_key));
  const resolvedIds = (existing || [])
    .filter(
      (item) =>
        /^(assembly:|front-receipt:|stock-terminal:)/.test(item.source_key) &&
        !activeKeys.has(item.source_key),
    )
    .map((item) => item.id);
  if (resolvedIds.length) {
    const resolvedAt = new Date().toISOString();
    const { error: resolveError } = await db
      .from('pos_reconciliation_cases')
      .update({
        status: 'resolved',
        resolution_note: 'Проверка сервера больше не обнаруживает проблему',
        resolved_at: resolvedAt,
        updated_at: resolvedAt,
      })
      .in('id', resolvedIds);
    if (resolveError) throw resolveError;
  }
}

function normalizeDevice(row, policy, now = Date.now()) {
  const heartbeatAt = row.last_health_at || row.last_seen_at;
  const stale = now - (Date.parse(heartbeatAt) || 0) > STALE_DEVICE_MS;
  const latestOrder = compareVersions(row.plugin_version, policy.latestVersion);
  const minimumOrder = compareVersions(row.plugin_version, policy.minimumVersion);
  const outdated = latestOrder === null || latestOrder < 0;
  return {
    id: row.terminal_id,
    branchId: row.branch_id,
    branch: Array.isArray(row.bulka_locations)
      ? row.bulka_locations[0] || null
      : row.bulka_locations || null,
    name: row.name,
    role: row.device_role,
    active: row.active,
    online: row.active && !stale,
    health: stale ? 'offline' : row.health_status,
    pluginVersion: row.plugin_version,
    apiVersion: row.plugin_api_version,
    outdated,
    incompatible: policy.enforceMinimum && (minimumOrder === null || minimumOrder < 0),
    connectedToMain: row.connected_to_main,
    printerStatus: row.printer_status,
    queues: row.health_payload?.queues || {},
    statuses: row.health_payload?.statuses || {},
    lastError: row.last_error,
    pairedAt: row.paired_at,
    lastSeenAt: heartbeatAt,
  };
}

async function getPosHealth(branchIds = [], db = supabase) {
  const policy = await getPolicy(db);
  await refreshDatabaseCases(branchIds, db);
  let devicesQuery = db
    .from('pos_devices')
    .select(
      'terminal_id,branch_id,name,device_role,active,paired_at,last_seen_at,last_health_at,plugin_version,plugin_api_version,connected_to_main,printer_status,health_status,health_payload,last_error,bulka_locations(id,name,city,address)',
    )
    .order('last_health_at', { ascending: false, nullsFirst: false });
  let casesQuery = db
    .from('pos_reconciliation_cases')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(300);
  if (branchIds.length) {
    devicesQuery = devicesQuery.in('branch_id', branchIds);
    casesQuery = casesQuery.in('branch_id', branchIds);
  }
  const [{ data: devices, error: devicesError }, { data: cases, error: casesError }] =
    await Promise.all([devicesQuery, casesQuery]);
  if (devicesError) throw devicesError;
  if (casesError) throw casesError;
  const normalizedDevices = (devices || []).map((row) => normalizeDevice(row, policy));
  return {
    checkedAt: new Date().toISOString(),
    policy,
    summary: {
      total: normalizedDevices.length,
      online: normalizedDevices.filter((device) => device.online).length,
      attention: normalizedDevices.filter((device) => device.health !== 'healthy').length,
      outdated: normalizedDevices.filter((device) => device.outdated).length,
      openCases: (cases || []).filter((item) => ACTIVE_CASE_STATUSES.includes(item.status)).length,
    },
    devices: normalizedDevices,
    cases: cases || [],
  };
}

async function caseForAdmin(id, branchIds, db = supabase) {
  let query = db.from('pos_reconciliation_cases').select('*').eq('id', id);
  if (branchIds.length) query = query.in('branch_id', branchIds);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error('Проблема сверки не найдена'), { statusCode: 404 });
  return data;
}

async function actOnCase(id, payload, admin, branchIds, db = supabase) {
  const current = await caseForAdmin(id, branchIds, db);
  const now = new Date().toISOString();
  if (payload.action === 'close') {
    const { data, error } = await db
      .from('pos_reconciliation_cases')
      .update({
        status: 'manual_closed',
        resolution_note: payload.reason,
        resolved_by: admin?.sub || null,
        resolved_at: now,
        updated_at: now,
      })
      .eq('id', current.id)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }
  if (payload.action === 'check') {
    await refreshDatabaseCases(branchIds, db);
    const checked = await caseForAdmin(id, branchIds, db);
    const { data, error } = await db
      .from('pos_reconciliation_cases')
      .update({ last_checked_at: now, updated_at: now })
      .eq('id', checked.id)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }
  const orderId = current.payload?.orderId;
  if (current.kind === 'assembly_print' && orderId) {
    const { error } = await db
      .from('front_receipt_jobs')
      .update({ assembly_status: 'pending', last_error: null, updated_at: now })
      .eq('order_id', orderId)
      .neq('status', 'completed');
    if (error) throw error;
  } else if (current.kind === 'front_receipt' && orderId) {
    const { error } = await db
      .from('front_receipt_jobs')
      .update({ last_error: null, updated_at: now })
      .eq('order_id', orderId)
      .neq('status', 'completed');
    if (error) throw error;
  }
  const { data, error } = await db
    .from('pos_reconciliation_cases')
    .update({
      status: 'retrying',
      attempts: Math.min(1000, Number(current.attempts || 0) + 1),
      retry_requested_at: now,
      last_checked_at: now,
      resolution_note: payload.reason || null,
      updated_at: now,
    })
    .eq('id', current.id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

module.exports = {
  actOnCase,
  compareVersions,
  healthStatus,
  telemetryCases,
  getPolicy,
  getPosHealth,
  recordHeartbeat,
  refreshDatabaseCases,
  savePolicy,
};
