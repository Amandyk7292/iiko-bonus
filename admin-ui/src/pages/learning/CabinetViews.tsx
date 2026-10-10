import { BookOpenText, Clock, LockKeyhole, Trophy } from '../../components/BulkaIcons';
import PageState from '../../components/PageState';
import { assessmentAvailability, assessmentPrerequisites } from './model';
import { useLearningCopy } from './copy';
import type { Assessment, Cabinet, Catalog, Course } from './types';

type Actions = {
  openCourse: (course: Course) => void;
  openAttempt: (id: string) => void;
  startAssessment: (assessment: Assessment) => void;
};
export function AssessmentCards({
  cabinet,
  catalog,
  busy,
  openAttempt,
  startAssessment,
}: { cabinet: Cabinet; catalog: Catalog; busy: boolean } & Pick<
  Actions,
  'openAttempt' | 'startAssessment'
>) {
  const { text, datetime, date } = useLearningCopy();
  const labels = {
    practice: text('Практика', 'Тәжірибе'),
    control: text('Контрольный тест', 'Бақылау тесті'),
    promotion: text('Экзамен на повышение', 'Жоғарылату емтиханы'),
  };
  if (!catalog.assessments.length)
    return <PageState type="empty" title={text('Тестов пока нет', 'Әзірге тест жоқ')} />;
  return (
    <>
      <div className="academy-course-grid">
        {catalog.assessments.map((assessment) => {
          const prerequisites = assessmentPrerequisites(
            assessment,
            catalog.courses,
            cabinet.progress,
            cabinet.profile.tenureDays,
          );
          const availability = assessmentAvailability(assessment, cabinet.attempts);
          const assignment = cabinet.assignments.find(
            (item) => item.assessmentId === assessment.id,
          );
          const reasons = [
            prerequisites.missingCourses.length
              ? text(
                  'Сначала завершите обязательные курсы.',
                  'Алдымен міндетті курстарды аяқтаңыз.',
                )
              : '',
            prerequisites.missingStartDate
              ? text(
                  'Управляющий должен подтвердить дату начала работы.',
                  'Менеджер жұмысқа кіріскен күнді растауы керек.',
                )
              : '',
            prerequisites.remainingDays
              ? text(
                  `До допуска по стажу: ${prerequisites.remainingDays} дней.`,
                  `Жұмыс өтілі бойынша рұқсатқа дейін: ${prerequisites.remainingDays} күн.`,
                )
              : '',
            availability.exhausted
              ? text('Все доступные попытки использованы.', 'Қолжетімді талпыныстар пайдаланылды.')
              : '',
            availability.cooldownUntil
              ? text(
                  `Следующая попытка после ${datetime(availability.cooldownUntil)}.`,
                  `Келесі талпыныс ${datetime(availability.cooldownUntil)} кейін.`,
                )
              : '',
          ].filter(Boolean);
          const locked =
            !availability.active && (reasons.length > 0 || assessment.questionCount < 1);
          return (
            <article className="academy-course-card" key={assessment.id}>
              <div className="academy-course-mark">
                <span>{labels[assessment.kind]}</span>
                {assessment.kind === 'promotion' ? (
                  <Trophy size={22} aria-hidden="true" />
                ) : (
                  <BookOpenText size={22} aria-hidden="true" />
                )}
              </div>
              <h3>{assessment.title}</h3>
              <div className="academy-course-meta">
                <span>
                  {assessment.questionCount} {text('вопросов', 'сұрақ')}
                </span>
                <span>
                  <Clock size={15} aria-hidden="true" />
                  {assessment.timeLimitMinutes} {text('мин', 'мин')}
                </span>
                {assignment?.dueAt && (
                  <span>
                    {text('До', 'Дейін')} {date(assignment.dueAt)}
                  </span>
                )}
              </div>
              <details className="academy-conditions">
                <summary>{text('Условия', 'Шарттар')}</summary>
                <p>
                  {text('Проходной балл', 'Өту балы')}: {assessment.passPercent}%
                </p>
                <p>
                  {text('Попытки', 'Талпыныстар')}: {availability.issued} /{' '}
                  {assessment.maxAttempts > 0
                    ? assessment.maxAttempts
                    : text('без ограничений', 'шектеусіз')}
                  {assessment.minimumTenureDays > 0 && (
                    <>
                      {' '}
                      · {text('Стаж от', 'Жұмыс өтілі')} {assessment.minimumTenureDays}{' '}
                      {text('дней', 'күн')}
                    </>
                  )}
                </p>
                {assessment.kind === 'promotion' && (
                  <p className="academy-note">
                    {text(
                      'Повышение подтверждает руководитель после экзамена.',
                      'Емтиханнан кейін жоғарылатуды жетекші растайды.',
                    )}
                  </p>
                )}
              </details>
              {reasons.length > 0 && !availability.active && (
                <ul className="academy-requirements">
                  {reasons.map((reason) => (
                    <li key={reason}>
                      <LockKeyhole size={15} aria-hidden="true" />
                      {reason}
                    </li>
                  ))}
                </ul>
              )}
              <button
                className={locked ? 'academy-secondary' : 'academy-primary'}
                disabled={busy || locked}
                onClick={() =>
                  availability.active
                    ? openAttempt(availability.active.id)
                    : startAssessment(assessment)
                }
              >
                {availability.active
                  ? text('Продолжить', 'Жалғастыру')
                  : locked
                    ? text('Пока недоступен', 'Әзірге қолжетімсіз')
                    : text('Начать тест', 'Тестті бастау')}
              </button>
            </article>
          );
        })}
      </div>
    </>
  );
}

export function Achievements({ cabinet }: { cabinet: Cabinet }) {
  const { text, number, date } = useLearningCopy();
  if (!cabinet.achievements.length)
    return <p className="academy-note">{text('Достижений пока нет.', 'Әзірге жетістік жоқ.')}</p>;
  return (
    <div className="academy-achievement-grid">
      {cabinet.achievements.map((achievement) => (
        <article className="academy-card academy-achievement" key={achievement.id}>
          <span className="academy-achievement-icon">
            <Trophy size={30} aria-hidden="true" />
          </span>
          <h2>{achievement.title}</h2>
          <p>{date(achievement.earnedAt)}</p>
          <strong>+{number(achievement.xp)} XP</strong>
        </article>
      ))}
    </div>
  );
}
