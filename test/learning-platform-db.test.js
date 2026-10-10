const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createLearningDatabase } = require('./fixtures/learning-pg-fixture.cjs');

const CASHIER = '10000000-0000-4000-8000-000000000001';
const BAKER = '10000000-0000-4000-8000-000000000004';
const MANAGER = '10000000-0000-4000-8000-000000000005';
const BRANCH = '20000000-0000-4000-8000-000000000001';
const OTHER_BRANCH = '20000000-0000-4000-8000-000000000002';

async function fixture(t) {
  const pg = await createLearningDatabase();
  t.after(() => pg.close());
  await pg.query('insert into bulka_locations(id) values($1),($2)', [BRANCH, OTHER_BRANCH]);
  await pg.query(
    `insert into admin_user_profiles(username,role,branch_ids) values
      ('owner','owner','{}'),('learner','employee',array[$1::uuid]),
      ('other','employee',array[$2::uuid]),('manager','branch_manager',array[$1::uuid]),
      ('foreign-manager','branch_manager',array[$2::uuid])`,
    [BRANCH, OTHER_BRANCH],
  );
  await pg.query(
    `insert into learning_employee_profiles(username,job_role_id,start_date,learning_enabled) values
      ('learner',$1,((clock_timestamp() at time zone 'Asia/Almaty')::date-100),true),
      ('other',$2,((clock_timestamp() at time zone 'Asia/Almaty')::date-100),true)`,
    [CASHIER, BAKER],
  );
  const rpc = async (name, ...args) =>
    (
      await pg.query(
        `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`,
        args.map((value) => (Array.isArray(value) ? JSON.stringify(value) : value)),
      )
    ).rows[0].result;
  const attempt = async (id) =>
    (await pg.query('select * from learning_attempts where id=$1', [id])).rows[0];
  const xp = async () =>
    (
      await pg.query(
        "select coalesce(sum(xp),0)::int xp from learning_achievements where username='learner'",
      )
    ).rows[0].xp;
  return { pg, rpc, attempt, xp };
}

function question(index) {
  const choices = [
    { id: randomUUID(), text: `Верный вариант ${index}` },
    { id: randomUUID(), text: `Другой вариант ${index}` },
  ];
  return {
    id: randomUUID(),
    prompt: `Реальный учебный вопрос ${index}`,
    choices,
    correctChoiceId: choices[0].id,
    explanation: 'Объяснение для администратора.',
  };
}

async function course(f, { roleIds = [], published = true, count = 2 } = {}) {
  const id = randomUUID();
  const lessons = Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    title: `Урок ${index + 1}`,
    body: 'Учебное содержание утверждено администратором.',
    videoUrl: null,
    estimatedMinutes: 5,
    sortOrder: index,
  }));
  const modules = [{ id: randomUUID(), title: 'Модуль', sortOrder: 0, lessons }];
  await f.pg.query(
    'insert into learning_courses(id,title,role_ids,published,modules) values($1,$2,$3,$4,$5)',
    [id, 'Курс', roleIds, published, JSON.stringify(modules)],
  );
  return { id, lessons, modules };
}

