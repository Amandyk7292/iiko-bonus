import { useEffect, useState } from 'react';
import { BadgeCheck, ChevronLeft, Clock } from '../../components/BulkaIcons';
import PageState from '../../components/PageState';
import { useLearningCopy } from './copy';
import { validAnswers } from './model';
import type { Attempt } from './types';

export default function AttemptView({
  attempt,
  answers,
  busy,
  changeAnswer,
  submit,
  back,
  refresh,
}: {
  attempt: Attempt;
  answers: Record<string, string>;
  busy: boolean;
  changeAnswer: (question: string, choice: string) => void;
  submit: () => void;
  back: () => void;
  refresh: () => void;
}) {
  const { text } = useLearningCopy();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (attempt.status !== 'in_progress') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [attempt.id, attempt.status]);
  const seconds = Math.max(0, Math.ceil((Date.parse(attempt.deadlineAt) - now) / 1000));
  const expired =
    attempt.status === 'expired' || (attempt.status === 'in_progress' && seconds === 0);
  const selected = validAnswers(attempt, answers);
  const complete = attempt.questions.length > 0 && selected.length === attempt.questions.length;
  return (
    <>
      <button className="academy-back" onClick={back} disabled={busy}>
        <ChevronLeft size={18} aria-hidden="true" />
        {text('К тестам', 'Тесттерге оралу')}
      </button>
      <section className="academy-card academy-attempt">
        <div className="academy-attempt-header">
          <div>
            <span className="academy-eyebrow">
              {attempt.kind === 'promotion'
                ? text('Экзамен на повышение', 'Жоғарылату емтиханы')
                : attempt.kind === 'control'
                  ? text('Контроль знаний', 'Білімді бақылау')
                  : text('Практика', 'Тәжірибе')}
            </span>
            <h2>{attempt.title}</h2>
          </div>
          {attempt.status === 'in_progress' && (
            <div className="academy-timer" aria-label={text('Оставшееся время', 'Қалған уақыт')}>
              <Clock size={18} aria-hidden="true" />
              <strong>
                {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
              </strong>
            </div>
          )}
        </div>
        {attempt.status === 'submitted' ? (
          <div className={`academy-result ${attempt.passed ? 'is-passed' : ''}`} role="status">
            <BadgeCheck size={42} aria-hidden="true" />
            <h3>
              {attempt.passed === null
                ? text('Результат ожидается', 'Нәтиже күтілуде')
                : attempt.passed
                  ? text('Тест пройден', 'Тесттен өттіңіз')
                  : text('Тест не пройден', 'Тесттен өтпедіңіз')}
            </h3>
            <strong>{attempt.scorePercent === null ? '—' : `${attempt.scorePercent}%`}</strong>
            <p>
              {text('Проходной балл', 'Өту балы')}: {attempt.passPercent}%
            </p>
            {attempt.result && (
              <p>
                {attempt.result.correctCount} / {attempt.result.questionCount}{' '}
                {text('правильных ответов', 'дұрыс жауап')} · +{attempt.result.xpAwarded} XP
              </p>
            )}
            {attempt.kind === 'promotion' && attempt.passed && (
              <p className="academy-note">
                {attempt.promotionDecision === 'approved'
                  ? text('Повышение подтверждено руководителем.', 'Жоғарылатуды жетекші растады.')
                  : attempt.promotionDecision === 'rejected'
                    ? text(
                        'Повышение не подтверждено. Обсудите решение с руководителем.',
                        'Жоғарылату расталмады. Шешімді жетекшімен талқылаңыз.',
                      )
                    : text(
                        'Экзамен сдан. Повышение ожидает подтверждения руководителем.',
                        'Емтихан тапсырылды. Жоғарылату жетекшінің растауын күтуде.',
                      )}
              </p>
            )}
            <button className="academy-secondary" onClick={back}>
              {text('К тестам', 'Тесттерге оралу')}
            </button>
          </div>
        ) : expired ? (
          <PageState
            type="error"
            title={text('Время попытки истекло', 'Талпыныс уақыты аяқталды')}
            description={text(
              'Ответы не отправляются автоматически. Обновите статус или вернитесь к списку тестов.',
              'Жауаптар автоматты түрде жіберілмейді. Күйді жаңартыңыз немесе тесттер тізіміне оралыңыз.',
            )}
            onRetry={refresh}
          />
        ) : !attempt.questions.length ? (
          <PageState
            type="empty"
            title={text('Вопросы недоступны', 'Сұрақтар қолжетімсіз')}
            description={text(
              'Обновите попытку. Если вопросов всё ещё нет, сообщите администратору.',
              'Талпынысты жаңартыңыз. Сұрақтар әлі жоқ болса, әкімшіге хабарлаңыз.',
            )}
            onRetry={refresh}
          />
        ) : (
          <>
            <p className="academy-note">
              {text('Выберите один ответ на каждый вопрос.', 'Әр сұраққа бір жауап таңдаңыз.')}
            </p>
            <progress
              value={selected.length}
              max={attempt.questions.length}
              aria-label={text('Отвеченные вопросы', 'Жауап берілген сұрақтар')}
            />
            <p className="academy-answer-count" aria-live="polite">
              {text('Отвечено', 'Жауап берілді')}: {selected.length} / {attempt.questions.length}
            </p>
            <div className="academy-questions">
              {attempt.questions.map((question, index) => (
                <fieldset key={question.id} disabled={busy}>
                  <legend>
                    <span>{index + 1}</span>
                    {question.prompt}
                  </legend>
                  {question.choices.map((choice) => (
                    <label
                      key={choice.id}
                      className={answers[question.id] === choice.id ? 'is-selected' : ''}
                    >
                      <input
                        type="radio"
                        name={`answer-${attempt.id}-${question.id}`}
                        value={choice.id}
                        checked={answers[question.id] === choice.id}
                        onChange={() => changeAnswer(question.id, choice.id)}
                      />
                      <span>{choice.text}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <div className="academy-attempt-submit">
              {!complete && (
                <p>{text('Ответьте на все вопросы.', 'Барлық сұраққа жауап беріңіз.')}</p>
              )}
              <button className="academy-primary" onClick={submit} disabled={busy || !complete}>
                {busy
                  ? text('Проверяем…', 'Тексерілуде…')
                  : text('Отправить ответы', 'Жауаптарды жіберу')}
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
