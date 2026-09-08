import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { download } from './api';
import { metrics, type Server } from './model';
import type { Template } from './ReportBuilder';
export interface Preferences {
  cards: string[];
  templates: Template[];
  auto: boolean;
}
export function parsePreferences(raw: string): Preferences {
  if (raw.length > 200000) throw new Error('Invalid preferences');
  const data = JSON.parse(raw);
  if (
    !Array.isArray(data.cards) ||
    !data.cards.length ||
    data.cards.length > metrics.length ||
    data.cards.some((key: unknown) => !metrics.some((item) => item.id === key)) ||
    new Set(data.cards).size !== data.cards.length ||
    !Array.isArray(data.templates) ||
    data.templates.length > 50 ||
    typeof data.auto !== 'boolean'
  )
    throw new Error('Invalid preferences');
  for (const template of data.templates) {
    if (
      !template ||
      typeof template.name !== 'string' ||
      template.name.length > 80 ||
      !['SALES', 'TRANSACTIONS', 'DELIVERIES'].includes(template.reportType)
    )
      throw new Error('Invalid template');
    for (const key of ['aggregate', 'groupBy'])
      if (
        !Array.isArray(template[key]) ||
        template[key].length > (key === 'aggregate' ? 12 : 5) ||
        template[key].some(
          (field: unknown) => typeof field !== 'string' || !/^[a-zA-Z0-9_.-]{1,120}$/.test(field),
        )
      )
        throw new Error('Invalid fields');
    if (!Array.isArray(template.filters) || template.filters.length > 15)
      throw new Error('Invalid filters');
    for (const filter of template.filters)
      if (
        typeof filter.field !== 'string' ||
        !/^[a-zA-Z0-9_.-]{1,120}$/.test(filter.field) ||
        typeof filter.exclude !== 'boolean' ||
        !Array.isArray(filter.values) ||
        filter.values.length > 100 ||
        filter.values.some(
          (value: unknown) =>
            !['string', 'number', 'boolean'].includes(typeof value) || String(value).length > 250,
        )
      )
        throw new Error('Invalid filter');
  }
  return {
    cards: data.cards,
    templates: data.templates.map((item: Template) => ({
      name: item.name,
      reportType: item.reportType,
      groupBy: item.groupBy,
      aggregate: item.aggregate,
      filters: item.filters,
    })),
    auto: data.auto,
  };
}
export default function Settings({
  servers,
  preferences,
  onChange,
}: {
  servers: Server[];
  preferences: Preferences;
  onChange: (value: Preferences) => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState(false);
  const move = (index: number, direction: number) => {
    const cards = [...preferences.cards];
    [cards[index], cards[index + direction]] = [cards[index + direction], cards[index]];
    onChange({ ...preferences, cards });
  };
  return (
    <div className="id-settings-grid">
      <section className="card id-panel">
        <h2>{t('id.cards')}</h2>
        {preferences.cards.map((key, index) => (
          <div className="id-setting-row" key={key}>
            <span>{t(`id.${key}`)}</span>
            <div>
              <button
                type="button"
                aria-label={`${t('id.moveUp')}: ${t(`id.${key}`)}`}
                disabled={!index}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={16} />
              </button>
              <button
                type="button"
                aria-label={`${t('id.moveDown')}: ${t(`id.${key}`)}`}
                disabled={index === preferences.cards.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={16} />
              </button>
              <button
                type="button"
                disabled={preferences.cards.length <= 1}
                onClick={() =>
                  onChange({
                    ...preferences,
                    cards: preferences.cards.filter((item) => item !== key),
                  })
                }
              >
                {t('id.remove')}
              </button>
            </div>
          </div>
        ))}
        <select
          aria-label={t('id.metric')}
          value=""
          onChange={(event) => {
            if (event.target.value)
              onChange({ ...preferences, cards: [...preferences.cards, event.target.value] });
          }}
        >
          <option value="">+ {t('id.metric')}</option>
          {metrics
            .filter((item) => !preferences.cards.includes(item.id))
            .map((item) => (
              <option key={item.id} value={item.id}>
                {t(`id.${item.id}`)}
              </option>
            ))}
        </select>
        <h2>{t('id.templates')}</h2>
        {preferences.templates.map((item, index) => (
          <div className="id-setting-row" key={index}>
            <span>{item.name}</span>
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...preferences,
                  templates: preferences.templates.filter((_, i) => i !== index),
                })
              }
            >
              {t('id.remove')}
            </button>
          </div>
        ))}
        <p className="id-muted">{t('id.savedLocal')}</p>
        <div className="id-actions">
          <button
            type="button"
            onClick={() =>
              download(
                new Blob([JSON.stringify(preferences, null, 2)], { type: 'application/json' }),
                'bulka-iiko-dashboard.json',
              ).catch(() => setError(true))
            }
          >
            {t('id.exportSettings')}
          </button>
          <label className="id-file-button">
            {t('id.import')}
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setError(false);
                if (file.size > 200000) {
                  setError(true);
                  return;
                }
                void file
                  .text()
                  .then((text) => onChange(parsePreferences(text)))
                  .catch(() => setError(true));
                event.target.value = '';
              }}
            />
          </label>
        </div>
        {error && (
          <p className="id-error" role="alert">
            {t('id.invalidImport')}
          </p>
        )}
      </section>
      <section className="card id-panel">
        <h2>{t('id.source')}</h2>
        <p className="id-muted">{t('id.noDoubleCount')}</p>
        {servers.map((server) => (
          <div className="id-server-row" key={server.id}>
            <strong>{server.host}</strong>
            <span>
              {server.kind === 'chain' ? t('id.chain') : t('id.rms')} ·{' '}
              {server.city === 'aktau' ? 'Актау' : 'Астана'}
            </span>
            <small>
              {t(!server.active ? 'id.closed' : server.configured ? 'id.configured' : 'id.missing')}
            </small>
          </div>
        ))}
      </section>
    </div>
  );
}
