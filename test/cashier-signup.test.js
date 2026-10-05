const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { createCashierSignup, invitationUrl } = require('../src/services/cashier-signup.service');
const { cashierInviteQr } = require('../src/services/cashier-invite-qr.service');
const { publicError } = require('../src/utils/app-error.util');
const { customerRegistrationBodySchema } = require('../src/contracts/backend-safety.contract');
const {
  cashierDirectoryQuerySchema,
  cashierInviteParamsSchema,
} = require('../src/contracts/cashier-signup.contract');
const token = 'a'.repeat(64);
const employee = {
  id: '123',
  name: 'Алия Кассир',
  pointId: '4',
  branchName: 'ЖК Жасыл дала',
  city: 'Актау',
  branchId: null,
  isActive: true,
};
function fixture() {
  const rows = new Map();
  const calls = [];
  let syncAttempt = 0;
  let syncStatus = {
    state: 'never',
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    failureSince: null,
    consecutiveFailures: 0,
    cashierCount: null,
  };
  let source = employee;
  const directory = {
    listCashiers: async () => [employee],
    findCashier: async () => {
      if (source instanceof Error) throw source;
      return source;
    },
  };
  const db = {
    from() {
      return {
        select() {
          return this;
        },
        eq(_field, value) {
          this.token = value;
          return this;
        },
        async maybeSingle() {
          return {
            data: [...rows.values()].find((row) => row.invite_token === this.token) || null,
          };
        },
      };
    },
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'begin_cashier_directory_sync') {
        syncStatus.lastAttemptAt = new Date().toISOString();
        return { data: String(++syncAttempt) };
      }
      if (name === 'get_cashier_directory_sync_status') return { data: syncStatus };
      if (name === 'fail_cashier_directory_sync') {
        const failedAt = new Date().toISOString();
        syncStatus = {
          ...syncStatus,
          state: 'error',
          lastFailureAt: failedAt,
          failureSince: syncStatus.failureSince || failedAt,
          consecutiveFailures: syncStatus.consecutiveFailures + 1,
        };
        return { data: null };
      }
      if (name === 'sync_cashier_directory_with_status') {
        for (const item of args.p_cashiers) {
          rows.set(item.id, {
            employee_id: item.id,
            name: item.name,
            city: item.city,
            point_id: item.pointId,
            branch_name: item.branchName,
            invite_token: rows.get(item.id)?.invite_token || item.inviteToken,
          });
        }
        syncStatus = {
          ...syncStatus,
          state: 'ok',
          lastSuccessAt: new Date().toISOString(),
          failureSince: null,
          consecutiveFailures: 0,
          cashierCount: args.p_cashiers.length,
        };
        return { data: { items: [...rows.values()] } };
      }
      if (name === 'cashier_signup_ranking') {
        return {
          data: {
            reviewPolicy: {
              rapidCount: 5,
              rapidMinutes: 10,
              dailyCount: 20,
              timeZone: 'Asia/Almaty',
            },
            items: [
              {
                id: '123',
                name: employee.name,
                city: employee.city,
                branchName: employee.branchName,
                pointId: employee.pointId,
                duplicateCandidates: [],
                reviewSignals: [],
                completed: 2,
                rewardAmount: 600,
                rank: 1,
                isArchived: false,
                inviteToken: rows.get('123').invite_token,
              },
            ],
          },
        };
      }
      return { data: { cashierCounted: true, cashierRewardAmount: 300 } };
    },
  };
  return {
    calls,
    rows,
    db,
    directory,
    setSource: (value) => {
      source = value;
    },
  };
}
test('public directory filters cities/FIO and preserves opaque employee tokens across refresh', async () => {
  const f = fixture();
  const service = createCashierSignup(f);
  const first = await service.list();
  const again = await service.list({ city: 'Актау', search: 'АЛИЯ' });
  assert.deepEqual(first, again);
  assert.match(first.items[0].inviteToken, /^[a-f0-9]{64}$/);
  assert.equal(first.items[0].url, invitationUrl(first.items[0].inviteToken));
  const link = new URL(first.items[0].url);
  assert.equal(link.pathname, '/cashier-register');
  assert.equal(link.searchParams.get('cashier'), first.items[0].inviteToken);
  assert.deepEqual(first.cities, ['Актау']);
  assert.equal((await service.list({ city: 'Астана' })).items.length, 0);
  assert.equal((await service.list({ search: 'Неизвестный' })).items.length, 0);
  assert.deepEqual(
    Object.keys(first.items[0]).sort(),
    ['id', 'name', 'pointId', 'branchName', 'city', 'inviteToken', 'url'].sort(),
  );
  assert.equal(first.items[0].pointId, employee.pointId);
});
test('fresh archive/read failure blocks salary accrual before the completion RPC', async () => {
  const f = fixture();
  const service = createCashierSignup(f);
  const actualToken = (await service.list()).items[0].inviteToken;
  assert.equal((await service.invitation(actualToken)).cashier.name, employee.name);
  for (const source of [null, { ...employee, isActive: false }, { ...employee, id: '456' }]) {
    f.setSource(source);
    await assert.rejects(
      service.finish({ id: 'customer' }, { name: 'Client' }, actualToken, 'k'.repeat(64)),
      { code: 'CASHIER_INVITE_UNAVAILABLE' },
    );
  }
  f.setSource(
    publicError(503, 'STAFF_DIRECTORY_UNAVAILABLE', 'Список сотрудников временно недоступен.'),
  );
  await assert.rejects(service.invitation(actualToken), { code: 'STAFF_DIRECTORY_UNAVAILABLE' });
  assert.equal(
    f.calls.filter((call) => call.name === 'finish_customer_registration_with_cashier').length,
    0,
  );
  f.setSource(employee);
  await service.finish({ id: 'customer' }, { name: 'Client' }, actualToken, 'f'.repeat(64));
  const call = f.calls.at(-1);
  assert.equal(call.args.p_cashier.id, '123');
  assert.equal(call.args.p_cashier.amount, undefined);
  assert.equal(call.args.p_phone, undefined);
});
test('ranking applies authorized dates/scope and sums actual accrued ledger amounts', async () => {
  const f = fixture();
  const result = await createCashierSignup(f).ranking({
    from: '2026-10-01',
    to: '2026-10-03',
    branches: ['allowed'],
  });
  assert.equal(f.calls.at(-1).args.p_from, '2026-10-01T00:00:00+05:00');
  assert.equal(f.calls.at(-1).args.p_to, '2026-10-03T19:00:00.000Z');
  assert.deepEqual(f.calls.at(-1).args.p_branches, ['allowed']);
  assert.deepEqual(result.totals, { completed: 2, rewardAmount: 600 });
  assert.deepEqual(result.reviewPolicy, {
    rapidCount: 5,
    rapidMinutes: 10,
    dailyCount: 20,
    timeZone: 'Asia/Almaty',
  });
  assert.equal(result.items[0].pointId, employee.pointId);
  assert.deepEqual(result.items[0].duplicateCandidates, []);
  assert.deepEqual(result.items[0].reviewSignals, []);
});

