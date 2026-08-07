import type {
  TaplinkBlock,
  TaplinkDocument,
  TaplinkIcon,
  TaplinkLinkBlock,
  TaplinkLocale,
  TaplinkTarget,
} from '../../lib/api-types';
import { useI18n } from '../../lib/i18n';
import { TAPLINK_LOCALES } from './taplink.helpers';
import TaplinkThemeEditor from './TaplinkThemeEditor';
import type { TaplinkBuilderActions, TaplinkSelection } from './taplink.types';

const iconOptions: Array<{ value: TaplinkIcon; label: string }> = [
  { value: 'none', label: '—' },
  { value: 'phone', label: 'Телефон' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: '2gis', label: '2GIS' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'globe', label: 'Web' },
  { value: 'location', label: 'Локация' },
];

const targetDefaults: Record<TaplinkTarget['type'], string> = {
  whatsapp: '77012772233',
  phone: '+7 701 277 22 33',
  email: 'bulka.kazakhstan@mail.ru',
  url: 'https://bulka.com.kz',
};

function updateBlock(
  document: TaplinkDocument,
  id: string,
  updater: (block: TaplinkBlock) => TaplinkBlock,
) {
  return {
    ...document,
    blocks: document.blocks.map((block) => (block.id === id ? updater(block) : block)),
  };
}