async function assessment(
  f,
  {
    kind = 'control',
    roleIds = [],
    published = true,
    bank = Array.from({ length: 4 }, (_, index) => question(index)),
    questionCount = 2,
    maxAttempts = 3,
    cooldownMinutes = 0,
    minimumTenureDays = 0,
    requiredCourseIds = [],
    targetRoleId = kind === 'promotion' ? MANAGER : null,
  } = {},
) {
  const id = randomUUID();
  await f.pg.query(
    `insert into learning_assessments(id,title,kind,role_ids,published,question_count,max_attempts,
      cooldown_minutes,minimum_tenure_days,required_course_ids,target_role_id,questions)
      values($1,'Тест',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      kind,
      roleIds,
      published,
      questionCount,
      maxAttempts,
      cooldownMinutes,
      minimumTenureDays,
      requiredCourseIds,
      targetRoleId,
      JSON.stringify(bank),
    ],
  );
  return { id, bank };
}

const answersFor = (attempt, correct = true) =>
  attempt.questions.map((item) => ({
    questionId: item.id,
    choiceId: correct
      ? item.correctChoiceId
      : item.choices.find((choice) => choice.id !== item.correctChoiceId).id,
  }));
const expectError = (result, code) => assert.deepEqual(result, { error: code });

test('learning migration seeds roles only and closes public tables, RPCs and helper access', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.pg.query('select count(*)::int n from learning_job_roles')).rows[0].n, 6);
  assert.equal((await f.pg.query('select count(*)::int n from learning_courses')).rows[0].n, 0);
  assert.equal((await f.pg.query('select count(*)::int n from learning_assessments')).rows[0].n, 0);
  const tables = [
    'learning_job_roles',
    'learning_employee_profiles',
    'learning_courses',
    'learning_assessments',
    'learning_assignments',
    'learning_lesson_progress',
    'learning_achievements',
    'learning_attempts',
  ];
  for (const table of tables) {
    const privileges = (
      await f.pg.query(
        `select has_table_privilege('anon',$1,'select,insert,update,delete') a,
          has_table_privilege('authenticated',$1,'select,insert,update,delete') b,
          has_table_privilege('service_role',$1,'select') service_read,
          (select relrowsecurity from pg_class where oid=$1::regclass) rls`,
        [table],
      )
    ).rows[0];
    assert.deepEqual(privileges, { a: false, b: false, service_read: true, rls: true }, table);
  }
  for (const name of [
    'learning_complete_lesson(text,uuid)',
    'learning_start_attempt(text,uuid)',
    'learning_submit_attempt(text,uuid,jsonb)',
    'learning_decide_promotion(uuid,text,text)',
    'create_employee_access(text,text,uuid[],text)',
    'update_employee_access(text,text,uuid[],boolean)',
    'reset_employee_password(text,text)',
  ]) {
    assert.deepEqual(
      (
        await f.pg.query(
          `select has_function_privilege('anon',$1,'execute') a,
          has_function_privilege('authenticated',$1,'execute') b,
          has_function_privilege('service_role',$1,'execute') service`,
          [name],
        )
      ).rows[0],
      { a: false, b: false, service: true },
    );
  }
  assert.equal(
    (
      await f.pg.query(
        "select has_function_privilege('service_role','learning_award(text,text,text,integer)','execute') p",
      )
    ).rows[0].p,
    false,
  );
  for (const table of ['learning_attempts', 'learning_lesson_progress', 'learning_achievements']) {
    assert.equal(
      (
        await f.pg.query("select has_table_privilege('service_role',$1,'insert,update,delete') p", [
          table,
        ])
      ).rows[0].p,
      false,
    );
  }
  const exam = await assessment(f);
  for (const role of ['anon', 'authenticated']) {
    await f.pg.exec(`set role ${role}`);
    try {
      await assert.rejects(
        f.pg.query('select questions from learning_attempts'),
        /permission denied/,
      );
      await assert.rejects(
        f.rpc('learning_start_attempt', 'learner', exam.id),
        /permission denied/,
      );
    } finally {
      await f.pg.exec('reset role');
    }
  }
  await f.pg.exec('set role service_role');
  try {
    assert.ok((await f.rpc('learning_start_attempt', 'learner', exam.id)).attemptId);
    await assert.rejects(f.pg.exec('delete from learning_achievements'), /permission denied/);
    await f.pg.exec("insert into learning_job_roles(title) values('Новая должность')");
  } finally {
    await f.pg.exec('reset role');
  }
});

test('lessons enforce access and progression, with atomic one-time lesson and course XP', async (t) => {
  const f = await fixture(t);
  const c = await course(f);
  expectError(
    await f.rpc('learning_complete_lesson', 'learner', c.lessons[1].id),
    'LEARNING_LESSON_LOCKED',
  );
  assert.deepEqual(await f.rpc('learning_complete_lesson', 'learner', c.lessons[0].id), {
    ok: true,
  });
  assert.equal(await f.xp(), 10);
  await f.rpc('learning_complete_lesson', 'learner', c.lessons[0].id);
  assert.equal(await f.xp(), 10);
  await f.rpc('learning_complete_lesson', 'learner', c.lessons[1].id);
  assert.equal(await f.xp(), 70);
  await f.rpc('learning_complete_lesson', 'learner', c.lessons[1].id);
  assert.equal(await f.xp(), 70);
  const restricted = await course(f, { roleIds: [BAKER], count: 1 });
  expectError(
    await f.rpc('learning_complete_lesson', 'learner', restricted.lessons[0].id),
    'LEARNING_COURSE_UNAVAILABLE',
  );
  await f.pg.query(
    "insert into learning_assignments(employee_username,course_id,created_by) values('learner',$1,'owner')",
    [restricted.id],
  );
  assert.deepEqual(await f.rpc('learning_complete_lesson', 'learner', restricted.lessons[0].id), {
    ok: true,
  });
  const atomic = await course(f, { count: 1 });
  await f.pg.exec(`create function test_fail_course_award() returns trigger language plpgsql as $$
    begin if new.code like 'course:%' then raise exception 'forced award failure'; end if; return new; end $$;
    create trigger test_fail_course_award before insert on learning_achievements
      for each row execute function test_fail_course_award();`);
  await assert.rejects(
    f.rpc('learning_complete_lesson', 'learner', atomic.lessons[0].id),
    /forced award failure/,
  );
  assert.equal(
    (
      await f.pg.query('select count(*)::int n from learning_lesson_progress where course_id=$1', [
        atomic.id,
      ])
    ).rows[0].n,
    0,
  );
  assert.equal(await f.xp(), 130);
});

test('start enforces enabled active profiles, role assignments, drafts, current course prerequisites and reviewed tenure', async (t) => {
  const f = await fixture(t);
  const c = await course(f, { count: 1 });
  const exam = await assessment(f, { requiredCourseIds: [c.id], minimumTenureDays: 90 });
  expectError(await f.rpc('learning_start_attempt', 'learner', exam.id), 'LEARNING_PREREQUISITES');
  await f.rpc('learning_complete_lesson', 'learner', c.lessons[0].id);
  await f.pg.exec("update learning_employee_profiles set start_date=null where username='learner'");
  expectError(
    await f.rpc('learning_start_attempt', 'learner', exam.id),
    'LEARNING_TENURE_REQUIRED',
  );
  await assert.rejects(
    f.pg.exec(
      "update learning_employee_profiles set start_date=(clock_timestamp() at time zone 'Asia/Almaty')::date+1 where username='learner'",
    ),
    /check constraint/,
  );
  await f.pg.exec(
    "update learning_employee_profiles set start_date=(clock_timestamp() at time zone 'Asia/Almaty')::date where username='learner'",
  );
  expectError(
    await f.rpc('learning_start_attempt', 'learner', exam.id),
    'LEARNING_TENURE_REQUIRED',
  );
  await f.pg.exec(
    "update learning_employee_profiles set start_date=current_date-100,learning_enabled=false where username='learner'",
  );
  expectError(
    await f.rpc('learning_start_attempt', 'learner', exam.id),
    'LEARNING_ACCESS_DISABLED',
  );
  await f.pg.exec(
    "update learning_employee_profiles set learning_enabled=true where username='learner'; update admin_user_profiles set active=false where username='learner'",
  );
  expectError(
    await f.rpc('learning_start_attempt', 'learner', exam.id),
    'LEARNING_ACCOUNT_INACTIVE',
  );
  await f.pg.exec("update admin_user_profiles set active=true where username='learner'");
  await f.pg.query('update learning_job_roles set active=false where id=$1', [CASHIER]);
  expectError(await f.rpc('learning_start_attempt', 'learner', exam.id), 'LEARNING_ROLE_INACTIVE');
  await f.pg.query('update learning_job_roles set active=true where id=$1', [CASHIER]);
  const draft = await assessment(f, { published: false });
  expectError(
    await f.rpc('learning_start_attempt', 'learner', draft.id),
    'LEARNING_ASSESSMENT_UNAVAILABLE',
  );
  const restricted = await assessment(f, { roleIds: [BAKER] });
  expectError(
    await f.rpc('learning_start_attempt', 'learner', restricted.id),
    'LEARNING_ASSESSMENT_UNAVAILABLE',
  );
  await f.pg.query(
    "insert into learning_assignments(role_id,assessment_id,created_by) values($1,$2,'owner')",
    [CASHIER, restricted.id],
  );
  assert.ok((await f.rpc('learning_start_attempt', 'learner', restricted.id)).attemptId);
  const extraLesson = {
    ...c.lessons[0],
    id: randomUUID(),
    sortOrder: 1,
  };
  c.modules[0].lessons.push(extraLesson);
  await f.pg.query('update learning_courses set modules=$2 where id=$1', [
    c.id,
    JSON.stringify(c.modules),
  ]);
  expectError(await f.rpc('learning_start_attempt', 'learner', exam.id), 'LEARNING_PREREQUISITES');
  await f.rpc('learning_complete_lesson', 'learner', extraLesson.id);
  assert.ok((await f.rpc('learning_start_attempt', 'learner', exam.id)).attemptId);
  assert.equal(
    (
      await f.pg.query('select count(*)::int n from learning_achievements where code=$1', [
        `course:${c.id}`,
      ])
    ).rows[0].n,
    1,
  );
});

test('active attempts resume without deadline reset; abandoned and expired starts consume limits and cooldown', async (t) => {
  const f = await fixture(t);
  const exam = await assessment(f, { maxAttempts: 1 });
  const first = await f.rpc('learning_start_attempt', 'learner', exam.id);
  const initial = await f.attempt(first.attemptId);
  const resumes = await Promise.all([
    f.rpc('learning_start_attempt', 'learner', exam.id),
    f.rpc('learning_start_attempt', 'learner', exam.id),
  ]);
  assert.deepEqual(resumes, [first, first]);
  assert.equal(
    (await f.attempt(first.attemptId)).deadline_at.getTime(),
    initial.deadline_at.getTime(),
  );
  assert.equal((await f.pg.query('select count(*)::int n from learning_attempts')).rows[0].n, 1);
  await f.pg.query(
    "update learning_attempts set started_at=clock_timestamp()-interval '2 hours',deadline_at=clock_timestamp()-interval '1 hour' where id=$1",
    [first.attemptId],
  );
  expectError(await f.rpc('learning_start_attempt', 'learner', exam.id), 'LEARNING_MAX_ATTEMPTS');
  assert.equal((await f.attempt(first.attemptId)).status, 'expired');
  const cooling = await assessment(f, { cooldownMinutes: 60 });
  const active = await f.rpc('learning_start_attempt', 'learner', cooling.id);
  await f.pg.query(
    "update learning_attempts set started_at=clock_timestamp()-interval '2 hours',deadline_at=clock_timestamp()-interval '1 minute' where id=$1",
    [active.attemptId],
  );
  expectError(await f.rpc('learning_start_attempt', 'learner', cooling.id), 'LEARNING_COOLDOWN');
  await f.pg.query(
    "update learning_attempts set deadline_at=clock_timestamp()-interval '61 minutes' where id=$1",
    [active.attemptId],
  );
  assert.notEqual(
    (await f.rpc('learning_start_attempt', 'learner', cooling.id)).attemptId,
    active.attemptId,
  );
});

test('grading uses immutable sampled bank and threshold, rejects invalid answers and ownership, and replays original results', async (t) => {
  const f = await fixture(t);
  const exam = await assessment(f);
  const started = await f.rpc('learning_start_attempt', 'learner', exam.id);
  assert.deepEqual(Object.keys(started), ['attemptId']);
  const initial = await f.attempt(started.attemptId);
  assert.equal(initial.questions.length, 2);
  assert.equal(new Set(initial.questions.map((item) => item.id)).size, 2);
  const answers = answersFor(initial);
  expectError(
    await f.rpc('learning_submit_attempt', 'other', started.attemptId, answers),
    'LEARNING_ATTEMPT_NOT_FOUND',
  );
  for (const invalid of [
    [],
    [answers[0], answers[0]],
    [answers[0], { questionId: randomUUID(), choiceId: randomUUID() }],
    [answers[0], { ...answers[1], choiceId: randomUUID() }],
    [answers[0], { ...answers[1], score: 100 }],
    [answers[0], null],
  ]) {
    expectError(
      await f.rpc('learning_submit_attempt', 'learner', started.attemptId, invalid),
      'LEARNING_INVALID_ANSWERS',
    );
  }
  const changedBank = exam.bank.map((item) => ({ ...item, correctChoiceId: item.choices[1].id }));
  await f.pg.query(
    'update learning_assessments set questions=$2,pass_percent=100,title=$3 where id=$1',
    [exam.id, JSON.stringify(changedBank), 'Обновлённый тест'],
  );
  assert.deepEqual(
    await f.rpc('learning_submit_attempt', 'learner', started.attemptId, answers),
    started,
  );
  const graded = await f.attempt(started.attemptId);
  assert.equal(graded.score_percent, '100.00');
  assert.equal(graded.passed, true);
  assert.equal(graded.pass_percent, 80);
  assert.equal(graded.title, 'Тест');
  assert.equal(graded.correct_count, 2);
  assert.equal(graded.xp_awarded, 50);
  assert.equal(await f.xp(), 50);
  assert.deepEqual(
    await f.rpc('learning_submit_attempt', 'learner', started.attemptId, [...answers].reverse()),
    started,
  );
  expectError(
    await f.rpc(
      'learning_submit_attempt',
      'learner',
      started.attemptId,
      answersFor(initial, false),
    ),
    'LEARNING_SUBMISSION_CONFLICT',
  );
  assert.equal(
    (await f.attempt(started.attemptId)).submitted_at.getTime(),
    graded.submitted_at.getTime(),
  );
  assert.equal(await f.xp(), 50);
  const second = await f.rpc('learning_start_attempt', 'learner', exam.id);
  await f.rpc(
    'learning_submit_attempt',
    'learner',
    second.attemptId,
    answersFor(await f.attempt(second.attemptId)),
  );
  assert.equal((await f.attempt(second.attemptId)).xp_awarded, 0);
  assert.equal(await f.xp(), 50);
});

test('deadline expiration persists without grading or XP, while grading failure rolls back the whole result', async (t) => {
  const f = await fixture(t);
  const exam = await assessment(f);
  const started = await f.rpc('learning_start_attempt', 'learner', exam.id);
  const answers = answersFor(await f.attempt(started.attemptId));
  await f.pg.query(
    "update learning_attempts set started_at=clock_timestamp()-interval '2 hours',deadline_at=clock_timestamp() where id=$1",
    [started.attemptId],
  );
  expectError(
    await f.rpc('learning_submit_attempt', 'learner', started.attemptId, answers),
    'LEARNING_ATTEMPT_EXPIRED',
  );
  assert.equal((await f.attempt(started.attemptId)).status, 'expired');
  assert.equal((await f.attempt(started.attemptId)).answers, null);
  assert.equal(await f.xp(), 0);
  const second = await f.rpc('learning_start_attempt', 'learner', exam.id);
  await f.pg.exec(`create function test_fail_grade() returns trigger language plpgsql as $$
    begin if new.status='submitted' then raise exception 'forced grade failure'; end if; return new; end $$;
    create trigger test_fail_grade before update on learning_attempts for each row execute function test_fail_grade();`);
  await assert.rejects(
    f.rpc(
      'learning_submit_attempt',
      'learner',
      second.attemptId,
      answersFor(await f.attempt(second.attemptId)),
    ),
    /forced grade failure/,
  );
  assert.equal((await f.attempt(second.attemptId)).status, 'in_progress');
  assert.equal(await f.xp(), 0);
});

test('promotion needs a passed snapshot and explicit authorized decision, changes only job role, and awards once', async (t) => {
  const f = await fixture(t);
  const exam = await assessment(f, { kind: 'promotion' });
  const started = await f.rpc('learning_start_attempt', 'learner', exam.id);
  expectError(
    await f.rpc('learning_decide_promotion', started.attemptId, 'approved', 'owner'),
    'LEARNING_PROMOTION_CONFLICT',
  );
  await f.rpc(
    'learning_submit_attempt',
    'learner',
    started.attemptId,
    answersFor(await f.attempt(started.attemptId)),
  );
  assert.equal(
    (
      await f.pg.query(
        "select job_role_id from learning_employee_profiles where username='learner'",
      )
    ).rows[0].job_role_id,
    CASHIER,
  );
  expectError(
    await f.rpc('learning_decide_promotion', started.attemptId, 'approved', 'foreign-manager'),
    'LEARNING_PROMOTION_FORBIDDEN',
  );
  expectError(
    await f.rpc('learning_decide_promotion', started.attemptId, 'approved', 'learner'),
    'LEARNING_PROMOTION_FORBIDDEN',
  );
  await f.pg.query('update learning_job_roles set active=false where id=$1', [MANAGER]);
  expectError(
    await f.rpc('learning_decide_promotion', started.attemptId, 'approved', 'owner'),
    'LEARNING_TARGET_ROLE_INACTIVE',
  );
  await f.pg.query('update learning_job_roles set active=true where id=$1', [MANAGER]);
  const expected = { attemptId: started.attemptId, username: 'learner' };
  assert.deepEqual(
    await f.rpc('learning_decide_promotion', started.attemptId, 'approved', 'manager'),
    expected,
  );
  assert.deepEqual(
    await f.rpc('learning_decide_promotion', started.attemptId, 'approved', 'environment-owner'),
    expected,
  );
  expectError(
    await f.rpc('learning_decide_promotion', started.attemptId, 'rejected', 'owner'),
    'LEARNING_PROMOTION_CONFLICT',
  );
  assert.equal(
    (
      await f.pg.query(
        "select job_role_id from learning_employee_profiles where username='learner'",
      )
    ).rows[0].job_role_id,
    MANAGER,
  );
  assert.deepEqual(
    (
      await f.pg.query(
        "select role,branch_ids,active from admin_user_profiles where username='learner'",
      )
    ).rows[0],
    { role: 'employee', branch_ids: [BRANCH], active: true },
  );
  assert.equal((await f.attempt(started.attemptId)).decided_by, 'manager');
  assert.equal(await f.xp(), 100);
  assert.equal(
    (
      await f.pg.query(
        "select count(*)::int n from learning_achievements where code like 'promotion:%'",
      )
    ).rows[0].n,
    1,
  );
  const rejectedExam = await assessment(f, { kind: 'promotion', targetRoleId: BAKER });
  const rejected = await f.rpc('learning_start_attempt', 'learner', rejectedExam.id);
  await f.rpc(
    'learning_submit_attempt',
    'learner',
    rejected.attemptId,
    answersFor(await f.attempt(rejected.attemptId)),
  );
  await f.rpc('learning_decide_promotion', rejected.attemptId, 'rejected', 'environment-owner');
  assert.equal(
    (
      await f.pg.query(
        "select job_role_id from learning_employee_profiles where username='learner'",
      )
    ).rows[0].job_role_id,
    MANAGER,
  );
});

test('promotion requires the manager to cover every employee branch at decision time', async (t) => {
  const f = await fixture(t);
  const exam = await assessment(f, { kind: 'promotion' });
  const started = await f.rpc('learning_start_attempt', 'learner', exam.id);
  await f.rpc(
    'learning_submit_attempt',
    'learner',
    started.attemptId,
    answersFor(await f.attempt(started.attemptId)),
  );

  // Membership may expand after the HTTP scope check and before the atomic decision.
  await f.pg.query("update admin_user_profiles set branch_ids=$1 where username='learner'", [
    [BRANCH, OTHER_BRANCH],
  ]);
  expectError(
    await f.rpc('learning_decide_promotion', started.attemptId, 'approved', 'manager'),
    'LEARNING_PROMOTION_FORBIDDEN',
  );
  assert.equal((await f.attempt(started.attemptId)).promotion_decision, null);
  assert.equal(
    (
      await f.pg.query(
        "select job_role_id from learning_employee_profiles where username='learner'",
      )
    ).rows[0].job_role_id,
    CASHIER,
  );

  await f.pg.query("update admin_user_profiles set branch_ids='{}' where username='learner'");
  expectError(
    await f.rpc('learning_decide_promotion', started.attemptId, 'approved', 'manager'),
    'LEARNING_PROMOTION_FORBIDDEN',
  );
  assert.equal((await f.attempt(started.attemptId)).promotion_decision, null);

  await f.pg.query(
    "update admin_user_profiles set branch_ids=$1 where username in ('learner','manager')",
    [[BRANCH, OTHER_BRANCH]],
  );
  assert.deepEqual(
    await f.rpc('learning_decide_promotion', started.attemptId, 'approved', 'manager'),
    { attemptId: started.attemptId, username: 'learner' },
  );
  assert.equal((await f.attempt(started.attemptId)).decided_by, 'manager');
  assert.equal(
    (
      await f.pg.query(
        "select job_role_id from learning_employee_profiles where username='learner'",
      )
    ).rows[0].job_role_id,
    MANAGER,
  );
  assert.deepEqual(
    (
      await f.pg.query(
        "select role,branch_ids,active from admin_user_profiles where username='learner'",
      )
    ).rows[0],
    { role: 'employee', branch_ids: [BRANCH, OTHER_BRANCH], active: true },
  );
});

test('publication and assignment constraints reject empty, ambiguous and malformed content', async (t) => {
  const f = await fixture(t);
  await assert.rejects(course(f, { count: 0 }), /LEARNING_INVALID_CONTENT/);
  await assert.rejects(assessment(f, { bank: [], questionCount: 1 }), /LEARNING_INVALID_CONTENT/);
  const bad = question(1);
  bad.correctChoiceId = randomUUID();
  await assert.rejects(
    assessment(f, { bank: [bad], questionCount: 1 }),
    /LEARNING_INVALID_CONTENT/,
  );
  const c = await course(f, { count: 1 });
  const duplicated = await course(f, { count: 1 });
  await assert.rejects(
    f.pg.query('update learning_courses set modules=$2 where id=$1', [
      duplicated.id,
      JSON.stringify(c.modules),
    ]),
    /LEARNING_INVALID_CONTENT/,
  );
  const exam = await assessment(f);
  await assert.rejects(
    f.pg.query(
      "insert into learning_assignments(employee_username,role_id,course_id,created_by) values('learner',$1,$2,'owner')",
      [CASHIER, c.id],
    ),
    /check constraint/,
  );
  await assert.rejects(
    f.pg.query(
      "insert into learning_assignments(employee_username,course_id,assessment_id,created_by) values('learner',$1,$2,'owner')",
      [c.id, exam.id],
    ),
    /check constraint/,
  );
});

test('employee password creation is atomic, stays employee-only, and resets revoke sessions', async (t) => {
  const f = await fixture(t);
  const hash = '$2b$12$4ojkOJkkZ0OkGMSV5W8oKuR0nm4G9Djwrn1XF.7z9KqNhxQH1Ugkq';
  const created = (
    await f.pg.query('select create_employee_access($1,$2,$3,$4) result', [
      'Worker.One',
      'Работник',
      [BRANCH, OTHER_BRANCH],
      hash,
    ])
  ).rows[0].result;
  assert.equal(created.role, 'employee');
  assert.deepEqual(created.branch_ids, [BRANCH, OTHER_BRANCH]);
  assert.equal(JSON.stringify(created).includes(hash), false);
  await f.pg.query("insert into admin_sessions(admin_subject) values('worker.one')");
  assert.equal(
    (await f.pg.query('select reset_employee_password($1,$2) result', ['worker.one', hash])).rows[0]
      .result,
    true,
  );
  assert.equal(
    (
      await f.pg.query(
        "select auth_version from admin_staff_credentials where username='worker.one'",
      )
    ).rows[0].auth_version,
    2,
  );
  assert.ok(
    (await f.pg.query("select revoked_at from admin_sessions where admin_subject='worker.one'"))
      .rows[0].revoked_at,
  );
  await f.pg.query("insert into admin_sessions(admin_subject) values('worker.one')");
  const updated = (
    await f.pg.query('select update_employee_access($1,$2,$3,$4) result', [
      'worker.one',
      'Работник',
      [],
      false,
    ])
  ).rows[0].result;
  assert.equal(updated.active, false);
  assert.equal(updated.role, 'employee');
  const renamed = (
    await f.pg.query('select update_employee_access($1,$2,$3,$4) result', [
      'worker.one',
      null,
      [],
      true,
    ])
  ).rows[0].result;
  assert.equal(
    renamed.display_name,
    'Работник',
    'omitted display name preserves the canonical name',
  );
  assert.equal(
    (
      await f.pg.query(
        "select count(*)::int n from admin_sessions where admin_subject='worker.one' and revoked_at is null",
      )
    ).rows[0].n,
    0,
  );
  await assert.rejects(
    f.pg.query('select create_employee_access($1,$2,$3,$4)', [
      'bad.branch',
      'Работник',
      [randomUUID()],
      hash,
    ]),
    /invalid employee branches/,
  );
  await assert.rejects(
    f.pg.query('select reset_employee_password($1,$2)', ['owner', hash]),
    /employee account not found/,
  );
  await f.pg
    .exec(`create function refuse_employee_hash() returns trigger language plpgsql as $$ begin
    if new.username='atomic.worker' then raise exception 'injected credential failure'; end if; return new; end $$;
    create trigger refuse_hash before insert on admin_staff_credentials for each row execute function refuse_employee_hash();`);
  await assert.rejects(
    f.pg.query('select create_employee_access($1,$2,$3,$4)', [
      'atomic.worker',
      'Работник',
      [],
      hash,
    ]),
    /injected credential failure/,
  );
  assert.equal(
    (
      await f.pg.query(
        "select count(*)::int n from admin_user_profiles where username='atomic.worker'",
      )
    ).rows[0].n,
    0,
  );
});