test('overlapping directory/ranking refreshes share a source read, then read fresh again', async () => {
  const f = fixture();
  const service = createCashierSignup(f);
  let release;
  let reads = 0;
  f.directory.listCashiers = async () => {
    reads += 1;
    await new Promise((resolve) => {
      release = resolve;
    });
    return [employee];
  };
  const requests = [service.list(), service.ranking({ from: '2026-10-01', to: '2026-10-04' })];
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 1);
  release();
  await Promise.all(requests);
  assert.equal(
    f.calls.filter((call) => call.name === 'sync_cashier_directory_with_status').length,
    1,
  );
  const next = service.list();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 2, 'a completed snapshot is never reused on the next refresh');
  release();
  await next;
});

test('a failed source refresh never writes a partial directory and the next refresh recovers', async () => {
  const f = fixture();
  const service = createCashierSignup(f);
  const original = await service.list();
  const unavailable = publicError(503, 'STAFF_DIRECTORY_UNAVAILABLE', 'Недоступно');
  f.directory.listCashiers = async () => {
    throw unavailable;
  };
  const requests = await Promise.allSettled([service.list(), service.list()]);
  assert.ok(
    requests.every((request) => request.status === 'rejected' && request.reason === unavailable),
  );
  assert.equal(
    f.calls.filter((call) => call.name === 'sync_cashier_directory_with_status').length,
    1,
  );
  f.directory.listCashiers = async () => [{ ...employee, name: 'Новое ФИО', city: 'Астана' }];
  const updated = await service.list();
  assert.equal(updated.items[0].name, 'Новое ФИО');
  assert.equal(updated.items[0].city, 'Астана');
  assert.equal(updated.items[0].inviteToken, original.items[0].inviteToken);
});
test('strict registration contract rejects forged employee identity/reward and malformed invite tokens', () => {
  const input = {
    name: 'Client',
    acceptedLegal: true,
    legalConsent: {
      offerVersion: '2026-10-03',
      privacyVersion: '2026-10-03',
      locale: 'ru',
      channel: 'web',
    },
    cashierInviteToken: token,
  };
  assert.equal(customerRegistrationBodySchema.parse(input).cashierInviteToken, token);
  for (const extra of [
    { employeeId: '123' },
    { cashierRewardAmount: 900 },
    { cashierInviteToken: '123' },
    { cashierInviteToken: 'https://example.test' },
  ]) {
    assert.equal(customerRegistrationBodySchema.safeParse({ ...input, ...extra }).success, false);
  }
  assert.equal(cashierInviteParamsSchema.safeParse({ token: 'a'.repeat(65) }).success, false);
  assert.equal(cashierDirectoryQuerySchema.safeParse({ city: ['Актау', 'Астана'] }).success, false);
});
test('downloadable QR includes the brand badge and native PNG dimensions', async () => {
  const bytes = await cashierInviteQr(invitationUrl(token));
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.width, 900);
  assert.equal(metadata.height, 900);
  assert.equal(metadata.format, 'png');
  const center = await sharp(bytes)
    .extract({ left: 380, top: 380, width: 140, height: 140 })
    .removeAlpha()
    .raw()
    .toBuffer();
  assert.ok(
    [...center].some((value) => value > 0 && value < 255),
    'brand artwork has colored pixels',
  );
});
