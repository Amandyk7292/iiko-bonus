# Employee learning API

All endpoints use `/admin/api/learning`, the existing authenticated staff session,
CSRF protection for cookie mutations, and `{ "success": true, ... }` responses.
Learning job roles are data and never change the account's security role.
The security role `employee` can use only this learning section and session login/logout.
Owner/admin manage learning content; branch managers manage employees, assignments,
results and promotion decisions only for employees within their assigned branch scope.
Learning access must be enabled by an administrator. Existing owner/admin accounts
can use their own cabinet. Names, access and branches come from existing staff accounts.
An employment start date is explicitly reviewed input, not account creation time.

## Shared types

IDs are UUIDs, dates are `YYYY-MM-DD`, timestamps are ISO 8601 UTC.
Text/video lesson content is plain text and an optional HTTPS video URL.
Course/module/lesson/question IDs may be omitted on creation and are returned by the
server. Choice IDs must be supplied as UUIDs because `correctChoiceId` references one.
Preserve returned IDs when updating existing content.

```ts
type JobRole = { id: string; title: string; description: string; active: boolean };
type Lesson = {
  id: string;
  title: string;
  body: string;
  videoUrl: string | null;
  estimatedMinutes: number;
  sortOrder: number;
};
type Module = { id: string; title: string; sortOrder: number; lessons: Lesson[] };
type Course = {
  id: string;
  title: string;
  description: string;
  roleIds: string[];
  published: boolean;
  modules: Module[];
  createdAt: string;
  updatedAt: string;
};
type Question = { id: string; prompt: string; choices: { id: string; text: string }[] };
type BankQuestion = Question & { correctChoiceId: string; explanation: string };
type Assessment = {
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
};
type EmployeeProfile = {
  username: string;
  displayName: string;
  securityRole: string;
  branchIds: string[];
  jobRoleId: string | null;
  jobRole: JobRole | null;
  startDate: string | null;
  tenureDays: number | null;
  learningEnabled: boolean;
};
type LessonProgress = { lessonId: string; courseId: string; completedAt: string };
type Progress = {
  xp: number;
  level: number;
  completedLessons: number;
  completedCourses: number;
  lessons: LessonProgress[];
};
type Achievement = { id: string; code: string; title: string; xp: number; earnedAt: string };
type Attempt = {
  id: string;
  assessmentId: string;
  title: string;
  kind: Assessment['kind'];
  status: 'in_progress' | 'submitted' | 'expired';
  startedAt: string;
  deadlineAt: string;
  submittedAt: string | null;
  scorePercent: number | null;
  passed: boolean | null;
  passPercent: number;
  targetRoleId: string | null;
  promotionDecision: 'approved' | 'rejected' | null;
  questions: Question[];
  answers?: { questionId: string; choiceId: string }[];
  result?: { correctCount: number; questionCount: number; xpAwarded: number };
};
type Assignment = {
  id: string;
  employeeUsername: string | null;
  roleId: string | null;
  courseId: string | null;
  assessmentId: string | null;
  required: boolean;
  dueAt: string | null;
  createdAt: string;
};
```

Empty `roleIds` means available to every enabled learner. Otherwise access requires
a matching job role or a direct/role assignment. Draft content is admin-only.
Only management assessment responses include `questions: BankQuestion[]`.
Learner responses never contain `correctChoiceId` or the private grading snapshot.

## Personal cabinet and learning

| Method | Path                        | Input                                                           | Response                                                     |
| ------ | --------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| GET    | `/me`                       | none                                                            | `{ profile, progress, assignments, achievements, attempts }` |
| GET    | `/catalog`                  | none                                                            | `{ courses: Course[], assessments: Assessment[] }`           |
| GET    | `/courses/:id`              | UUID                                                            | `{ course, progress }`                                       |
| POST   | `/lessons/:id/progress`     | `{ "completed": true }`                                         | `{ progress, achievements }`                                 |
| POST   | `/assessments/:id/attempts` | `{}`                                                            | `{ attempt }`                                                |
| GET    | `/attempts/:id`             | UUID                                                            | `{ attempt }`                                                |
| POST   | `/attempts/:id/submit`      | `{ "answers": [{ "questionId": "uuid", "choiceId": "uuid" }] }` | `{ attempt, progress, achievements }`                        |

