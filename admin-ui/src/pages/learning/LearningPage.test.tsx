import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, request } from '../../lib/api';
import { I18nProvider } from '../../lib/i18n';
import { BrowserRouter } from '../../lib/router';
import LearningPage from './LearningPage';
import type { Assessment, Attempt, Cabinet, Catalog, Course, Progress } from './types';

vi.mock('../../lib/api', async (original) => ({
  ...(await original<typeof import('../../lib/api')>()),
  request: vi.fn(),
}));
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const lessonOne = {
  id: id(11),
  title: 'Встречаем гостя',
  body: 'Поздоровайтесь и уточните заказ.\n\nПроверьте пожелания гостя.',
  videoUrl: 'https://media.example.org/welcome.mp4',
  estimatedMinutes: 4,
  sortOrder: 0,
};
const lessonTwo = {
  ...lessonOne,
  id: id(12),
  title: 'Уточняем заказ',
  videoUrl: null,
  sortOrder: 0,
};
const course: Course = {
  id: id(1),
  title: 'Забота о госте',
  description: 'Уверенный сервис каждый день.',
  roleIds: [],
  published: true,
  modules: [
    { id: id(3), title: 'Заказ', sortOrder: 1, lessons: [lessonTwo] },
    { id: id(2), title: 'Приветствие', sortOrder: 0, lessons: [lessonOne] },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const assessment: Assessment = {
  id: id(20),
  title: 'Практика сервиса',
  description: 'Проверьте знание стандартов.',
  kind: 'practice',
  roleIds: [],
  published: true,
  questionCount: 2,
  maxAttempts: 3,
  passPercent: 80,
  timeLimitMinutes: 15,
  cooldownMinutes: 0,
  minimumTenureDays: 0,
  requiredCourseIds: [],
  targetRoleId: null,
};
const progress: Progress = {
  xp: 0,
  level: 1,
  completedLessons: 0,
  completedCourses: 0,
  lessons: [],
};
function cabinet(extra: Partial<Cabinet> = {}): Cabinet {
  return {
    profile: {
      username: 'employee-one',
      displayName: 'Алия',
      securityRole: 'employee',
      branchIds: [id(80)],
      jobRoleId: id(70),
      jobRole: { id: id(70), title: 'Кассир', description: '', active: true },
      startDate: '2025-01-05',
      tenureDays: 420,
      learningEnabled: true,
    },
    progress,
    assignments: [],
    achievements: [],
    attempts: [],
    ...extra,
  };
}
function attempt(extra: Partial<Attempt> = {}): Attempt {
  return {
    id: id(30),
    assessmentId: assessment.id,
    title: assessment.title,
    kind: 'practice',
    status: 'in_progress',
    startedAt: new Date(Date.now() - 60000).toISOString(),
    deadlineAt: new Date(Date.now() + 3600000).toISOString(),
    submittedAt: null,
    scorePercent: null,
    passed: null,
    passPercent: 80,
    targetRoleId: null,
    promotionDecision: null,
    questions: [
      {
        id: id(31),
        prompt: 'Как начать разговор?',
        choices: [
          { id: id(32), text: 'Поздороваться с гостем' },
          { id: id(33), text: 'Продолжить личный разговор' },
        ],
      },
      {
        id: id(34),
        prompt: 'Что проверить перед оплатой?',
        choices: [
          { id: id(35), text: 'Состав заказа' },
          { id: id(36), text: 'Только сумму' },
        ],
      },
    ],
    ...extra,
  };
}
let me: Cabinet;
let catalog: Catalog;
let reply: (endpoint: string, options: RequestInit) => unknown | Promise<unknown>;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/admin/learning');
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  me = cabinet();
  catalog = { courses: [course], assessments: [assessment] };
  reply = (endpoint) => {
    if (endpoint === '/learning/me') return me;
    if (endpoint === '/learning/catalog') return catalog;
    if (endpoint === `/learning/courses/${course.id}`) return { course, progress: me.progress };
    if (endpoint === `/learning/attempts/${id(30)}`) return { attempt: attempt() };
    throw new Error(`Unexpected test endpoint: ${endpoint}`);
  };
  vi.mocked(request).mockReset();
  vi.mocked(request).mockImplementation(async (endpoint, options = {}, scope) => {
    expect(scope).toEqual({ branchScope: '' });
    return (await reply(endpoint, options)) as never;
  });
});
function page() {
  return render(
    <BrowserRouter basename="/admin">
      <I18nProvider>
        <LearningPage role="employee" />
      </I18nProvider>
    </BrowserRouter>,
  );
}
const nav = (name: string) =>
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Разделы обучения' })).getByRole('button', {
      name,
    }),
  );
