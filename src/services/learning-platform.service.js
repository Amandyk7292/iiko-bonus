const { supabase } = require('../config/supabase');
const d = require('./learning-data.service');

function createLearningPlatform({ db = supabase, now = () => new Date() } = {}) {
  const getRoles = () => d.rows(db, 'learning_job_roles', '*', (query) => query.order('title'));
  const getCourses = () =>
    d.rows(db, 'learning_courses', '*', (query) => query.order('created_at'));
  const getAssessments = () =>
    d.rows(db, 'learning_assessments', '*', (query) => query.order('created_at'));
  const getAssignments = () =>
    d.rows(db, 'learning_assignments', '*', (query) => query.order('created_at'));
  const getAccounts = () =>
    d.rows(db, 'admin_user_profiles', 'username,display_name,role,branch_ids,active', (query) =>
      query.order('username'),
    );
  const getProfile = (username) => d.one(db, 'learning_employee_profiles', 'username', username);
  async function self(admin, { enabled = false } = {}) {
    const username = d.subject(admin);
    if (!username) d.fail(401, 'LEARNING_AUTH_REQUIRED', 'Войдите в кабинет сотрудника.');
    let account = await d.one(db, 'admin_user_profiles', 'username', username);
    if (!account) {
      if (!d.contentManager(admin))
        d.fail(403, 'LEARNING_ACCOUNT_INACTIVE', 'Учётная запись сотрудника недоступна.');
      // Environment owners authenticate through the existing login too. Make
      // their canonical profile explicit before linking learning history.
      const created = await db
        .from('admin_user_profiles')
        .insert({
          username,
          display_name: username,
          role: admin.role,
          branch_ids: admin.branchIds || [],
          active: true,
        })
        .select('*')
        .single();
      account =
        created.error?.code === '23505'
          ? await d.one(db, 'admin_user_profiles', 'username', username)
          : d.check(created);
    }
    if (account.active === false)
      d.fail(403, 'LEARNING_ACCOUNT_INACTIVE', 'Учётная запись отключена.');
    let profile = await getProfile(username);
    if (!profile) {
      const inserted = await db
        .from('learning_employee_profiles')
        .insert({
          username,
          learning_enabled: d.contentManager(admin),
        })
        .select('*')
        .single();
      if (inserted.error?.code === '23505') profile = await getProfile(username);
      else profile = d.check(inserted);
    }
    const roles = await getRoles();
    if (enabled && !profile.learning_enabled)
      d.fail(
        403,
        'LEARNING_ACCESS_DISABLED',
        'Доступ к обучению отключён. Обратитесь к администратору.',
      );
    if (
      enabled &&
      profile.job_role_id &&
      !roles.some((role) => role.id === profile.job_role_id && role.active)
    )
      d.fail(403, 'LEARNING_ROLE_INACTIVE', 'Учебная должность недоступна.');
    return { username, account, profile, roles };
  }
  async function progress(username) {
    const [lessons, achievements] = await Promise.all([
      d.rows(db, 'learning_lesson_progress', '*', (query) =>
        query.eq('username', username).order('completed_at'),
      ),
      d.rows(db, 'learning_achievements', '*', (query) =>
        query.eq('username', username).order('earned_at'),
      ),
    ]);
    return {
      progress: d.progressFor(lessons, achievements),
      achievements: achievements.map(d.achievementFor),
    };
  }
  const personalAssignments = (values, profile) =>
    values.filter(
      (item) =>
        item.employee_username === profile.username ||
        (item.role_id && item.role_id === profile.job_role_id),
    );
  async function me(admin) {
    const current = await self(admin);
    const [state, assignments, attempts] = await Promise.all([
      progress(current.username),
      getAssignments(),
      d.rows(db, 'learning_attempts', '*', (query) =>
        query.eq('username', current.username).order('started_at', { ascending: false }),
      ),
    ]);
    return {
      profile: d.profileFor(current.account, current.profile, current.roles, now()),
      ...state,
      assignments: personalAssignments(assignments, current.profile).map(d.assignmentFor),
      attempts: attempts.map((item) => d.attemptFor(item, now())),
    };
  }
  async function catalog(admin) {
    const current = await self(admin, { enabled: true });
    const [courses, assessments, assignments] = await Promise.all([
      getCourses(),
      getAssessments(),
      getAssignments(),
    ]);
    return {
      courses: courses
        .filter(
          (item) => item.published && d.allowed(item, current.profile, assignments, 'course_id'),
        )
        .map(d.courseFor),
      assessments: assessments
        .filter(
          (item) =>
            item.published && d.allowed(item, current.profile, assignments, 'assessment_id'),
        )
        .map((item) => d.assessmentFor(item)),
    };
  }
  async function course(admin, id) {
    const current = await self(admin, { enabled: true });
    const [item, assignments, state] = await Promise.all([
      d.one(db, 'learning_courses', 'id', id),
      getAssignments(),
      progress(current.username),
    ]);
    if (!item?.published || !d.allowed(item, current.profile, assignments, 'course_id'))
      d.fail(404, 'LEARNING_COURSE_UNAVAILABLE', 'Курс недоступен.');
    return { course: d.courseFor(item), progress: state.progress };
  }
  async function completeLesson(admin, id) {
    const current = await self(admin, { enabled: true });
    await d.rpc(db, 'learning_complete_lesson', { p_username: current.username, p_lesson_id: id });
    return progress(current.username);
  }
  async function attempt(admin, id) {
    const current = await self(admin, { enabled: true });
    const item = await d.one(db, 'learning_attempts', 'id', id);
    if (!item || item.username !== current.username)
      d.fail(404, 'LEARNING_ATTEMPT_NOT_FOUND', 'Попытка не найдена.');
    return { attempt: d.attemptFor(item, now()) };
  }
  async function startAttempt(admin, id) {
    const current = await self(admin, { enabled: true });
    const result = await d.rpc(db, 'learning_start_attempt', {
      p_username: current.username,
      p_assessment_id: id,
    });
    return attempt(admin, result.attemptId);
  }
  async function submitAttempt(admin, id, input) {
    const current = await self(admin, { enabled: true });
    await d.rpc(db, 'learning_submit_attempt', {
      p_username: current.username,
      p_attempt_id: id,
      p_answers: input.answers,
    });
    const [result, state] = await Promise.all([attempt(admin, id), progress(current.username)]);
    return { ...result, ...state };
  }
  async function employees(admin) {
    d.requireManager(admin);
    const [accounts, profiles, roles, lessons, achievements] = await Promise.all([
      getAccounts(),
      d.rows(db, 'learning_employee_profiles'),
      getRoles(),
      d.rows(db, 'learning_lesson_progress'),
      d.rows(db, 'learning_achievements'),
    ]);
    return {
      employees: accounts
        .filter((account) => d.inScope(admin, account))
        .map((account) => ({
          ...d.profileFor(
            account,
            profiles.find((profile) => profile.username === account.username),
            roles,
            now(),
          ),
          progress: d.progressFor(
            lessons.filter((row) => row.username === account.username),
            achievements.filter((row) => row.username === account.username),
          ),
        })),
    };
  }
  async function employeeAccount(admin, username) {
    d.requireManager(admin);
    const account = await d.one(db, 'admin_user_profiles', 'username', username);
    if (!account || !d.inScope(admin, account))
      d.fail(404, 'LEARNING_EMPLOYEE_NOT_FOUND', 'Сотрудник не найден в области доступа.');
    return account;
  }
  async function patchEmployee(admin, username, input) {
    const account = await employeeAccount(admin, username);
    const roles = await getRoles();
    if (input.jobRoleId && !roles.some((role) => role.id === input.jobRoleId && role.active))
      d.fail(400, 'LEARNING_ROLE_NOT_FOUND', 'Учебная должность не найдена.');
    if (input.startDate && input.startDate > d.businessDate(now()))
      d.fail(400, 'LEARNING_START_DATE_FUTURE', 'Дата начала работы не может быть в будущем.');
    const values = {
      username,
      updated_at: now().toISOString(),
      ...(Object.hasOwn(input, 'jobRoleId') ? { job_role_id: input.jobRoleId } : {}),
      ...(Object.hasOwn(input, 'startDate') ? { start_date: input.startDate } : {}),
      ...(Object.hasOwn(input, 'learningEnabled')
        ? { learning_enabled: input.learningEnabled }
        : {}),
    };
    const saved = d.check(
      await db
        .from('learning_employee_profiles')
        .upsert(values, { onConflict: 'username' })
        .select('*')
        .single(),
    );
    return {
      employee: { ...d.profileFor(account, saved, roles, now()), ...(await progress(username)) },
    };
  }
  async function assignments(admin) {
    d.requireManager(admin);
    const values = await getAssignments();
    if (d.contentManager(admin)) return { assignments: values.map(d.assignmentFor) };
    const { employees: accounts } = await employees(admin);
    const usernames = new Set(accounts.map((account) => account.username));
    return {
      assignments: values
        .filter((item) => usernames.has(item.employee_username))
        .map(d.assignmentFor),
    };
  }
  async function createAssignment(admin, input) {
    d.requireManager(admin);
    if (input.roleId) {
      d.requireContentManager(admin);
      if (!(await getRoles()).some((role) => role.id === input.roleId && role.active))
        d.fail(400, 'LEARNING_ROLE_NOT_FOUND', 'Учебная должность не найдена.');
    } else await employeeAccount(admin, input.employeeUsername);
    const item = await d.one(
      db,
      input.courseId ? 'learning_courses' : 'learning_assessments',
      'id',
      input.courseId || input.assessmentId,
    );
    if (!item || (!d.contentManager(admin) && !item.published))
      d.fail(404, 'LEARNING_CONTENT_NOT_FOUND', 'Учебный материал не найден.');
    const value = d.check(
      await db
        .from('learning_assignments')
        .insert({
          employee_username: input.employeeUsername,
          role_id: input.roleId,
          course_id: input.courseId,
          assessment_id: input.assessmentId,
          required: input.required,
          due_at: input.dueAt,
          created_by: d.subject(admin),
        })
        .select('*')
        .single(),
    );
    return { assignment: d.assignmentFor(value) };
  }
  async function deleteAssignment(admin, id) {
    d.requireManager(admin);
    const item = await d.one(db, 'learning_assignments', 'id', id);
    if (!item) d.fail(404, 'LEARNING_ASSIGNMENT_NOT_FOUND', 'Назначение не найдено.');
    if (item.role_id) d.requireContentManager(admin);
    else await employeeAccount(admin, item.employee_username);
    d.check(await db.from('learning_assignments').delete().eq('id', id));
    return { deleted: true };
  }
  async function results(admin) {
    d.requireManager(admin);
    const { employees: accounts } = await employees(admin);
    const index = new Map(accounts.map((account) => [account.username, account]));
    const values = await d.rows(db, 'learning_attempts', '*', (query) =>
      query.order('started_at', { ascending: false }),
    );
    return {
      results: values
        .filter((item) => index.has(item.username))
        .map((item) => ({
          ...d.attemptFor(item, now()),
          username: item.username,
          displayName: index.get(item.username).displayName,
        })),
    };
  }
  async function promotionDecision(admin, id, input) {
    d.requireManager(admin);
    const item = await d.one(db, 'learning_attempts', 'id', id);
    if (!item) d.fail(404, 'LEARNING_ATTEMPT_NOT_FOUND', 'Попытка не найдена.');
    await employeeAccount(admin, item.username);
    await d.rpc(db, 'learning_decide_promotion', {
      p_attempt_id: id,
      p_decision: input.decision,
      p_actor: d.subject(admin),
    });
    const [saved, account, profile, roles, state] = await Promise.all([
      d.one(db, 'learning_attempts', 'id', id),
      d.one(db, 'admin_user_profiles', 'username', item.username),
      getProfile(item.username),
      getRoles(),
      progress(item.username),
    ]);
    return {
      attempt: d.attemptFor(saved, now()),
      employee: { ...d.profileFor(account, profile, roles, now()), ...state },
    };
  }
  const content = require('./learning-content.service').createLearningContent({
    db,
    now,
    getRoles,
    getCourses,
    getAssessments,
  });
  async function dashboard(admin) {
    d.requireManager(admin);
    const [staff, assigned, exams, roles, courseRows, assessmentRows] = await Promise.all([
      employees(admin),
      assignments(admin),
      results(admin),
      getRoles(),
      getCourses(),
      getAssessments(),
    ]);
    const courses = courseRows
      .filter((item) => d.contentManager(admin) || item.published)
      .map(d.courseFor);
    const assessments = assessmentRows
      .filter((item) => d.contentManager(admin) || item.published)
      .map((item) => d.assessmentFor(item, d.contentManager(admin)));
    return {
      counts: {
        employees: staff.employees.length,
        enabledEmployees: staff.employees.filter((employee) => employee.learningEnabled).length,
        courses: courses.length,
        publishedCourses: courses.filter((course) => course.published).length,
        assessments: assessments.length,
        assignments: assigned.assignments.length,
        submittedAttempts: exams.results.filter((attempt) => attempt.status === 'submitted').length,
        passedAttempts: exams.results.filter((attempt) => attempt.passed).length,
      },
      roles: roles.map(d.roleFor),
      courses,
      assessments,
      ...staff,
      ...assigned,
      ...exams,
    };
  }
  return {
    me,
    catalog,
    course,
    completeLesson,
    attempt,
    startAttempt,
    submitAttempt,
    employees,
    patchEmployee,
    assignments,
    createAssignment,
    deleteAssignment,
    results,
    promotionDecision,
    dashboard,
    ...content,
  };
}

module.exports = { createLearningPlatform, learningPlatform: createLearningPlatform() };
