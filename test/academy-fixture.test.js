const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { startAcademyFixture } = require('./fixtures/academy-server.cjs');

test('synthetic browser fixture exercises real employee access, content, grading, XP and scoped promotion', async (t) => {
  const fixture = await startAcademyFixture({ port: 0 });
  t.after(() => fixture.close());
  const origin = `http://127.0.0.1:${fixture.port}`;
  const login = async (account) => {
    const response = await fetch(`${origin}/__fixture/login/${account}`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const request = async (cookie, url, method = 'GET', body, { csrf = true } = {}) => {
    const response = await fetch(`${origin}/admin/api${url}`, {
      method,
      headers: { cookie, ...(csrf ? { origin } : {}), 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    return { status: response.status, ...result };
  };
  const owner = await login('owner');
  const state = await (await fetch(`${origin}/__fixture/state`)).json();
  const createBody = {
    username: 'qa-worker',
    displayName: 'Синтетический работник QA',
    role: 'employee',
    branchIds: [state.branches[0].id],
    password: 'SyntheticEmployee123',
  };
  assert.equal((await request(owner, '/access', 'POST', createBody, { csrf: false })).status, 403);
  const created = await request(owner, '/access', 'POST', createBody);
  assert.equal(created.status, 201, JSON.stringify(created));
  assert.equal(created.profile.role, 'employee');
  assert.equal(created.profile.authMethod, 'password');
  const roles = await request(owner, '/learning/manage/roles');
  const cashier = roles.roles.find((role) => role.title === 'Кассир');
  const target = (
    await request(owner, '/learning/manage/roles', 'POST', {
      title: 'Учебная должность QA',
      description: 'Синтетическое повышение',
      active: true,
    })
  ).role;
  const patched = await request(owner, '/learning/manage/employees/qa-worker', 'PATCH', {
    jobRoleId: cashier.id,
    startDate: '2020-01-01',
    learningEnabled: true,
  });
  assert.equal(patched.status, 200, JSON.stringify(patched));
  const courseResult = await request(owner, '/learning/manage/courses', 'POST', {
    title: 'QA настоящий курс',
    description: 'Учебный материал',
    roleIds: [],
    published: true,
    modules: [
      {
        title: 'Модуль QA',
        lessons: [
          { title: 'Первый урок', body: 'Первое действие.' },
          { title: 'Второй урок', body: 'Второе действие.' },
        ],
      },
    ],
  });
  assert.equal(courseResult.status, 200, JSON.stringify(courseResult));
  const course = courseResult.course;
  const edited = await request(owner, `/learning/manage/courses/${course.id}`, 'PATCH', {
    description: 'Изменённый материал',
  });
  assert.equal(edited.course.modules[0].lessons.length, 2);
  assert.equal(edited.course.published, true);
  const assignment = await request(owner, '/learning/manage/assignments', 'POST', {
    employeeUsername: 'qa-worker',
    courseId: course.id,
  });
  assert.equal(assignment.status, 200, JSON.stringify(assignment));
  const bank = Array.from({ length: 3 }, (_, index) => {
    const choices = [
      { id: randomUUID(), text: `Утверждённый ответ ${index}` },
      { id: randomUUID(), text: 'Неверный вариант' },
    ];
    return { id: randomUUID(), prompt: `Вопрос ${index}`, choices, correctChoiceId: choices[0].id };
  });
  const assessmentResult = await request(owner, '/learning/manage/assessments', 'POST', {
    title: 'QA экзамен',
    kind: 'promotion',
    roleIds: [],
    published: true,
    questionCount: 2,
    maxAttempts: 3,
    passPercent: 80,
    timeLimitMinutes: 10,
    minimumTenureDays: 30,
    requiredCourseIds: [course.id],
    targetRoleId: target.id,
    questions: bank,
  });
  assert.equal(assessmentResult.status, 200, JSON.stringify(assessmentResult));
  const assessment = assessmentResult.assessment;
  // Actual password verifier checks the real SQL credential record and bcrypt.
  const loginResponse = await fetch(`${origin}/admin/api/login`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'qa-worker', password: createBody.password }),
  });
  assert.equal(loginResponse.status, 200);
  const employee = loginResponse.headers.get('set-cookie').split(';')[0];
  assert.equal((await request(employee, '/access')).status, 403);
  assert.equal((await request(employee, '/scope')).status, 403);
  assert.equal((await request(employee, '/learning/manage/dashboard')).status, 403);
  const catalog = await request(employee, '/learning/catalog');
  assert.ok(catalog.courses.some((value) => value.id === course.id));
  assert.equal(
    (await request(employee, `/learning/assessments/${assessment.id}/attempts`, 'POST', {})).code,
    'LEARNING_PREREQUISITES',
  );
  const [first, second] = course.modules[0].lessons;
  const outOfOrder = await request(employee, `/learning/lessons/${second.id}/progress`, 'POST', {
    completed: true,
  });
  assert.equal(outOfOrder.code, 'LEARNING_LESSON_LOCKED');
  const complete = (id) =>
    request(employee, `/learning/lessons/${id}/progress`, 'POST', { completed: true });
  assert.equal((await complete(first.id)).progress.xp, 10);
  assert.equal((await complete(first.id)).progress.xp, 10);
  assert.equal((await complete(second.id)).progress.xp, 70);
  const started = await request(
    employee,
    `/learning/assessments/${assessment.id}/attempts`,
    'POST',
    {},
  );
  assert.equal(started.status, 200, JSON.stringify(started));
  const attempt = started.attempt;
  assert.equal(attempt.questions.length, 2);
  assert.ok(
    attempt.questions.every(
      (question) => !('correctChoiceId' in question) && !('explanation' in question),
    ),
  );
  const answers = attempt.questions.map((question) => ({
    questionId: question.id,
    choiceId: bank.find((value) => value.id === question.id).correctChoiceId,
  }));
  const submit = () =>
    request(employee, `/learning/attempts/${attempt.id}/submit`, 'POST', { answers });
  const graded = await submit();
  assert.equal(graded.status, 200, JSON.stringify(graded));
  assert.equal(graded.attempt.passed, true);
  assert.equal(graded.attempt.scorePercent, 100);
  assert.equal(graded.progress.xp, 170);
  assert.equal((await submit()).progress.xp, 170);
  const foreignManager = await login('foreign-manager');
  assert.equal(
    (
      await request(
        foreignManager,
        `/learning/manage/attempts/${attempt.id}/promotion-decision`,
        'POST',
        { decision: 'approved' },
      )
    ).status,
    404,
  );
  const manager = await login('manager');
  const decision = await request(
    manager,
    `/learning/manage/attempts/${attempt.id}/promotion-decision`,
    'POST',
    { decision: 'approved' },
  );
  assert.equal(decision.status, 200, JSON.stringify(decision));
  const me = await request(employee, '/learning/me');
  assert.equal(me.profile.jobRoleId, target.id);
  const access = await request(owner, '/access');
  assert.equal(
    access.profiles.find((profile) => profile.username === 'qa-worker').role,
    'employee',
  );
  assert.ok(
    fixture.requests.some(
      (entry) => entry.path.endsWith('/promotion-decision') && entry.status === 200,
    ),
  );
  assert.ok(fixture.requests.every((entry) => !('body' in entry) && !('headers' in entry)));
});
