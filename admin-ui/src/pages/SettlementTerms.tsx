import { useState } from 'react';
import { request } from '../lib/api';
import { useI18n } from '../lib/i18n';
import Modal from '../components/GuardedModal';
import SelectControl from '../components/SelectControl';
import type { Config } from './settlements-model';
export default function SettlementTerms({
  config,
  onSaved,
}: {
  config: Config;
  onSaved: () => Promise<void>;
}) {
  const { locale } = useI18n();
  const kk = locale === 'kk';
  const [open, setOpen] = useState(false),
    [branch, setBranch] = useState(''),
    [partner, setPartner] = useState(''),
    [name, setName] = useState(''),
    [commission, setCommission] = useState('0'),
    [bonus, setBonus] = useState('100'),
    [delivery, setDelivery] = useState('platform'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await request('/transactions/settlements/terms', {
        method: 'POST',
        body: JSON.stringify({
          branch,
          partner: partner || null,
          commission: Math.round(Number(commission) * 100),
          bonus: Math.round(Number(bonus) * 100),
          delivery,
        }),
      });
      await onSaved();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    setBusy(true);
    setError('');
    try {
      const p = await request<{ id: string }>('/transactions/settlements/partners', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      await onSaved();
      setPartner(p.id);
      setName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        className="btn-outline"
        type="button"
        onClick={() => {
          setError('');
          setOpen(true);
        }}
      >
        {kk ? 'Серіктестер мен шарттар' : 'Партнёры и условия'}
      </button>
      <Modal
        open={open}
        title={kk ? 'Серіктестер мен шарттар' : 'Партнёры и условия'}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
      >
        <div className="modal-body form-stack">
          <p className="field-hint">
            {kk
              ? 'Өзгерістер тек жаңа тапсырыстарға қолданылады.'
              : 'Изменения действуют только для новых заказов. Владелец и условия прошлых заказов сохраняются.'}
          </p>
          <label className="field-group">
            <span>{kk ? 'Жаңа серіктестің атауы' : 'Название нового партнёра'}</span>
            <input
              className="input-classic"
              value={name}
              maxLength={160}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-outline"
            disabled={busy || name.trim().length < 2}
            onClick={() => void add()}
          >
            {kk ? 'Серіктес қосу' : 'Добавить партнёра'}
          </button>
          <div className="field-group">
            <label htmlFor="settlement-branch">{kk ? 'Нүкте' : 'Точка'}</label>
            <SelectControl
              id="settlement-branch"
              value={branch}
              options={[
                { value: '', label: kk ? 'Таңдаңыз' : 'Выберите точку' },
                ...config.locations.map((l) => ({ value: l.id, label: `${l.city} · ${l.name}` })),
              ]}
              onChange={(value) => {
                setBranch(value);
                const t = config.terms.find((t) => t.branch_id === value);
                setPartner(t?.partner_id || '');
                setCommission(String((t?.commission_bps || 0) / 100));
                setBonus(String((t?.bonus_compensation_bps ?? 10000) / 100));
                setDelivery(t?.delivery_recipient || 'platform');
              }}
            />
          </div>
          <div className="field-group">
            <label htmlFor="settlement-partner">{kk ? 'Иесі' : 'Владелец точки'}</label>
            <SelectControl
              id="settlement-partner"
              value={partner}
              onChange={setPartner}
              options={[
                { value: '', label: kk ? 'Өз нүктеміз' : 'Собственная точка Bulka' },
                ...config.partners.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </div>
          <div className="form-grid form-grid-2">
            <label className="field-group">
              <span>{kk ? 'Bulka комиссиясы, %' : 'Комиссия Bulka, %'}</span>
              <input
                type="number"
                className="input-classic"
                min="0"
                max="100"
                step="0.01"
                value={commission}
                onChange={(e) => setCommission(e.target.value)}
              />
            </label>
            <label className="field-group">
              <span>{kk ? 'Бонус өтемі, %' : 'Компенсация списанных бонусов, %'}</span>
              <input
                type="number"
                className="input-classic"
                min="0"
                max="100"
                step="0.01"
                value={bonus}
                onChange={(e) => setBonus(e.target.value)}
              />
            </label>
          </div>
          <p className="field-hint">
            {kk
              ? 'Комиссия жеткізусіз ақшалай төлемнен есептеледі.'
              : 'Комиссия считается от оставшейся после возвратов денежной оплаты товаров, без доставки и бонусов. 100% компенсации бонусов означает, что их оплачивает Bulka. Комиссия эквайринга — за счёт партнёра, по факту сверки.'}
          </p>
          <div className="field-group">
            <label htmlFor="settlement-delivery">
              {kk ? 'Жеткізу ақысы кімге тиесілі' : 'Кому причитается плата за доставку'}
            </label>
            <SelectControl
              id="settlement-delivery"
              value={delivery}
              onChange={setDelivery}
              options={[
                { value: 'platform', label: 'Bulka' },
                { value: 'partner', label: kk ? 'Серіктес' : 'Партнёр' },
              ]}
            />
          </div>
          {error && (
            <p className="inline-alert inline-alert-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="btn-classic"
              type="button"
              disabled={
                busy ||
                !branch ||
                commission === '' ||
                bonus === '' ||
                Number(commission) < 0 ||
                Number(commission) > 100 ||
                Number(bonus) < 0 ||
                Number(bonus) > 100
              }
              onClick={() => void save()}
            >
              {busy ? '…' : kk ? 'Жаңа тапсырыстарға қолдану' : 'Применить к новым заказам'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
