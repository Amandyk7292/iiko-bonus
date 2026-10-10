import { useState, type FormEvent } from 'react';
import { ChevronDown, Plus, Save, Trash2 } from '../../components/BulkaIcons';
import GuardedModal from '../../components/GuardedModal';
import { Field, NumberField, RolePicker, Toggle } from './Fields';
import {
  coursePayload,
  emptyCourse,
  emptyLesson,
  emptyModule,
  validateCourse,
  type Course,
  type JobRole,
  type Text,
} from './model';
import { saveLearning } from './api';

export default function CourseEditor({
  course,
  roles,
  text,
  onClose,
  onSaved,
}: {
  course: Course | null;
  roles: JobRole[];
  text: Text;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Course>(() => structuredClone(course || emptyCourse()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(draft.modules[0]?.id || '');
  const updateModule = (moduleIndex: number, data: Partial<Course['modules'][number]>) =>
    setDraft((current) => ({
      ...current,
      modules: current.modules.map((module, index) =>
        index === moduleIndex ? { ...module, ...data } : module,
      ),
    }));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const invalid = validateCourse(draft, text);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await saveLearning(
        `/courses${course ? `/${course.id}` : ''}`,
        coursePayload(draft),
        course ? 'PATCH' : 'POST',
      );
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : text('Не удалось сохранить курс.', 'Курс сақталмады.'),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <GuardedModal
      open
      title={course ? text('Редактировать курс', 'Курсты өңдеу') : text('Новый курс', 'Жаңа курс')}
      onClose={onClose}
      dismissDisabled={saving}
      size="xl"
      footer={
        <>
          <button
            type="button"
            className="btn-outline"
            onClick={onClose}
            data-modal-dismiss
            disabled={saving}
          >
            {text('Отмена', 'Бас тарту')}
          </button>
          <button
            type="submit"
            className="btn-classic"
            form="academy-course-form"
            disabled={saving}
          >
            <Save size={18} aria-hidden="true" />
            {saving ? text('Сохраняем…', 'Сақталуда…') : text('Сохранить курс', 'Курсты сақтау')}
          </button>
        </>
      }
    >
      <form id="academy-course-form" className="modal-body academy-edit" onSubmit={save} noValidate>
        {error && (
          <p className="academy-error" role="alert">
            {error}
          </p>
        )}
        <div className="academy-editor-intro">
          <strong>{text('Курс → модули → уроки', 'Курс → модульдер → сабақтар')}</strong>
          <p>
            {text(
              'Добавьте реальные материалы, затем опубликуйте курс для сотрудников.',
              'Нақты материал қосып, курсты қызметкерлерге жариялаңыз.',
            )}
          </p>
        </div>
        <Field label={text('Название курса *', 'Курс атауы *')}>
          <input
            className="input-classic"
            required
            maxLength={180}
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </Field>
        <Field label={text('Краткое описание', 'Қысқаша сипаттама')}>
          <textarea
            className="input-classic"
            rows={2}
            maxLength={3000}
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </Field>
        <RolePicker
          roles={roles}
          selected={draft.roleIds}
          onChange={(roleIds) => setDraft({ ...draft, roleIds })}
          text={text}
        />
        <div className="academy-section-title">
          <h3>{text('Модули и уроки', 'Модульдер мен сабақтар')}</h3>
          <span>
            {draft.modules.reduce((count, module) => count + module.lessons.length, 0)}{' '}
            {text('уроков', 'сабақ')}
          </span>
        </div>
        <div className="academy-module-list">
          {draft.modules.map((module, moduleIndex) => (
            <section className="academy-module" key={module.id}>
              <div className="academy-module-heading">
                <button
                  type="button"
                  className="academy-module-expand"
                  onClick={() => setExpanded(expanded === module.id ? '' : module.id)}
                  aria-expanded={expanded === module.id}
                  aria-controls={`academy-module-${module.id}`}
                >
                  <span className="academy-step">{moduleIndex + 1}</span>
                  <strong>{module.title || text('Новый модуль', 'Жаңа модуль')}</strong>
                  <span>
                    {module.lessons.length} {text('уроков', 'сабақ')}
                  </span>
                  <ChevronDown size={18} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`${text('Удалить модуль', 'Модульді жою')} ${moduleIndex + 1}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      modules: draft.modules.filter((item) => item.id !== module.id),
                    })
                  }
                >
                  <Trash2 size={18} />
                </button>
              </div>
              <div
                id={`academy-module-${module.id}`}
                hidden={expanded !== module.id}
                className="academy-module-body"
              >
                <Field label={text('Название модуля *', 'Модуль атауы *')}>
                  <input
                    className="input-classic"
                    maxLength={180}
                    value={module.title}
                    onChange={(event) => updateModule(moduleIndex, { title: event.target.value })}
                  />
                </Field>
                {module.lessons.map((lesson, lessonIndex) => {
                  const updateLesson = (data: Partial<typeof lesson>) =>
                    updateModule(moduleIndex, {
                      lessons: module.lessons.map((item, index) =>
                        index === lessonIndex ? { ...item, ...data } : item,
                      ),
                    });
                  return (
                    <article className="academy-lesson" key={lesson.id}>
                      <div className="academy-section-title">
                        <h4>
                          {text('Урок', 'Сабақ')} {moduleIndex + 1}.{lessonIndex + 1}
                        </h4>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`${text('Удалить урок', 'Сабақты жою')} ${moduleIndex + 1}.${lessonIndex + 1}`}
                          onClick={() =>
                            updateModule(moduleIndex, {
                              lessons: module.lessons.filter((item) => item.id !== lesson.id),
                            })
                          }
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                      <Field label={text('Название урока *', 'Сабақ атауы *')}>
                        <input
                          className="input-classic"
                          maxLength={180}
                          value={lesson.title}
                          onChange={(event) => updateLesson({ title: event.target.value })}
                        />
                      </Field>
                      <Field
                        label={text('Материал урока', 'Сабақ материалы')}
                        hint={text(
                          'Обычный текст: инструкции, стандарты, примеры.',
                          'Мәтін: нұсқаулықтар, стандарттар, мысалдар.',
                        )}
                      >
                        <textarea
                          className="input-classic"
                          rows={5}
                          maxLength={30000}
                          value={lesson.body}
                          onChange={(event) => updateLesson({ body: event.target.value })}
                        />
                      </Field>
                      <div className="academy-two-columns">
                        <Field
                          label={text('Видео', 'Бейне')}
                          hint={text(
                            'Прямая защищённая ссылка https:// на видеофайл, например MP4.',
                            'Бейнефайлға, мысалы MP4, тікелей https:// сілтемесі.',
                          )}
                        >
                          <input
                            className="input-classic"
                            type="url"
                            inputMode="url"
                            placeholder="https://"
                            maxLength={2000}
                            value={lesson.videoUrl || ''}
                            onChange={(event) =>
                              updateLesson({ videoUrl: event.target.value || null })
                            }
                          />
                        </Field>
                        <NumberField
                          label={text('Время изучения, минут', 'Оқу уақыты, минут')}
                          min={0}
                          max={1440}
                          value={lesson.estimatedMinutes}
                          onChange={(estimatedMinutes) => updateLesson({ estimatedMinutes })}
                        />
                      </div>
                    </article>
                  );
                })}
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() =>
                    updateModule(moduleIndex, { lessons: [...module.lessons, emptyLesson()] })
                  }
                >
                  <Plus size={17} aria-hidden="true" />
                  {text('Добавить урок', 'Сабақ қосу')}
                </button>
              </div>
            </section>
          ))}
        </div>
        <button
          type="button"
          className="btn-outline academy-add-module"
          onClick={() => {
            const module = emptyModule();
            setDraft({ ...draft, modules: [...draft.modules, module] });
            setExpanded(module.id);
          }}
        >
          <Plus size={18} aria-hidden="true" />
          {text('Добавить модуль', 'Модуль қосу')}
        </button>
        <Toggle
          checked={draft.published}
          onChange={(published) => setDraft({ ...draft, published })}
          label={text('Опубликовать курс', 'Курсты жариялау')}
          hint={
            draft.published
              ? text('Сотрудники с доступом увидят курс.', 'Қолжетімді қызметкерлер курсты көреді.')
              : text(
                  'Черновик доступен только администраторам.',
                  'Жоба тек әкімшілерге қолжетімді.',
                )
          }
        />
      </form>
    </GuardedModal>
  );
}
