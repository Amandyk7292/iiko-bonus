import { useCallback, useEffect, useState } from 'react';
import {
  BookOpenText,
  ClipboardCheck,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Trophy,
  Users,
} from '../../components/BulkaIcons';
import PageState from '../../components/PageState';
import { useFeedback } from '../../components/Feedback';
import { useI18n } from '../../lib/i18n';
import { Link } from '../../lib/router';
import CourseEditor from './CourseEditor';
import AssessmentEditor from './AssessmentEditor';
import { AssignmentEditor, EmployeeEditor, RoleEditor } from './ManagementDialogs';
import { Status } from './Fields';
import { loadDashboard, saveLearning } from './api';
import type { Assessment, Course, Dashboard, Employee, JobRole, Result } from './model';
import './academy-admin.css';

type Tab =
  'overview' | 'courses' | 'assessments' | 'employees' | 'assignments' | 'results' | 'roles';
type Dialog =
  | { type: 'course'; course: Course | null }
  | { type: 'assessment'; assessment: Assessment | null }
  | { type: 'role'; role: JobRole | null }
  | { type: 'employee'; employee: Employee }
  | { type: 'assignment'; employee?: Employee }
  | null;
const matches = (query: string, ...values: unknown[]) =>
  values.some((value) =>
    String(value || '')
      .toLocaleLowerCase('ru-RU')
      .includes(query.trim().toLocaleLowerCase('ru-RU')),
  );

