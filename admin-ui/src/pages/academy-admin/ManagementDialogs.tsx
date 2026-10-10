import { useState, type FormEvent } from 'react';
import GuardedModal from '../../components/GuardedModal';
import { Save } from '../../components/BulkaIcons';
import { Field, Toggle } from './Fields';
import { saveLearning } from './api';
import type { Assignment, Course, Assessment, Employee, JobRole, Text } from './model';

interface Common {
  text: Text;
  onClose: () => void;
  onSaved: () => void;
}
function Footer({ form, saving, text, onClose }: Common & { form: string; saving: boolean }) {
  return (
    <>
      <button
        type="button"
        className="btn-outline"
        disabled={saving}
        data-modal-dismiss
        onClick={onClose}
      >
        {text('Отмена', 'Бас тарту')}
      </button>
      <button type="submit" form={form} className="btn-classic" disabled={saving}>
        <Save size={18} aria-hidden="true" />
        {saving ? text('Сохраняем…', 'Сақталуда…') : text('Сохранить', 'Сақтау')}
      </button>
    </>
  );
}
export function RoleEditor({ role, text, onClose, onSaved }: Common & { role: JobRole | null }) {
  const [title, setTitle] = useState(role?.title || '');
  const [description, setDescription] = useState(role?.description || '');
  const [active, setActive] = useState(role?.active ?? true);
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!title.trim()) {
      setError(text('Укажите название должности.', 'Лауазым атауын көрсетіңіз.'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await saveLearning(
        `/roles${role ? `/${role.id}` : ''}`,
        { title: title.trim(), description: description.trim(), active },
        role ? 'PATCH' : 'POST',
      );
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : text('Не удалось сохранить.', 'Сақталмады.'),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <GuardedModal
      open
      title={role ? text('Должность', 'Лауазым') : text('Новая должность', 'Жаңа лауазым')}
      onClose={onClose}
      dismissDisabled={saving}
      footer={
        <Footer
          form="academy-role-form"
          saving={saving}
          text={text}
          onClose={onClose}
          onSaved={onSaved}
        />
      }
    >
      <form id="academy-role-form" className="modal-body academy-edit" onSubmit={save}>
        {error && (
          <p className="academy-error" role="alert">
            {error}
          </p>
        )}
        <Field label={text('Название должности *', 'Лауазым атауы *')}>
          <input
            className="input-classic"
            required
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label={text('Описание', 'Сипаттама')}>
          <textarea
            className="input-classic"
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <Toggle
          checked={active}
          onChange={setActive}
          label={text('Должность активна', 'Лауазым белсенді')}
          hint={text(
            'Архив сохраняет историю обучения сотрудников.',
            'Мұрағат қызметкерлердің оқу тарихын сақтайды.',
          )}
        />
        <p className="academy-hint">
          {text(
            'Должность определяет программу обучения и не меняет доступ к управлению системой.',
            'Лауазым оқу бағдарламасын анықтайды, жүйені басқару құқығын өзгертпейді.',
          )}
        </p>
      </form>
    </GuardedModal>
  );
}
export function EmployeeEditor({
  employee,
  roles,
  text,
  onClose,
  onSaved,
}: Common & { employee: Employee; roles: JobRole[] }) {
  const [jobRoleId, setJobRoleId] = useState(employee.jobRoleId || ''),
    [startDate, setStartDate] = useState(employee.startDate || ''),
    [learningEnabled, setLearningEnabled] = useState(employee.learningEnabled);
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await saveLearning(
        `/employees/${encodeURIComponent(employee.username)}`,
        { jobRoleId: jobRoleId || null, startDate: startDate || null, learningEnabled },
        'PATCH',
      );
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : text('Не удалось сохранить.', 'Сақталмады.'),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <GuardedModal
      open
      title={employee.displayName || employee.username}
      onClose={onClose}
      dismissDisabled={saving}
      footer={
        <Footer
          form="academy-employee-form"
          saving={saving}
          text={text}
          onClose={onClose}
          onSaved={onSaved}
        />
      }
    >
      <form id="academy-employee-form" className="modal-body academy-edit" onSubmit={save}>
        {error && (
          <p className="academy-error" role="alert">
            {error}
          </p>
        )}
        <p className="academy-hint">
          {text(
            'Личный кабинет использует существующий вход сотрудника.',
            'Жеке кабинет қызметкердің қолданыстағы кіру деректерін пайдаланады.',
          )}
        </p>
        <Field label={text('Должность', 'Лауазым')}>
          <select
            className="input-classic"
            value={jobRoleId}
            onChange={(event) => setJobRoleId(event.target.value)}
          >
            <option value="">{text('Не назначена', 'Тағайындалмаған')}</option>
            {roles
              .filter((role) => role.active || role.id === jobRoleId)
              .map((role) => (
                <option key={role.id} value={role.id}>
                  {role.title}
                </option>
              ))}
          </select>
        </Field>
        <Field
          label={text('Первый рабочий день', 'Алғашқы жұмыс күні')}
          hint={text(
            'По этой дате считается стаж для допуска к экзаменам.',
            'Емтиханға жіберу үшін еңбек өтілі осы күннен есептеледі.',
          )}
        >
          <input
            className="input-classic"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </Field>
        <Toggle
          checked={learningEnabled}
          onChange={setLearningEnabled}
          label={text('Доступ к обучению', 'Оқуға қолжетімділік')}
          hint={text(
            'Прогресс и достижения сохраняются при отключении.',
            'Өшіргенде оқу барысы мен жетістіктер сақталады.',
          )}
        />
      </form>
    </GuardedModal>
  );
}
export function AssignmentEditor({
  employees,
  roles,
  courses,
  assessments,
  employee,
  canAssignRole,
  text,
  onClose,
  onSaved,
}: Common & {
  employees: Employee[];
  roles: JobRole[];
  courses: Course[];
  assessments: Assessment[];
  employee?: Employee;
  canAssignRole: boolean;
}) {
  const [targetType, setTargetType] = useState<'employee' | 'role'>('employee'),
    [target, setTarget] = useState(employee?.username || ''),
    [resourceType, setResourceType] = useState<'course' | 'assessment'>('course'),
    [resource, setResource] = useState(''),
    [required, setRequired] = useState(true),
    [dueAt, setDueAt] = useState('');
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const resources =
    resourceType === 'course'
      ? courses.filter((course) => course.published)
      : assessments.filter((assessment) => assessment.published);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!target || !resource) {
      setError(
        text(
          'Выберите сотрудника или должность и учебный материал.',
          'Қызметкерді немесе лауазымды және оқу материалын таңдаңыз.',
        ),
      );
      return;
    }
    setSaving(true);
    setError('');
    try {
      const data: Omit<Assignment, 'id' | 'createdAt'> = {
        employeeUsername: targetType === 'employee' ? target : null,
        roleId: targetType === 'role' ? target : null,
        courseId: resourceType === 'course' ? resource : null,
        assessmentId: resourceType === 'assessment' ? resource : null,
        required,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      };
      await saveLearning('/assignments', data);
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : text('Не удалось сохранить назначение.', 'Тағайындау сақталмады.'),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <GuardedModal
      open
      title={text('Назначить обучение', 'Оқуды тағайындау')}
      onClose={onClose}
      dismissDisabled={saving}
      footer={
        <Footer
          form="academy-assignment-form"
          saving={saving}
          text={text}
          onClose={onClose}
          onSaved={onSaved}
        />
      }
    >
      <form id="academy-assignment-form" className="modal-body academy-edit" onSubmit={save}>
        {error && (
          <p className="academy-error" role="alert">
            {error}
          </p>
        )}
        {canAssignRole && (
          <Field label={text('Кому назначить', 'Кімге тағайындау')}>
            <select
              className="input-classic"
              value={targetType}
              onChange={(event) => {
                setTargetType(event.target.value as typeof targetType);
                setTarget('');
              }}
            >
              <option value="employee">{text('Отдельному сотруднику', 'Жеке қызметкерге')}</option>
              <option value="role">
                {text('Всем в этой должности', 'Осы лауазымның барлығына')}
              </option>
            </select>
          </Field>
        )}
        <Field
          label={
            targetType === 'employee'
              ? text('Сотрудник *', 'Қызметкер *')
              : text('Должность *', 'Лауазым *')
          }
        >
          <select
            className="input-classic"
            required
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="">{text('Выберите', 'Таңдаңыз')}</option>
            {targetType === 'employee'
              ? employees.map((item) => (
                  <option key={item.username} value={item.username}>
                    {item.displayName || item.username}
                    {!item.learningEnabled && ` (${text('обучение отключено', 'оқу өшірілген')})`}
                  </option>
                ))
              : roles
                  .filter((role) => role.active)
                  .map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.title}
                    </option>
                  ))}
          </select>
        </Field>
        <Field label={text('Учебный материал', 'Оқу материалы')}>
          <select
            className="input-classic"
            value={resourceType}
            onChange={(event) => {
              setResourceType(event.target.value as typeof resourceType);
              setResource('');
            }}
          >
            <option value="course">{text('Курс', 'Курс')}</option>
            <option value="assessment">{text('Тест или экзамен', 'Тест немесе емтихан')}</option>
          </select>
        </Field>
        <Field label={text('Название *', 'Атауы *')}>
          <select
            className="input-classic"
            required
            value={resource}
            onChange={(event) => setResource(event.target.value)}
          >
            <option value="">{text('Выберите материал', 'Материалды таңдаңыз')}</option>
            {resources.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </Field>
        {!resources.length && (
          <p className="academy-hint">
            {text(
              'Сначала опубликуйте материалы в разделе курсов или тестов.',
              'Алдымен курс немесе тест бөлімінде материал жариялаңыз.',
            )}
          </p>
        )}
        <Field label={text('Пройти до (необязательно)', 'Өту мерзімі (міндетті емес)')}>
          <input
            className="input-classic"
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
        </Field>
        <Toggle
          checked={required}
          onChange={setRequired}
          label={text('Обязательное обучение', 'Міндетті оқу')}
        />
      </form>
    </GuardedModal>
  );
}
