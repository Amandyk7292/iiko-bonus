import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import { BrowserRouter } from '../../lib/router';
import AcademyAdminPage from './AcademyAdminPage';
import CourseEditor from './CourseEditor';
import AssessmentEditor from './AssessmentEditor';
import type { Assessment, Course, Dashboard } from './model';

const mocks = vi.hoisted(() => ({
  loadDashboard: vi.fn(),
  saveLearning: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('./api', () => ({ loadDashboard: mocks.loadDashboard, saveLearning: mocks.saveLearning }));
vi.mock('../../components/Feedback', () => ({
  useFeedback: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));

const ids = Array.from(
  { length: 12 },
  (_, index) => `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
);
const course: Course = {
  id: ids[0],
  title: 'Сервис Bulka',
  description: 'Стандарты общения',
  roleIds: [ids[1]],
  published: true,
  modules: [
    {
      id: ids[2],
      title: 'Сервис',
      sortOrder: 0,
      lessons: [
        {
          id: ids[3],
          title: 'Приветствие',
          body: 'Поздоровайтесь с гостем.',
          videoUrl: null,
          sortOrder: 0,
          estimatedMinutes: 5,
        },
      ],
    },
  ],
};
const assessment: Assessment = {
  id: ids[4],
  title: 'Контроль знаний',
  description: '',
  kind: 'control',
  roleIds: [],
  published: true,
  questionCount: 1,
  maxAttempts: 3,
  passPercent: 80,
  timeLimitMinutes: 15,
  cooldownMinutes: 60,
  minimumTenureDays: 0,
  requiredCourseIds: [],
  targetRoleId: null,
  questions: [
    {
      id: ids[5],
      prompt: 'Что сделать первым?',
      choices: [
        { id: ids[6], text: 'Поздороваться' },
        { id: ids[7], text: 'Игнорировать гостя' },
      ],
      correctChoiceId: ids[6],
      explanation: 'Начните с приветствия.',
    },
  ],
};
const fixture = (): Dashboard => ({
  counts: {},
  roles: [
    { id: ids[1], title: 'Кассир', description: '', active: true },
    { id: ids[8], title: 'Администратор', description: '', active: true },
  ],
  courses: [structuredClone(course)],
  assessments: [structuredClone(assessment)],
  employees: [
    {
      username: 'cashier.1',
      displayName: 'Алия',
      securityRole: 'cashier',
      branchIds: [ids[9]],
      jobRoleId: ids[1],
      jobRole: { id: ids[1], title: 'Кассир', description: '', active: true },
      startDate: '2026-01-01',
      tenureDays: 280,
      learningEnabled: true,
      progress: { xp: 10, level: 1, completedLessons: 1, completedCourses: 0 },
    },
  ],
  assignments: [],
  results: [],
});
const text = (ru: string) => ru;
const mount = (element: React.ReactNode) =>
  render(
    <BrowserRouter>
      <I18nProvider>{element}</I18nProvider>
    </BrowserRouter>,
  );

describe('Academy management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.loadDashboard.mockResolvedValue(fixture());
    mocks.saveLearning.mockResolvedValue({ success: true });
    mocks.confirm.mockResolvedValue(true);
  });
  it('limits branch managers to employee and result tools, with no content or role editor', async () => {
    const user = userEvent.setup();
    mount(<AcademyAdminPage role="branch_manager" />);
    await screen.findByRole('heading', { name: 'Развитие команды' });
    expect(screen.queryByRole('button', { name: 'Курсы' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Тесты' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Должности' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Назначения' }));
    await user.click(screen.getAllByRole('button', { name: 'Назначить обучение' })[0]);
    expect(screen.queryByLabelText('Кому назначить')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Сотрудник *')).toBeInTheDocument();
  });
  it('does not request management data for ordinary learners', () => {
    mount(<AcademyAdminPage role="employee" />);
    expect(
      screen.getByRole('heading', { name: 'Раздел доступен руководителям' }),
    ).toBeInTheDocument();
    expect(mocks.loadDashboard).not.toHaveBeenCalled();
  });
  it('saves employment learning fields without changing login permissions', async () => {
    const user = userEvent.setup();
    mount(<AcademyAdminPage role="owner" />);
    await user.click(await screen.findByRole('button', { name: 'Сотрудники' }));
    await user.click(screen.getByRole('button', { name: 'Настроить' }));
    const dialog = screen.getByRole('dialog', { name: 'Алия' });
    await user.selectOptions(within(dialog).getByLabelText('Должность'), ids[8]);
    await user.clear(within(dialog).getByLabelText('Первый рабочий день'));
    await user.type(within(dialog).getByLabelText('Первый рабочий день'), '2026-02-01');
    await user.click(within(dialog).getByLabelText(/Доступ к обучению/));
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(mocks.saveLearning).toHaveBeenCalledWith(
        '/employees/cashier.1',
        { jobRoleId: ids[8], startDate: '2026-02-01', learningEnabled: false },
        'PATCH',
      ),
    );
  });
  it('creates an individual required course assignment with one target and one resource', async () => {
    const user = userEvent.setup();
    mount(<AcademyAdminPage role="branch_manager" />);
    await user.click(await screen.findByRole('button', { name: 'Сотрудники' }));
    await user.click(screen.getByRole('button', { name: 'Назначить' }));
    const dialog = screen.getByRole('dialog', { name: 'Назначить обучение' });
    await user.selectOptions(within(dialog).getByLabelText('Название *'), ids[0]);
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(mocks.saveLearning).toHaveBeenCalledWith('/assignments', {
        employeeUsername: 'cashier.1',
        roleId: null,
        courseId: ids[0],
        assessmentId: null,
        required: true,
        dueAt: null,
      }),
    );
  });
  it('requires a review decision for a passed promotion and prevents duplicate actions while saving', async () => {
    const data = fixture();
    data.results = [
      {
        id: ids[10],
        assessmentId: ids[4],
        title: 'Экзамен администратора',
        kind: 'promotion',
        username: 'cashier.1',
        displayName: 'Алия',
        status: 'submitted',
        scorePercent: 100,
        passed: true,
        submittedAt: '2026-10-10T06:00:00Z',
        deadlineAt: '2026-10-10T06:15:00Z',
        promotionDecision: null,
        targetRoleId: ids[8],
      },
    ];
    mocks.loadDashboard.mockResolvedValue(data);
    let finish!: () => void;
    mocks.saveLearning.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    mount(<AcademyAdminPage role="owner" />);
    await user.click(await screen.findByRole('button', { name: 'Подтвердить повышение' }));
    await waitFor(() =>
      expect(mocks.saveLearning).toHaveBeenCalledWith(`/attempts/${ids[10]}/promotion-decision`, {
        decision: 'approved',
      }),
    );
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('Администратор') }),
    );
    expect(screen.getByRole('button', { name: 'Отклонить' })).toBeDisabled();
    finish();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Решение сохранено'));
  });
});

describe('Learning content editors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.saveLearning.mockResolvedValue({ success: true });
  });
  it('retains course drafts on Escape and server rejection and preserves lesson IDs on save', async () => {
    const user = userEvent.setup(),
      saved = vi.fn();
    mocks.saveLearning.mockRejectedValue(new Error('Сервер недоступен'));
    mount(
      <CourseEditor
        course={course}
        roles={fixture().roles}
        text={text}
        onClose={vi.fn()}
        onSaved={saved}
      />,
    );
    await user.clear(screen.getByLabelText('Название курса *'));
    await user.type(screen.getByLabelText('Название курса *'), 'Обновлённый курс');
    await user.keyboard('{Escape}');
    const confirm = screen.getByRole('dialog', { name: 'Закрыть без сохранения?' });
    await user.click(within(confirm).getByRole('button', { name: 'Отмена' }));
    expect(screen.getByLabelText('Название курса *')).toHaveValue('Обновлённый курс');
    await user.click(screen.getByRole('button', { name: 'Сохранить курс' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Сервер недоступен');
    expect(saved).not.toHaveBeenCalled();
    expect(mocks.saveLearning).toHaveBeenCalledWith(
      `/courses/${course.id}`,
      expect.objectContaining({
        title: 'Обновлённый курс',
        modules: [
          expect.objectContaining({
            id: ids[2],
            lessons: [expect.objectContaining({ id: ids[3] })],
          }),
        ],
      }),
      'PATCH',
    );
  });
  it('blocks publishing a course without actual lesson content', async () => {
    const broken = structuredClone(course);
    broken.modules[0].lessons[0].body = '';
    const user = userEvent.setup();
    mount(
      <CourseEditor
        course={broken}
        roles={fixture().roles}
        text={text}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Сохранить курс' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Добавьте текст или видео');
    expect(mocks.saveLearning).not.toHaveBeenCalled();
  });
  it('publishes a configured test only when the approved bank has enough questions', async () => {
    const user = userEvent.setup();
    mount(
      <AssessmentEditor
        assessment={assessment}
        roles={fixture().roles}
        courses={[course]}
        text={text}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await user.clear(screen.getByLabelText('Вопросов в каждой попытке'));
    await user.type(screen.getByLabelText('Вопросов в каждой попытке'), '2');
    await user.click(screen.getByRole('button', { name: 'Сохранить тест' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('В банке меньше вопросов');
    expect(mocks.saveLearning).not.toHaveBeenCalled();
  });
  it('saves the administrator-selected correct answer using stable choice IDs', async () => {
    const user = userEvent.setup();
    mount(
      <AssessmentEditor
        assessment={assessment}
        roles={fixture().roles}
        courses={[course]}
        text={text}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Банк вопросов/ }));
    await user.click(screen.getByRole('radio', { name: 'Правильный ответ 2' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить тест' }));
    await waitFor(() =>
      expect(mocks.saveLearning).toHaveBeenCalledWith(
        `/assessments/${assessment.id}`,
        expect.objectContaining({
          questions: [expect.objectContaining({ id: ids[5], correctChoiceId: ids[7] })],
        }),
        'PATCH',
      ),
    );
  });
});
