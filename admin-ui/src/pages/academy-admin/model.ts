export interface JobRole {
  id: string;
  title: string;
  description: string;
  active: boolean;
}
export interface Lesson {
  id: string;
  title: string;
  body: string;
  videoUrl: string | null;
  estimatedMinutes: number;
  sortOrder: number;
}
export interface CourseModule {
  id: string;
  title: string;
  sortOrder: number;
  lessons: Lesson[];
}
export interface Course {
  id: string;
  title: string;
  description: string;
  roleIds: string[];
  published: boolean;
  modules: CourseModule[];
  createdAt?: string;
  updatedAt?: string;
}
export interface BankQuestion {
  id: string;
  prompt: string;
  choices: { id: string; text: string }[];
  correctChoiceId: string;
  explanation: string;
}
export interface Assessment {
  id: string;
  title: string;
  description: string;
  kind: 'practice' | 'control' | 'promotion';
  roleIds: string[];
  published: boolean;
  questionCount: number;
  maxAttempts: number;
  passPercent: number;
  timeLimitMinutes: number;
  cooldownMinutes: number;
  minimumTenureDays: number;
  requiredCourseIds: string[];
  targetRoleId: string | null;
  questions?: BankQuestion[];
}
export interface Progress {
  xp: number;
  level: number;
  completedLessons: number;
  completedCourses: number;
}
export interface Employee {
  username: string;
  displayName: string;
  securityRole: string;
  branchIds: string[];
  jobRoleId: string | null;
  jobRole: JobRole | null;
  startDate: string | null;
  tenureDays: number | null;
  learningEnabled: boolean;
  progress: Progress;
}
export interface Assignment {
  id: string;
  employeeUsername: string | null;
  roleId: string | null;
  courseId: string | null;
  assessmentId: string | null;
  required: boolean;
  dueAt: string | null;
  createdAt?: string;
}
export interface Result {
  id: string;
  assessmentId: string;
  title: string;
  kind: Assessment['kind'];
  username: string;
  displayName: string;
  status: 'in_progress' | 'submitted' | 'expired';
  scorePercent: number | null;
  passed: boolean | null;
  submittedAt: string | null;
  deadlineAt: string;
  promotionDecision: 'approved' | 'rejected' | null;
  targetRoleId: string | null;
}
export interface Dashboard {
  counts: Record<string, number>;
  roles: JobRole[];
  courses: Course[];
  assessments: Assessment[];
  employees: Employee[];
  assignments: Assignment[];
  results: Result[];
}
export type Text = (ru: string, kk: string) => string;
export const freshId = () => crypto.randomUUID();
export const emptyLesson = (): Lesson => ({
  id: freshId(),
  title: '',
  body: '',
  videoUrl: null,
  estimatedMinutes: 5,
  sortOrder: 0,
});
export const emptyModule = (): CourseModule => ({
  id: freshId(),
  title: '',
  sortOrder: 0,
  lessons: [emptyLesson()],
});
export const emptyCourse = (): Course => ({
  id: '',
  title: '',
  description: '',
  roleIds: [],
  published: false,
  modules: [emptyModule()],
});
export const emptyQuestion = (): BankQuestion => {
  const choices = Array.from({ length: 4 }, () => ({ id: freshId(), text: '' }));
  return { id: freshId(), prompt: '', choices, correctChoiceId: choices[0].id, explanation: '' };
};
export const emptyAssessment = (): Assessment => ({
  id: '',
  title: '',
  description: '',
  kind: 'practice',
  roleIds: [],
  published: false,
  questionCount: 5,
  maxAttempts: 3,
  passPercent: 80,
  timeLimitMinutes: 15,
  cooldownMinutes: 60,
  minimumTenureDays: 0,
  requiredCourseIds: [],
  targetRoleId: null,
  questions: [],
});
export function coursePayload(course: Course) {
  return {
    title: course.title.trim(),
    description: course.description.trim(),
    roleIds: course.roleIds,
    published: course.published,
    modules: course.modules.map((module, index) => ({
      ...module,
      title: module.title.trim(),
      sortOrder: index,
      lessons: module.lessons.map((lesson, lessonIndex) => ({
        ...lesson,
        title: lesson.title.trim(),
        body: lesson.body.trim(),
        videoUrl: lesson.videoUrl?.trim() || null,
        sortOrder: lessonIndex,
      })),
    })),
  };
}
export function assessmentPayload(assessment: Assessment) {
  const { id: _id, ...data } = assessment;
  return {
    ...data,
    title: data.title.trim(),
    description: data.description.trim(),
    targetRoleId: data.kind === 'promotion' ? data.targetRoleId : null,
    questions: (data.questions || []).map((question) => ({
      ...question,
      prompt: question.prompt.trim(),
      explanation: question.explanation.trim(),
      choices: question.choices.map((choice) => ({ ...choice, text: choice.text.trim() })),
    })),
  };
}
export function validHttps(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
export function validateCourse(course: Course, text: Text): string {
  if (!course.title.trim()) return text('Укажите название курса.', 'Курс атауын көрсетіңіз.');
  for (const module of course.modules) {
    if (!module.title.trim())
      return text('Укажите название каждого модуля.', 'Әр модульдің атауын көрсетіңіз.');
    for (const lesson of module.lessons) {
      if (!lesson.title.trim())
        return text('Укажите название каждого урока.', 'Әр сабақтың атауын көрсетіңіз.');
      if (lesson.videoUrl && !validHttps(lesson.videoUrl))
        return text(
          'Ссылка на видео должна начинаться с https://.',
          'Бейне сілтемесі https:// арқылы басталуы керек.',
        );
      if (!lesson.body.trim() && !lesson.videoUrl)
        return text(
          'Добавьте текст или видео в каждый урок.',
          'Әр сабаққа мәтін немесе бейне қосыңыз.',
        );
      if (
        !Number.isInteger(lesson.estimatedMinutes) ||
        lesson.estimatedMinutes < 0 ||
        lesson.estimatedMinutes > 1440
      )
        return text(
          'Время урока должно быть от 0 до 1440 минут.',
          'Сабақ уақыты 0–1440 минут болуы керек.',
        );
    }
  }
  if (
    course.published &&
    (!course.modules.length || course.modules.some((module) => !module.lessons.length))
  )
    return text(
      'Для публикации добавьте уроки в каждый модуль.',
      'Жариялау үшін әр модульге сабақ қосыңыз.',
    );
  return '';
}
export function validateAssessment(assessment: Assessment, text: Text): string {
  if (!assessment.title.trim()) return text('Укажите название теста.', 'Тест атауын көрсетіңіз.');
  if (assessment.kind === 'promotion' && !assessment.targetRoleId)
    return text('Выберите должность для повышения.', 'Жоғарылау лауазымын таңдаңыз.');
  const limits: [number, number, number, string, string][] = [
    [assessment.questionCount, 1, 100, 'Количество вопросов', 'Сұрақ саны'],
    [assessment.passPercent, 1, 100, 'Проходной балл', 'Өту ұпайы'],
    [assessment.timeLimitMinutes, 1, 180, 'Время на тест', 'Тест уақыты'],
    [assessment.maxAttempts, 1, 100, 'Количество попыток', 'Талпыныс саны'],
    [assessment.cooldownMinutes, 0, 43200, 'Пауза между попытками', 'Талпыныстар аралығы'],
    [assessment.minimumTenureDays, 0, 36500, 'Минимальный стаж', 'Ең аз еңбек өтілі'],
  ];
  for (const [value, minimum, maximum, ru, kk] of limits) {
    if (!Number.isInteger(value) || value < minimum || value > maximum)
      return text(
        `${ru}: укажите целое число от ${minimum} до ${maximum}.`,
        `${kk}: ${minimum}–${maximum} аралығындағы бүтін санды көрсетіңіз.`,
      );
  }
  for (const question of assessment.questions || []) {
    if (!question.prompt.trim() || question.choices.some((choice) => !choice.text.trim()))
      return text(
        'Заполните вопрос и все варианты ответа.',
        'Сұрақ пен барлық жауап нұсқасын толтырыңыз.',
      );
    if (!question.choices.some((choice) => choice.id === question.correctChoiceId))
      return text(
        'Выберите правильный ответ для каждого вопроса.',
        'Әр сұрақтың дұрыс жауабын таңдаңыз.',
      );
  }
  if (assessment.published && (assessment.questions || []).length < assessment.questionCount)
    return text(
      'В банке меньше вопросов, чем в тесте. Добавьте вопросы или уменьшите их количество.',
      'Сұрақ қорында тестке жететін сұрақ жоқ. Сұрақ қосыңыз немесе санын азайтыңыз.',
    );
  return '';
}