export default function TaplinkBlockEditor({
  document,
  activeLocale,
  selected,
  busy,
  actions,
}: {
  document: TaplinkDocument;
  activeLocale: TaplinkLocale;
  selected: TaplinkSelection;
  busy: boolean;
  actions: TaplinkBuilderActions;
}) {
  const { t } = useI18n();
  const selectedBlock =
    selected === 'page' ? null : (document.blocks.find((block) => block.id === selected) ?? null);

  const updateSelected = (updater: (block: TaplinkBlock) => TaplinkBlock) => {
    if (!selectedBlock) return;
    actions.updateDocument((current) => updateBlock(current, selectedBlock.id, updater));
  };

  return (
    <section className="card taplink-editor-panel" aria-labelledby="taplink-editor-title">
      <div className="taplink-panel-heading">
        <div>
          <h2 id="taplink-editor-title">
            {selectedBlock
              ? t(selectedBlock.type === 'section' ? 'taplink.section' : 'taplink.link')
              : t('taplink.pageSettings')}
          </h2>
          <p>{selectedBlock ? t('taplink.previewHint') : t('taplink.pageSettingsHint')}</p>
        </div>
      </div>

      <fieldset className="taplink-editor-fieldset" disabled={busy}>
        {!selectedBlock ? (
          <div className="form-stack">
            <div className="form-grid form-grid-2">
              <div className="field-group">
                <label className="field-label" htmlFor="taplink-profile-title">
                  {t('taplink.profileTitle')} · {t(`language.${activeLocale}`)}
                </label>
                <input
                  id="taplink-profile-title"
                  className="input-classic"
                  maxLength={120}
                  value={document.profile.title[activeLocale]}
                  onChange={(event) =>
                    actions.updateDocument((current) => ({
                      ...current,
                      profile: {
                        ...current.profile,
                        title: {
                          ...current.profile.title,
                          [activeLocale]: event.target.value,
                        },
                      },
                    }))
                  }
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="taplink-footer">
                  {t('taplink.footer')} · {t(`language.${activeLocale}`)}
                </label>
                <input
                  id="taplink-footer"
                  className="input-classic"
                  maxLength={120}
                  value={document.profile.footer[activeLocale]}
                  onChange={(event) =>
                    actions.updateDocument((current) => ({
                      ...current,
                      profile: {
                        ...current.profile,
                        footer: {
                          ...current.profile.footer,
                          [activeLocale]: event.target.value,
                        },
                      },
                    }))
                  }
                />
              </div>
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="taplink-profile-description">
                {t('taplink.profileDescription')} · {t(`language.${activeLocale}`)}
              </label>
              <textarea
                id="taplink-profile-description"
                className="input-classic"
                rows={3}
                maxLength={300}
                value={document.profile.description[activeLocale]}
                onChange={(event) =>
                  actions.updateDocument((current) => ({
                    ...current,
                    profile: {
                      ...current.profile,
                      description: {
                        ...current.profile.description,
                        [activeLocale]: event.target.value,
                      },
                    },
                  }))
                }
              />
            </div>

            <fieldset className="form-section">
              <legend>SEO</legend>
              <div className="form-stack">
                <div className="field-group">
                  <label className="field-label" htmlFor="taplink-seo-title">
                    {t('taplink.seoTitle')} · {t(`language.${activeLocale}`)}
                  </label>
                  <input
                    id="taplink-seo-title"
                    className="input-classic"
                    maxLength={160}
                    value={document.seo.title[activeLocale]}
                    onChange={(event) =>
                      actions.updateDocument((current) => ({
                        ...current,
                        seo: {
                          ...current.seo,
                          title: {
                            ...current.seo.title,
                            [activeLocale]: event.target.value,
                          },
                        },
                      }))
                    }
                  />
                </div>
                <div className="field-group">
                  <label className="field-label" htmlFor="taplink-seo-description">
                    {t('taplink.seoDescription')} · {t(`language.${activeLocale}`)}
                  </label>
                  <textarea
                    id="taplink-seo-description"
                    className="input-classic"
                    rows={3}
                    maxLength={300}
                    value={document.seo.description[activeLocale]}
                    onChange={(event) =>
                      actions.updateDocument((current) => ({
                        ...current,
                        seo: {
                          ...current.seo,
                          description: {
                            ...current.seo.description,
                            [activeLocale]: event.target.value,
                          },
                        },
                      }))
                    }
                  />
                </div>
              </div>
            </fieldset>

            <fieldset className="form-section">
              <legend>{t('taplink.enabledLanguages')}</legend>
              <div className="taplink-language-options">
                {TAPLINK_LOCALES.map((locale) => {
                  const checked = document.enabledLocales.includes(locale);
                  return (
                    <label key={locale} className="taplink-check-row">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={checked && document.enabledLocales.length === 1}
                        onChange={(event) =>
                          actions.updateDocument((current) => {
                            const enabledLocales = event.target.checked
                              ? [...new Set([...current.enabledLocales, locale])]
                              : current.enabledLocales.filter((item) => item !== locale);
                            return {
                              ...current,
                              enabledLocales,
                              defaultLocale: enabledLocales.includes(current.defaultLocale)
                                ? current.defaultLocale
                                : enabledLocales[0],
                            };
                          })
                        }
                      />
                      <span>{t(`language.${locale}`)}</span>
                    </label>
                  );
                })}
              </div>
              <div className="field-group taplink-default-language">
                <label className="field-label" htmlFor="taplink-default-language">
                  {t('taplink.defaultLanguage')}
                </label>
                <select
                  id="taplink-default-language"
                  className="input-classic"
                  value={document.defaultLocale}
                  onChange={(event) =>
                    actions.updateDocument((current) => ({
                      ...current,
                      defaultLocale: event.target.value as TaplinkLocale,
                    }))
                  }
                >
                  {document.enabledLocales.map((locale) => (
                    <option key={locale} value={locale}>
                      {t(`language.${locale}`)}
                    </option>
                  ))}
                </select>
              </div>
            </fieldset>

            <TaplinkThemeEditor document={document} actions={actions} />
          </div>
        ) : (
          <div className="form-stack">
            <label className="switch-row">
              <input
                type="checkbox"
                checked={selectedBlock.enabled}
                onChange={(event) =>
                  updateSelected((block) => ({ ...block, enabled: event.target.checked }))
                }
              />
              <span className="switch-control" aria-hidden="true" />
              <span>{t('taplink.visible')}</span>
            </label>

            <div className="field-group">
              <label className="field-label" htmlFor="taplink-block-label">
                {t('taplink.blockLabel')} · {t(`language.${activeLocale}`)}
              </label>
              <input
                id="taplink-block-label"
                className="input-classic"
                maxLength={120}
                value={selectedBlock.labels[activeLocale]}
                onChange={(event) =>
                  updateSelected((block) => ({
                    ...block,
                    labels: { ...block.labels, [activeLocale]: event.target.value },
                  }))
                }
              />
            </div>

            {selectedBlock.type === 'link' && (
              <LinkFields
                block={selectedBlock}
                activeLocale={activeLocale}
                update={(updater) =>
                  updateSelected((block) => (block.type === 'link' ? updater(block) : block))
                }
              />
            )}
          </div>
        )}
      </fieldset>
    </section>
  );
}

