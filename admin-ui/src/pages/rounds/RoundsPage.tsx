import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  KeyRound,
  Pencil,
  Plus,
  Users,
} from '../../components/BulkaIcons';
import { useFeedback } from '../../components/Feedback';
import PageState from '../../components/PageState';
import { roundsApi } from './api';
import { calendarDays, dayLabel, shiftDay, todayKz } from './model';
import { CredentialsModal, InspectorForm, RoundForm } from './RoundForms';
import RoundDetails, { Status } from './RoundDetails';
import type { Branch, Credentials, Inspector, RoundsData } from './types';
import { useAutoRefresh } from './useAutoRefresh';
import './rounds.css';

type Editor = { kind: 'round' } | { kind: 'inspector'; inspector?: Inspector } | null;
export default function RoundsPage() {
  const [tab, setTab] = useState<'rounds' | 'inspectors'>('rounds');
  const [from, setFrom] = useState(todayKz);
  const [to, setTo] = useState(() => shiftDay(todayKz(), 6));
  const [city, setCity] = useState('');
  const [person, setPerson] = useState('');
  const [cities, setCities] = useState<string[]>([]);
  const [data, setData] = useState<RoundsData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [editor, setEditor] = useState<Editor>(null);
  const [credentials, setCredentials] = useState<Credentials>();
  const [detailId, setDetailId] = useState('');
  const [busyInspector, setBusyInspector] = useState('');
  const { toast, confirm } = useFeedback();
  const days = useMemo(() => calendarDays(from, to), [from, to]);
  const refresh = () => setTick((value) => value + 1);
  const loadedQuery = useRef('');
  const query = `${from}:${to}:${city}`;
  useAutoRefresh(refresh);
  useEffect(() => {
    const controller = new AbortController();
    if (!days.length) {
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(loadedQuery.current !== `${from}:${to}:${city}`);
    setError('');
    roundsApi
      .list(from, to, city, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        loadedQuery.current = `${from}:${to}:${city}`;
        setData(result);
        setCities((previous) =>
          [
            ...new Set([
              ...previous,
              ...result.branches.map((branch) => branch.city),
              ...result.inspectors.map((inspector) => inspector.city),
            ]),
          ].sort(),
        );
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setError(caught instanceof Error ? caught.message : 'Не удалось загрузить обходы.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [from, to, city, days.length, tick]);
  const inspectors = (data?.inspectors || []).filter(
    (inspector) => !city || inspector.city === city,
  );
  const rounds = (data?.rounds || []).filter(
    (round) => (!person || round.inspectorId === person) && (!city || round.city === city),
  );
  const selectedInspector = inspectors.find((inspector) => inspector.id === person);
  const branchMap = new Map((data?.branches || []).map((branch) => [branch.id, branch]));
  rounds.forEach((round) => {
    if (!branchMap.has(round.branchId))
      branchMap.set(round.branchId, {
        id: round.branchId,
        name: round.branchName,
        city: round.city,
        active: false,
      });
  });
  const branches = [...branchMap.values()].filter(
    (branch) =>
      (!city || branch.city === city) &&
      (!person ||
        selectedInspector?.branchIds.includes(branch.id) ||
        rounds.some((round) => round.branchId === branch.id)),
  );
  const completed = rounds.filter((round) => round.status === 'completed').length;
  const overdue = rounds.filter((round) => round.status === 'overdue').length;
  const active = rounds.filter(
    (round) => !['completed', 'cancelled'].includes(round.status),
  ).length;
  const shiftRange = (direction: number) => {
    const amount = direction * (days.length || 7);
    setFrom(shiftDay(from, amount));
    setTo(shiftDay(to, amount));
  };
  const saved = (nextCredentials?: Credentials) => {
    setEditor(null);
    if (nextCredentials) setCredentials(nextCredentials);
    refresh();
    toast(nextCredentials ? 'Сотрудник добавлен.' : 'Сохранено.', 'success');
  };
  const changeActive = async (inspector: Inspector) => {
    if (busyInspector) return;
    setBusyInspector(inspector.id);
    try {
      await roundsApi.updateInspector(inspector.id, { active: !inspector.active });
      toast(inspector.active ? 'Доступ отключён.' : 'Доступ включён.', 'success');
      refresh();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Не удалось изменить доступ.', 'error');
    } finally {
      setBusyInspector('');
    }
  };
  const resetPassword = async (inspector: Inspector) => {
    if (
      busyInspector ||
      !(await confirm({
        title: 'Выдать новый пароль?',
        body: `Старый пароль сотрудника «${inspector.name}» перестанет работать.`,
        confirmLabel: 'Выдать пароль',
      }))
    )
      return;
    setBusyInspector(inspector.id);
    try {
      const result = await roundsApi.password(inspector.id);
      setCredentials(result.credentials);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Не удалось создать пароль.', 'error');
    } finally {
      setBusyInspector('');
    }
  };
  const allBranches = data?.branches || [];
  const canAssign = inspectors.some((inspector) => inspector.active);
  return (
    <div className="rounds-page">
      <header className="rounds-heading">
        <div>
          <span className="rounds-eyebrow">КОМАНДА BULKA</span>
          <h1>Обходы точек</h1>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={loading || !data}
          onClick={() =>
            setEditor(tab === 'rounds' && canAssign ? { kind: 'round' } : { kind: 'inspector' })
          }
        >
          <Plus size={18} />
          {tab === 'rounds' && canAssign ? 'Назначить обход' : 'Добавить сотрудника'}
        </button>
      </header>
      <div className="rounds-tabs" role="tablist" aria-label="Разделы обходов">
        {(['rounds', 'inspectors'] as const).map((value, index) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`rounds-tab-${value}`}
            aria-selected={tab === value}
            aria-controls="rounds-panel"
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                setTab(value === 'rounds' ? 'inspectors' : 'rounds');
                event.currentTarget.parentElement
                  ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                  [(index + 1) % 2]?.focus();
              }
            }}
          >
            {value === 'rounds' ? <CalendarDays size={19} /> : <Users size={19} />}
            {value === 'rounds' ? 'Обходы' : 'Сотрудники'}
          </button>
        ))}
      </div>
      <div className="rounds-filters">
        <label>
          Город
          <select
            value={city}
            onChange={(event) => {
              setCity(event.target.value);
              setPerson('');
            }}
          >
            <option value="">Все города</option>
            {cities.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        {tab === 'rounds' && (
          <>
            <label>
              С
              <input
                aria-label="Дата с"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label>
              По
              <input
                aria-label="Дата по"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
            <label>
              Сотрудник
              <select value={person} onChange={(event) => setPerson(event.target.value)}>
                <option value="">Все сотрудники</option>
                {inspectors.map((inspector) => (
                  <option key={inspector.id} value={inspector.id}>
                    {inspector.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="rounds-period">
              <button
                type="button"
                className="rounds-icon-button"
                aria-label="Предыдущий период"
                disabled={!days.length}
                onClick={() => shiftRange(-1)}
              >
                <ChevronLeft size={19} />
              </button>
              <button
                type="button"
                className="btn-outline"
                onClick={() => {
                  setFrom(todayKz());
                  setTo(shiftDay(todayKz(), 6));
                }}
              >
                Сегодня
              </button>
              <button
                type="button"
                className="rounds-icon-button"
                aria-label="Следующий период"
                disabled={!days.length}
                onClick={() => shiftRange(1)}
              >
                <ChevronRight size={19} />
              </button>
            </div>
          </>
        )}
      </div>
      {error && loadedQuery.current === query && (
        <p className="rounds-error" role="alert">
          {error}
        </p>
      )}
      <section id="rounds-panel" role="tabpanel" aria-labelledby={`rounds-tab-${tab}`}>
        {!days.length && tab === 'rounds' ? (
          <p role="alert" className="rounds-error">
            Выберите период от 1 до 30 дней.
          </p>
        ) : loading ? (
          <PageState type="loading" title="Загружаем обходы" />
        ) : error && loadedQuery.current !== query ? (
          <PageState type="error" description={error} onRetry={refresh} />
        ) : (
          data &&
          (tab === 'rounds' ? (
            <>
              <div className="rounds-metrics">
                <div>
                  <ClipboardCheck size={21} />
                  <span>
                    <strong>{active}</strong>К выполнению
                  </span>
                </div>
                <div className="rounds-metric-completed">
                  <CheckCircle2 size={21} />
                  <span>
                    <strong>{completed}</strong>Выполнено
                  </span>
                </div>
                <div>
                  <span className="rounds-metric-dot" />
                  <span>
                    <strong>{overdue}</strong>Просрочено
                  </span>
                </div>
              </div>
              {!inspectors.length && !rounds.length ? (
                <PageState
                  type="empty"
                  title="Сначала добавьте сотрудника"
                  description="Выберите его город и филиалы, затем назначьте обход."
                  action={
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => setEditor({ kind: 'inspector' })}
                    >
                      <Plus size={18} />
                      Добавить сотрудника
                    </button>
                  }
                />
              ) : !branches.length ? (
                <PageState
                  type="empty"
                  title="Нет доступных филиалов"
                  description="Назначьте сотруднику филиалы в разделе «Сотрудники»."
                />
              ) : (
                <div
                  className="rounds-calendar-wrap"
                  role="region"
                  aria-label="Календарь обходов"
                  tabIndex={0}
                >
                  <table className="rounds-calendar">
                    <thead>
                      <tr>
                        <th scope="col">Филиал</th>
                        {days.map((day) => (
                          <th scope="col" className={day === todayKz() ? 'is-today' : ''} key={day}>
                            <span>
                              {new Intl.DateTimeFormat('ru-RU', {
                                weekday: 'short',
                                timeZone: 'Asia/Almaty',
                              }).format(new Date(`${day}T12:00:00Z`))}
                            </span>
                            {dayLabel(day)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {branches.map((branch: Branch) => (
                        <tr key={branch.id}>
                          <th scope="row">
                            <strong>{branch.name}</strong>
                            <small>{branch.city}</small>
                          </th>
                          {days.map((day) => (
                            <td key={day} className={day === todayKz() ? 'is-today' : ''}>
                              {rounds
                                .filter(
                                  (round) => round.branchId === branch.id && round.date === day,
                                )
                                .map((round) => (
                                  <button
                                    type="button"
                                    key={round.id}
                                    className={`rounds-calendar-card rounds-card-${round.status}`}
                                    aria-label={`${branch.name}, ${dayLabel(day)}, ${round.inspectorName}: ${round.title}, ${round.status === 'completed' ? 'Выполнен' : round.status === 'overdue' ? 'Просрочен' : round.status === 'in_progress' ? 'В работе' : round.status === 'cancelled' ? 'Отменён' : 'Назначен'}`}
                                    onClick={() => setDetailId(round.id)}
                                  >
                                    <Status round={round} />
                                    <strong>{round.title}</strong>
                                    <span>{round.inspectorName}</span>
                                    <small>
                                      {round.completedTasks} / {round.totalTasks} задач
                                    </small>
                                  </button>
                                ))}
                              {!rounds.some(
                                (round) => round.branchId === branch.id && round.date === day,
                              ) && (
                                <span className="rounds-empty-day" aria-label="Нет обходов">
                                  —
                                </span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {branches.length > 0 &&
                inspectors.some((inspector) => inspector.active) &&
                !rounds.length && (
                  <p className="rounds-empty-hint">
                    В этом периоде обходов нет. Нажмите «Назначить обход».
                  </p>
                )}
            </>
          ) : !inspectors.length ? (
            <PageState
              type="empty"
              title="Добавьте первого сотрудника"
              description="Выберите его город и филиалы. Логин и пароль создадим автоматически."
              action={
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setEditor({ kind: 'inspector' })}
                >
                  <Plus size={18} />
                  Добавить сотрудника
                </button>
              }
            />
          ) : (
            <div className="rounds-people">
              {inspectors.map((inspector) => (
                <article className="rounds-person" key={inspector.id}>
                  <div className="rounds-person-header">
                    <span className="rounds-avatar">
                      {inspector.name.trim().slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <h2>{inspector.name}</h2>
                      <p>{inspector.city}</p>
                    </div>
                    <span className={`rounds-access ${inspector.active ? 'is-active' : ''}`}>
                      {inspector.active ? 'Доступ открыт' : 'Отключён'}
                    </span>
                  </div>
                  <p className="rounds-username">{inspector.username}</p>
                  <div className="rounds-person-branches">
                    {inspector.branchIds.map((id) => (
                      <span key={id}>
                        {allBranches.find((branch) => branch.id === id)?.name ||
                          'Филиал недоступен'}
                      </span>
                    ))}
                  </div>
                  <div className="rounds-person-actions">
                    <button
                      type="button"
                      className="btn-outline"
                      disabled={Boolean(busyInspector)}
                      onClick={() => setEditor({ kind: 'inspector', inspector })}
                    >
                      <Pencil size={16} />
                      Изменить
                    </button>
                    <button
                      type="button"
                      className="btn-outline"
                      disabled={Boolean(busyInspector)}
                      onClick={() => void resetPassword(inspector)}
                    >
                      <KeyRound size={16} />
                      Новый пароль
                    </button>
                    <button
                      type="button"
                      className="rounds-text-button"
                      disabled={Boolean(busyInspector)}
                      onClick={() => void changeActive(inspector)}
                    >
                      {inspector.active ? 'Отключить доступ' : 'Включить доступ'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ))
        )}
      </section>
      {editor?.kind === 'inspector' && (
        <InspectorForm
          key={editor.inspector?.id || 'new'}
          inspector={editor.inspector}
          branches={allBranches}
          initialCity={city}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      )}
      {editor?.kind === 'round' && (
        <RoundForm
          branches={allBranches}
          inspectors={inspectors}
          initialInspector={person}
          initialDate={from}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            refresh();
            toast('Обход назначен.', 'success');
          }}
        />
      )}
      {credentials && (
        <CredentialsModal credentials={credentials} onClose={() => setCredentials(undefined)} />
      )}
      {detailId && (
        <RoundDetails id={detailId} onClose={() => setDetailId('')} onChanged={refresh} />
      )}
    </div>
  );
}
