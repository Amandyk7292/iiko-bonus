const crypto = require('node:crypto');
const { publicError } = require('../utils/app-error.util');
const { branchScopeForAdmin } = require('../utils/admin-scope.util');

const subject = (admin) => String(admin?.sub || admin?.username || '');
const contentManager = (admin) => ['owner', 'admin'].includes(admin?.role);
const manager = (admin) => contentManager(admin) || admin?.role === 'branch_manager';
const fail = (status, code, message) => {
  throw publicError(status, code, message);
};
const requireContentManager = (admin) => {
  if (!contentManager(admin))
    fail(
      403,
      'LEARNING_MANAGEMENT_FORBIDDEN',
      'Недостаточно прав для изменения учебных материалов.',
    );
};
const requireManager = (admin) => {
  if (!manager(admin))
    fail(403, 'LEARNING_MANAGEMENT_FORBIDDEN', 'Недостаточно прав для управления обучением.');
};
const inScope = (admin, account) => {
  if (contentManager(admin)) return true;
  const scope = branchScopeForAdmin(admin);
  const branches = account?.branch_ids || [];
  return branches.length > 0 && branches.every((id) => scope.includes(id));
};
const check = (result) => {
  if (result.error) {
    if (result.error.code === '23505')
      fail(409, 'LEARNING_ALREADY_EXISTS', 'Запись уже существует.');
    fail(503, 'LEARNING_DATABASE_UNAVAILABLE', 'Обучение временно недоступно. Попробуйте ещё раз.');
  }
  return result.data;
};
async function rows(db, table, columns = '*', filter = (query) => query) {
  const result = [];
  for (let offset = 0; offset <= 20000; offset += 500) {
    const data = check(await filter(db.from(table).select(columns)).range(offset, offset + 499));
    if (!Array.isArray(data))
      fail(503, 'LEARNING_DATABASE_UNAVAILABLE', 'Обучение временно недоступно.');
    result.push(...data);
    if (result.length > 20000)
      fail(503, 'LEARNING_DATA_LIMIT', 'Слишком много записей. Уточните выборку.');
    if (data.length < 500) return result;
  }
  return result;
}
const one = async (db, table, key, value) =>
  check(await db.from(table).select('*').eq(key, value).maybeSingle());
const roleFor = (row) =>
  row && { id: row.id, title: row.title, description: row.description, active: row.active };
const courseFor = (row) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  roleIds: row.role_ids || [],
  published: row.published,
  modules: row.modules || [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const assessmentFor = (row, privateBank = false) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  kind: row.kind,
  roleIds: row.role_ids || [],
  published: row.published,
  questionCount: row.question_count,
  maxAttempts: row.max_attempts,
  passPercent: Number(row.pass_percent),
  timeLimitMinutes: row.time_limit_minutes,
  cooldownMinutes: row.cooldown_minutes,
  minimumTenureDays: row.minimum_tenure_days,
  requiredCourseIds: row.required_course_ids || [],
  targetRoleId: row.target_role_id,
  ...(privateBank ? { questions: row.questions || [] } : {}),
});
const assignmentFor = (row) => ({
  id: row.id,
  employeeUsername: row.employee_username,
  roleId: row.role_id,
  courseId: row.course_id,
  assessmentId: row.assessment_id,
  required: row.required,
  dueAt: row.due_at,
  createdAt: row.created_at,
});
const achievementFor = (row) => ({
  id: row.id,
  code: row.code,
  title: row.title,
  xp: row.xp,
  earnedAt: row.earned_at,
});
const businessDate = (instant) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Almaty',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const publicQuestion = (question) => ({
  id: question.id,
  prompt: question.prompt,
  choices: (question.choices || []).map((choice) => ({ id: choice.id, text: choice.text })),
});
const attemptFor = (row, now = new Date()) => ({
  id: row.id,
  assessmentId: row.assessment_id,
  title: row.title,
  kind: row.kind,
  status:
    row.status === 'in_progress' && Date.parse(row.deadline_at) <= now.getTime()
      ? 'expired'
      : row.status,
  startedAt: row.started_at,
  deadlineAt: row.deadline_at,
  submittedAt: row.submitted_at,
  scorePercent: row.score_percent == null ? null : Number(row.score_percent),
  passed: row.passed,
  passPercent: Number(row.pass_percent),
  targetRoleId: row.target_role_id,
  promotionDecision: row.promotion_decision,
  questions: (row.questions || []).map(publicQuestion),
  ...(row.answers ? { answers: row.answers } : {}),
  ...(row.status === 'submitted'
    ? {
        result: {
          correctCount: row.correct_count,
          questionCount: row.question_count,
          xpAwarded: row.xp_awarded,
        },
      }
    : {}),
});
function profileFor(account, profile, roles, now = new Date()) {
  const date = businessDate(now);
  return {
    username: account.username,
    displayName: account.display_name || account.username,
    securityRole: account.role,
    branchIds: account.branch_ids || [],
    jobRoleId: profile?.job_role_id || null,
    jobRole: roleFor(roles.find((role) => role.id === profile?.job_role_id)) || null,
    startDate: profile?.start_date || null,
    tenureDays: profile?.start_date
      ? Math.max(0, Math.floor((Date.parse(date) - Date.parse(profile.start_date)) / 86400000))
      : null,
    learningEnabled: Boolean(profile?.learning_enabled),
  };
}
function progressFor(progress, achievements) {
  const xp = achievements.reduce((sum, item) => sum + Number(item.xp), 0);
  return {
    xp,
    level: 1 + Math.floor(xp / 100),
    completedLessons: progress.length,
    completedCourses: achievements.filter((item) => item.code.startsWith('course:')).length,
    lessons: progress.map((row) => ({
      lessonId: row.lesson_id,
      courseId: row.course_id,
      completedAt: row.completed_at,
    })),
  };
}
const allowed = (item, profile, assignments, key) =>
  !item.role_ids?.length ||
  item.role_ids.includes(profile.job_role_id) ||
  assignments.some(
    (assignment) =>
      assignment[key] === item.id &&
      (assignment.employee_username === profile.username ||
        (assignment.role_id && assignment.role_id === profile.job_role_id)),
  );
