const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const c = require('../src/contracts/learning-platform.contract');
const { createLearningPlatform } = require('../src/services/learning-platform.service');
const { adminMutationRoleMiddleware } = require('../src/middlewares/auth.middleware');
const { validateAdminSession } = require('../src/services/admin-session.service');
const credentials = require('../src/services/admin-credential-auth.service');

const BRANCH = '20000000-0000-4000-8000-000000000001';
const OTHER = '20000000-0000-4000-8000-000000000002';
const HASH = '$2b$12$4ojkOJkkZ0OkGMSV5W8oKuR0nm4G9Djwrn1XF.7z9KqNhxQH1Ugkq';
const admin = { sub: 'learner', role: 'employee', branchIds: [BRANCH] };

function fixture(extra = {}) {
  const tables = {
    admin_user_profiles: [
      {
        username: 'learner',
        display_name: 'Сотрудник',
        role: 'employee',
        branch_ids: [BRANCH],
        active: true,
      },
    ],
    learning_employee_profiles: [
      { username: 'learner', job_role_id: null, start_date: '2026-10-09', learning_enabled: true },
    ],
    learning_job_roles: [],
    learning_courses: [],
    learning_assessments: [],
    learning_assignments: [],
    learning_lesson_progress: [],
    learning_achievements: [],
    learning_attempts: [],
    ...extra,
  };
  const calls = [];
  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.mutation = null;
    }
    select() {
      return this;
    }
    eq(key, value) {
      this.filters.push((row) => row[key] === value);
      return this;
    }
    order() {
      return this;
    }
    range(start, end) {
      this.window = [start, end];
      return this;
    }
    maybeSingle() {
      this.singleRow = true;
      return this;
    }
    single() {
      this.singleRow = true;
      return this;
    }
    insert(value) {
      this.mutation = ['insert', value];
      return this;
    }
    update(value) {
      this.mutation = ['update', value];
      return this;
    }
    upsert(value) {
      this.mutation = ['upsert', value];
      return this;
    }
    delete() {
      this.mutation = ['delete'];
      return this;
    }
    then(resolve) {
      let values = (tables[this.table] || []).filter((row) =>
        this.filters.every((filter) => filter(row)),
      );
      if (this.mutation) {
        calls.push({ table: this.table, mutation: this.mutation });
        const [kind, input] = this.mutation;
        if (kind === 'insert' || kind === 'upsert') {
          const existing =
            kind === 'upsert' && tables[this.table].find((row) => row.username === input.username);
          const row = existing || { id: randomUUID() };
          Object.assign(row, input);
          if (!existing) tables[this.table].push(row);
          values = [row];
        } else if (kind === 'update') values.forEach((row) => Object.assign(row, input));
        else tables[this.table] = tables[this.table].filter((row) => !values.includes(row));
      }
      if (this.window) values = values.slice(this.window[0], this.window[1] + 1);
      return Promise.resolve({
        data: this.singleRow ? values[0] || null : values,
        error: null,
      }).then(resolve);
    }
  }
  const db = {
    from: (table) => new Query(table),
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: { ok: true }, error: null };
    },
  };
  return {
    db,
    tables,
    calls,
    service: createLearningPlatform({ db, now: () => new Date('2026-10-09T22:00:00Z') }),
  };
}

test('employee security role can learn but every unrelated API and management mutation is forbidden', () => {
  const allowed = (role, path, method = 'GET') => {
    let passed = false;
    const res = {
      status() {
        return this;
      },
      json() {
        return this;
      },
    };
    adminMutationRoleMiddleware({ admin: { role }, path, method }, res, () => {
      passed = true;
    });
    return passed;
  };
  for (const path of [
    '/customers',
    '/orders',
    '/kitchen',
    '/settings',
    '/access',
    '/scope',
    '/staff/catalog',
  ])
    assert.equal(allowed('employee', path), false, path);
  for (const role of ['employee', 'cashier', 'courier', 'viewer', 'franchisee']) {
    assert.equal(allowed(role, '/learning/me'), true, role);
    assert.equal(allowed(role, `/learning/attempts/${randomUUID()}/submit`, 'POST'), true, role);
    assert.equal(allowed(role, '/learning/manage/courses', 'POST'), false, role);
  }
  assert.equal(allowed('employee', '/learning/me', 'DELETE'), false);
  assert.equal(allowed('employee', '/session'), true);
});

