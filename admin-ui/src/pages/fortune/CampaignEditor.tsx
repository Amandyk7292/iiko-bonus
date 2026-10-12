import { useState, type FormEvent } from 'react';
import { Plus } from '../../components/BulkaIcons';
import Modal from '../../components/GuardedModal';
import { useI18n } from '../../lib/i18n';
import { Field, WheelPreview } from './Fields';
import PrizeEditor from './PrizeEditor';
import { saveCampaign } from './api';
import {
  campaignInput,
  defaultPrize,
  validationMessage,
  type Branch,
  type Campaign,
} from './model';

function localDate(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}
function isoDate(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export default function CampaignEditor({
  campaign,
  branches,
  onClose,
  onSaved,
}: {
  campaign: Campaign;
  branches: Branch[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { locale } = useI18n();
  const text = (ru: string, kk: string) => (locale === 'kk' ? kk : ru);
  const [draft, setDraft] = useState<Campaign>(() => structuredClone(campaign));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(campaign);
  const patch = (value: Partial<Campaign>) => setDraft((current) => ({ ...current, ...value }));
  const probability = draft.prizes
    .filter((prize) => prize.active)
    .reduce((sum, prize) => sum + prize.weight, 0);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const message = validationMessage(draft, text);
    if (message) {
      setError(message);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await saveCampaign(draft.id, campaignInput(draft));
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : text('Не удалось сохранить акцию.', 'Акция сақталмады.'),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={
        campaign.id
          ? text('Настройки рулетки', 'Рулетка баптаулары')
          : text('Новая рулетка', 'Жаңа рулетка')
      }
      onClose={onClose}
      size="xl"
      dirty={dirty}
      dismissDisabled={busy}
      footer={
        <div className="fortune-editor-footer">
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="fortune-actions">
            <button
              type="button"
              className="btn-outline"
              disabled={busy}
              onClick={onClose}
              data-modal-dismiss
            >
              {text('Отмена', 'Бас тарту')}
            </button>
            <button
              type="submit"
              form="fortune-campaign-form"
              className="btn-primary"
              disabled={busy}
            >
              {busy
                ? text('Сохраняем…', 'Сақталуда…')
                : text('Сохранить настройки', 'Баптауларды сақтау')}
            </button>
          </div>
        </div>
      }
    >
      <form id="fortune-campaign-form" className="fortune-editor" onSubmit={save}>
        <fieldset disabled={busy} className="fortune-editor-controls">
          <div className="fortune-fields">
            <Field label={text('Название акции', 'Акция атауы')}>
              <input
                className="input-classic"
                value={draft.title}
                required
                maxLength={160}
                placeholder={text('Колесо подарков Bulka', 'Bulka сыйлық дөңгелегі')}
                onChange={(event) => patch({ title: event.target.value })}
              />
            </Field>
            <Field label={text('Статус', 'Мәртебе')}>
              <select
                className="input-classic"
                value={draft.status}
                onChange={(event) => patch({ status: event.target.value as Campaign['status'] })}
              >
                <option value="draft">{text('Черновик', 'Жоба')}</option>
                <option value="active">{text('Активна', 'Белсенді')}</option>
                <option value="paused">{text('Приостановлена', 'Кідіртілген')}</option>
              </select>
            </Field>
          </div>
          <fieldset className="fortune-branches">
            <legend>{text('Филиалы', 'Филиалдар')}</legend>
            <div>
              {branches
                .filter((branch) => branch.active || draft.branchIds.includes(branch.id))
                .map((branch) => (
                  <label key={branch.id} className="fortune-check">
                    <input
                      type="checkbox"
                      checked={draft.branchIds.includes(branch.id)}
                      onChange={(event) =>
                        patch({
                          branchIds: event.target.checked
                            ? [...draft.branchIds, branch.id]
                            : draft.branchIds.filter((id) => id !== branch.id),
                        })
                      }
                    />
                    <span>
                      {branch.name}
                      <small>
                        {branch.city}
                        {!branch.active && ` · ${text('неактивен', 'белсенді емес')}`}
                      </small>
                    </span>
                  </label>
                ))}
            </div>
          </fieldset>
          <div className="fortune-fields">
            <Field label={text('Минимальная сумма чека, ₸', 'Чектің ең аз сомасы, ₸')}>
              <input
                type="number"
                className="input-classic"
                min={0}
                max={10000000}
                step="0.01"
                required
                value={draft.minReceiptAmount}
                onChange={(event) => patch({ minReceiptAmount: Number(event.target.value) })}
              />
            </Field>
            <Field label={text('Чек действует, часов', 'Чек жарамдылығы, сағат')}>
              <input
                type="number"
                className="input-classic"
                min={1}
                max={168}
                step={1}
                required
                value={draft.maxReceiptAgeHours}
                onChange={(event) => patch({ maxReceiptAgeHours: Number(event.target.value) })}
              />
            </Field>
          </div>
          <details className="fortune-schedule">
            <summary>{text('Период акции', 'Акция мерзімі')}</summary>
            <div className="fortune-fields">
              <Field label={text('Начало', 'Басталуы')}>
                <input
                  type="datetime-local"
                  className="input-classic"
                  value={localDate(draft.startsAt)}
                  onChange={(event) => patch({ startsAt: isoDate(event.target.value) })}
                />
              </Field>
              <Field label={text('Окончание', 'Аяқталуы')}>
                <input
                  type="datetime-local"
                  className="input-classic"
                  value={localDate(draft.endsAt)}
                  onChange={(event) => patch({ endsAt: isoDate(event.target.value) })}
                />
              </Field>
            </div>
          </details>
          <div className="fortune-section-heading">
            <h3>{text('Призы', 'Сыйлықтар')}</h3>
            <span className={`fortune-probability ${probability === 100 ? 'is-valid' : ''}`}>
              {probability} / 100%
            </span>
          </div>
          <div className="fortune-prize-list">
            {draft.prizes.map((prize, index) => (
              <PrizeEditor
                key={prize.id}
                prize={prize}
                index={index}
                text={text}
                onChange={(updated) =>
                  patch({
                    prizes: draft.prizes.map((current) =>
                      current.id === prize.id ? updated : current,
                    ),
                  })
                }
                onRemove={() =>
                  patch({ prizes: draft.prizes.filter((current) => current.id !== prize.id) })
                }
              />
            ))}
          </div>
          <button
            type="button"
            className="btn-outline"
            disabled={draft.prizes.length >= 12}
            onClick={() =>
              patch({ prizes: [...draft.prizes, defaultPrize('gift', '', '#f4b894', 0)] })
            }
          >
            <Plus size={18} />
            {text('Добавить приз', 'Сыйлық қосу')}
          </button>
          <p className="fortune-private-note">
            {text(
              'Вероятности и лимиты видны только в админке. Когда лимит исчерпан, приз больше не выпадает.',
              'Ықтималдықтар мен шектеулер тек әкімшіге көрінеді. Шек біткенде сыйлық түспейді.',
            )}
          </p>
        </fieldset>
        <aside className="fortune-editor-preview">
          <h3>{text('Колесо клиента', 'Клиент дөңгелегі')}</h3>
          <WheelPreview prizes={draft.prizes} text={text} />
        </aside>
      </form>
    </Modal>
  );
}