export default function AcademyAdminPage({ role = 'viewer' }: { role?: string }) {
  const { locale, formatDate, formatNumber } = useI18n();
  const text = (ru: string, kk: string) => (locale === 'kk' ? kk : ru);
  const { toast, confirm } = useFeedback();
  const contentManager = ['owner', 'admin'].includes(role),
    allowed = contentManager || role === 'branch_manager';
  const [data, setData] = useState<Dashboard | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview'),
    [query, setQuery] = useState(''),
    [dialog, setDialog] = useState<Dialog>(null),
    [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError('');
    try {
      setData(await loadDashboard());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить обучение.');
    } finally {
      setLoading(false);
    }
  }, [allowed]);
  useEffect(() => {
    void load();
  }, [load]);
  const saved = () => {
    setDialog(null);
    toast(text('Настройки обучения сохранены', 'Оқу баптаулары сақталды'));
    void load();
  };
  const tabs: { id: Tab; title: string }[] = [
    { id: 'overview', title: text('Обзор', 'Шолу') },
    ...(contentManager
      ? [
          { id: 'courses' as Tab, title: text('Курсы', 'Курстар') },
          { id: 'assessments' as Tab, title: text('Тесты', 'Тесттер') },
        ]
      : []),
    { id: 'employees', title: text('Сотрудники', 'Қызметкерлер') },
    { id: 'assignments', title: text('Назначения', 'Тағайындаулар') },
    { id: 'results', title: text('Результаты', 'Нәтижелер') },
    ...(contentManager ? [{ id: 'roles' as Tab, title: text('Должности', 'Лауазымдар') }] : []),
  ];
  const kindLabel = (kind: Assessment['kind']) =>
    kind === 'promotion'
      ? text('Повышение', 'Жоғарылау')
      : kind === 'control'
        ? text('Контрольный', 'Бақылау')
        : text('Тренировка', 'Жаттығу');
  const decidePromotion = async (result: Result, decision: 'approved' | 'rejected') => {
    if (busy || !data) return;
    const employeeName = result.displayName || result.username,
      target =
        data.roles.find((item) => item.id === result.targetRoleId)?.title ||
        text('новая должность', 'жаңа лауазым');
    if (
      !(await confirm({
        title:
          decision === 'approved'
            ? text('Подтвердить повышение?', 'Жоғарылауды бекіту керек пе?')
            : text('Отклонить повышение?', 'Жоғарылауды қабылдамау керек пе?'),
        body:
          decision === 'approved'
            ? text(
                `${employeeName}: назначить должность «${target}» в обучении?`,
                `${employeeName}: оқуда «${target}» лауазымын тағайындау керек пе?`,
              )
            : text(
                `${employeeName}: сохранить решение об отклонении по этому экзамену?`,
                `${employeeName}: осы емтихан бойынша қабылдамау шешімін сақтау керек пе?`,
              ),
        confirmLabel:
          decision === 'approved' ? text('Подтвердить', 'Бекіту') : text('Отклонить', 'Қабылдамау'),
      }))
    )
      return;
    setBusy(result.id);
    try {
      await saveLearning(`/attempts/${result.id}/promotion-decision`, { decision });
      toast(text('Решение сохранено', 'Шешім сақталды'));
      await load();
    } catch (caught) {
      toast(
        caught instanceof Error
          ? caught.message
          : text('Не удалось сохранить решение.', 'Шешім сақталмады.'),
        'error',
      );
    } finally {
      setBusy('');
    }
  };
  const deleteAssignment = async (id: string) => {
    if (busy) return;
    if (
      !(await confirm({
        title: text('Отменить назначение?', 'Тағайындауды жою керек пе?'),
        body: text(
          'Курс или тест исчезнет из назначений. Пройденные уроки и результаты сохранятся.',
          'Курс немесе тест тағайындаудан алынады. Өтілген сабақтар мен нәтижелер сақталады.',
        ),
        confirmLabel: text('Отменить назначение', 'Тағайындауды жою'),
        destructive: true,
      }))
    )
      return;
    setBusy(id);
    try {
      await saveLearning(`/assignments/${id}`, {}, 'DELETE');
      toast(text('Назначение отменено', 'Тағайындау жойылды'));
      await load();
    } catch (caught) {
      toast(
        caught instanceof Error
          ? caught.message
          : text('Не удалось отменить назначение.', 'Тағайындау жойылмады.'),
        'error',
      );
    } finally {
      setBusy('');
    }
  };
  if (!allowed)
    return (
      <PageState
        type="error"
        title={text('Раздел доступен руководителям', 'Бөлім басшыларға қолжетімді')}
        description={text('Откройте личный кабинет обучения.', 'Оқу жеке кабинетін ашыңыз.')}
        action={
          <Link className="btn-classic" to="/learning">
            {text('Моё обучение', 'Менің оқуым')}
          </Link>
        }
      />
    );
  if (!data && loading)
    return <PageState type="loading" title={text('Загружаем академию', 'Академия жүктелуде')} />;
  if (!data) return <PageState type="error" description={error} onRetry={() => void load()} />;
  const rolesForCourse = (ids: string[]) =>
    ids.length
      ? ids
          .map(
            (id) =>
              data.roles.find((item) => item.id === id)?.title ||
              text('Должность в архиве', 'Мұрағаттағы лауазым'),
          )
          .join(' · ')
      : text('Все должности', 'Барлық лауазым');
  const create =
    tab === 'courses'
      ? () => setDialog({ type: 'course', course: null })
      : tab === 'assessments'
        ? () => setDialog({ type: 'assessment', assessment: null })
        : tab === 'roles'
          ? () => setDialog({ type: 'role', role: null })
          : tab === 'assignments'
            ? () => setDialog({ type: 'assignment' })
            : undefined;
  const createLabel =
    tab === 'courses'
      ? text('Создать курс', 'Курс құру')
      : tab === 'assessments'
        ? text('Создать тест', 'Тест құру')
        : tab === 'roles'
          ? text('Добавить должность', 'Лауазым қосу')
          : text('Назначить обучение', 'Оқуды тағайындау');
  const pendingPromotions = data.results.filter(
    (item) => item.kind === 'promotion' && item.passed && !item.promotionDecision,
  );
  const ResultCard = ({ result }: { result: Result }) => (
    <article className="card academy-result">
      <div className="academy-result-main">
        <div>
          <strong>{result.displayName || result.username}</strong>
          <h3>{result.title}</h3>
          <small>
            {kindLabel(result.kind)} ·{' '}
            {result.submittedAt ? formatDate(result.submittedAt) : text('В процессе', 'Орындалуда')}
          </small>
        </div>
        <div className="academy-result-score">
          <strong>{result.scorePercent === null ? '—' : `${result.scorePercent}%`}</strong>
          <Status good={result.passed === true}>
            {result.status === 'expired'
              ? text('Время истекло', 'Уақыт аяқталды')
              : result.status === 'in_progress'
                ? text('Проходит тест', 'Тест өтуде')
                : result.passed
                  ? text('Пройден', 'Өтілді')
                  : text('Не пройден', 'Өтілмеді')}
          </Status>
        </div>
      </div>
      {result.kind === 'promotion' && result.passed && (
        <div className="academy-promotion-actions">
          {result.promotionDecision ? (
            <Status good={result.promotionDecision === 'approved'}>
              {result.promotionDecision === 'approved'
                ? text('Повышение подтверждено', 'Жоғарылау бекітілді')
                : text('Повышение отклонено', 'Жоғарылау қабылданбады')}
            </Status>
          ) : (
            <>
              <span>{text('Ожидает решения руководителя', 'Басшы шешімін күтуде')}</span>
              <button
                type="button"
                className="btn-outline"
                disabled={Boolean(busy)}
                onClick={() => void decidePromotion(result, 'rejected')}
              >
                {text('Отклонить', 'Қабылдамау')}
              </button>
              <button
                type="button"
                className="btn-classic"
                disabled={Boolean(busy)}
                onClick={() => void decidePromotion(result, 'approved')}
              >
                <ShieldCheck size={17} aria-hidden="true" />
                {busy === result.id
                  ? text('Сохраняем…', 'Сақталуда…')
                  : text('Подтвердить повышение', 'Жоғарылауды бекіту')}
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
  return (
    <div className="academy-admin">
      <header className="academy-header">
        <div>
          <span className="academy-eyebrow">BULKA ACADEMY</span>
          <h1>{text('Развитие команды', 'Команданы дамыту')}</h1>
          <p>
            {contentManager
              ? text(
                  'Обучение по должностям, проверка знаний и рост сотрудников.',
                  'Лауазым бойынша оқу, білімді тексеру және қызметкерлердің өсуі.',
                )
              : text(
                  'Обучение и результаты сотрудников ваших филиалов.',
                  'Филиалдарыңыздағы қызметкерлердің оқуы мен нәтижелері.',
                )}
          </p>
        </div>
        <Link className="btn-outline" to="/learning">
          <BookOpenText size={18} aria-hidden="true" />
          {text('Мой кабинет', 'Менің кабинетім')}
        </Link>
      </header>
      <nav className="academy-tabs" aria-label={text('Управление обучением', 'Оқуды басқару')}>
        {tabs.map((item) => (
          <button
            type="button"
            key={item.id}
            className={tab === item.id ? 'is-active' : ''}
            aria-pressed={tab === item.id}
            onClick={() => {
              setTab(item.id);
              setQuery('');
            }}
          >
            {item.title}
            {item.id === 'results' && pendingPromotions.length > 0 && (
              <span className="academy-tab-count">{pendingPromotions.length}</span>
            )}
          </button>
        ))}
      </nav>
      {error && (
        <div className="academy-error" role="alert">
          {error}
          <button type="button" className="btn-outline" onClick={() => void load()}>
            {text('Повторить', 'Қайталау')}
          </button>
        </div>
      )}
      {tab === 'overview' ? (
        <>
          <div className="academy-stat-grid">
            {[
              {
                title: text('Сотрудники учатся', 'Оқитын қызметкерлер'),
                value:
                  data.counts.enabledEmployees ??
                  data.employees.filter((item) => item.learningEnabled).length,
                Icon: Users,
              },
              {
                title: text('Курсов опубликовано', 'Жарияланған курстар'),
                value:
                  data.counts.publishedCourses ??
                  data.courses.filter((item) => item.published).length,
                Icon: BookOpenText,
              },
              {
                title: text('Тестов пройдено', 'Өтілген тесттер'),
                value:
                  data.counts.passedAttempts ?? data.results.filter((item) => item.passed).length,
                Icon: ClipboardCheck,
              },
              {
                title: text('Ждут повышения', 'Жоғарылауды күтуде'),
                value: pendingPromotions.length,
                Icon: Trophy,
              },
            ].map(({ title, value, Icon }) => (
              <article className="card academy-stat" key={title}>
                <span className="academy-stat-icon">
                  <Icon size={23} aria-hidden="true" />
                </span>
                <strong>{formatNumber(value)}</strong>
                <span>{title}</span>
              </article>
            ))}
          </div>
          <div className="academy-overview-grid">
            <article className="card academy-onboarding">
              <span className="academy-eyebrow">
                {text('ПРОГРАММА ОБУЧЕНИЯ', 'ОҚУ БАҒДАРЛАМАСЫ')}
              </span>
              <h2>
                {text(
                  'От первого урока до новой должности',
                  'Бірінші сабақтан жаңа лауазымға дейін',
                )}
              </h2>
              <ol>
                <li>
                  <strong>{text('Назначьте должность', 'Лауазымды тағайындаңыз')}</strong>
                  <span>
                    {text(
                      'Включите кабинет и укажите первый рабочий день.',
                      'Кабинетті қосып, алғашқы жұмыс күнін көрсетіңіз.',
                    )}
                  </span>
                </li>
                <li>
                  <strong>
                    {text('Дайте понятную программу', 'Түсінікті бағдарлама беріңіз')}
                  </strong>
                  <span>
                    {text(
                      'Курсы с видео и инструкциями, задания и сроки.',
                      'Бейне мен нұсқаулықтары бар курстар, тапсырмалар және мерзімдер.',
                    )}
                  </span>
                </li>
                <li>
                  <strong>{text('Проверьте знания', 'Білімді тексеріңіз')}</strong>
                  <span>
                    {text(
                      'Тесты формируются из банка вопросов. Повышение подтверждает руководитель.',
                      'Тесттер сұрақ қорынан жасалады. Жоғарылауды басшы бекітеді.',
                    )}
                  </span>
                </li>
              </ol>
              <button type="button" className="btn-classic" onClick={() => setTab('employees')}>
                {text('Настроить сотрудников', 'Қызметкерлерді баптау')}
              </button>
            </article>
            <section className="academy-recent">
              <div className="academy-section-title">
                <h2>{text('Результаты команды', 'Команда нәтижелері')}</h2>
                <button type="button" className="btn-outline" onClick={() => setTab('results')}>
                  {text('Все', 'Барлығы')}
                </button>
              </div>
              {pendingPromotions.length > 0 ? (
                pendingPromotions
                  .slice(0, 3)
                  .map((result) => <ResultCard key={result.id} result={result} />)
              ) : data.results.length ? (
                data.results
                  .slice(0, 3)
                  .map((result) => <ResultCard key={result.id} result={result} />)
              ) : (
                <PageState
                  compact
                  type="empty"
                  title={text('Первый результат впереди', 'Алғашқы нәтиже алда')}
                  description={text(
                    'Когда сотрудники пройдут тесты, результаты появятся здесь.',
                    'Қызметкерлер тест өткенде нәтижелер осында көрсетіледі.',
                  )}
                />
              )}
            </section>
          </div>
        </>
      ) : (
        <>
          <div className="academy-toolbar">
            <label className="academy-search">
              <Search size={18} aria-hidden="true" />
              <input
                type="search"
                aria-label={text('Поиск в разделе', 'Бөлімде іздеу')}
                placeholder={text('Найти по названию или имени', 'Атау немесе есім бойынша іздеу')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn-outline"
              disabled={loading}
              onClick={() => void load()}
              aria-label={text('Обновить данные обучения', 'Оқу деректерін жаңарту')}
            >
              <RefreshCw className={loading ? 'spin' : ''} size={18} aria-hidden="true" />
            </button>
            {create && (
              <button type="button" className="btn-classic" onClick={create}>
                <Plus size={18} aria-hidden="true" />
                {createLabel}
              </button>
            )}
          </div>
          {tab === 'courses' && (
            <div className="academy-content-grid">
              {data.courses
                .filter((item) => matches(query, item.title, item.description))
                .map((course) => (
                  <article key={course.id} className="card academy-content-card">
                    <div className="academy-card-top">
                      <span className="academy-stat-icon">
                        <BookOpenText size={25} aria-hidden="true" />
                      </span>
                      <Status good={course.published}>
                        {course.published
                          ? text('Опубликован', 'Жарияланған')
                          : text('Черновик', 'Жоба')}
                      </Status>
                    </div>
                    <h2>{course.title}</h2>
                    <p>
                      {course.description ||
                        text('Описание ещё не добавлено.', 'Сипаттама қосылмаған.')}
                    </p>
                    <span className="academy-hint">{rolesForCourse(course.roleIds)}</span>
                    <div className="academy-card-footer">
                      <span>
                        {course.modules.length} {text('модулей', 'модуль')} ·{' '}
                        {course.modules.reduce((count, module) => count + module.lessons.length, 0)}{' '}
                        {text('уроков', 'сабақ')}
                      </span>
                      <button
                        type="button"
                        className="btn-outline"
                        onClick={() => setDialog({ type: 'course', course })}
                      >
                        <Pencil size={17} aria-hidden="true" />
                        {text('Изменить', 'Өзгерту')}
                      </button>
                    </div>
                  </article>
                ))}
              {!data.courses.filter((item) => matches(query, item.title, item.description))
                .length && (
                <PageState
                  type="empty"
                  title={text('Нет курсов', 'Курс жоқ')}
                  description={
                    query
                      ? text('Попробуйте другой запрос.', 'Басқа сұранысты көріңіз.')
                      : text(
                          'Создайте первый курс с модулями, уроками и видео.',
                          'Модуль, сабақ және бейне бар алғашқы курсты құрыңыз.',
                        )
                  }
                  action={
                    !query && (
                      <button type="button" className="btn-classic" onClick={create}>
                        {createLabel}
                      </button>
                    )
                  }
                />
              )}
            </div>
          )}
          {tab === 'assessments' && (
            <div className="academy-content-grid">
              {data.assessments
                .filter((item) => matches(query, item.title, item.description))
                .map((assessment) => (
                  <article key={assessment.id} className="card academy-content-card">
                    <div className="academy-card-top">
                      <span className="academy-stat-icon">
                        <ClipboardCheck size={25} aria-hidden="true" />
                      </span>
                      <Status good={assessment.published}>
                        {assessment.published
                          ? text('Опубликован', 'Жарияланған')
                          : text('Черновик', 'Жоба')}
                      </Status>
                    </div>
                    <span className="academy-eyebrow">{kindLabel(assessment.kind)}</span>
                    <h2>{assessment.title}</h2>
                    <p>{assessment.description}</p>
                    <div className="academy-test-metrics">
                      <span>
                        {assessment.questionCount} {text('вопросов', 'сұрақ')}
                      </span>
                      <span>
                        {assessment.passPercent}% {text('для зачёта', 'өту үшін')}
                      </span>
                      <span>
                        {assessment.timeLimitMinutes} {text('минут', 'минут')}
                      </span>
                    </div>
                    <span className="academy-hint">{rolesForCourse(assessment.roleIds)}</span>
                    <div className="academy-card-footer">
                      <span>
                        {text('Банк:', 'Қор:')} {assessment.questions?.length || 0}
                      </span>
                      <button
                        type="button"
                        className="btn-outline"
                        onClick={() => setDialog({ type: 'assessment', assessment })}
                      >
                        <Pencil size={17} aria-hidden="true" />
                        {text('Изменить', 'Өзгерту')}
                      </button>
                    </div>
                  </article>
                ))}
              {!data.assessments.filter((item) => matches(query, item.title, item.description))
                .length && (
                <PageState
                  type="empty"
                  title={text('Нет тестов', 'Тест жоқ')}
                  description={
                    query
                      ? text('Попробуйте другой запрос.', 'Басқа сұранысты көріңіз.')
                      : text(
                          'Создайте банк вопросов и правила генерации теста.',
                          'Сұрақ қоры мен тест жасау ережесін құрыңыз.',
                        )
                  }
                  action={
                    !query && (
                      <button type="button" className="btn-classic" onClick={create}>
                        {createLabel}
                      </button>
                    )
                  }
                />
              )}
            </div>
          )}
          {tab === 'employees' && (
            <div className="academy-employee-list">
              {data.employees
                .filter((item) =>
                  matches(query, item.displayName, item.username, item.jobRole?.title),
                )
                .map((employee) => (
                  <article className="card academy-employee" key={employee.username}>
                    <div className="academy-employee-name">
                      <span className="academy-avatar" aria-hidden="true">
                        {(employee.displayName || employee.username).slice(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <h2>{employee.displayName || employee.username}</h2>
                        <p>
                          {employee.jobRole?.title ||
                            text('Должность не назначена', 'Лауазым тағайындалмаған')}
                        </p>
                        <small>
                          {employee.tenureDays === null
                            ? text(
                                'Дата начала работы не указана',
                                'Жұмыс басталған күн көрсетілмеген',
                              )
                            : `${text('Стаж:', 'Еңбек өтілі:')} ${employee.tenureDays} ${text('дней', 'күн')}`}
                        </small>
                      </div>
                    </div>
                    <div className="academy-employee-progress">
                      <strong>
                        {text('Уровень', 'Деңгей')} {employee.progress?.level || 1} ·{' '}
                        {employee.progress?.xp || 0} XP
                      </strong>
                      <span>
                        {employee.progress?.completedCourses || 0} {text('курсов', 'курс')} ·{' '}
                        {employee.progress?.completedLessons || 0} {text('уроков', 'сабақ')}
                      </span>
                      <Status good={employee.learningEnabled}>
                        {employee.learningEnabled
                          ? text('Обучение включено', 'Оқу қосылған')
                          : text('Обучение выключено', 'Оқу өшірілген')}
                      </Status>
                    </div>
                    <div className="academy-employee-actions">
                      <button
                        type="button"
                        className="btn-outline"
                        onClick={() => setDialog({ type: 'employee', employee })}
                      >
                        {text('Настроить', 'Баптау')}
                      </button>
                      <button
                        type="button"
                        className="btn-outline"
                        onClick={() => setDialog({ type: 'assignment', employee })}
                      >
                        {text('Назначить', 'Тағайындау')}
                      </button>
                    </div>
                  </article>
                ))}
              {!data.employees.filter((item) =>
                matches(query, item.displayName, item.username, item.jobRole?.title),
              ).length && (
                <PageState
                  type="empty"
                  title={text('Сотрудники не найдены', 'Қызметкер табылмады')}
                  description={
                    query
                      ? text(
                          'Попробуйте другое имя или должность.',
                          'Басқа есім немесе лауазымды көріңіз.',
                        )
                      : text(
                          'Добавьте сотрудника в разделе «Доступы», затем включите обучение.',
                          '«Қолжетімділік» бөлімінде қызметкер қосып, оқуды қосыңыз.',
                        )
                  }
                />
              )}
            </div>
          )}
          {tab === 'roles' && (
            <div className="academy-content-grid">
              {data.roles
                .filter((item) => matches(query, item.title, item.description))
                .map((jobRole) => (
                  <article className="card academy-content-card" key={jobRole.id}>
                    <div className="academy-card-top">
                      <span className="academy-stat-icon">
                        <Users size={25} aria-hidden="true" />
                      </span>
                      <Status good={jobRole.active}>
                        {jobRole.active
                          ? text('Активна', 'Белсенді')
                          : text('В архиве', 'Мұрағатта')}
                      </Status>
                    </div>
                    <h2>{jobRole.title}</h2>
                    <p>{jobRole.description}</p>
                    <div className="academy-card-footer">
                      <span>
                        {
                          data.employees.filter((employee) => employee.jobRoleId === jobRole.id)
                            .length
                        }{' '}
                        {text('сотрудников', 'қызметкер')}
                      </span>
                      <button
                        type="button"
                        className="btn-outline"
                        onClick={() => setDialog({ type: 'role', role: jobRole })}
                      >
                        <Pencil size={17} aria-hidden="true" />
                        {text('Изменить', 'Өзгерту')}
                      </button>
                    </div>
                  </article>
                ))}
              {!data.roles.filter((item) => matches(query, item.title, item.description))
                .length && (
                <PageState
                  type="empty"
                  title={text('Нет подходящих должностей', 'Сәйкес лауазым жоқ')}
                />
              )}
            </div>
          )}
          {tab === 'assignments' && (
            <div className="academy-assignment-list">
              {data.assignments
                .filter((item) =>
                  matches(
                    query,
                    data.employees.find((employee) => employee.username === item.employeeUsername)
                      ?.displayName,
                    item.employeeUsername,
                    data.roles.find((jobRole) => jobRole.id === item.roleId)?.title,
                    data.courses.find((course) => course.id === item.courseId)?.title,
                    data.assessments.find((assessment) => assessment.id === item.assessmentId)
                      ?.title,
                  ),
                )
                .map((assignment) => (
                  <article className="card academy-assignment" key={assignment.id}>
                    <span className="academy-stat-icon">
                      <BookOpenText size={22} aria-hidden="true" />
                    </span>
                    <div>
                      <h2>
                        {assignment.courseId
                          ? data.courses.find((course) => course.id === assignment.courseId)
                              ?.title || text('Курс недоступен', 'Курс қолжетімсіз')
                          : data.assessments.find(
                              (assessment) => assessment.id === assignment.assessmentId,
                            )?.title || text('Тест недоступен', 'Тест қолжетімсіз')}
                      </h2>
                      <p>
                        {assignment.employeeUsername
                          ? data.employees.find(
                              (employee) => employee.username === assignment.employeeUsername,
                            )?.displayName || assignment.employeeUsername
                          : `${text('Должность:', 'Лауазым:')} ${data.roles.find((jobRole) => jobRole.id === assignment.roleId)?.title || '—'}`}
                      </p>
                      <small>
                        {assignment.dueAt
                          ? `${text('До', 'Дейін')} ${formatDate(assignment.dueAt)}`
                          : text('Без срока', 'Мерзімсіз')}
                      </small>
                    </div>
                    <Status>
                      {assignment.required
                        ? text('Обязательно', 'Міндетті')
                        : text('Рекомендовано', 'Ұсынылған')}
                    </Status>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={Boolean(busy)}
                      aria-label={text('Отменить назначение', 'Тағайындауды жою')}
                      onClick={() => void deleteAssignment(assignment.id)}
                    >
                      <Trash2 size={18} />
                    </button>
                  </article>
                ))}
              {!data.assignments.length && (
                <PageState
                  type="empty"
                  title={text('Пока нет назначений', 'Тағайындау жоқ')}
                  description={text(
                    'Назначьте курс или тест сотруднику либо всей должности.',
                    'Қызметкерге немесе лауазымның барлығына курс не тест тағайындаңыз.',
                  )}
                  action={
                    <button type="button" className="btn-classic" onClick={create}>
                      {createLabel}
                    </button>
                  }
                />
              )}
            </div>
          )}
          {tab === 'results' && (
            <section className="academy-results-list">
              {pendingPromotions.length > 0 && (
                <p className="academy-editor-intro">
                  <Trophy size={18} aria-hidden="true" />{' '}
                  {text(
                    'Повышение ожидает решения руководителя.',
                    'Жоғарылау басшы шешімін күтуде.',
                  )}
                </p>
              )}
              {data.results
                .filter((item) => matches(query, item.displayName, item.username, item.title))
                .map((result) => (
                  <ResultCard key={result.id} result={result} />
                ))}
              {!data.results.filter((item) =>
                matches(query, item.displayName, item.username, item.title),
              ).length && (
                <PageState
                  type="empty"
                  title={text('Результатов пока нет', 'Нәтиже жоқ')}
                  description={
                    query
                      ? text('Попробуйте другой запрос.', 'Басқа сұранысты көріңіз.')
                      : text(
                          'Здесь появятся попытки тестов и решения о повышении.',
                          'Тест талпыныстары мен жоғарылау шешімдері осында көрсетіледі.',
                        )
                  }
                />
              )}
            </section>
          )}
        </>
      )}
      {dialog?.type === 'course' && (
        <CourseEditor
          key={dialog.course?.id || 'new-course'}
          course={dialog.course}
          roles={data.roles}
          text={text}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {dialog?.type === 'assessment' && (
        <AssessmentEditor
          key={dialog.assessment?.id || 'new-assessment'}
          assessment={dialog.assessment}
          roles={data.roles}
          courses={data.courses}
          text={text}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {dialog?.type === 'role' && (
        <RoleEditor
          key={dialog.role?.id || 'new-role'}
          role={dialog.role}
          text={text}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {dialog?.type === 'employee' && (
        <EmployeeEditor
          key={dialog.employee.username}
          employee={dialog.employee}
          roles={data.roles}
          text={text}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {dialog?.type === 'assignment' && (
        <AssignmentEditor
          employees={data.employees}
          roles={data.roles}
          courses={data.courses}
          assessments={data.assessments}
          employee={dialog.employee}
          canAssignRole={contentManager}
          text={text}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
}
