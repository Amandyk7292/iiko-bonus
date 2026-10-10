import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpenText,
  ClipboardCheck,
  RefreshCw,
  Trophy,
  UserRound,
} from '../../components/BulkaIcons';
import PageState from '../../components/PageState';
import { ApiError } from '../../lib/api';
import { useNavigationBlocker, useSearchParams } from '../../lib/router';
import { learningApi } from './api';
import { AssessmentCards } from './CabinetViews';
import { LearningHome, Profile, Results } from './SimpleCabinet';
import AttemptView from './AttemptView';
import LessonView from './LessonView';
import { useLearningCopy } from './copy';
import {
  clearDraft,
  courseLessons,
  latestActiveAttempt,
  readDraft,
  saveDraft,
  validAnswers,
} from './model';
import type { Assessment, Attempt, Cabinet, Catalog, Course, Lesson } from './types';
import './learning.css';

const accessDenied = (error: unknown) =>
  error instanceof ApiError &&
  ['LEARNING_ACCESS_DISABLED', 'LEARNING_ACCOUNT_INACTIVE', 'LEARNING_ROLE_INACTIVE'].includes(
    error.code || '',
  );

export default function LearningPage({ role }: { role?: string }) {
  const { text } = useLearningCopy();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') || 'dashboard';
  const tabView = view === 'courses' ? 'dashboard' : view === 'achievements' ? 'results' : view;
  const courseId = params.get('course');
  const lessonId = params.get('lesson');
  const attemptId = params.get('attempt');
  const [cabinet, setCabinet] = useState<Cabinet>();
  const [catalog, setCatalog] = useState<Catalog>();
  const [course, setCourse] = useState<Course>();
  const [attempt, setAttempt] = useState<Attempt>();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [loadError, setLoadError] = useState<unknown>();
  const [selectionError, setSelectionError] = useState<unknown>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [selectionTick, setSelectionTick] = useState(0);
  const mounted = useRef(true);
  const pending = useRef(false);
  const firstLoad = useRef(true);
  const initialParams = useRef(new URLSearchParams(params));
  const errorMessage = (error: unknown) =>
    error instanceof Error
      ? error.message
      : text(
          'Не удалось загрузить обучение. Повторите попытку.',
          'Оқуды жүктеу мүмкін болмады. Қайталап көріңіз.',
        );
  const handleAccessDenied = (error: unknown) => {
    if (!accessDenied(error)) return false;
    setCabinet(undefined);
    setCatalog(undefined);
    setCourse(undefined);
    setAttempt(undefined);
    setAnswers({});
    setMessage('');
    setLoadError(error);
    return true;
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(undefined);
    Promise.all([learningApi.me(controller.signal), learningApi.catalog(controller.signal)])
      .then(([me, available]) => {
        if (controller.signal.aborted) return;
        setCabinet(me);
        setCatalog(available);
        if (firstLoad.current) {
          firstLoad.current = false;
          const active = latestActiveAttempt(me.attempts);
          if (
            active &&
            (!initialParams.current.get('view') ||
              initialParams.current.get('view') === 'assessments') &&
            !initialParams.current.get('course') &&
            !initialParams.current.get('attempt')
          )
            setParams({ view: 'assessments', attempt: active.id }, { replace: true });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          handleAccessDenied(error);
          setLoadError(error);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshTick]);

  useEffect(() => {
    if (!cabinet) return;
    const controller = new AbortController();
    setSelectionError(undefined);
    setCourse(undefined);
    setAttempt(undefined);
    setAnswers({});
    setMessage('');
    if (!courseId && !attemptId) {
      setSelectionLoading(false);
      return;
    }
    setSelectionLoading(true);
    const selected = attemptId
      ? learningApi.attempt(attemptId, controller.signal).then(({ attempt: loaded }) => {
          if (controller.signal.aborted) return;
          setAttempt(loaded);
          setAnswers(readDraft(cabinet.profile.username, loaded));
          setCabinet(
            (current) =>
              current && {
                ...current,
                attempts: [...current.attempts.filter((item) => item.id !== loaded.id), loaded],
              },
          );
        })
      : learningApi.course(courseId!, controller.signal).then(({ course: loaded, progress }) => {
          if (controller.signal.aborted) return;
          setCourse(loaded);
          setCabinet((current) => current && { ...current, progress });
        });
    selected
      .catch((error) => {
        if (!controller.signal.aborted && !handleAccessDenied(error)) setSelectionError(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSelectionLoading(false);
      });
    return () => controller.abort();
  }, [cabinet?.profile.username, courseId, attemptId, selectionTick]);

  const dirty = attempt?.status === 'in_progress' && validAnswers(attempt, answers).length > 0;
  useNavigationBlocker(busy || Boolean(dirty), () =>
    pending.current
      ? false
      : dirty
        ? window.confirm(
            text(
              'Ответы ещё не отправлены. Выйти из теста? Черновик останется в этой вкладке.',
              'Жауаптар әлі жіберілмеген. Тесттен шығасыз ба? Нобай осы қойындыда қалады.',
            ),
          )
        : true,
  );
  useEffect(() => {
    if (!dirty && !busy) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty, busy]);

  const openCourse = (item: Course) => {
    if (!cabinet) return;
    const completed = new Set(cabinet.progress.lessons.map((entry) => entry.lessonId));
    const lesson =
      courseLessons(item).find((entry) => !completed.has(entry.id)) || courseLessons(item)[0];
    setParams({ view: 'courses', course: item.id, ...(lesson && { lesson: lesson.id }) });
  };
  const openAttempt = (id: string) => setParams({ view: 'assessments', attempt: id });
  const mutate = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      if (mounted.current && !handleAccessDenied(error)) setMessage(errorMessage(error));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const complete = (lesson: Lesson) =>
    void mutate(async () => {
      const result = await learningApi.complete(lesson.id);
      if (mounted.current)
        setCabinet(
          (current) =>
            current && { ...current, progress: result.progress, achievements: result.achievements },
        );
    });
  const startAssessment = (assessment: Assessment) =>
    void mutate(async () => {
      const result = await learningApi.start(assessment.id);
      if (!mounted.current) return;
      // Navigate after the mutation guard releases; GET restores the authoritative attempt.
      pending.current = false;
      setBusy(false);
      setCabinet(
        (current) =>
          current && {
            ...current,
            attempts: [
              ...current.attempts.filter((item) => item.id !== result.attempt.id),
              result.attempt,
            ],
          },
      );
      openAttempt(result.attempt.id);
    });
  const changeAnswer = (question: string, choice: string) => {
    if (!attempt || !cabinet || busy || attempt.status !== 'in_progress') return;
    const next = { ...answers, [question]: choice };
    setAnswers(next);
    saveDraft(cabinet.profile.username, attempt, next);
  };
  const submit = () => {
    if (!attempt || !cabinet || attempt.status !== 'in_progress') return;
    const checked = validAnswers(attempt, answers);
    if (!attempt.questions.length || checked.length !== attempt.questions.length) {
      setMessage(
        text(
          'Ответьте на каждый вопрос перед отправкой.',
          'Жібермес бұрын әр сұраққа жауап беріңіз.',
        ),
      );
      return;
    }
    void mutate(async () => {
      const result = await learningApi.submit(attempt.id, checked);
      if (!mounted.current) return;
      clearDraft(cabinet.profile.username, attempt.id);
      setAttempt(result.attempt);
      setCabinet(
        (current) =>
          current && {
            ...current,
            progress: result.progress,
            achievements: result.achievements,
            attempts: [
              ...current.attempts.filter((item) => item.id !== result.attempt.id),
              result.attempt,
            ],
          },
      );
    });
  };

  if (!cabinet || !catalog) {
    const disabled = accessDenied(loadError);
    return (
      <div className="academy">
        <PageState
          type={loadError ? (disabled ? 'empty' : 'error') : 'loading'}
          title={disabled ? text('Обучение пока не подключено', 'Оқу әлі қосылмаған') : undefined}
          description={
            loadError
              ? disabled
                ? text(
                    'Попросите управляющего включить обучение для вашей учётной записи и проверить должность.',
                    'Менеджерден тіркелгіңіз үшін оқуды қосып, лауазымды тексеруді сұраңыз.',
                  )
                : errorMessage(loadError)
              : undefined
          }
          onRetry={loadError ? () => setRefreshTick((value) => value + 1) : undefined}
        />
        {disabled && ['owner', 'admin', 'branch_manager'].includes(role || '') && (
          <p className="academy-note">
            {text(
              'Доступ к личному обучению настраивается в управлении Академией.',
              'Жеке оқуға қолжетімділік Академияны басқаруда бапталады.',
            )}
          </p>
        )}
      </div>
    );
  }
  if (!cabinet.profile.learningEnabled)
    return (
      <div className="academy">
        <PageState
          type="empty"
          title={text('Обучение отключено', 'Оқу өшірілген')}
          description={text(
            'Обратитесь к управляющему для подключения обучения.',
            'Оқуды қосу үшін менеджерге хабарласыңыз.',
          )}
        />
      </div>
    );
  const tabs = [
    { id: 'dashboard', label: text('Обучение', 'Оқу'), icon: BookOpenText },
    {
      id: 'assessments',
      label: text('Тесты', 'Тесттер'),
      icon: ClipboardCheck,
    },
    { id: 'results', label: text('Результаты', 'Нәтижелер'), icon: Trophy },
    { id: 'profile', label: text('Профиль', 'Профиль'), icon: UserRound },
  ];
  return (
    <div className="academy" aria-busy={loading || selectionLoading || busy}>
      <header className="academy-heading">
        <h1>
          {text('Здравствуйте', 'Сәлеметсіз бе')},{' '}
          {cabinet.profile.displayName || cabinet.profile.username}
        </h1>
        <button
          type="button"
          className="academy-refresh"
          disabled={loading || busy}
          onClick={() => {
            setRefreshTick((value) => value + 1);
            setSelectionTick((value) => value + 1);
          }}
          aria-label={text('Обновить обучение', 'Оқуды жаңарту')}
        >
          <RefreshCw size={18} aria-hidden="true" />
        </button>
      </header>
      <nav className="academy-nav" aria-label={text('Разделы обучения', 'Оқу бөлімдері')}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-current={tabView === tab.id ? 'page' : undefined}
            onClick={() => setParams({ view: tab.id })}
            disabled={busy}
          >
            <tab.icon size={18} aria-hidden="true" />
            {tab.label}
          </button>
        ))}
      </nav>
      {Boolean(loadError) && (
        <div className="academy-alert" role="alert">
          <AlertCircle size={19} aria-hidden="true" />
          {errorMessage(loadError)}
        </div>
      )}
      {message && (
        <div className="academy-alert" role="alert">
          <AlertCircle size={19} aria-hidden="true" />
          {message}
        </div>
      )}
      {courseId || attemptId ? (
        selectionLoading ? (
          <PageState type="loading" />
        ) : selectionError ? (
          <PageState
            type="error"
            description={errorMessage(selectionError)}
            onRetry={() => setSelectionTick((value) => value + 1)}
          />
        ) : attempt ? (
          <AttemptView
            attempt={attempt}
            answers={answers}
            busy={busy}
            changeAnswer={changeAnswer}
            submit={submit}
            back={() => setParams({ view: 'assessments' })}
            refresh={() => setSelectionTick((value) => value + 1)}
          />
        ) : course ? (
          <LessonView
            course={course}
            progress={cabinet.progress}
            lessonId={lessonId}
            busy={busy}
            selectLesson={(id) => setParams({ view: 'courses', course: course.id, lesson: id })}
            complete={complete}
            back={() => setParams({ view: 'courses' })}
          />
        ) : null
      ) : tabView === 'assessments' ? (
        <AssessmentCards
          cabinet={cabinet}
          catalog={catalog}
          busy={busy}
          openAttempt={openAttempt}
          startAssessment={startAssessment}
        />
      ) : tabView === 'results' ? (
        <Results cabinet={cabinet} openAttempt={openAttempt} />
      ) : tabView === 'profile' ? (
        <Profile cabinet={cabinet} />
      ) : (
        <LearningHome
          cabinet={cabinet}
          catalog={catalog}
          busy={busy}
          openCourse={openCourse}
          openAttempt={openAttempt}
          startAssessment={startAssessment}
          showTests={() => setParams({ view: 'assessments' })}
        />
      )}
    </div>
  );
}
