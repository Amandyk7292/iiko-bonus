import type { Answer, Assessment, Attempt, Course, Progress } from './types';

export function courseLessons(course: Course) {
  return [...course.modules]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((module) => [...module.lessons].sort((a, b) => a.sortOrder - b.sortOrder));
}
export function courseProgress(course: Course, progress: Progress) {
  const lessons = courseLessons(course);
  const completed = new Set(progress.lessons.map((item) => item.lessonId));
  const count = lessons.filter((lesson) => completed.has(lesson.id)).length;
  return { count, total: lessons.length, complete: lessons.length > 0 && count === lessons.length };
}
export function latestActiveAttempt(attempts: Attempt[]) {
  return attempts
    .filter((attempt) => attempt.status === 'in_progress')
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
}
export function safeVideoUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
export function validAnswers(attempt: Attempt, values: Record<string, string>): Answer[] {
  return attempt.questions.flatMap((question) =>
    question.choices.some((choice) => choice.id === values[question.id])
      ? [{ questionId: question.id, choiceId: values[question.id] }]
      : [],
  );
}
const draftKey = (username: string, id: string) => `bulka-learning-draft:${username}:${id}`;
export function readDraft(username: string, attempt: Attempt) {
  const values = Object.fromEntries(
    (attempt.answers || []).map((answer) => [answer.questionId, answer.choiceId]),
  );
  try {
    const saved: unknown = JSON.parse(
      sessionStorage.getItem(draftKey(username, attempt.id)) || '{}',
    );
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) Object.assign(values, saved);
  } catch {
    /* The current page remains usable when browser storage is unavailable. */
  }
  return Object.fromEntries(
    validAnswers(attempt, values).map((answer) => [answer.questionId, answer.choiceId]),
  );
}
export function saveDraft(username: string, attempt: Attempt, values: Record<string, string>) {
  try {
    sessionStorage.setItem(
      draftKey(username, attempt.id),
      JSON.stringify(
        Object.fromEntries(
          validAnswers(attempt, values).map((answer) => [answer.questionId, answer.choiceId]),
        ),
      ),
    );
  } catch {
    /* Keep choices in page memory. */
  }
}
export function clearDraft(username: string, id: string) {
  try {
    sessionStorage.removeItem(draftKey(username, id));
  } catch {
    /* Server submission is authoritative. */
  }
}
export function assessmentPrerequisites(
  assessment: Assessment,
  courses: Course[],
  progress: Progress,
  tenureDays: number | null,
) {
  const missingCourses = assessment.requiredCourseIds.filter((id) => {
    const course = courses.find((item) => item.id === id);
    // A prior role's course can disappear from this catalog. Its completion is checked on start.
    return Boolean(course && !courseProgress(course, progress).complete);
  });
  return {
    missingCourses,
    missingStartDate: assessment.minimumTenureDays > 0 && tenureDays === null,
    remainingDays: tenureDays === null ? 0 : Math.max(0, assessment.minimumTenureDays - tenureDays),
  };
}
export function assessmentAvailability(
  assessment: Assessment,
  attempts: Attempt[],
  now = Date.now(),
) {
  const history = attempts.filter((attempt) => attempt.assessmentId === assessment.id);
  const active = latestActiveAttempt(
    history.filter((attempt) => Date.parse(attempt.deadlineAt) > now),
  );
  const latestEnd = Math.max(
    0,
    ...history.map((attempt) => Date.parse(attempt.submittedAt || attempt.deadlineAt) || 0),
  );
  const cooldownUntil = latestEnd + assessment.cooldownMinutes * 60000;
  return {
    active,
    issued: history.length,
    exhausted: !active && assessment.maxAttempts > 0 && history.length >= assessment.maxAttempts,
    cooldownUntil: !active && cooldownUntil > now ? cooldownUntil : null,
  };
}
