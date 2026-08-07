import type { CSSProperties } from 'react';
import { Camera, ExternalLink, Globe2, MapPin, MessageCircle, Phone, Send } from 'lucide-react';
import type { TaplinkDocument, TaplinkIcon, TaplinkLocale } from '../../lib/api-types';
import { useI18n } from '../../lib/i18n';
import { taplinkTargetHref } from './taplink.helpers';

const previewIcon = (icon: TaplinkIcon) => {
  if (icon === 'phone') return <Phone aria-hidden="true" size={19} />;
  if (icon === 'whatsapp') return <MessageCircle aria-hidden="true" size={19} />;
  if (icon === 'instagram') return <Camera aria-hidden="true" size={19} />;
  if (icon === 'telegram') return <Send aria-hidden="true" size={19} />;
  if (icon === 'globe') return <Globe2 aria-hidden="true" size={19} />;
  if (icon === 'location') return <MapPin aria-hidden="true" size={19} />;
  if (icon === '2gis')
    return <img src="/taplink/assets/2gis-icon.png?v=20260806-1" width="22" height="22" alt="" />;
  return null;
};

export default function TaplinkPhonePreview({
  document,
  activeLocale,
  onLocaleChange,
}: {
  document: TaplinkDocument;
  activeLocale: TaplinkLocale;
  onLocaleChange: (locale: TaplinkLocale) => void;
}) {
  const { t } = useI18n();
  const style = {
    '--taplink-preview-radius': `${document.theme.radius}px`,
    ...(document.theme.backgroundImageUrl
      ? { backgroundImage: `url("${document.theme.backgroundImageUrl}")` }
      : {}),
  } as CSSProperties;

  return (
    <section className="card taplink-preview-panel" aria-labelledby="taplink-preview-title">
      <div className="taplink-panel-heading">
        <div>
          <h2 id="taplink-preview-title">{t('taplink.preview')}</h2>
          <p>{t('taplink.previewHint')}</p>
        </div>
      </div>

      <div className="taplink-phone-frame">
        <div className="taplink-phone-speaker" aria-hidden="true" />
        <div
          className={`taplink-phone-screen taplink-buttons-${document.theme.buttonStyle}`}
          style={style}
          data-testid="taplink-live-preview"
        >
          <header className="taplink-preview-profile">
            {document.profile.logoUrl ? (
              <img className="taplink-preview-logo" src={document.profile.logoUrl} alt="Bulka" />
            ) : (
              <strong className="taplink-preview-wordmark">Bulka</strong>
            )}
            {document.enabledLocales.length > 1 && (
              <div className="taplink-preview-languages" aria-label={t('taplink.contentLanguage')}>
                {document.enabledLocales.map((locale) => (
                  <button
                    key={locale}
                    type="button"
                    className={locale === activeLocale ? 'is-active' : ''}
                    onClick={() => onLocaleChange(locale)}
                    aria-pressed={locale === activeLocale}
                  >
                    {locale === 'kk' ? 'ҚАЗ' : 'РУС'}
                  </button>
                ))}
              </div>
            )}
            <h3>{document.profile.title[activeLocale]}</h3>
            <p>{document.profile.description[activeLocale]}</p>
          </header>

          <div className="taplink-preview-blocks">
            {document.blocks
              .filter((block) => block.enabled)
              .map((block) =>
                block.type === 'section' ? (
                  <p key={block.id} className="taplink-preview-section">
                    {block.labels[activeLocale]}
                  </p>
                ) : (
                  <a
                    key={block.id}
                    className={`taplink-preview-link is-${block.style}`}
                    href={taplinkTargetHref(block.target)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={block.ariaLabels?.[activeLocale] || block.labels[activeLocale]}
                    onClick={(event) => event.preventDefault()}
                  >
                    {block.icon !== 'none' && (
                      <span className="taplink-preview-link-icon">{previewIcon(block.icon)}</span>
                    )}
                    <span className="taplink-preview-link-copy">
                      <strong>{block.labels[activeLocale]}</strong>
                      {block.subtitles?.[activeLocale] && (
                        <small>{block.subtitles[activeLocale]}</small>
                      )}
                    </span>
                    <ExternalLink
                      className="taplink-preview-link-arrow"
                      aria-hidden="true"
                      size={16}
                    />
                  </a>
                ),
              )}
          </div>

          <footer className="taplink-preview-footer">
            <span aria-hidden="true" />
            <p>{document.profile.footer[activeLocale]}</p>
            <span aria-hidden="true" />
          </footer>
        </div>
      </div>
    </section>
  );
}
