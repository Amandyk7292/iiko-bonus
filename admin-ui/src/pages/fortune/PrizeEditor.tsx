import { Trash2 } from '../../components/BulkaIcons';
import { Field } from './Fields';
import type { Prize, Text } from './model';

export default function PrizeEditor({
  prize,
  index,
  onChange,
  onRemove,
  text,
}: {
  prize: Prize;
  index: number;
  onChange: (prize: Prize) => void;
  onRemove: () => void;
  text: Text;
}) {
  const patch = (value: Partial<Prize>) => onChange({ ...prize, ...value });
  return (
    <fieldset className={`fortune-prize ${prize.active ? '' : 'is-inactive'}`}>
      <legend>
        {text('Сектор', 'Сектор')} {index + 1}
      </legend>
      <div className="fortune-prize-header">
        <span
          className="fortune-color-chip"
          style={{ background: prize.color }}
          aria-hidden="true"
        />
        <label className="fortune-check">
          <input
            type="checkbox"
            checked={prize.active}
            onChange={(event) => patch({ active: event.target.checked })}
          />
          {text('Включён', 'Қосулы')}
        </label>
        <button
          type="button"
          className="icon-button"
          disabled={prize.issuedCount > 0}
          title={
            prize.issuedCount > 0
              ? text('Выданные призы сохраняются в истории', 'Берілген сыйлықтар тарихта сақталады')
              : undefined
          }
          aria-label={text(`Удалить сектор ${index + 1}`, `${index + 1} секторды жою`)}
          onClick={onRemove}
        >
          <Trash2 size={18} />
        </button>
      </div>
      <div className="fortune-fields">
        <Field label={text('Название приза', 'Сыйлық атауы')}>
          <input
            className="input-classic"
            value={prize.label}
            maxLength={100}
            required
            onChange={(event) => patch({ label: event.target.value })}
          />
        </Field>
        <Field label={text('Тип приза', 'Сыйлық түрі')}>
          <select
            className="input-classic"
            value={prize.kind}
            onChange={(event) => {
              const kind = event.target.value as Prize['kind'];
              patch({
                kind,
                bonusAmount: kind === 'bonus' ? prize.bonusAmount || 100 : null,
                stockLimit: kind === 'none' ? null : prize.stockLimit,
              });
            }}
          >
            <option value="gift">{text('Подарок', 'Сыйлық')}</option>
            <option value="bonus">{text('Бонусы', 'Бонустар')}</option>
            <option value="none">{text('Без приза', 'Сыйлықсыз')}</option>
          </select>
        </Field>
        <Field label={text('Цвет сектора', 'Сектор түсі')}>
          <input
            className="fortune-color-input"
            type="color"
            value={prize.color}
            onChange={(event) => patch({ color: event.target.value })}
          />
        </Field>
        <Field label={text('Вероятность, %', 'Ықтималдық, %')}>
          <input
            className="input-classic"
            type="number"
            min={0}
            max={100}
            step={1}
            required
            value={prize.weight}
            onChange={(event) => patch({ weight: Number(event.target.value) })}
          />
        </Field>
        {prize.kind === 'bonus' && (
          <Field label={text('Сумма бонусов', 'Бонус сомасы')}>
            <input
              className="input-classic"
              type="number"
              min={1}
              max={100000}
              step={1}
              required
              value={prize.bonusAmount || ''}
              onChange={(event) =>
                patch({ bonusAmount: event.target.value ? Number(event.target.value) : null })
              }
            />
          </Field>
        )}
        {prize.kind !== 'none' && (
          <>
            <Field
              label={text('Всего призов', 'Сыйлық саны')}
              hint={text(
                `Выдано: ${prize.issuedCount}. Пусто — без лимита.`,
                `Берілді: ${prize.issuedCount}. Бос болса — шектеусіз.`,
              )}
            >
              <input
                className="input-classic"
                type="number"
                min={prize.issuedCount}
                max={1000000}
                step={1}
                value={prize.stockLimit ?? ''}
                placeholder={text('Без лимита', 'Шектеусіз')}
                onChange={(event) =>
                  patch({
                    stockLimit: event.target.value === '' ? null : Number(event.target.value),
                  })
                }
              />
            </Field>
            <Field label={text('Срок получения, дней', 'Алу мерзімі, күн')}>
              <input
                className="input-classic"
                type="number"
                min={1}
                max={365}
                step={1}
                required
                value={prize.validityDays}
                onChange={(event) => patch({ validityDays: Number(event.target.value) })}
              />
            </Field>
          </>
        )}
      </div>
    </fieldset>
  );
}
