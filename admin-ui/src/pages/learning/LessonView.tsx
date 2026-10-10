import {
  BookOpenText,
  CheckCircle2,
  ChevronLeft,
  ExternalLink,
  LockKeyhole,
} from '../../components/BulkaIcons';
import PageState from '../../components/PageState';
import { useLearningCopy } from './copy';
import { courseLessons, safeVideoUrl } from './model';
import type { Course, Lesson, Progress } from './types';

export default function LessonView({
  course,
  progress,
  lessonId,
  busy,
  selectLesson,
  complete,
  back,
}: {
  course: Course;
  progress: Progress;
  lessonId: string | null;
  busy: boolean;
  selectLesson: (id: string) => void;
  complete: (lesson: Lesson) => void;
  back: () => void;
}) {
  const { text } = useLearningCopy();
  const lessons = courseLessons(course);
  const completed = new Set(progress.lessons.map((item) => item.lessonId));
  const lesson =
    lessons.find((item) => item.id === lessonId) ||
    lessons.find((item) => !completed.has(item.id)) ||
    lessons[0];
  const index = lessons.findIndex((item) => item.id === lesson?.id);
  const locked = index > 0 && lessons.slice(0, index).some((item) => !completed.has(item.id));
  const video = safeVideoUrl(lesson?.videoUrl || null);
  const next = lessons[index + 1];
  return (
    <>
      <button className="academy-back" onClick={back}>
        <ChevronLeft size={18} aria-hidden="true" />
        {text('К обучению', 'Оқуға оралу')}
      </button>
      <div className="academy-reader-layout">
        <aside className="academy-card academy-syllabus">
          <span className="academy-eyebrow">{text('Программа курса', 'Курс бағдарламасы')}</span>
          <h2>{course.title}</h2>
          {[...course.modules]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((module) => (
              <section key={module.id}>
                <h3>{module.title}</h3>
                <ol>
                  {[...module.lessons]
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((item) => {
                      const position = lessons.findIndex((entry) => entry.id === item.id);
                      const available = lessons
                        .slice(0, position)
                        .every((entry) => completed.has(entry.id));
                      return (
                        <li key={item.id}>
                          <button
                            className={item.id === lesson?.id ? 'is-selected' : ''}
                            aria-current={item.id === lesson?.id ? 'step' : undefined}
                            disabled={busy || !available}
                            onClick={() => selectLesson(item.id)}
                          >
                            {completed.has(item.id) ? (
                              <CheckCircle2 size={17} aria-hidden="true" />
                            ) : available ? (
                              <BookOpenText size={17} aria-hidden="true" />
                            ) : (
                              <LockKeyhole size={17} aria-hidden="true" />
                            )}
                            <span>
                              {item.title}
                              <small>
                                {item.estimatedMinutes} {text('мин', 'мин')}
                              </small>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                </ol>
              </section>
            ))}
        </aside>
        <article className="academy-card academy-lesson">
          {!lesson ? (
            <PageState
              type="empty"
              title={text('В курсе пока нет уроков', 'Курста әлі сабақ жоқ')}
            />
          ) : locked ? (
            <PageState
              type="empty"
              title={text(
                'Сначала завершите предыдущие уроки',
                'Алдымен алдыңғы сабақтарды аяқтаңыз',
              )}
            />
          ) : (
            <>
              <div className="academy-lesson-top">
                <span className="academy-eyebrow">
                  {text('Урок', 'Сабақ')} {index + 1} / {lessons.length}
                </span>
                <span>
                  {lesson.estimatedMinutes} {text('мин', 'мин')}
                </span>
              </div>
              <h2>{lesson.title}</h2>
              {video && (
                <div className="academy-video">
                  <video
                    key={video}
                    controls
                    playsInline
                    preload="metadata"
                    aria-label={lesson.title}
                    src={video}
                  >
                    <a href={video}>{text('Открыть видео', 'Бейнені ашу')}</a>
                  </video>
                  <a
                    href={video}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="academy-video-link"
                  >
                    <ExternalLink size={16} aria-hidden="true" />
                    {text('Открыть видео отдельно', 'Бейнені бөлек ашу')}
                  </a>
                </div>
              )}
              {lesson.videoUrl && !video && (
                <p className="academy-note">
                  {text(
                    'Ссылка на видео недоступна. Сообщите администратору.',
                    'Бейне сілтемесі қолжетімсіз. Әкімшіге хабарлаңыз.',
                  )}
                </p>
              )}
              <div className="academy-lesson-body">
                {lesson.body
                  .split(/\n\s*\n/)
                  .filter(Boolean)
                  .map((paragraph, paragraphIndex) => (
                    <p key={paragraphIndex}>{paragraph}</p>
                  ))}
              </div>
              <div className="academy-lesson-footer">
                {completed.has(lesson.id) ? (
                  <>
                    <span className="academy-completed">
                      <CheckCircle2 size={19} aria-hidden="true" />
                      {text('Урок завершён', 'Сабақ аяқталды')}
                    </span>
                    {next && (
                      <button
                        className="academy-primary"
                        disabled={busy}
                        onClick={() => selectLesson(next.id)}
                      >
                        {text('Следующий урок', 'Келесі сабақ')}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      className="academy-primary"
                      disabled={busy}
                      onClick={() => complete(lesson)}
                    >
                      {busy
                        ? text('Сохраняем…', 'Сақталуда…')
                        : text('Завершить урок', 'Сабақты аяқтау')}
                      <CheckCircle2 size={18} aria-hidden="true" />
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </article>
      </div>
    </>
  );
}
