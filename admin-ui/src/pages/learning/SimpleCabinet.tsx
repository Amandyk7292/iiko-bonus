import { BookOpenText, ChevronRight, Clock } from '../../components/BulkaIcons';
import PageState from '../../components/PageState';
import { Achievements } from './CabinetViews';
import { useLearningCopy } from './copy';
import {
  assessmentAvailability,
  assessmentPrerequisites,
  courseLessons,
  courseProgress,
  latestActiveAttempt,
} from './model';
import type { Assessment, Assignment, Cabinet, Catalog, Course } from './types';

type Actions = {
  openCourse: (course: Course) => void;
  openAttempt: (id: string) => void;
  startAssessment: (assessment: Assessment) => void;
};
const assignmentFor = (cabinet: Cabinet, id: string) =>
  cabinet.assignments.find((item) => item.courseId === id || item.assessmentId === id);
const passed = (cabinet: Cabinet, id: string) =>
  cabinet.attempts.some((attempt) => attempt.assessmentId === id && attempt.passed === true);
function canStart(assessment: Assessment, cabinet: Cabinet, catalog: Catalog) {
  const required = assessmentPrerequisites(
    assessment,
    catalog.courses,
    cabinet.progress,
    cabinet.profile.tenureDays,
  );
  const available = assessmentAvailability(assessment, cabinet.attempts);
  return (
    Boolean(available.active) ||
    (!required.missingCourses.length &&
      !required.missingStartDate &&
      !required.remainingDays &&
      !available.exhausted &&
      !available.cooldownUntil &&
      assessment.questionCount > 0)
  );
}
function nextAssigned(cabinet: Cabinet, catalog: Catalog) {
  const assignments = [...cabinet.assignments].sort(
    (a, b) =>
      Number(b.required) - Number(a.required) ||
      (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity),
  );
  for (const assignment of assignments) {
    const course = catalog.courses.find((item) => item.id === assignment.courseId);
    if (
      course &&
      courseProgress(course, cabinet.progress).total &&
      !courseProgress(course, cabinet.progress).complete
    )
      return { course, assessment: undefined };
    const assessment = catalog.assessments.find((item) => item.id === assignment.assessmentId);
    if (!assessment || passed(cabinet, assessment.id)) continue;
    if (canStart(assessment, cabinet, catalog)) return { course: undefined, assessment };
    const prerequisite = catalog.courses.find(
      (item) =>
        assessment.requiredCourseIds.includes(item.id) &&
        courseProgress(item, cabinet.progress).total &&
        !courseProgress(item, cabinet.progress).complete,
    );
    if (prerequisite) return { course: prerequisite, assessment: undefined };
  }
  return undefined;
}

