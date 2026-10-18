const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Execute the production handler, with controlled request completion instead
// of a real server, so network ordering and navigation are deterministic.
function fixture() {
  const source = fs.readFileSync(path.resolve(__dirname, '../public/rounds/app.js'), 'utf8');
  const start = source.indexOf('  async function completeTask(id) {');
  const end = source.indexOf('  async function removeMedia(', start);
  assert.ok(start > 0 && end > start);
  const state = {
    epoch: 1,
    round: { status: 'pending', tasks: [{ id: 'A' }, { id: 'B' }] },
    uploads: new Map(), comments: new Map(), taskErrors: new Map(),
    completing: new Set(), completionQueue: Promise.resolve(),
  };
  const calls = [];
  const context = {
    state, M: { editable: (round) => round.status !== 'completed', evidenceReady: () => true },
    taskById: (id) => state.round.tasks.find((task) => task.id === id),
    renderDetail() {}, announce() {}, errorMessage: (error) => error.message,
    request: (url, options) => new Promise((resolve, reject) => calls.push({ url, options, resolve, reject })),
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + '\nglobalThis.completeTask = completeTask;', context);
  const snapshot = (complete) => ({ round: {
    status: complete.length === 2 ? 'completed' : 'in_progress',
    tasks: ['A', 'B'].map((id) => ({ id, completedAt: complete.includes(id) ? '2026-10-18T10:00:00Z' : null })),
  } });
  return { state, calls, complete: context.completeTask, snapshot };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('round task completions keep both buttons pending but serialize snapshots in server order', async () => {
  const f = fixture();
  f.state.comments.set('B', 'Проверено');
  const a = f.complete('A');
  const b = f.complete('B');
  await flush();
  assert.deepEqual([...f.state.completing], ['A', 'B']);
  assert.equal(f.calls.length, 1, 'B must not overtake the delayed A response');
  f.calls[0].resolve(f.snapshot(['A']));
  await a;
  await flush();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].url, '/tasks/B/complete');
  assert.equal(f.calls[1].options.body.comment, 'Проверено');
  f.calls[1].resolve(f.snapshot(['A', 'B']));
  await b;
  assert.equal(f.state.round.status, 'completed');
  assert.ok(f.state.round.tasks.every((task) => task.completedAt));
  assert.equal(f.state.completing.size, 0);
});

test('one failed completion does not discard a queued task or its pending indicator', async () => {
  const f = fixture();
  const a = f.complete('A');
  const b = f.complete('B');
  await flush();
  f.calls[0].reject(new Error('Повторите отправку'));
  await a;
  await flush();
  assert.equal(f.state.taskErrors.get('A'), 'Повторите отправку');
  assert.equal(f.calls.length, 2);
  assert.equal(f.state.completing.has('B'), true);
  f.calls[1].resolve(f.snapshot(['B']));
  await b;
  assert.equal(f.state.round.tasks.find((task) => task.id === 'B').completedAt != null, true);
});

test('navigation prevents queued submissions and late responses from replacing the new round', async () => {
  const f = fixture();
  const a = f.complete('A');
  const b = f.complete('B');
  await flush();
  f.state.epoch++;
  f.state.round = { id: 'new-round', status: 'pending', tasks: [] };
  f.calls[0].resolve(f.snapshot(['A']));
  await Promise.all([a, b]);
  assert.equal(f.calls.length, 1, 'Queued B belongs to the old screen and must not submit');
  assert.equal(f.state.round.id, 'new-round');
});
