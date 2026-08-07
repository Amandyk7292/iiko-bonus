import { useState, type CSSProperties } from 'react';
import {
  Camera,
  ExternalLink,
  Globe2,
  MapPin,
  MessageCircle,
  Phone,
  RotateCcw,
  Send,
} from 'lucide-react';
import type {
  TaplinkDocument,
  TaplinkGradientDirection,
  TaplinkIcon,
  TaplinkLocale,
} from '../../lib/api-types';
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

const gradientAngles: Record<TaplinkGradientDirection, string> = {
  top: '0deg',
  'top-right': '45deg',
  right: '90deg',
  'bottom-right': '135deg',
  bottom: '180deg',
  'bottom-left': '225deg',
  left: '270deg',
  'top-left': '315deg',
};

const SAFE_LOCAL_ASSET = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]+$/u;
const BULKA_BACKGROUND_URL = '/taplink/assets/mobile-background.png?v=20260806-1';

const safePreviewAssetUrl = (value?: string) => {
  const text = value?.trim() ?? '';
  if (
    !text ||
    text.length > 2_000 ||
    [...text].some((item) => {
      const code = item.codePointAt(0)!;
      return code < 32 || code === 127;
    })
  ) {
    return '';
  }
  if (SAFE_LOCAL_ASSET.test(text)) return text;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
};

const colorWithOpacity = (color: string, opacity: number) => {
  const alpha = Math.max(0, Math.min(1, opacity / 100));
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
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
  const [animationCycle, setAnimationCycle] = useState(0);
  const backgroundImageUrl = safePreviewAssetUrl(
    document.theme.backgroundImageUrl ||
      (document.theme.backgroundMode === 'brand' ? BULKA_BACKGROUND_URL : ''),
  );
  const style = {
    '--taplink-preview-radius': `${document.theme.radius}px`,
    '--taplink-preview-background-color': document.theme.backgroundColor,
    '--taplink-preview-gradient-from': document.theme.gradientFrom,
    '--taplink-preview-gradient-to': document.theme.gradientTo,
    '--taplink-preview-gradient-direction': gradientAngles[document.theme.gradientDirection],
    '--taplink-preview-background-image': backgroundImageUrl
      ? `url(${JSON.stringify(backgroundImageUrl)})`
      : 'none',
    '--taplink-preview-overlay': colorWithOpacity(
      document.theme.backgroundOverlayColor,
      document.theme.backgroundOverlayOpacity,
    ),
    '--taplink-preview-text': document.theme.textColor,
    '--taplink-preview-muted': document.theme.mutedTextColor,
    '--taplink-preview-surface': document.theme.surfaceColor,
    '--taplink-preview-button-background': document.theme.buttonBackgroundColor,
    '--taplink-preview-button-text': document.theme.buttonTextColor,
    '--taplink-preview-primary-background': document.theme.primaryButtonBackgroundColor,
    '--taplink-preview-primary-text': document.theme.primaryButtonTextColor,
  } as CSSProperties;

  return (
    <section className="card taplink-preview-panel" aria-labelledby="taplink-preview-title">
      <div className="taplink-panel-heading">
        <div>
          <h2 id="taplink-preview-title">{t('taplink.preview')}</h2>
          <p>{t('taplink.previewHint')}</p>
        </div>
        <button
          type="button"
          className="btn-outline taplink-preview-replay"
          onClick={() => setAnimationCycle((current) => current + 1)}
          disabled={document.theme.animation === 'none'}
          data-testid="taplink-replay-animation"
        >
          <RotateCcw aria-hidden="true" size={16} />
          {t('taplink.replayAnimation')}
        </button>
      </div>

      <div className="taplink-phone-frame">
        <div className="taplink-phone-speaker" aria-hidden="true" />
        <div
          key={animationCycle}
          className={[
            'taplink-phone-screen',
            `taplink-background-${document.theme.backgroundMode}`,
            `taplink-buttons-${document.theme.buttonStyle}`,
            `taplink-animation-${document.theme.animation}`,
            `taplink-effect-${document.theme.buttonEffect}`,
          ].join(' ')}
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