export function LearningHome({
  cabinet,
  catalog,
  busy,
  openCourse,
  openAttempt,
  startAssessment,
  showTests,
}: { cabinet: Cabinet; catalog: Catalog; busy: boolean; showTests: () => void } & Actions) {
  const { text, date } = useLearningCopy();
  const active = latestActiveAttempt(
    cabinet.attempts.filter((item) => Date.parse(item.deadlineAt) > Date.now()),
  );
  const assigned = nextAssigned(cabinet, catalog);
  const unfinished = catalog.courses.filter(
    (item) =>
      courseProgress(item, cabinet.progress).total &&
      !courseProgress(item, cabinet.progress).complete,
  );
  const nextCourse =
    active || assigned?.assessment
      ? undefined
      : assigned?.course ||
        unfinished.find((item) => courseProgress(item, cabinet.progress).count > 0) ||
        unfinished[0];
  const nextAssessment =
    active || nextCourse
      ? undefined
      : assigned?.assessment ||
        catalog.assessments.find(
          (item) => !passed(cabinet, item.id) && canStart(item, cabinet, catalog),
        );
  const assignment: Assignment | undefined = nextCourse
    ? assignmentFor(cabinet, nextCourse.id)
    : nextAssessment
      ? assignmentFor(cabinet, nextAssessment.id)
      : undefined;
  const lessons = nextCourse ? courseLessons(nextCourse) : [];
  const completed = new Set(cabinet.progress.lessons.map((item) => item.lessonId));
  const lessonIndex = lessons.findIndex((item) => !completed.has(item.id));
  const lesson = lessons[lessonIndex];
  const remainingCourses = catalog.courses.filter((item) => item.id !== nextCourse?.id);
  const assignedTests = catalog.assessments.filter(
    (item) =>
      item.id !== nextAssessment?.id &&
      assignmentFor(cabinet, item.id) &&
      !passed(cabinet, item.id),
  );
  return (
    <>
      {active || nextCourse || nextAssessment ? (
        <section
          className="academy-card academy-next"
          aria-label={text('Следующее задание', 'Келесі тапсырма')}
        >
          <div className="academy-next-meta">
            <span>{active || nextAssessment ? text('Тест', 'Тест') : text('Курс', 'Курс')}</span>
            {assignment?.required && <span>{text('Обязательно', 'Міндетті')}</span>}
          </div>
          <h2>{active?.title || nextCourse?.title || nextAssessment?.title}</h2>
          {lesson && <p>{lesson.title}</p>}
          <div className="academy-course-meta">
            {lesson && (
              <span>
                {text('Урок', 'Сабақ')} {lessonIndex + 1} / {lessons.length}
              </span>
            )}
            {Boolean(lesson?.estimatedMinutes || nextAssessment?.timeLimitMinutes) && (
              <span>
                <Clock size={15} aria-hidden="true" />
                {lesson?.estimatedMinutes || nextAssessment?.timeLimitMinutes} {text('мин', 'мин')}
              </span>
            )}
            {assignment?.dueAt && (
              <span>
                {text('До', 'Дейін')} {date(assignment.dueAt)}
              </span>
            )}
          </div>
          <button
            type="button"
            className="academy-primary"
            disabled={busy}
            onClick={() =>
              active
                ? openAttempt(active.id)
                : nextCourse
                  ? openCourse(nextCourse)
                  : nextAssessment && startAssessment(nextAssessment)
            }
          >
            {busy
              ? text('Открываем…', 'Ашылуда…')
              : active || (nextCourse && courseProgress(nextCourse, cabinet.progress).count > 0)
                ? text('Продолжить', 'Жалғастыру')
                : text('Начать', 'Бастау')}
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </section>
      ) : (
        <PageState
          type="empty"
          title={
            catalog.courses.length || catalog.assessments.length
              ? text('Новых заданий нет', 'Жаңа тапсырма жоқ')
              : text('Заданий пока нет', 'Әзірге тапсырма жоқ')
          }
        />
      )}
      {remainingCourses.length > 0 && (
        <section>
          <h2 className="academy-list-title">{text('Курсы', 'Курстар')}</h2>
          <div className="academy-learning-list">
            {remainingCourses.map((course) => {
              const progress = courseProgress(course, cabinet.progress);
              const assignedCourse = assignmentFor(cabinet, course.id);
              return (
                <button
                  type="button"
                  className="academy-learning-row"
                  key={course.id}
                  onClick={() => openCourse(course)}
                  disabled={!progress.total}
                >
                  <BookOpenText size={22} aria-hidden="true" />
                  <span className="academy-learning-row-copy">
                    <strong>{course.title}</strong>
                    <small>
                      {progress.complete
                        ? text('Пройден', 'Аяқталды')
                        : `${progress.count} / ${progress.total} ${text('уроков', 'сабақ')}`}
                      {assignedCourse?.required && ` · ${text('Обязательно', 'Міндетті')}`}
                      {assignedCourse?.dueAt &&
                        ` · ${text('До', 'Дейін')} ${date(assignedCourse.dueAt)}`}
                    </small>
                  </span>
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </section>
      )}
      {assignedTests.length > 0 && (
        <section>
          <h2 className="academy-list-title">
            {text('Назначенные тесты', 'Тағайындалған тесттер')}
          </h2>
          <div className="academy-learning-list">
            {assignedTests.map((assessment) => (
              <button
                type="button"
                className="academy-learning-row"
                key={assessment.id}
                onClick={showTests}
              >
                <BookOpenText size={22} aria-hidden="true" />
                <span className="academy-learning-row-copy">
                  <strong>{assessment.title}</strong>
                  <small>
                    {canStart(assessment, cabinet, catalog)
                      ? text('Можно начать', 'Бастауға болады')
                      : text('Есть условия допуска', 'Қатысу шарттары бар')}
                  </small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export function Profile({ cabinet }: { cabinet: Cabinet }) {
  const { text, number, date } = useLearningCopy();
  const rows = [
    [
      text('Должность', 'Лауазым'),
      cabinet.profile.jobRole?.title || text('Не указана', 'Көрсетілмеген'),
    ],
    [
      text('Первый рабочий день', 'Алғашқы жұмыс күні'),
      cabinet.profile.startDate
        ? date(cabinet.profile.startDate)
        : text('Не подтверждён', 'Расталмаған'),
    ],
    [
      text('Стаж', 'Жұмыс өтілі'),
      cabinet.profile.tenureDays === null
        ? '—'
        : `${number(cabinet.profile.tenureDays)} ${text('дней', 'күн')}`,
    ],
    [text('Уровень', 'Деңгей'), number(cabinet.progress.level)],
    [text('Опыт обучения', 'Оқу тәжірибесі'), `${number(cabinet.progress.xp)} XP`],
    [text('Пройдено уроков', 'Аяқталған сабақтар'), number(cabinet.progress.completedLessons)],
    [text('Завершено курсов', 'Аяқталған курстар'), number(cabinet.progress.completedCourses)],
  ];
  return (
    <section className="academy-card academy-profile">
      <h2>{text('Профиль', 'Профиль')}</h2>
      <dl className="academy-profile-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {!cabinet.profile.startDate && (
        <p className="academy-note">
          {text(
            'Дату начала работы подтверждает управляющий.',
            'Жұмысқа кіріскен күнді менеджер растайды.',
          )}
        </p>
      )}
    </section>
  );
}

export function Results({
  cabinet,
  openAttempt,
}: {
  cabinet: Cabinet;
  openAttempt: Actions['openAttempt'];
}) {
  const { text, datetime } = useLearningCopy();
  return (
    <>
      <section className="academy-card academy-history">
        <h2>{text('Результаты тестов', 'Тест нәтижелері')}</h2>
        {!cabinet.attempts.length ? (
          <p className="academy-note">
            {text('Вы ещё не проходили тесты.', 'Әлі тест тапсырмадыңыз.')}
          </p>
        ) : (
          <div className="academy-history-list">
            {[...cabinet.attempts]
              .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
              .map((attempt) => (
                <button
                  type="button"
                  key={attempt.id}
                  className="academy-history-row"
                  onClick={() => openAttempt(attempt.id)}
                >
                  <span>
                    <strong>{attempt.title}</strong>
                    <small>{datetime(attempt.startedAt)}</small>
                  </span>
                  <span>
                    {attempt.status === 'in_progress'
                      ? text('Продолжить', 'Жалғастыру')
                      : attempt.status === 'expired'
                        ? text('Время истекло', 'Уақыт аяқталды')
                        : `${attempt.scorePercent === null ? '—' : attempt.scorePercent + '%'} · ${attempt.passed ? text('Пройден', 'Өтті') : text('Не пройден', 'Өтпеді')}`}
                    <ChevronRight size={17} aria-hidden="true" />
                  </span>
                </button>
              ))}
          </div>
        )}
      </section>
      <section>
        <h2 className="academy-list-title">{text('Достижения', 'Жетістіктер')}</h2>
        <Achievements cabinet={cabinet} />
      </section>
    </>
  );
}