test('learner contracts reject forged grades, duplicate answers and destructive patch defaults', () => {
  assert.deepEqual(c.coursePatch.parse({ title: 'Новое название' }), { title: 'Новое название' });
  assert.deepEqual(c.assessmentPatch.parse({ published: false }), { published: false });
  assert.deepEqual(c.rolePatch.parse({ active: false }), { active: false });
  assert.equal(c.submitAttempt.safeParse({ answers: [], passed: true }).success, false);
  const answer = { questionId: randomUUID(), choiceId: randomUUID() };
  assert.equal(c.submitAttempt.safeParse({ answers: [answer, answer] }).success, false);
  assert.equal(c.employeePatch.safeParse({ startDate: '2026-02-30' }).success, false);
  assert.equal(c.employeePatch.safeParse({ securityRole: 'owner' }).success, false);
  assert.equal(
    c.assignmentCreate.safeParse({
      employeeUsername: 'learner',
      roleId: randomUUID(),
      courseId: randomUUID(),
    }).success,
    false,
  );
});

test('cabinet reports real XP and bakery-day tenure; disabled access cannot read the catalog', async () => {
  const f = fixture({
    learning_achievements: [
      {
        id: randomUUID(),
        username: 'learner',
        code: 'course:test',
        title: 'Курс завершён',
        xp: 50,
        earned_at: '2026-10-09T10:00:00Z',
      },
      {
        id: randomUUID(),
        username: 'learner',
        code: 'assessment:test',
        title: 'Тест сдан',
        xp: 50,
        earned_at: '2026-10-09T11:00:00Z',
      },
    ],
  });
  const cabinet = await f.service.me(admin);
  assert.equal(cabinet.profile.tenureDays, 1, 'Kazakhstan has already reached October 10');
  assert.equal(cabinet.progress.xp, 100);
  assert.equal(cabinet.progress.level, 2);
  assert.equal(cabinet.progress.completedCourses, 1);
  f.tables.learning_employee_profiles[0].learning_enabled = false;
  await assert.rejects(
    f.service.catalog(admin),
    (error) => error.code === 'LEARNING_ACCESS_DISABLED',
  );
  assert.equal((await f.service.me(admin)).profile.learningEnabled, false);
});

test('authenticated environment owner gets a canonical account before learning history; missing ordinary accounts fail closed', async () => {
  const f = fixture();
  const result = await f.service.me({ sub: 'configured-owner', role: 'owner', branchIds: [] });
  assert.equal(result.profile.learningEnabled, true);
  assert.deepEqual(
    f.calls.map((call) => call.table),
    ['admin_user_profiles', 'learning_employee_profiles'],
  );
  assert.equal(
    f.tables.admin_user_profiles.find((row) => row.username === 'configured-owner').role,
    'owner',
  );
  await assert.rejects(
    f.service.me({ sub: 'deleted-staff', role: 'operator' }),
    (error) => error.code === 'LEARNING_ACCOUNT_INACTIVE',
  );
});

test('null job role never matches another employee assignment; catalog and attempts do not leak answer keys', async () => {
  const courseId = randomUUID();
  const testId = randomUUID();
  const roleId = randomUUID();
  const choiceId = randomUUID();
  const question = {
    id: randomUUID(),
    prompt: 'Вопрос',
    choices: [{ id: choiceId, text: 'Ответ' }],
    correctChoiceId: choiceId,
    explanation: 'private explanation',
  };
  const f = fixture({
    learning_courses: [
      { id: courseId, title: 'Чужой курс', role_ids: [roleId], published: true, modules: [] },
    ],
    learning_assignments: [
      { id: randomUUID(), employee_username: 'other', role_id: null, course_id: courseId },
    ],
    learning_assessments: [
      { id: testId, title: 'Общий тест', role_ids: [], published: true, questions: [question] },
    ],
    learning_attempts: [
      {
        id: testId,
        username: 'learner',
        assessment_id: testId,
        title: 'Тест',
        kind: 'control',
        status: 'in_progress',
        pass_percent: 80,
        questions: [question],
      },
    ],
  });
  const catalog = await f.service.catalog(admin);
  assert.equal(catalog.courses.length, 0);
  assert.equal(catalog.assessments.length, 1);
  assert.equal(Object.hasOwn(catalog.assessments[0], 'questions'), false);
  const result = await f.service.attempt(admin, testId);
  assert.deepEqual(result.attempt.questions[0], {
    id: question.id,
    prompt: 'Вопрос',
    choices: [{ id: choiceId, text: 'Ответ' }],
  });
  assert.doesNotMatch(JSON.stringify(result), /correctChoiceId|explanation/);
  f.tables.admin_user_profiles.push({
    username: 'other',
    role: 'employee',
    active: true,
    branch_ids: [OTHER],
  });
  f.tables.learning_employee_profiles.push({
    username: 'other',
    learning_enabled: true,
    job_role_id: null,
  });
  await assert.rejects(
    f.service.attempt({ ...admin, sub: 'other' }, testId),
    (error) => error.code === 'LEARNING_ATTEMPT_NOT_FOUND',
  );
});