const calls = (suffix: string) =>
  vi.mocked(request).mock.calls.filter(([endpoint]) => endpoint.endsWith(suffix));

describe('employee learning cabinet', () => {
  it('opens a linked Profile without replacing it with an unfinished test', async () => {
    me = cabinet({ attempts: [attempt()] });
    window.history.replaceState({}, '', '/admin/learning?view=profile');
    page();
    expect(await screen.findByText('420 дней')).toBeVisible();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(calls(`/attempts/${id(30)}`)).toHaveLength(0);
  });
  it('puts a directly assigned ready test ahead of optional courses and starts its real attempt', async () => {
    me = cabinet({
      assignments: [
        {
          id: id(90),
          employeeUsername: me.profile.username,
          roleId: null,
          courseId: null,
          assessmentId: assessment.id,
          required: true,
          dueAt: '2026-12-31T12:00:00Z',
          createdAt: new Date().toISOString(),
        },
      ],
    });
    const base = reply;
    reply = (endpoint, options) =>
      endpoint.endsWith(`/assessments/${assessment.id}/attempts`)
        ? { attempt: attempt() }
        : base(endpoint, options);
    page();
    const task = await screen.findByRole('region', { name: 'Следующее задание' });
    expect(within(task).getByRole('heading', { name: assessment.title })).toBeVisible();
    expect(within(task).queryByText(course.title)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(course.title) })).toBeVisible();
    fireEvent.click(within(task).getByRole('button', { name: 'Начать' }));
    expect(await screen.findByRole('radio', { name: 'Поздороваться с гостем' })).toBeVisible();
    expect(calls(`/assessments/${assessment.id}/attempts`)).toHaveLength(1);
  });
  it('removes the previous cabinet when a refreshed account loses learning access', async () => {
    page();
    await screen.findByRole('heading', { name: 'Здравствуйте, Алия' });
    const base = reply;
    reply = (endpoint, options) => {
      if (endpoint === '/learning/me')
        throw new ApiError('Доступ к обучению отключён.', 403, 'LEARNING_ACCESS_DISABLED');
      return base(endpoint, options);
    };
    fireEvent.click(screen.getByRole('button', { name: 'Обновить обучение' }));
    expect(
      await screen.findByRole('heading', { name: 'Обучение пока не подключено' }),
    ).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Здравствуйте, Алия' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Разделы обучения' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Начать' })).not.toBeInTheDocument();
  });
  it('gives a first-time employee one clear task and keeps actual XP and tenure in Profile', async () => {
    me = cabinet({
      progress: { ...progress, xp: 235, level: 3, completedLessons: 7, completedCourses: 2 },
      assignments: [
        {
          id: id(90),
          employeeUsername: 'employee-one',
          roleId: null,
          courseId: course.id,
          assessmentId: null,
          required: true,
          dueAt: '2026-12-31T12:00:00Z',
          createdAt: new Date().toISOString(),
        },
      ],
    });
    page();
    expect(await screen.findByRole('heading', { name: 'Здравствуйте, Алия' })).toBeVisible();
    const next = screen.getByRole('region', { name: 'Следующее задание' });
    expect(within(next).getByRole('button', { name: 'Начать' })).toBeVisible();
    expect(screen.getAllByText(course.title)).toHaveLength(1);
    expect(screen.getByText('Обязательно')).toBeVisible();
    expect(screen.getByText(/До 31/)).toBeVisible();
    expect(screen.queryByText('235 XP')).not.toBeInTheDocument();
    expect(screen.queryByText('Стаж')).not.toBeInTheDocument();
    expect(screen.queryByText(/Ваш путь от новых знаний/)).not.toBeInTheDocument();
    nav('Профиль');
    expect(screen.getByText('235 XP')).toBeVisible();
    expect(screen.getByText('420 дней')).toBeVisible();
    expect(screen.getByText('Кассир')).toBeVisible();
    expect(screen.getByText('Уровень')).toBeVisible();
  });
  it('completes real sequential lessons only after the server confirms progress', async () => {
    let finish!: (value: unknown) => void;
    const base = reply;
    reply = (endpoint, options) =>
      endpoint.endsWith(`/lessons/${lessonOne.id}/progress`)
        ? new Promise((resolve) => {
            expect(JSON.parse(String(options.body))).toEqual({ completed: true });
            finish = resolve;
          })
        : base(endpoint, options);
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Начать' }));
    const complete = await screen.findByRole('button', { name: 'Завершить урок' });
    expect(screen.getByRole('button', { name: /Уточняем заказ/ })).toBeDisabled();
    expect(screen.getByText('Поздоровайтесь и уточните заказ.')).toBeVisible();
    expect(document.querySelector('video')?.getAttribute('src')).toBe(lessonOne.videoUrl);
    fireEvent.click(complete);
    fireEvent.click(complete);
    expect(calls(`/lessons/${lessonOne.id}/progress`)).toHaveLength(1);
    expect(screen.queryByText('Урок завершён')).not.toBeInTheDocument();
    await act(async () =>
      finish({
        progress: {
          ...progress,
          xp: 10,
          completedLessons: 1,
          lessons: [
            { lessonId: lessonOne.id, courseId: course.id, completedAt: new Date().toISOString() },
          ],
        },
        achievements: [],
      }),
    );
    expect(await screen.findByText('Урок завершён')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Следующий урок' }));
    expect(await screen.findByRole('heading', { name: lessonTwo.title })).toBeVisible();
    expect(calls('/progress')).toHaveLength(1);
  });
  it('creates a bank-generated attempt and sends all selected IDs for server grading', async () => {
    const base = reply;
    reply = (endpoint, options) => {
      if (endpoint.endsWith(`/assessments/${assessment.id}/attempts`))
        return { attempt: attempt() };
      if (endpoint.endsWith(`/attempts/${id(30)}/submit`)) {
        expect(JSON.parse(String(options.body))).toEqual({
          answers: [
            { questionId: id(31), choiceId: id(32) },
            { questionId: id(34), choiceId: id(35) },
          ],
        });
        return {
          attempt: attempt({
            status: 'submitted',
            scorePercent: 40,
            passed: false,
            submittedAt: new Date().toISOString(),
            result: { correctCount: 1, questionCount: 2, xpAwarded: 0 },
          }),
          progress,
          achievements: [],
        };
      }
      return base(endpoint, options);
    };
    page();
    await screen.findByRole('heading', { name: /Здравствуйте/ });
    nav('Тесты');
    fireEvent.click(screen.getByRole('button', { name: 'Начать тест' }));
    const first = await screen.findByRole('radio', { name: 'Поздороваться с гостем' });
    expect(screen.getByRole('button', { name: 'Отправить ответы' })).toBeDisabled();
    fireEvent.click(first);
    expect(screen.getByRole('button', { name: 'Отправить ответы' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Состав заказа' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отправить ответы' }));
    expect(await screen.findByRole('heading', { name: 'Тест не пройден' })).toBeVisible();
    expect(screen.getByText('40%')).toBeVisible();
    expect(calls(`/assessments/${assessment.id}/attempts`)).toHaveLength(1);
    expect(calls('/submit')).toHaveLength(1);
  });
  it('restores an unfinished attempt on reload without creating another and rejects foreign draft choices', async () => {
    me = cabinet({ attempts: [attempt()] });
    sessionStorage.setItem(
      `bulka-learning-draft:employee-one:${id(30)}`,
      JSON.stringify({ [id(31)]: id(32), [id(34)]: 'foreign-choice', 'foreign-question': id(35) }),
    );
    page();
    expect(await screen.findByRole('radio', { name: 'Поздороваться с гостем' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Состав заказа' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Отправить ответы' })).toBeDisabled();
    expect(calls(`/attempts/${id(30)}`)).toHaveLength(1);
    expect(vi.mocked(request).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(
      false,
    );
  });
  it('keeps answer drafts on a failed submission and allows an explicit retry', async () => {
    me = cabinet({ attempts: [attempt()] });
    const base = reply;
    let submissions = 0;
    reply = (endpoint, options) => {
      if (endpoint.endsWith('/submit')) {
        if (++submissions === 1)
          throw new ApiError('Связь временно недоступна.', 503, 'LEARNING_UNAVAILABLE');
        return {
          attempt: attempt({
            status: 'submitted',
            scorePercent: 100,
            passed: true,
            result: { correctCount: 2, questionCount: 2, xpAwarded: 20 },
          }),
          progress: { ...progress, xp: 20 },
          achievements: [],
        };
      }
      return base(endpoint, options);
    };
    page();
    fireEvent.click(await screen.findByRole('radio', { name: 'Поздороваться с гостем' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Состав заказа' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отправить ответы' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Связь временно недоступна.');
    expect(screen.getByRole('radio', { name: 'Состав заказа' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Отправить ответы' }));
    expect(await screen.findByRole('heading', { name: 'Тест пройден' })).toBeVisible();
    expect(submissions).toBe(2);
    expect(sessionStorage.getItem(`bulka-learning-draft:employee-one:${id(30)}`)).toBeNull();
  });
  it('explains course and verified tenure requirements before a promotion exam', async () => {
    me = cabinet({ profile: { ...cabinet().profile, startDate: null, tenureDays: null } });
    catalog = {
      courses: [course],
      assessments: [
        {
          ...assessment,
          title: 'Повышение до администратора',
          kind: 'promotion',
          requiredCourseIds: [course.id],
          minimumTenureDays: 90,
        },
      ],
    };
    page();
    await screen.findByRole('heading', { name: /Здравствуйте/ });
    expect(screen.queryByText(/Дату начала работы/)).not.toBeInTheDocument();
    nav('Тесты');
    expect(screen.getByText('Сначала завершите обязательные курсы.')).toBeVisible();
    expect(screen.getByText('Управляющий должен подтвердить дату начала работы.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Пока недоступен' })).toBeDisabled();
    expect(calls('/attempts')).toHaveLength(0);
  });
  it('counts expired attempts toward limits and displays the server-based cooldown', async () => {
    const expired = attempt({
      status: 'expired',
      deadlineAt: new Date(Date.now() - 1000).toISOString(),
    });
    me = cabinet({ attempts: [expired] });
    catalog = {
      courses: [],
      assessments: [{ ...assessment, maxAttempts: 1, cooldownMinutes: 60 }],
    };
    page();
    await screen.findByRole('heading', { name: /Здравствуйте/ });
    nav('Тесты');
    expect(screen.getByText('Все доступные попытки использованы.')).toBeVisible();
    expect(screen.getByText(/Следующая попытка после/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Пока недоступен' })).toBeDisabled();
  });
  it('starts an exam after a role change hides a completed prerequisite course from the current catalog', async () => {
    const previousCourseId = id(98);
    me = cabinet({
      profile: {
        ...cabinet().profile,
        jobRoleId: id(71),
        jobRole: { id: id(71), title: 'Администратор', description: '', active: true },
      },
      progress: {
        ...progress,
        completedCourses: 1,
        completedLessons: 1,
        lessons: [
          { lessonId: id(99), courseId: previousCourseId, completedAt: new Date().toISOString() },
        ],
      },
    });
    catalog = {
      courses: [course],
      assessments: [{ ...assessment, requiredCourseIds: [previousCourseId] }],
    };
    const base = reply;
    reply = (endpoint, options) =>
      endpoint.endsWith(`/assessments/${assessment.id}/attempts`)
        ? { attempt: attempt() }
        : base(endpoint, options);
    page();
    await screen.findByRole('heading', { name: 'Здравствуйте, Алия' });
    nav('Тесты');
    const start = screen.getByRole('button', { name: 'Начать тест' });
    expect(start).toBeEnabled();
    expect(screen.queryByText('Сначала завершите обязательные курсы.')).not.toBeInTheDocument();
    fireEvent.click(start);
    expect(await screen.findByRole('radio', { name: 'Поздороваться с гостем' })).toBeVisible();
    expect(calls(`/assessments/${assessment.id}/attempts`)).toHaveLength(1);
  });
  it('lets the server reject an unavailable prerequisite without pretending an attempt was created', async () => {
    catalog = { courses: [course], assessments: [{ ...assessment, requiredCourseIds: [id(98)] }] };
    const base = reply;
    reply = (endpoint, options) => {
      if (endpoint.endsWith(`/assessments/${assessment.id}/attempts`))
        throw new ApiError(
          'Завершите обновлённый обязательный курс.',
          409,
          'LEARNING_PREREQUISITES',
        );
      return base(endpoint, options);
    };
    page();
    await screen.findByRole('heading', { name: /Здравствуйте/ });
    nav('Тесты');
    expect(screen.getByRole('button', { name: 'Начать тест' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Начать тест' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Завершите обновлённый обязательный курс.',
    );
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(window.location.search).not.toContain('attempt=');
  });
  it('shows a disabled cabinet without invented XP and recovers a temporary bootstrap failure', async () => {
    reply = () => {
      throw new ApiError('Доступ к обучению отключён.', 403, 'LEARNING_ACCESS_DISABLED');
    };
    page();
    expect(
      await screen.findByRole('heading', { name: 'Обучение пока не подключено' }),
    ).toBeVisible();
    expect(screen.queryByText('Опыт обучения')).not.toBeInTheDocument();
    reply = (endpoint) => (endpoint.endsWith('/me') ? me : catalog);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('heading', { name: /Здравствуйте/ })).toBeVisible();
  });
  it('does not submit an expired restored attempt', async () => {
    me = cabinet({ attempts: [attempt()] });
    const base = reply;
    reply = (endpoint, options) =>
      endpoint.endsWith(`/attempts/${id(30)}`)
        ? {
            attempt: attempt({
              status: 'expired',
              deadlineAt: new Date(Date.now() - 1000).toISOString(),
            }),
          }
        : base(endpoint, options);
    page();
    expect(await screen.findByRole('heading', { name: 'Время попытки истекло' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Отправить ответы' })).not.toBeInTheDocument();
    expect(calls('/submit')).toHaveLength(0);
  });
  it('keeps the current draft when navigation is canceled and restores it after returning', async () => {
    me = cabinet({ attempts: [attempt()] });
    page();
    fireEvent.click(await screen.findByRole('radio', { name: 'Поздороваться с гостем' }));
    vi.mocked(window.confirm).mockReturnValue(false);
    nav('Обучение');
    expect(screen.getByRole('radio', { name: 'Поздороваться с гостем' })).toBeChecked();
    vi.mocked(window.confirm).mockReturnValue(true);
    nav('Обучение');
    fireEvent.click(await screen.findByRole('button', { name: 'Продолжить' }));
    expect(await screen.findByRole('radio', { name: 'Поздороваться с гостем' })).toBeChecked();
    expect(calls('/submit')).toHaveLength(0);
  });
  it('does not invent achievements or courses when the catalog is empty', async () => {
    catalog = { courses: [], assessments: [] };
    page();
    await screen.findByRole('heading', { name: /Здравствуйте/ });
    expect(screen.getByRole('heading', { name: 'Заданий пока нет' })).toBeVisible();
    nav('Результаты');
    expect(screen.getByText('Достижений пока нет.')).toBeVisible();
    expect(screen.queryByText(/\+\d+ XP/)).not.toBeInTheDocument();
  });
  it('keeps submitted results and earned achievements accessible without cluttering the first screen', async () => {
    me = cabinet({
      attempts: [
        attempt({
          status: 'submitted',
          passed: true,
          scorePercent: 100,
          submittedAt: new Date().toISOString(),
        }),
      ],
      achievements: [
        {
          id: id(95),
          code: 'first-pass',
          title: 'Первый тест',
          xp: 20,
          earnedAt: new Date().toISOString(),
        },
      ],
    });
    page();
    await screen.findByRole('heading', { name: 'Здравствуйте, Алия' });
    expect(screen.queryByText('Первый тест')).not.toBeInTheDocument();
    expect(screen.queryByText(/100%/)).not.toBeInTheDocument();
    nav('Результаты');
    expect(screen.getByText(/100% · Пройден/)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Первый тест' })).toBeVisible();
    expect(screen.getByText('+20 XP')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(assessment.title) }));
    expect(calls(`/attempts/${id(30)}`)).toHaveLength(1);
  });
});
