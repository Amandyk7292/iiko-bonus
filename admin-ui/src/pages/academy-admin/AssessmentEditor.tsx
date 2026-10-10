import { useState, type FormEvent } from 'react';
import { Plus, Save, Trash2 } from '../../components/BulkaIcons';
import GuardedModal from '../../components/GuardedModal';
import { Field, NumberField, RolePicker, Toggle } from './Fields';
import {
  assessmentPayload,
  emptyAssessment,
  emptyQuestion,
  freshId,
  validateAssessment,
  type Assessment,
  type Course,
  type JobRole,
  type Text,
} from './model';
import { saveLearning } from './api';

export default function AssessmentEditor({
  assessment,
  roles,
  courses,
  text,
  onClose,
  onSaved,
}: {
  assessment: Assessment | null;
  roles: JobRole[];
  courses: Course[];
  text: Text;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Assessment>(() =>
    structuredClone(assessment || emptyAssessment()),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'settings' | 'bank'>('settings');
  const patch = (data: Partial<Assessment>) => setDraft((current) => ({ ...current, ...data }));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const invalid = validateAssessment(draft, text);
    if (invalid) {
      setError(invalid);
      if (
        invalid.includes('банк') ||
        invalid.includes('вопрос') ||
        invalid.includes('жауап') ||
        invalid.includes('қор')
      )
        setView('bank');
      else setView('settings');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await saveLearning(
        `/assessments${assessment ? `/${assessment.id}` : ''}`,
        assessmentPayload(draft),
        assessment ? 'PATCH' : 'POST',
      );
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : text('Не удалось сохранить тест.', 'Тест сақталмады.'),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <GuardedModal
      open
      title={
        assessment ? text('Редактировать тест', 'Тестті өңдеу') : text('Новый тест', 'Жаңа тест')
      }
      onClose={onClose}
      dismissDisabled={saving}
      size="xl"
      footer={
        <>
          <button
            type="button"
            className="btn-outline"
            data-modal-dismiss
            onClick={onClose}
            disabled={saving}
          >
            {text('Отмена', 'Бас тарту')}
          </button>
          <button
            type="submit"
            className="btn-classic"
            form="academy-assessment-form"
            disabled={saving}
          >
            <Save size={18} aria-hidden="true" />
            {saving ? text('Сохраняем…', 'Сақталуда…') : text('Сохранить тест', 'Тестті сақтау')}
          </button>
        </>
      }
    >
      <form
        id="academy-assessment-form"
        className="modal-body academy-edit"
        onSubmit={save}
        noValidate
      >
        {error && (
          <p className="academy-error" role="alert">
            {error}
          </p>
        )}
        <div className="academy-editor-intro">
          <strong>{text('Своя выборка для каждой попытки', 'Әр талпынысқа жеке жинақ')}</strong>
          <p>
            {text(
              'При запуске система случайно выбирает вопросы из утверждённого банка. Ответы и результат проверяются автоматически.',
              'Жүйе бекітілген сұрақ қорынан кездейсоқ сұрақ таңдайды. Жауаптар мен нәтиже автоматты тексеріледі.',
            )}
          </p>
        </div>
        <div
          className="academy-tabs"
          role="group"
          aria-label={text('Редактор теста', 'Тест редакторы')}
        >
          <button
            type="button"
            aria-pressed={view === 'settings'}
            className={view === 'settings' ? 'is-active' : ''}
            onClick={() => setView('settings')}
          >
            {text('Настройки', 'Баптаулар')}
          </button>
          <button
            type="button"
            aria-pressed={view === 'bank'}
            className={view === 'bank' ? 'is-active' : ''}
            onClick={() => setView('bank')}
          >
            {text('Банк вопросов', 'Сұрақ қоры')} · {draft.questions?.length || 0}
          </button>
        </div>
        <div hidden={view !== 'settings'} className="academy-edit-section">
          <Field label={text('Название теста *', 'Тест атауы *')}>
            <input
              className="input-classic"
              maxLength={180}
              value={draft.title}
              onChange={(event) => patch({ title: event.target.value })}
            />
          </Field>
          <Field label={text('Описание', 'Сипаттама')}>
            <textarea
              className="input-classic"
              rows={2}
              maxLength={3000}
              value={draft.description}
              onChange={(event) => patch({ description: event.target.value })}
            />
          </Field>
          <Field label={text('Тип теста', 'Тест түрі')}>
            <select
              className="input-classic"
              value={draft.kind}
              onChange={(event) => patch({ kind: event.target.value as Assessment['kind'] })}
            >
              <option value="practice">{text('Тренировка', 'Жаттығу')}</option>
              <option value="control">{text('Контрольный тест', 'Бақылау тесті')}</option>
              <option value="promotion">
                {text('Экзамен для повышения', 'Жоғарылау емтиханы')}
              </option>
            </select>
          </Field>
          {draft.kind === 'promotion' && (
            <Field
              label={text('Должность после повышения *', 'Жоғарылаудан кейінгі лауазым *')}
              hint={text(
                'После успешного экзамена руководитель отдельно подтверждает повышение.',
                'Сәтті емтиханнан кейін басшы жоғарылауды бөлек бекітеді.',
              )}
            >
              <select
                className="input-classic"
                value={draft.targetRoleId || ''}
                onChange={(event) => patch({ targetRoleId: event.target.value || null })}
              >
                <option value="">{text('Выберите должность', 'Лауазымды таңдаңыз')}</option>
                {roles
                  .filter((role) => role.active || role.id === draft.targetRoleId)
                  .map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.title}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          <RolePicker
            roles={roles}
            selected={draft.roleIds}
            onChange={(roleIds) => patch({ roleIds })}
            text={text}
          />
          <div className="academy-two-columns">
            <NumberField
              label={text('Вопросов в каждой попытке', 'Әр талпыныстағы сұрақ саны')}
              min={1}
              max={100}
              value={draft.questionCount}
              onChange={(questionCount) => patch({ questionCount })}
            />
            <NumberField
              label={text('Проходной балл, %', 'Өту ұпайы, %')}
              min={1}
              max={100}
              value={draft.passPercent}
              onChange={(passPercent) => patch({ passPercent })}
            />
            <NumberField
              label={text('Время на тест, минут', 'Тест уақыты, минут')}
              min={1}
              max={180}
              value={draft.timeLimitMinutes}
              onChange={(timeLimitMinutes) => patch({ timeLimitMinutes })}
            />
            <NumberField
              label={text('Максимум попыток', 'Ең көп талпыныс')}
              min={1}
              max={100}
              value={draft.maxAttempts}
              onChange={(maxAttempts) => patch({ maxAttempts })}
            />
            <NumberField
              label={text('Пауза между попытками, минут', 'Талпыныстар аралығы, минут')}
              min={0}
              max={43200}
              value={draft.cooldownMinutes}
              onChange={(cooldownMinutes) => patch({ cooldownMinutes })}
            />
            <NumberField
              label={text('Минимальный стаж, дней', 'Ең аз еңбек өтілі, күн')}
              min={0}
              max={36500}
              value={draft.minimumTenureDays}
              onChange={(minimumTenureDays) => patch({ minimumTenureDays })}
            />
          </div>
          <fieldset className="academy-role-picker">
            <legend>{text('Сначала пройти курсы', 'Алдымен өтетін курстар')}</legend>
            <div className="academy-role-options">
              {courses.map((course) => (
                <label key={course.id}>
                  <input
                    type="checkbox"
                    checked={draft.requiredCourseIds.includes(course.id)}
                    onChange={(event) =>
                      patch({
                        requiredCourseIds: event.target.checked
                          ? [...draft.requiredCourseIds, course.id]
                          : draft.requiredCourseIds.filter((id) => id !== course.id),
                      })
                    }
                  />
                  {course.title}
                  {!course.published && ` (${text('черновик', 'жоба')})`}
                </label>
              ))}
            </div>
            {!courses.length && (
              <p>
                {text(
                  'Пока нет курсов. Их можно добавить позже.',
                  'Әзірге курс жоқ. Кейін қосуға болады.',
                )}
              </p>
            )}
          </fieldset>
        </div>
        <div hidden={view !== 'bank'} className="academy-edit-section">
          <p className="academy-hint">
            {text(
              'Создайте вопросы и отметьте один правильный ответ. Для разных вариантов теста добавьте больше вопросов, чем используется в одной попытке.',
              'Сұрақ құрып, бір дұрыс жауапты белгілеңіз. Әртүрлі тест нұсқасы үшін бір талпыныстағы саннан көп сұрақ қосыңыз.',
            )}
          </p>
          {(draft.questions || []).map((question, questionIndex) => {
            const updateQuestion = (data: Partial<typeof question>) =>
              patch({
                questions: (draft.questions || []).map((item, index) =>
                  index === questionIndex ? { ...item, ...data } : item,
                ),
              });
            return (
              <article className="academy-lesson" key={question.id}>
                <div className="academy-section-title">
                  <h3>
                    {text('Вопрос', 'Сұрақ')} {questionIndex + 1}
                  </h3>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`${text('Удалить вопрос', 'Сұрақты жою')} ${questionIndex + 1}`}
                    onClick={() =>
                      patch({
                        questions: draft.questions?.filter((item) => item.id !== question.id),
                      })
                    }
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
                <Field label={text('Вопрос *', 'Сұрақ *')}>
                  <textarea
                    className="input-classic"
                    rows={2}
                    maxLength={2000}
                    value={question.prompt}
                    onChange={(event) => updateQuestion({ prompt: event.target.value })}
                  />
                </Field>
                <fieldset className="academy-answer-options">
                  <legend>
                    {text(
                      'Варианты ответа — выберите правильный',
                      'Жауап нұсқалары — дұрысын таңдаңыз',
                    )}
                  </legend>
                  {question.choices.map((choice, choiceIndex) => (
                    <div className="academy-answer-row" key={choice.id}>
                      <label className="academy-correct-choice">
                        <input
                          type="radio"
                          name={`correct-${question.id}`}
                          checked={question.correctChoiceId === choice.id}
                          aria-label={`${text('Правильный ответ', 'Дұрыс жауап')} ${choiceIndex + 1}`}
                          onChange={() => updateQuestion({ correctChoiceId: choice.id })}
                        />
                        <span>{choiceIndex + 1}</span>
                      </label>
                      <input
                        className="input-classic"
                        aria-label={`${text('Вариант ответа', 'Жауап нұсқасы')} ${choiceIndex + 1}`}
                        maxLength={1000}
                        value={choice.text}
                        onChange={(event) =>
                          updateQuestion({
                            choices: question.choices.map((item) =>
                              item.id === choice.id ? { ...item, text: event.target.value } : item,
                            ),
                          })
                        }
                      />
                      <button
                        type="button"
                        className="icon-button"
                        disabled={question.choices.length <= 2}
                        aria-label={`${text('Удалить вариант', 'Нұсқаны жою')} ${choiceIndex + 1}`}
                        onClick={() => {
                          const choices = question.choices.filter((item) => item.id !== choice.id);
                          updateQuestion({
                            choices,
                            correctChoiceId:
                              question.correctChoiceId === choice.id
                                ? choices[0].id
                                : question.correctChoiceId,
                          });
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </fieldset>
                {question.choices.length < 6 && (
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() =>
                      updateQuestion({
                        choices: [...question.choices, { id: freshId(), text: '' }],
                      })
                    }
                  >
                    <Plus size={16} aria-hidden="true" />
                    {text('Вариант ответа', 'Жауап нұсқасы')}
                  </button>
                )}
                <Field label={text('Объяснение ответа', 'Жауап түсіндірмесі')}>
                  <textarea
                    className="input-classic"
                    rows={2}
                    maxLength={3000}
                    value={question.explanation}
                    onChange={(event) => updateQuestion({ explanation: event.target.value })}
                  />
                </Field>
              </article>
            );
          })}
          <button
            type="button"
            className="btn-outline"
            onClick={() => patch({ questions: [...(draft.questions || []), emptyQuestion()] })}
          >
            <Plus size={18} aria-hidden="true" />
            {text('Добавить вопрос', 'Сұрақ қосу')}
          </button>
        </div>
        <Toggle
          checked={draft.published}
          onChange={(published) => patch({ published })}
          label={text('Опубликовать тест', 'Тестті жариялау')}
          hint={
            draft.published
              ? text(
                  'Будет доступен сотрудникам после сохранения.',
                  'Сақталғаннан кейін қызметкерлерге қолжетімді.',
                )
              : text(
                  'Черновик для подготовки и проверки вопросов.',
                  'Сұрақ дайындау және тексеруге арналған жоба.',
                )
          }
        />
      </form>
    </GuardedModal>
  );
}