An active attempt is resumed instead of consuming another attempt. Every new attempt
randomly samples the approved question bank and stores an immutable question and
grading snapshot. All questions must receive exactly one valid answer. The server
enforces prerequisites, tenure, maximum attempts, cooldown and deadline. Submitted
attempts are immutable; repeated submission returns the original result. Completion
awards XP once: lesson 10, course 50, first pass practice 20/control 50/promotion 100.
Level is `1 + floor(xp / 100)`. There are no monetary rewards.

## Administration

| Method | Path                                      | Input                                                        | Response                                                                   |
| ------ | ----------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| GET    | `/manage/dashboard`                       | none                                                         | `{ counts, roles, courses, assessments, employees, assignments, results }` |
| GET    | `/manage/roles`                           | none                                                         | `{ roles }`                                                                |
| POST   | `/manage/roles`                           | `{ title, description?, active? }`                           | `{ role }`                                                                 |
| PATCH  | `/manage/roles/:id`                       | same optional fields                                         | `{ role }`                                                                 |
| GET    | `/manage/courses`                         | none                                                         | `{ courses }`                                                              |
| POST   | `/manage/courses`                         | course fields excluding id/timestamps                        | `{ course }`                                                               |
| PATCH  | `/manage/courses/:id`                     | optional course fields; modules replaces full tree           | `{ course }`                                                               |
| GET    | `/manage/assessments`                     | none                                                         | `{ assessments: (Assessment & {questions: BankQuestion[]})[] }`            |
| POST   | `/manage/assessments`                     | assessment fields plus approved `questions`                  | `{ assessment }`                                                           |
| PATCH  | `/manage/assessments/:id`                 | same optional fields; questions replaces full bank           | `{ assessment }`                                                           |
| GET    | `/manage/employees`                       | none                                                         | `{ employees: (EmployeeProfile & {progress: Progress})[] }`                |
| PATCH  | `/manage/employees/:username`             | `{ jobRoleId?, startDate?, learningEnabled? }`               | `{ employee }`                                                             |
| GET    | `/manage/assignments`                     | none                                                         | `{ assignments }`                                                          |
| POST   | `/manage/assignments`                     | Assignment excluding id/createdAt                            | `{ assignment }`                                                           |
| DELETE | `/manage/assignments/:id`                 | `{}`                                                         | `{ deleted: true }`                                                        |
| GET    | `/manage/results`                         | none                                                         | `{ results: (Attempt & {username:string,displayName:string})[] }`          |
| POST   | `/manage/attempts/:id/promotion-decision` | `{ "decision": "approved" }` or `{ "decision": "rejected" }` | `{ attempt, employee }`                                                    |

Each assignment targets exactly one employee or job role and exactly one course or
assessment. Role-wide assignments and content are owner/admin operations. A branch
manager may assign only individual employees in scope. Profile enable/disable does
not change login authorization. Promotion approval requires a passed promotion exam;
it changes only the learning job role and awards a recorded achievement once.

Dashboard `counts` has `employees`, `enabledEmployees`, `courses`, `publishedCourses`,
`assessments`, `assignments`, `submittedAttempts`, and `passedAttempts`. Owner/admin
dashboard assessment entries include the question bank. Branch managers receive only
published content, without answer keys, and scoped employees/results/assignments.
Tenure and employment date validation use the bakery date in `Asia/Almaty`.

Initial role data: «Кассир», «Администратор», «Оператор», «Пекарь», «Управляющий»,
«Продавец». Administrators can create any additional job roles. Courses and questions
start empty; published courses require real lessons, and published assessments require
enough approved questions. Archiving uses `active:false` / `published:false`.

Errors use `{ success:false, error, code }` with HTTP 400 for invalid input, 403 for
disabled/out-of-scope access, 404 for missing/unavailable content, 409 for prerequisites,
attempt/cooldown/promotion conflicts, 410 for an expired attempt, and 503 for database
unavailability. Codes start with `LEARNING_`; request shape failures use `VALIDATION_ERROR`.
