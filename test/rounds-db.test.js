const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
let inspector, session, branch, otherBranch;
const value = async (sql, args = []) => (await db.query(sql, args)).rows[0].value;
const account = (branchIds = [branch], scope = []) =>
  value('select inspection_save_inspector(null,$1,$2,$3) value', [
    JSON.stringify({
      name: 'Inspector',
      username: `rounds.${randomUUID()}`,
      passwordHash: 'test-hash',
      city: 'Актау',
      branchIds,
    }),
    scope,
    'owner',
  ]);
const open = (id = inspector, passwordHash = 'test-hash') =>
  value('select inspection_open_session($1,$2,$3) value', [
    id,
    passwordHash,
    randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
  ]);
const create = (
  tasks = [{ title: 'Осмотр', evidenceType: 'none' }],
  branches = [branch],
  scope = [],
) =>
  value("select inspection_create_rounds($1,$2,'Обход',$3,$4,$5,'owner',$6) value", [
    inspector,
    branches,
    '2026-10-16',
    '2026-10-16T18:00:00+05:00',
    JSON.stringify(tasks),
    scope,
  ]);
const tasks = (id) =>
  db
    .query('select * from inspection_tasks where round_id=$1 order by position', [id])
    .then((r) => r.rows);
const complete = (taskId, id = inspector, sessionId = session, comment = 'Готово') =>
  value('select inspection_complete_task($1,$2,$3,$4) value', [id, sessionId, taskId, comment]);