function LinkFields({
  block,
  activeLocale,
  update,
}: {
  block: TaplinkLinkBlock;
  activeLocale: TaplinkLocale;
  update: (updater: (block: TaplinkLinkBlock) => TaplinkLinkBlock) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="field-group">
        <label className="field-label" htmlFor="taplink-block-subtitle">
          {t('taplink.blockSubtitle')} · {t(`language.${activeLocale}`)}
        </label>
        <input
          id="taplink-block-subtitle"
          className="input-classic"
          maxLength={160}
          value={block.subtitles?.[activeLocale] ?? ''}
          onChange={(event) =>
            update((current) => ({
              ...current,
              subtitles: {
                kk: current.subtitles?.kk ?? '',
                ru: current.subtitles?.ru ?? '',
                [activeLocale]: event.target.value,
              },
            }))
          }
        />
      </div>

      <div className="field-group">
        <label className="field-label" htmlFor="taplink-block-aria">
          {t('taplink.ariaLabel')} · {t(`language.${activeLocale}`)}
        </label>
        <input
          id="taplink-block-aria"
          className="input-classic"
          maxLength={200}
          value={block.ariaLabels?.[activeLocale] ?? ''}
          onChange={(event) =>
            update((current) => ({
              ...current,
              ariaLabels: {
                kk: current.ariaLabels?.kk ?? '',
                ru: current.ariaLabels?.ru ?? '',
                [activeLocale]: event.target.value,
              },
            }))
          }
        />
      </div>

      <div className="form-grid form-grid-2">
        <div className="field-group">
          <label className="field-label" htmlFor="taplink-link-style">
            {t('taplink.linkStyle')}
          </label>
          <select
            id="taplink-link-style"
            className="input-classic"
            value={block.style}
            onChange={(event) =>
              update((current) => ({
                ...current,
                style: event.target.value as TaplinkLinkBlock['style'],
              }))
            }
          >
            {(['primary', 'standard', 'city'] as const).map((style) => (
              <option key={style} value={style}>
                {t(`taplink.linkStyle.${style}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="taplink-icon">
            {t('taplink.icon')}
          </label>
          <select
            id="taplink-icon"
            className="input-classic"
            value={block.icon}
            onChange={(event) =>
              update((current) => ({
                ...current,
                icon: event.target.value as TaplinkIcon,
              }))
            }
          >
            {iconOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-grid form-grid-2">
        <div className="field-group">
          <label className="field-label" htmlFor="taplink-target-type">
            {t('taplink.targetType')}
          </label>
          <select
            id="taplink-target-type"
            className="input-classic"
            value={block.target.type}
            onChange={(event) => {
              const type = event.target.value as TaplinkTarget['type'];
              update((current) => ({
                ...current,
                target: { type, value: targetDefaults[type] } as TaplinkTarget,
              }));
            }}
          >
            {(['whatsapp', 'phone', 'email', 'url'] as const).map((type) => (
              <option key={type} value={type}>
                {t(`taplink.target.${type}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="taplink-target-value">
            {t('taplink.targetValue')}
          </label>
          <input
            id="taplink-target-value"
            className="input-classic"
            type={block.target.type === 'email' ? 'email' : 'text'}
            value={block.target.value}
            onChange={(event) =>
              update((current) => ({
                ...current,
                target: { ...current.target, value: event.target.value } as TaplinkTarget,
              }))
            }
          />
        </div>
      </div>
    </>
  );
}