test('cabinet, attempt details and manager results expire abandoned attempts at server time without changing history', async () => {
  const rows = [
    { status: 'in_progress', deadline_at: '2026-10-09T21:59:59Z', expected: 'expired' },
    { status: 'in_progress', deadline_at: '2026-10-09T22:00:00Z', expected: 'expired' },
    { status: 'in_progress', deadline_at: '2026-10-09T22:00:01Z', expected: 'in_progress' },
    { status: 'submitted', deadline_at: '2026-10-09T21:59:59Z', expected: 'submitted' },
  ].map(({ expected, ...row }) => ({
    expected,
    stored: {
      ...row,
      id: randomUUID(),
      username: 'learner',
      assessment_id: randomUUID(),
      title: 'Контрольный тест',
      kind: 'control',
      started_at: '2026-10-09T21:30:00Z',
      pass_percent: 80,
      questions: [],
      ...(row.status === 'submitted'
        ? { correct_count: 2, question_count: 2, xp_awarded: 50, passed: true, score_percent: 100 }
        : {}),
    },
  }));
  const f = fixture({ learning_attempts: rows.map((row) => row.stored) });
  const cabinet = await f.service.me(admin);
  const managed = await f.service.results({
    sub: 'manager',
    role: 'branch_manager',
    branchIds: [BRANCH],
  });
  for (const { stored, expected } of rows) {
    assert.equal(cabinet.attempts.find((attempt) => attempt.id === stored.id).status, expected);
    assert.equal(managed.results.find((attempt) => attempt.id === stored.id).status, expected);
    assert.equal((await f.service.attempt(admin, stored.id)).attempt.status, expected);
  }
  assert.deepEqual(
    f.tables.learning_attempts.map((attempt) => attempt.status),
    ['in_progress', 'in_progress', 'in_progress', 'submitted'],
    'Read-time expiration preserves immutable stored attempt history',
  );
  assert.deepEqual(cabinet.attempts.find((attempt) => attempt.status === 'submitted').result, {
    correctCount: 2,
    questionCount: 2,
    xpAwarded: 50,
  });
  assert.deepEqual(f.calls, [], 'Reading expired attempts must not write results or XP');
});

test('branch managers cannot alter an employee assigned outside their scope; learner RPC identity is server-owned', async () => {
  const f = fixture();
  f.tables.admin_user_profiles[0].branch_ids = [BRANCH, OTHER];
  await assert.rejects(
    f.service.patchEmployee(
      { sub: 'manager', role: 'branch_manager', branchIds: [BRANCH] },
      'learner',
      { learningEnabled: false },
    ),
    (error) => error.code === 'LEARNING_EMPLOYEE_NOT_FOUND',
  );
  assert.equal(f.calls.length, 0);
  const lessonId = randomUUID();
  await f.service.completeLesson(admin, lessonId);
  assert.deepEqual(f.calls[0], {
    name: 'learning_complete_lesson',
    args: { p_username: 'learner', p_lesson_id: lessonId },
  });
  await assert.rejects(
    f.service.saveRole(admin, null, { title: 'Owner' }),
    (error) => error.code === 'LEARNING_MANAGEMENT_FORBIDDEN',
  );
});

