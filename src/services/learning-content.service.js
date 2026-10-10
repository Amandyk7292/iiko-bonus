const crypto = require('node:crypto');
const d = require('./learning-data.service');

function createLearningContent({ db, now, getRoles, getCourses, getAssessments }) {
  async function roles(admin) {
    d.requireContentManager(admin);
    return { roles: (await getRoles()).map(d.roleFor) };
  }
  async function saveRole(admin, id, input) {
    d.requireContentManager(admin);
    if (id && !(await d.one(db, 'learning_job_roles', 'id', id)))
      d.fail(404, 'LEARNING_ROLE_NOT_FOUND', 'Учебная должность не найдена.');
    const value = {
      ...(id ? {} : { id: crypto.randomUUID() }),
      ...input,
      updated_at: now().toISOString(),
    };
    const query = id
      ? db.from('learning_job_roles').update(value).eq('id', id)
      : db.from('learning_job_roles').insert(value);
    return { role: d.roleFor(d.check(await query.select('*').single())) };
  }
  async function courses(admin) {
    d.requireContentManager(admin);
    return { courses: (await getCourses()).map(d.courseFor) };
  }
  async function checkRoles(roleIds, published) {
    const available = await getRoles();
    if (
      roleIds.some((id) => !available.some((role) => role.id === id && (!published || role.active)))
    )
      d.fail(400, 'LEARNING_ROLE_NOT_FOUND', 'Одна из учебных должностей недоступна.');
  }
  async function saveCourse(admin, id, input) {
    d.requireContentManager(admin);
    const existing = id ? await d.one(db, 'learning_courses', 'id', id) : null;
    if (id && !existing) d.fail(404, 'LEARNING_COURSE_UNAVAILABLE', 'Курс не найден.');
    const value = { ...(existing ? d.courseFor(existing) : {}), ...input };
    const modules = d.ensureIds(value.modules || []);
    const lessonIds = modules.flatMap((module) => module.lessons.map((lesson) => lesson.id));
    if (value.published && (!modules.length || modules.some((module) => !module.lessons.length)))
      d.fail(400, 'LEARNING_EMPTY_COURSE', 'Перед публикацией добавьте уроки в каждый модуль.');
    await checkRoles(value.roleIds || [], value.published);
    const otherCourses = (await getCourses()).filter((course) => course.id !== id);
    const otherIds = new Set(
      otherCourses.flatMap((course) =>
        (course.modules || []).flatMap((module) => [
          module.id,
          ...(module.lessons || []).map((lesson) => lesson.id),
        ]),
      ),
    );
    if (
      modules.some((module) => otherIds.has(module.id)) ||
      lessonIds.some((lessonId) => otherIds.has(lessonId))
    )
      d.fail(
        400,
        'LEARNING_CONTENT_ID_CONFLICT',
        'Идентификатор урока уже используется в другом курсе.',
      );
    const saved = {
      title: value.title,
      description: value.description || '',
      role_ids: value.roleIds || [],
      published: Boolean(value.published),
      modules,
      updated_at: now().toISOString(),
      ...(id ? {} : { id: crypto.randomUUID() }),
    };
    const query = id
      ? db.from('learning_courses').update(saved).eq('id', id)
      : db.from('learning_courses').insert(saved);
    return { course: d.courseFor(d.check(await query.select('*').single())) };
  }
  async function assessments(admin) {
    d.requireContentManager(admin);
    return { assessments: (await getAssessments()).map((value) => d.assessmentFor(value, true)) };
  }
  async function saveAssessment(admin, id, input) {
    d.requireContentManager(admin);
    const existing = id ? await d.one(db, 'learning_assessments', 'id', id) : null;
    if (id && !existing) d.fail(404, 'LEARNING_ASSESSMENT_UNAVAILABLE', 'Тест не найден.');
    const value = { ...(existing ? d.assessmentFor(existing, true) : {}), ...input };
    await checkRoles(value.roleIds || [], value.published);
    const roles = await getRoles();
    if (value.kind === 'promotion') {
      if (
        !value.targetRoleId ||
        !roles.some((role) => role.id === value.targetRoleId && role.active)
      )
        d.fail(400, 'LEARNING_TARGET_ROLE_INACTIVE', 'Выберите доступную должность для повышения.');
    } else if (value.targetRoleId)
      d.fail(
        400,
        'LEARNING_INVALID_TARGET_ROLE',
        'Должность для повышения указывается только в экзамене на повышение.',
      );
    const courses = await getCourses();
    if (
      (value.requiredCourseIds || []).some(
        (courseId) =>
          !courses.some(
            (course) => course.id === courseId && (!value.published || course.published),
          ),
      )
    )
      d.fail(400, 'LEARNING_PREREQUISITE_NOT_FOUND', 'Один из обязательных курсов недоступен.');
    const seen = new Set();
    const questions = (value.questions || []).map((question) => {
      const questionId = question.id || crypto.randomUUID();
      if (seen.has(questionId))
        d.fail(
          400,
          'LEARNING_DUPLICATE_QUESTION_ID',
          'Вопросы должны иметь разные идентификаторы.',
        );
      seen.add(questionId);
      const choiceIds = question.choices.map((choice) => choice.id);
      if (
        new Set(choiceIds).size !== choiceIds.length ||
        choiceIds.includes(questionId) ||
        choiceIds.some((choiceId) => seen.has(choiceId))
      )
        d.fail(
          400,
          'LEARNING_DUPLICATE_CHOICE_ID',
          'Варианты ответа должны иметь разные идентификаторы.',
        );
      for (const choiceId of choiceIds) seen.add(choiceId);
      return { ...question, id: questionId };
    });
    if (value.published && questions.length < value.questionCount)
      d.fail(
        400,
        'LEARNING_QUESTION_BANK_INSUFFICIENT',
        'В банке недостаточно вопросов для публикации теста.',
      );
    const saved = {
      title: value.title,
      description: value.description || '',
      kind: value.kind,
      role_ids: value.roleIds || [],
      published: Boolean(value.published),
      question_count: value.questionCount,
      max_attempts: value.maxAttempts,
      pass_percent: value.passPercent,
      time_limit_minutes: value.timeLimitMinutes,
      cooldown_minutes: value.cooldownMinutes || 0,
      minimum_tenure_days: value.minimumTenureDays || 0,
      required_course_ids: value.requiredCourseIds || [],
      target_role_id: value.targetRoleId || null,
      questions,
      updated_at: now().toISOString(),
      ...(id ? {} : { id: crypto.randomUUID() }),
    };
    const query = id
      ? db.from('learning_assessments').update(saved).eq('id', id)
      : db.from('learning_assessments').insert(saved);
    return { assessment: d.assessmentFor(d.check(await query.select('*').single()), true) };
  }
  return { roles, saveRole, courses, saveCourse, assessments, saveAssessment };
}

module.exports = { createLearningContent };