const ensureIds = (modules) => {
  const used = new Set();
  const id = (value) => {
    const result = value || crypto.randomUUID();
    if (used.has(result))
      fail(
        400,
        'LEARNING_DUPLICATE_CONTENT_ID',
        'Идентификаторы уроков и модулей должны различаться.',
      );
    used.add(result);
    return result;
  };
  return [...modules]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((module, moduleIndex) => ({
      ...module,
      id: id(module.id),
      sortOrder: moduleIndex,
      lessons: [...module.lessons]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((lesson, index) => ({
          ...lesson,
          id: id(lesson.id),
          sortOrder: index,
        })),
    }));
};
const rpcErrors = {
  LEARNING_ACCESS_DISABLED: [403, 'Доступ к обучению отключён. Обратитесь к администратору.'],
  LEARNING_ACCOUNT_INACTIVE: [403, 'Учётная запись отключена.'],
  LEARNING_ROLE_INACTIVE: [403, 'Учебная должность недоступна.'],
  LEARNING_LESSON_NOT_FOUND: [404, 'Урок недоступен.'],
  LEARNING_COURSE_UNAVAILABLE: [404, 'Курс недоступен.'],
  LEARNING_ASSESSMENT_UNAVAILABLE: [404, 'Тест недоступен.'],
  LEARNING_PREREQUISITES: [409, 'Сначала завершите обязательные курсы.'],
  LEARNING_LESSON_LOCKED: [409, 'Сначала завершите предыдущие уроки курса.'],
  LEARNING_TENURE_REQUIRED: [409, 'Для экзамена недостаточно подтверждённого стажа.'],
  LEARNING_MAX_ATTEMPTS: [409, 'Доступные попытки использованы.'],
  LEARNING_COOLDOWN: [409, 'Следующая попытка пока недоступна.'],
  LEARNING_ATTEMPT_NOT_FOUND: [404, 'Попытка не найдена.'],
  LEARNING_ATTEMPT_EXPIRED: [410, 'Время прохождения теста истекло.'],
  LEARNING_INVALID_ANSWERS: [400, 'Ответьте на каждый вопрос выбранным вариантом.'],
  LEARNING_SUBMISSION_CONFLICT: [409, 'Результат этой попытки уже сохранён.'],
  LEARNING_PROMOTION_CONFLICT: [
    409,
    'Для повышения требуется сданный экзамен без прежнего решения.',
  ],
  LEARNING_PROMOTION_FORBIDDEN: [403, 'Недостаточно прав для подтверждения повышения.'],
  LEARNING_TARGET_ROLE_INACTIVE: [409, 'Должность для повышения недоступна.'],
  LEARNING_INVALID_DECISION: [400, 'Некорректное решение по повышению.'],
};
async function rpc(db, name, args) {
  const result = check(await db.rpc(name, args));
  if (result?.error) {
    const [status, message] = rpcErrors[result.error] || [409, 'Действие недоступно.'];
    fail(status, result.error, message);
  }
  return result;
}

module.exports = {
  subject,
  contentManager,
  manager,
  fail,
  requireManager,
  requireContentManager,
  inScope,
  check,
  rows,
  one,
  roleFor,
  courseFor,
  assessmentFor,
  assignmentFor,
  achievementFor,
  attemptFor,
  profileFor,
  progressFor,
  allowed,
  ensureIds,
  rpc,
  businessDate,
};