test('employee passwords preserve employee authority and hashes; cashier branch requirements stay intact', async () => {
  const f = fixture();
  const returned = {
    username: 'worker.one',
    role: 'employee',
    branch_ids: [],
    active: true,
    auth_version: 2,
    password_hash: HASH,
  };
  const calls = [];
  f.db.rpc = async (name, args) => {
    calls.push({ name, args });
    return { data: name === 'get_cashier_auth_record' ? returned : true, error: null };
  };
  const bcryptImpl = { compare: async () => true, hash: async () => HASH };
  assert.deepEqual(
    await credentials.authenticateCashier('worker.one', 'SecurePass2026', { db: f.db, bcryptImpl }),
    {
      username: 'worker.one',
      role: 'employee',
      branchIds: [],
      authVersion: 2,
    },
  );
  returned.role = 'owner';
  assert.equal(
    await credentials.authenticateCashier('worker.one', 'SecurePass2026', { db: f.db, bcryptImpl }),
    null,
  );
  returned.role = 'cashier';
  assert.equal(
    await credentials.authenticateCashier('worker.one', 'SecurePass2026', { db: f.db, bcryptImpl }),
    null,
  );
  await credentials.createEmployeeAccess(
    {
      username: 'Worker.One',
      displayName: 'Работник',
      branchIds: [BRANCH, OTHER],
      password: 'SecurePass2026',
    },
    { db: f.db, bcryptImpl },
  );
  await credentials.resetEmployeePassword('worker.one', 'NewSecurePass2027', {
    db: f.db,
    bcryptImpl,
  });
  await credentials.updateEmployeeAccess(
    { username: 'worker.one', displayName: 'Работник', branchIds: [], active: false },
    { db: f.db },
  );
  assert.equal(calls[3].name, 'create_employee_access');
  assert.equal(calls[3].args.p_password_hash, HASH);
  assert.equal(calls[4].name, 'reset_employee_password');
  assert.equal(calls[5].name, 'update_employee_access');
  assert.doesNotMatch(JSON.stringify(calls), /SecurePass2026|NewSecurePass2027/);
});

test('password employee sessions require the current credential version and immutable security role', async () => {
  const tables = {
    admin_sessions: [
      {
        admin_subject: 'learner',
        role: 'employee',
        branch_ids: [],
        auth_version: 2,
        expires_at: 'infinity',
        revoked_at: null,
      },
    ],
    admin_user_profiles: [{ username: 'learner', role: 'employee', branch_ids: [], active: true }],
    admin_staff_credentials: [{ username: 'learner', auth_version: 2 }],
  };
  const db = {
    from(table) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: tables[table][0] || null, error: null };
        },
      };
    },
  };
  const payload = { sub: 'learner', jti: randomUUID(), role: 'employee' };
  assert.equal((await validateAdminSession(payload, { db, useLocal: false })).role, 'employee');
  tables.admin_staff_credentials[0].auth_version = 3;
  assert.equal(await validateAdminSession(payload, { db, useLocal: false }), null);
  tables.admin_staff_credentials[0].auth_version = 2;
  tables.admin_user_profiles[0].role = 'cashier';
  assert.equal(await validateAdminSession(payload, { db, useLocal: false }), null);
  tables.admin_user_profiles = [];
  assert.equal(await validateAdminSession(payload, { db, useLocal: false }), null);
});

test('single-field course edits retain curriculum and normalize tied lesson order without publishing empty content', async () => {
  const courseId = randomUUID();
  const lessons = [0, 1].map((index) => ({
    id: randomUUID(),
    title: `Урок ${index + 1}`,
    body: 'Содержание',
    videoUrl: null,
    estimatedMinutes: 5,
    sortOrder: 0,
  }));
  const f = fixture({
    learning_courses: [
      {
        id: courseId,
        title: 'Курс',
        description: 'Описание',
        role_ids: [],
        published: true,
        modules: [{ id: randomUUID(), title: 'Модуль', sortOrder: 0, lessons }],
      },
    ],
  });
  const result = await f.service.saveCourse(
    { sub: 'owner', role: 'owner' },
    courseId,
    c.coursePatch.parse({ title: 'Новый курс' }),
  );
  assert.equal(result.course.description, 'Описание');
  assert.equal(result.course.published, true);
  assert.deepEqual(
    result.course.modules[0].lessons.map((lesson) => lesson.id),
    lessons.map((lesson) => lesson.id),
  );
  assert.deepEqual(
    result.course.modules[0].lessons.map((lesson) => lesson.sortOrder),
    [0, 1],
  );
  await assert.rejects(
    f.service.saveCourse(
      { sub: 'owner', role: 'owner' },
      null,
      c.courseCreate.parse({ title: 'Пустой', published: true }),
    ),
    (error) => error.code === 'LEARNING_EMPTY_COURSE',
  );
});
