// Local synthetic browser fixture. Never import this file from production.
// Business rules, REST contracts, permissions and RPCs are the actual application.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { createLearningDatabase } = require('./learning-pg-fixture.cjs');
const { createSupabaseAdapter } = require('./pglite-supabase-adapter.cjs');

const BRANCH = '20000000-0000-4000-8000-000000000001';
const OTHER_BRANCH = '20000000-0000-4000-8000-000000000002';
const CASHIER = '10000000-0000-4000-8000-000000000001';
const MANAGER = '10000000-0000-4000-8000-000000000005';
const COOKIE = 'bulka_fixture_identity';

function substitute(modulePath, exports) {
  const filename = require.resolve(modulePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

async function startAcademyFixture({ port = 4181 } = {}) {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.BULKA_SECRET = 'synthetic-fixture-secret-never-production-2026';
  process.env.CUSTOMER_JWT_SECRET = 'synthetic-fixture-customer-secret-never-production-2026';
  process.env.ADMIN_USERS_JSON = JSON.stringify([{ username: 'owner' }]);
  const pg = await createLearningDatabase();
  const db = createSupabaseAdapter(pg);
  // Prevent config/supabase.js (and its dotenv loader) from being evaluated.
  substitute('../../src/config/supabase', { supabase: db });
  const locations = [
    {
      id: BRANCH,
      name: 'Учебный филиал А',
      address: 'Синтетический адрес А',
      city: 'Учебный город',
      active: true,
    },
    {
      id: OTHER_BRANCH,
      name: 'Учебный филиал Б',
      address: 'Синтетический адрес Б',
      city: 'Другой учебный город',
      active: true,
    },
  ];
  substitute('../../src/services/location.service', { getBulkaLocations: async () => locations });
  const { createLearningPlatform } = require('../../src/services/learning-platform.service');
  const {
    registerLearningPlatformRoutes,
  } = require('../../src/routes/admin/learning-platform.routes');
  const { registerAccessAdminRoutes } = require('../../src/routes/admin/access.routes');
  const {
    adminCsrfMiddleware,
    adminMutationRoleMiddleware,
    adminSessionHandler,
  } = require('../../src/middlewares/auth.middleware');
  const { authenticateCashier } = require('../../src/services/admin-credential-auth.service');
  const { applyAdminBranchSelection } = require('../../src/utils/admin-scope.util');
  const service = createLearningPlatform({ db });
  await pg.query(
    'insert into bulka_locations(id,name,city,address) values($1,$2,$3,$4),($5,$6,$7,$8)',
    [
      BRANCH,
      locations[0].name,
      locations[0].city,
      locations[0].address,
      OTHER_BRANCH,
      locations[1].name,
      locations[1].city,
      locations[1].address,
    ],
  );
  await pg.query(
    `insert into admin_user_profiles(username,display_name,role,branch_ids) values
    ('owner','Учебный владелец','owner','{}'),('learner','Учебный сотрудник','employee',array[$1::uuid]),
    ('manager','Учебный управляющий','branch_manager',array[$1::uuid]),
    ('foreign-manager','Управляющий другого филиала','branch_manager',array[$2::uuid])`,
    [BRANCH, OTHER_BRANCH],
  );
  await pg.query(
    `insert into learning_employee_profiles(username,job_role_id,start_date,learning_enabled)
    values('learner',$1,((clock_timestamp() at time zone 'Asia/Almaty')::date-100),true)`,
    [CASHIER],
  );
  const owner = { username: 'owner', sub: 'owner', role: 'owner', branchIds: [] };
  const course = (
    await service.saveCourse(owner, null, {
      title: 'Учебный курс: работа с гостем',
      description: 'Синтетические материалы для проверки платформы.',
      roleIds: [],
      published: true,
      modules: [
        {
          title: 'Основы сервиса',
          lessons: [
            {
              title: 'Приветствие гостя',
              body: 'Поздоровайтесь с гостем и уточните его заказ. Повторите заказ перед расчётом.',
              videoUrl: null,
              estimatedMinutes: 2,
              sortOrder: 0,
            },
            {
              title: 'Проверка заказа',
              body: 'Проверьте состав заказа, оплату и упаковку. При ошибке сообщите управляющему.',
              videoUrl: null,
              estimatedMinutes: 3,
              sortOrder: 1,
            },
          ],
          sortOrder: 0,
        },
      ],
    })
  ).course;
  const questions = [
    'Как начать обслуживание гостя?',
    'Что сделать перед выдачей заказа?',
    'Как поступить при ошибке заказа?',
  ].map((prompt, index) => {
    const choices = [
      {
        id: crypto.randomUUID(),
        text: [
          'Поздороваться и уточнить заказ',
          'Проверить состав заказа и оплату',
          'Сообщить управляющему и исправить ошибку',
        ][index],
      },
      { id: crypto.randomUUID(), text: 'Ничего не проверять' },
    ];
    return {
      id: crypto.randomUUID(),
      prompt,
      choices,
      correctChoiceId: choices[0].id,
      explanation: 'Утверждённый учебный порядок обслуживания.',
    };
  });
  const assessments = [];
  for (const kind of ['practice', 'control', 'promotion']) {
    assessments.push(
      (
        await service.saveAssessment(owner, null, {
          title: {
            practice: 'Учебная тренировка',
            control: 'Контроль сервиса',
            promotion: 'Экзамен на управляющего',
          }[kind],
          description: 'Синтетический банк из трёх утверждённых вопросов.',
          kind,
          roleIds: [],
          published: true,
          questionCount: 2,
          maxAttempts: 3,
          passPercent: 80,
          timeLimitMinutes: 10,
          cooldownMinutes: 0,
          minimumTenureDays: kind === 'promotion' ? 30 : 0,
          requiredCourseIds: kind === 'practice' ? [] : [course.id],
          targetRoleId: kind === 'promotion' ? MANAGER : null,
          questions,
        })
      ).assessment,
    );
  }
  await service.createAssignment(owner, {
    employeeUsername: 'learner',
    roleId: null,
    courseId: course.id,
    assessmentId: null,
    required: true,
    dueAt: null,
  });
  await pg.exec('set role service_role');

  const app = express();
  const requests = [];
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const detail = { requestId: crypto.randomUUID(), method: req.method, path: req.path };
    res.set('X-Request-Id', detail.requestId);
    const json = res.json.bind(res);
    res.json = (body) => {
      detail.code = body?.code || null;
      return json(body);
    };
    res.on('finish', () => {
      if (detail.path.startsWith('/admin/api')) {
        requests.push({ ...detail, status: res.statusCode });
        if (requests.length > 1000) requests.shift();
      }
    });
    next();
  });
  const findAccount = async (username) =>
    (await db.from('admin_user_profiles').select('*').eq('username', username).maybeSingle()).data;
  const userFor = (account) => ({
    username: account.username,
    sub: account.username,
    role: account.role,
    branchIds: account.branch_ids || [],
    mfaVerified: true,
    jti: `fixture-${account.username}`,
  });
  const select = async (req, res) => {
    const aliases = {
      employee: 'learner',
      owner: 'owner',
      manager: 'manager',
      'foreign-manager': 'foreign-manager',
    };
    const username = aliases[req.params.account] || req.params.account;
    const account = await findAccount(username);
    if (!account?.active) return res.status(404).json({ code: 'FIXTURE_ACCOUNT_NOT_FOUND' });
    res.cookie(COOKIE, username, { httpOnly: true, sameSite: 'strict', path: '/' });
    return res.redirect(
      ['owner', 'admin', 'branch_manager'].includes(account.role)
        ? '/admin/learning/manage'
        : '/admin/learning',
    );
  };
  app.get('/__fixture/login/:account', (req, res, next) => select(req, res).catch(next));
  app.get('/__fixture/requests', (_req, res) => res.json({ requests }));
  app.get('/__fixture/health', (_req, res) =>
    res.json({
      synthetic: true,
      database: 'in-memory PGlite',
      businessLogic: 'real SQL + services + routes',
    }),
  );
  app.get('/__fixture/state', async (_req, res, next) => {
    try {
      const profiles = (
        await pg.query(
          'select username,job_role_id,start_date,learning_enabled from learning_employee_profiles order by username',
        )
      ).rows;
      const achievements = (
        await pg.query('select username,code,xp from learning_achievements order by earned_at')
      ).rows;
      const attempts = (
        await pg.query(
          'select id,username,assessment_id,status,score_percent,passed,xp_awarded,promotion_decision from learning_attempts order by started_at',
        )
      ).rows;
      res.json({
        profiles,
        achievements,
        attempts,
        courseId: course.id,
        lessonIds: course.modules.flatMap((module) => module.lessons.map((lesson) => lesson.id)),
        assessments: assessments.map(({ id, kind, title }) => ({ id, kind, title })),
        branches: locations,
      });
    } catch (error) {
      next(error);
    }
  });
  app.post('/admin/api/login', adminCsrfMiddleware, async (req, res, next) => {
    try {
      const username = String(req.body?.username || '').toLowerCase();
      const valid =
        username === 'owner' && req.body?.password === 'SyntheticOwner123'
          ? true
          : Boolean(await authenticateCashier(username, req.body?.password, { db }));
      const account = valid && (await findAccount(username));
      if (!account?.active)
        return res.status(401).json({ error: 'Invalid synthetic fixture login' });
      res.cookie(COOKIE, username, { httpOnly: true, sameSite: 'strict', path: '/' });
      req.admin = userFor(account);
      return adminSessionHandler(req, res);
    } catch (error) {
      next(error);
    }
  });
  app.use(
    '/admin/api',
    async (req, res, next) => {
      try {
        const match = String(req.headers.cookie || '').match(
          /(?:^|;\s*)bulka_fixture_identity=([^;]+)/,
        );
        const account = match && (await findAccount(decodeURIComponent(match[1])));
        if (!account?.active)
          return res
            .status(401)
            .json({ error: 'Select a synthetic fixture account', code: 'FIXTURE_LOGIN_REQUIRED' });
        req.admin = applyAdminBranchSelection(
          userFor(account),
          req.headers['x-bulka-branch-id'],
          req.headers['x-bulka-branch-ids'],
        );
        next();
      } catch (error) {
        next(error);
      }
    },
    adminCsrfMiddleware,
    adminMutationRoleMiddleware,
  );
  app.get('/admin/api/session', adminSessionHandler);
  app.post('/admin/api/logout', (_req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ success: true });
  });
  app.get('/admin/api/scope', (req, res) =>
    res.json({
      success: true,
      locations: ['owner', 'admin'].includes(req.admin.role)
        ? locations
        : locations.filter((location) => req.admin.branchIds.includes(location.id)),
      selectedBranchId: null,
      selectedBranchIds: [],
    }),
  );
  app.get('/admin/api/locations', (_req, res) => res.json({ success: true, locations }));
  app.get('/admin/api/locations/cities', (_req, res) => res.json({ success: true, cities: [] }));
  app.get('/admin/api/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write(': synthetic local fixture connected\n\n');
    const timer = setInterval(() => res.write(': heartbeat\n\n'), 25000);
    req.on('close', () => clearInterval(timer));
  });
  app.get('/admin/api/operations/summary', (_req, res) =>
    res.json({
      success: true,
      updatedAt: new Date().toISOString(),
      capabilities: {
        orders: false,
        kitchen: false,
        dispatch: false,
        support: false,
        whatsapp: false,
        inventory: false,
        cashierDirectory: false,
      },
      counts: {
        newOrders: 0,
        activeOrders: 0,
        kitchenOverdue: 0,
        deliveryAttention: 0,
        paymentIssues: 0,
        supportNew: 0,
        supportOverdue: 0,
        supportMine: 0,
        whatsappUnread: 0,
        whatsappDialogs: 0,
        stoppedProducts: 0,
        cashierSyncIssues: 0,
      },
      orders: [],
      support: [],
      whatsapp: [],
    }),
  );
  registerLearningPlatformRoutes(app, service);
  registerAccessAdminRoutes(app);
  app.use('/admin/api', (_req, res) =>
    res.status(404).json({ code: 'FIXTURE_API_NOT_IMPLEMENTED' }),
  );
  const dist = path.join(__dirname, '../../admin-ui/dist');
  app.use('/admin', express.static(dist));
  app.get('/admin/*', (_req, res) => {
    if (!fs.existsSync(path.join(dist, 'index.html')))
      return res.status(503).send('Build admin-ui before browser QA.');
    return res.sendFile(path.join(dist, 'index.html'));
  });
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({
      success: false,
      code: error.code || 'FIXTURE_ERROR',
      error: error.expose || error.statusCode ? error.message : 'Synthetic fixture failed',
    }),
  );
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(port, '127.0.0.1', () => resolve(listening));
    listening.on('error', reject);
  });
  return {
    server,
    pg,
    db,
    service,
    port: server.address().port,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await pg.close();
    },
  };
}

if (require.main === module) {
  startAcademyFixture()
    .then((fixture) => {
      console.log(
        `Synthetic academy fixture: http://127.0.0.1:${fixture.port}/__fixture/login/owner`,
      );
      console.log(
        'Employee selector: /__fixture/login/employee; manager selector: /__fixture/login/manager',
      );
      for (const signal of ['SIGINT', 'SIGTERM'])
        process.once(signal, () => fixture.close().then(() => process.exit(0)));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
module.exports = { startAcademyFixture };