const media = async (taskId, kind) => {
  const id = randomUUID();
  return value('select inspection_register_media($1,$2,$3,$4,$5,$6,$7,1000) value', [
    inspector,
    session,
    taskId,
    id,
    `${id}.${kind === 'photo' ? 'jpg' : 'mp4'}`,
    kind,
    kind === 'photo' ? 'image/jpeg' : 'video/mp4',
  ]);
};
test.before(async () => {
  await db.exec(
    'create role anon;create role authenticated;create role service_role;create table bulka_locations(id uuid primary key,name text,city text,active boolean);',
  );
  await db.exec(
    fs.readFileSync('supabase/migrations/20261016110000_inspection_rounds.sql', 'utf8'),
  );
});
test.beforeEach(async () => {
  await db.exec(
    'delete from inspection_media;delete from inspection_tasks;delete from inspection_rounds;delete from inspection_sessions;delete from inspection_inspectors;delete from bulka_locations;',
  );
  branch = randomUUID();
  otherBranch = randomUUID();
  await db.query(
    "insert into bulka_locations values($1,'Точка','Актау',true),($2,'Другая','Актау',true)",
    [branch, otherBranch],
  );
  inspector = await account();
  session = await open();
});
test.after(() => db.close());
test('all evidence is required; last completed task atomically completes its round', async () => {
  const [roundId] = await create([
    { title: 'Витрина', evidenceType: 'photo_video' },
    { title: 'Чистота', evidenceType: 'none' },
  ]);
  const [first, second] = await tasks(roundId);
  await assert.rejects(complete(first.id), /ROUNDS_EVIDENCE_REQUIRED/);
  await media(first.id, 'photo');
  await assert.rejects(complete(first.id), /ROUNDS_EVIDENCE_REQUIRED/);
  const clip = await media(first.id, 'video');
  await complete(first.id);
  assert.equal(
    await value('select completed_at is null value from inspection_rounds where id=$1', [roundId]),
    true,
  );
  await assert.rejects(
    value('select inspection_delete_media($1,$2,$3) value', [inspector, session, clip]),
    /ROUNDS_TASK_COMPLETED/,
  );
  await assert.rejects(media(first.id, 'photo'), /ROUNDS_TASK_COMPLETED/);
  await complete(second.id);
  assert.equal(
    await value('select completed_at is not null value from inspection_rounds where id=$1', [
      roundId,
    ]),
    true,
  );
  const completedAt = await value('select completed_at value from inspection_rounds where id=$1', [
    roundId,
  ]);
  await complete(second.id, inspector, session, 'Повтор');
  assert.deepEqual(
    await value('select completed_at value from inspection_rounds where id=$1', [roundId]),
    completedAt,
  );
  assert.equal(
    await value('select comment value from inspection_tasks where id=$1', [second.id]),
    'Готово',
  );
});
test('other employees cannot complete or register media for a round', async () => {
  const [roundId] = await create([{ title: 'Осмотр', evidenceType: 'photo' }]);
  const [task] = await tasks(roundId);
  const other = await account();
  const otherSession = await open(other);
  await assert.rejects(complete(task.id, other, otherSession), /ROUNDS_NOT_FOUND/);
  await assert.rejects(
    value('select inspection_register_media($1,$2,$3,$4,$5,$6,$7,10) value', [
      other,
      otherSession,
      task.id,
      randomUUID(),
      `${randomUUID()}.jpg`,
      'photo',
      'image/jpeg',
    ]),
    /ROUNDS_NOT_FOUND/,
  );
});
test('removed branch scope, inactive branch, inactive inspector and revoked session immediately prevent writes', async () => {
  const [roundId] = await create();
  const [task] = await tasks(roundId);
  await db.query('update inspection_inspectors set branch_ids=$1 where id=$2', [
    [otherBranch],
    inspector,
  ]);
  await assert.rejects(complete(task.id), /ROUNDS_NOT_FOUND/);
  await db.query('update inspection_inspectors set branch_ids=$1 where id=$2', [
    [branch],
    inspector,
  ]);
  await db.query('update bulka_locations set active=false where id=$1', [branch]);
  await assert.rejects(complete(task.id), /ROUNDS_NOT_FOUND/);
  await db.query('update bulka_locations set active=true where id=$1', [branch]);
  await db.query('update inspection_inspectors set active=false where id=$1', [inspector]);
  await assert.rejects(complete(task.id), /ROUNDS_SESSION_INVALID/);
  await db.query('update inspection_inspectors set active=true where id=$1', [inspector]);
  await db.query('delete from inspection_sessions where id=$1', [session]);
  await assert.rejects(complete(task.id), /ROUNDS_SESSION_INVALID/);
});
test('batch scheduling rolls back every branch if any branch is invalid', async () => {
  await assert.rejects(create(undefined, [branch, otherBranch]), /ROUNDS_BRANCH_FORBIDDEN/);
  assert.equal(await value('select count(*)::int value from inspection_rounds'), 0);
  assert.equal(await value('select count(*)::int value from inspection_tasks'), 0);
  await assert.rejects(create(undefined, [branch], [otherBranch]), /ROUNDS_BRANCH_FORBIDDEN/);
});
test('deadline cannot precede its work day and cancelled rounds cannot be changed', async () => {
  await assert.rejects(
    value(
      "select inspection_create_rounds($1,$2,'Обход','2026-10-16','2026-10-15T23:00:00+05:00',$3,'owner','{}') value",
      [inspector, [branch], JSON.stringify([{ title: 'Осмотр', evidenceType: 'none' }])],
    ),
    /check constraint/,
  );
  const [roundId] = await create();
  const [task] = await tasks(roundId);
  await db.query('update inspection_rounds set cancelled_at=now() where id=$1', [roundId]);
  await assert.rejects(complete(task.id), /ROUNDS_CANCELLED/);
});
test('reset/deactivate revokes sessions atomically and a changed password cannot open an old session', async () => {
  await value(
    "select inspection_save_inspector($1,'{\"passwordHash\":\"new-hash\"}','{}','owner') value",
    [inspector],
  );
  assert.equal(await value('select count(*)::int value from inspection_sessions'), 0);
  await assert.rejects(open(), /ROUNDS_SESSION_INVALID/);
  await open(inspector, 'new-hash');
  await value("select inspection_save_inspector($1,'{\"active\":false}','{}','owner') value", [
    inspector,
  ]);
  assert.equal(await value('select count(*)::int value from inspection_sessions'), 0);
});
test('scoped administrators cannot take over accounts spanning another branch', async () => {
  await value("select inspection_save_inspector($1,$2,'{}','owner') value", [
    inspector,
    JSON.stringify({ branchIds: [branch, otherBranch] }),
  ]);
  await assert.rejects(
    value('select inspection_save_inspector($1,\'{"name":"Takeover"}\',$2,\'owner\') value', [
      inspector,
      [branch],
    ]),
    /ROUNDS_NOT_FOUND/,
  );
  await db.query("update bulka_locations set city='Астана' where id=$1", [otherBranch]);
  await assert.rejects(account([otherBranch]), /ROUNDS_BRANCH_FORBIDDEN/);
});
test('wrong media kind and excess attachments rejected; unfinished material can be deleted', async () => {
  const [roundId] = await create([{ title: 'Осмотр', evidenceType: 'photo' }]);
  const [task] = await tasks(roundId);
  await assert.rejects(media(task.id, 'video'), /ROUNDS_MEDIA_TYPE/);
  const first = await media(task.id, 'photo');
  for (let n = 1; n < 6; n++) await media(task.id, 'photo');
  await assert.rejects(media(task.id, 'photo'), /ROUNDS_MEDIA_LIMIT/);
  const file = await value('select inspection_delete_media($1,$2,$3) value', [
    inspector,
    session,
    first,
  ]);
  assert.equal(file, `${first}.jpg`);
});
test('service-only RLS and function privileges prevent browser direct access', async () => {
  assert.equal(
    await value(
      "select bool_and(relrowsecurity) value from pg_class where relname in ('inspection_inspectors','inspection_sessions','inspection_rounds','inspection_tasks','inspection_media')",
    ),
    true,
  );
  assert.equal(
    await value("select has_table_privilege('anon','inspection_inspectors','select') value"),
    false,
  );
  assert.equal(
    await value(
      "select has_function_privilege('authenticated','inspection_complete_task(uuid,uuid,uuid,text)','execute') value",
    ),
    false,
  );
  assert.equal(
    await value(
      "select has_function_privilege('service_role','inspection_authorize_round(uuid,uuid,uuid)','execute') value",
    ),
    false,
  );
});
