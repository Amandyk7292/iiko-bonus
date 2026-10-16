import { useState, type FormEvent } from 'react';
import { Copy, Plus, Trash2 } from '../../components/BulkaIcons';
import Modal from '../../components/Modal';
import { roundsApi } from './api';
import { evidenceLabels, todayKz } from './model';
import type { Branch, Credentials, EvidenceType, Inspector, TaskDraft } from './types';

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Не удалось сохранить. Повторите попытку.';
const toggle = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];

function BranchChoices({
  branches,
  selected,
  onChange,
}: {
  branches: Branch[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset className="rounds-branches">
      <legend>Филиалы</legend>
      {!branches.length && <p className="rounds-muted">Нет доступных филиалов.</p>}
      {branches.map((branch) => (
        <label className="rounds-checkbox" key={branch.id}>
          <input
            type="checkbox"
            checked={selected.includes(branch.id)}
            onChange={() => onChange(toggle(selected, branch.id))}
          />
          <span>{branch.name}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function InspectorForm({
  branches,
  inspector,
  initialCity,
  onClose,
  onSaved,
}: {
  branches: Branch[];
  inspector?: Inspector;
  initialCity: string;
  onClose: () => void;
  onSaved: (credentials?: Credentials) => void;
}) {
  const cities = [
    ...new Set(branches.filter((branch) => branch.active).map((branch) => branch.city)),
  ].sort();
  const [name, setName] = useState(inspector?.name || '');
  const [city, setCity] = useState(inspector?.city || initialCity || cities[0] || '');
  const [branchIds, setBranchIds] = useState(inspector?.branchIds || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const available = branches.filter((branch) => branch.active && branch.city === city);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const selected = branchIds.filter((id) => available.some((branch) => branch.id === id));
    if (!selected.length) {
      setError('Выберите хотя бы один филиал.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload = { name: name.trim(), city, branchIds: selected };
      if (inspector) {
        await roundsApi.updateInspector(inspector.id, payload);
        onSaved();
      } else {
        const result = await roundsApi.createInspector(payload);
        onSaved(result.credentials);
      }
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={inspector ? 'Изменить сотрудника' : 'Добавить сотрудника'}
      onClose={() => !busy && onClose()}
      size="md"
    >
      <form className="rounds-form" onSubmit={submit} aria-busy={busy}>
        <label>
          Имя сотрудника
          <input
            required
            maxLength={100}
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Город
          <select
            required
            value={city}
            onChange={(event) => {
              setCity(event.target.value);
              setBranchIds([]);
            }}
          >
            {!city && <option value="">Выберите город</option>}
            {cities.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <BranchChoices branches={available} selected={branchIds} onChange={setBranchIds} />
        {error && (
          <p className="rounds-error" role="alert">
            {error}
          </p>
        )}
        <div className="rounds-form-actions">
          <button type="button" className="btn-outline" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button className="btn-primary" disabled={busy || !available.length}>
            {busy ? 'Сохраняем…' : inspector ? 'Сохранить' : 'Создать доступ'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function RoundForm({
  branches,
  inspectors,
  initialInspector,
  initialDate,
  onClose,
  onSaved,
}: {
  branches: Branch[];
  inspectors: Inspector[];
  initialInspector: string;
  initialDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const availableInspectors = inspectors.filter((inspector) => inspector.active);
  const [inspectorId, setInspectorId] = useState(
    availableInspectors.some((person) => person.id === initialInspector)
      ? initialInspector
      : availableInspectors[0]?.id || '',
  );
  const [title, setTitle] = useState('Обход точки');
  const [date, setDate] = useState(initialDate < todayKz() ? todayKz() : initialDate);
  const [time, setTime] = useState('18:00');
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [tasks, setTasks] = useState<TaskDraft[]>([
    { title: '', instructions: '', evidenceType: 'photo' },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const person = availableInspectors.find((inspector) => inspector.id === inspectorId);
  const available = branches.filter(
    (branch) =>
      branch.active && person?.branchIds.includes(branch.id) && branch.city === person.city,
  );
  const updateTask = (index: number, update: Partial<TaskDraft>) =>
    setTasks((items) =>
      items.map((item, position) => (position === index ? { ...item, ...update } : item)),
    );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const selected = branchIds.filter((id) => available.some((branch) => branch.id === id));
    if (!selected.length) {
      setError('Выберите хотя бы один филиал.');
      return;
    }
    if (!tasks.length || tasks.some((task) => !task.title.trim())) {
      setError('Укажите название каждой задачи.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await roundsApi.create({
        inspectorId,
        branchIds: selected,
        title: title.trim(),
        date,
        deadline: `${date}T${time}:00+05:00`,
        tasks: tasks.map((task) => ({
          ...task,
          title: task.title.trim(),
          instructions: task.instructions.trim(),
        })),
      });
      onSaved();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title="Назначить обход" onClose={() => !busy && onClose()} size="lg">
      <form className="rounds-form" onSubmit={submit} aria-busy={busy}>
        <label>
          Сотрудник
          <select
            required
            value={inspectorId}
            onChange={(event) => {
              setInspectorId(event.target.value);
              setBranchIds([]);
            }}
          >
            {!availableInspectors.length && <option value="">Сначала добавьте сотрудника</option>}
            {availableInspectors.map((inspector) => (
              <option key={inspector.id} value={inspector.id}>
                {inspector.name} · {inspector.city}
              </option>
            ))}
          </select>
        </label>
        <label>
          Название обхода
          <input
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div className="rounds-form-pair">
          <label>
            Дата
            <input
              type="date"
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label>
            Выполнить до
            <input
              aria-label="Выполнить до"
              type="time"
              required
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
            <small>Время Казахстана</small>
          </label>
        </div>
        <BranchChoices branches={available} selected={branchIds} onChange={setBranchIds} />
        <div className="rounds-task-heading">
          <h3>Задачи</h3>
          <span>{tasks.length} / 30</span>
        </div>
        {tasks.map((task, index) => (
          <fieldset className="rounds-task-editor" key={index}>
            <legend>Задача {index + 1}</legend>
            <label>
              Что проверить
              <input
                required
                maxLength={200}
                value={task.title}
                onChange={(event) => updateTask(index, { title: event.target.value })}
              />
            </label>
            <label>
              Указания
              <textarea
                rows={2}
                maxLength={2000}
                value={task.instructions}
                onChange={(event) => updateTask(index, { instructions: event.target.value })}
              />
            </label>
            <div className="rounds-task-bottom">
              <label>
                Подтверждение
                <select
                  value={task.evidenceType}
                  onChange={(event) =>
                    updateTask(index, { evidenceType: event.target.value as EvidenceType })
                  }
                >
                  {Object.entries(evidenceLabels).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="rounds-icon-button"
                aria-label={`Удалить задачу ${index + 1}`}
                disabled={tasks.length === 1}
                onClick={() =>
                  setTasks((items) => items.filter((_, position) => position !== index))
                }
              >
                <Trash2 size={18} />
              </button>
            </div>
          </fieldset>
        ))}
        <button
          type="button"
          className="btn-outline rounds-add-task"
          disabled={tasks.length >= 30}
          onClick={() =>
            setTasks((items) => [...items, { title: '', instructions: '', evidenceType: 'photo' }])
          }
        >
          <Plus size={18} />
          Добавить задачу
        </button>
        {error && (
          <p className="rounds-error" role="alert">
            {error}
          </p>
        )}
        <div className="rounds-form-actions">
          <button type="button" className="btn-outline" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn-primary"
            disabled={busy || !availableInspectors.length || !available.length}
          >
            {busy ? 'Назначаем…' : 'Назначить обход'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function CredentialsModal({
  credentials,
  onClose,
}: {
  credentials: Credentials;
  onClose: () => void;
}) {
  const [feedback, setFeedback] = useState('');
  const url = new URL('/rounds', window.location.origin).href;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        `${url}\nЛогин: ${credentials.username}\nПароль: ${credentials.password}`,
      );
      setFeedback('Доступ скопирован.');
    } catch {
      setFeedback('Не удалось скопировать. Выделите и скопируйте данные.');
    }
  };
  return (
    <Modal open title="Доступ сотрудника" onClose={onClose} size="sm">
      <div className="rounds-form rounds-credentials">
        <p className="rounds-muted">Сохраните пароль — он показывается один раз.</p>
        <dl>
          <div>
            <dt>Вход</dt>
            <dd>
              <a href={url}>{url}</a>
            </dd>
          </div>
          <div>
            <dt>Логин</dt>
            <dd>{credentials.username}</dd>
          </div>
          <div>
            <dt>Пароль</dt>
            <dd>{credentials.password}</dd>
          </div>
        </dl>
        {feedback && <p role="status">{feedback}</p>}
        <button className="btn-primary" type="button" onClick={() => void copy()}>
          <Copy size={18} />
          Скопировать доступ
        </button>
        <button className="btn-outline" type="button" onClick={onClose}>
          Готово
        </button>
      </div>
    </Modal>
  );
}
