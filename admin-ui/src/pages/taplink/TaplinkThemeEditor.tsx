import { useEffect, useId, useState } from 'react';
import {
  AlertTriangle,
  Blend,
  CheckCircle2,
  Image as ImageIcon,
  Palette,
  RotateCcw,
  Square,
} from 'lucide-react';
import type {
  TaplinkBackgroundMode,
  TaplinkDocument,
  TaplinkGradientDirection,
} from '../../lib/api-types';
import { useI18n } from '../../lib/i18n';
import type { TaplinkBuilderActions } from './taplink.types';

const HEX_COLOR = /^#[0-9A-F]{6}$/i;
const SAFE_LOCAL_ASSET = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]+$/u;
const BULKA_BACKGROUND_URL = '/taplink/assets/mobile-background.png?v=20260806-1';

const BACKGROUND_MODES: Array<{
  value: TaplinkBackgroundMode;
  icon: typeof Palette;
}> = [
  { value: 'brand', icon: Palette },
  { value: 'solid', icon: Square },
  { value: 'gradient', icon: Blend },
  { value: 'image', icon: ImageIcon },
];

const GRADIENT_DIRECTIONS: TaplinkGradientDirection[] = [
  'top',
  'top-right',
  'right',
  'bottom-right',
  'bottom',
  'bottom-left',
  'left',
  'top-left',
];

const BULKA_THEME_DEFAULTS: Pick<
  TaplinkDocument['theme'],
  | 'backgroundImageUrl'
  | 'backgroundMode'
  | 'backgroundColor'
  | 'gradientFrom'
  | 'gradientTo'
  | 'gradientDirection'
  | 'backgroundOverlayColor'
  | 'backgroundOverlayOpacity'
  | 'textColor'
  | 'mutedTextColor'
  | 'surfaceColor'
  | 'buttonBackgroundColor'
  | 'buttonTextColor'
  | 'primaryButtonBackgroundColor'
  | 'primaryButtonTextColor'
  | 'buttonStyle'
  | 'animation'
  | 'buttonEffect'
  | 'radius'
> = {
  backgroundImageUrl: BULKA_BACKGROUND_URL,
  backgroundMode: 'brand',
  backgroundColor: '#FFB814',
  gradientFrom: '#FFD56A',
  gradientTo: '#F4A916',
  gradientDirection: 'bottom-right',
  backgroundOverlayColor: '#532814',
  backgroundOverlayOpacity: 0,
  textColor: '#532814',
  mutedTextColor: '#78665D',
  surfaceColor: '#FFFFFF',
  buttonBackgroundColor: '#FFFFFF',
  buttonTextColor: '#532814',
  primaryButtonBackgroundColor: '#FFB814',
  primaryButtonTextColor: '#3F1D0E',
  buttonStyle: 'soft',
  animation: 'stagger',
  buttonEffect: 'shine',
  radius: 22,
};

const normalizeHex = (value: string) => value.trim().toUpperCase();

const isSafeAssetUrl = (value: string) => {
  const text = value.trim();
  if (
    !text ||
    text.length > 2_000 ||
    [...text].some((item) => {
      const code = item.codePointAt(0)!;
      return code < 32 || code === 127;
    })
  ) {
    return false;
  }
  if (SAFE_LOCAL_ASSET.test(text)) return true;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
};

const relativeLuminance = (color: string) => {
  const rgb = [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16) / 255);
  const linear = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

const contrastRatio = (first: string, second: string) => {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
};

export function ThemeColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  const normalized = normalizeHex(draft);
  const valid = HEX_COLOR.test(normalized);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const updateDraft = (nextValue: string) => {
    setDraft(nextValue);
    const nextNormalized = normalizeHex(nextValue);
    if (HEX_COLOR.test(nextNormalized)) onChange(nextNormalized);
  };

  return (
    <div className="field-group taplink-color-field">
      <label className="field-label" htmlFor={`${id}-hex`}>
        {label}
      </label>
      <div className="taplink-color-control">
        <input
          id={`${id}-picker`}
          className="taplink-color-picker"
          type="color"
          value={value}
          onChange={(event) => updateDraft(event.target.value.toUpperCase())}
          aria-label={`${label}: ${t('taplink.colorPicker')}`}
        />
        <input
          id={`${id}-hex`}
          className="input-classic taplink-color-hex"
          type="text"
          value={draft}
          maxLength={7}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!valid}
          aria-describedby={!valid ? `${id}-error` : undefined}
          onChange={(event) => updateDraft(event.target.value)}
          onBlur={() => {
            if (!valid) setDraft(value);
          }}
        />
      </div>
      {!valid && (
        <p id={`${id}-error`} className="field-error">
          {t('taplink.colorInvalid')}
        </p>
      )}
    </div>
  );
}

export function ContrastStatus({
  label,
  foreground,
  background,
}: {
  label: string;
  foreground: string;
  background: string;
}) {
  const { t } = useI18n();
  const ratio = contrastRatio(foreground, background);
  const passes = ratio >= 4.5;
  return (
    <div className={`taplink-contrast-item ${passes ? 'is-valid' : 'is-warning'}`}>
      {passes ? (
        <CheckCircle2 aria-hidden="true" size={17} />
      ) : (
        <AlertTriangle aria-hidden="true" size={17} />
      )}
      <span>
        <strong>{label}</strong>
        <small>
          {ratio.toFixed(2)}:1 · {t(passes ? 'taplink.contrastPass' : 'taplink.contrastFail')}
        </small>
      </span>
    </div>
  );
}

export default function TaplinkThemeEditor({
  document,
  actions,
}: {
  document: TaplinkDocument;
  actions: TaplinkBuilderActions;
}) {
  const { t } = useI18n();
  const modeHeadingId = useId();
  const [imageUrlDraft, setImageUrlDraft] = useState(document.theme.backgroundImageUrl ?? '');
  const normalizedImageUrl = imageUrlDraft.trim();
  const imageUrlValid = !normalizedImageUrl || isSafeAssetUrl(normalizedImageUrl);

  useEffect(() => {
    setImageUrlDraft(document.theme.backgroundImageUrl ?? '');
  }, [document.theme.backgroundImageUrl]);

  const updateTheme = (patch: Partial<TaplinkDocument['theme']>) =>
    actions.updateDocument((current) => ({
      ...current,
      theme: { ...current.theme, ...patch },
    }));

  return (
    <fieldset className="form-section taplink-theme-editor" data-testid="taplink-theme-editor">
      <legend>{t('taplink.design')}</legend>
      <div className="form-stack">
        <section className="taplink-theme-section" aria-labelledby={modeHeadingId}>
          <div className="taplink-theme-section-heading">
            <div>
              <h3 id={modeHeadingId}>{t('taplink.background')}</h3>
              <p>{t('taplink.backgroundHint')}</p>
            </div>
          </div>

          <div
            className="taplink-background-modes"
            role="radiogroup"
            aria-labelledby={modeHeadingId}
            data-testid="taplink-background-mode"
          >
            {BACKGROUND_MODES.map(({ value, icon: Icon }) => (
              <label
                key={value}
                className={
                  document.theme.backgroundMode === value
                    ? 'taplink-background-mode is-selected'
                    : 'taplink-background-mode'
                }
              >
                <input
                  type="radio"
                  name="taplink-background-mode"
                  value={value}
                  checked={document.theme.backgroundMode === value}
                  onChange={() => updateTheme({ backgroundMode: value })}
                />
                <Icon aria-hidden="true" size={19} />
                <span>{t(`taplink.backgroundMode.${value}`)}</span>
              </label>
            ))}
          </div>

          {document.theme.backgroundMode === 'solid' && (
            <ThemeColorField
              id="taplink-background-color"
              label={t('taplink.backgroundColor')}
              value={document.theme.backgroundColor}
              onChange={(backgroundColor) => updateTheme({ backgroundColor })}
            />
          )}

          {document.theme.backgroundMode === 'gradient' && (
            <div className="form-stack">
              <div className="form-grid form-grid-2">
                <ThemeColorField
                  id="taplink-gradient-from"
                  label={t('taplink.gradientFrom')}
                  value={document.theme.gradientFrom}
                  onChange={(gradientFrom) => updateTheme({ gradientFrom })}
                />
                <ThemeColorField
                  id="taplink-gradient-to"
                  label={t('taplink.gradientTo')}
                  value={document.theme.gradientTo}
                  onChange={(gradientTo) => updateTheme({ gradientTo })}
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="taplink-gradient-direction">
                  {t('taplink.gradientDirection')}
                </label>
                <select
                  id="taplink-gradient-direction"
                  className="input-classic"
                  value={document.theme.gradientDirection}
                  onChange={(event) =>
                    updateTheme({
                      gradientDirection: event.target.value as TaplinkGradientDirection,
                    })
                  }
                >
                  {GRADIENT_DIRECTIONS.map((direction) => (
                    <option key={direction} value={direction}>
                      {t(`taplink.gradientDirection.${direction}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {document.theme.backgroundMode === 'image' && (
            <div className="field-group">
              <label className="field-label" htmlFor="taplink-background-image-url">
                {t('taplink.backgroundImageUrl')}
              </label>
              <input
                id="taplink-background-image-url"
                className="input-classic"
                type="url"
                value={imageUrlDraft}
                maxLength={2_000}
                placeholder="https://…"
                aria-invalid={!imageUrlValid}
                aria-describedby="taplink-background-image-hint"
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setImageUrlDraft(nextValue);
                  const trimmed = nextValue.trim();
                  if (!trimmed || isSafeAssetUrl(trimmed)) {
                    updateTheme({ backgroundImageUrl: trimmed || undefined });
                  }
                }}
                onBlur={() => {
                  if (!imageUrlValid) setImageUrlDraft(document.theme.backgroundImageUrl ?? '');
                }}
              />
              <p
                id="taplink-background-image-hint"
                className={imageUrlValid ? 'field-hint' : 'field-error'}
              >
                {t(
                  imageUrlValid ? 'taplink.backgroundImageHint' : 'taplink.backgroundImageInvalid',
                )}
              </p>
            </div>
          )}

          <div className="form-grid form-grid-2 taplink-overlay-controls">
            <ThemeColorField
              id="taplink-background-overlay-color"
              label={t('taplink.overlayColor')}
              value={document.theme.backgroundOverlayColor}
              onChange={(backgroundOverlayColor) => updateTheme({ backgroundOverlayColor })}
            />
            <div className="field-group">
              <label className="field-label" htmlFor="taplink-overlay-opacity">
                {t('taplink.overlayOpacity')}: {document.theme.backgroundOverlayOpacity}%
              </label>
              <input
                id="taplink-overlay-opacity"
                type="range"
                min="0"
                max="70"
                step="1"
                value={document.theme.backgroundOverlayOpacity}
                onChange={(event) =>
                  updateTheme({ backgroundOverlayOpacity: event.target.valueAsNumber })
                }
              />
            </div>
          </div>
        </section>

        <section className="taplink-theme-section" aria-labelledby="taplink-theme-colors-title">
          <div className="taplink-theme-section-heading">
            <div>
              <h3 id="taplink-theme-colors-title">{t('taplink.pageColors')}</h3>
              <p>{t('taplink.pageColorsHint')}</p>
            </div>
          </div>
          <div className="form-grid form-grid-2">
            <ThemeColorField
              id="taplink-text-color"
              label={t('taplink.textColor')}
              value={document.theme.textColor}
              onChange={(textColor) => updateTheme({ textColor })}
            />
            <ThemeColorField
              id="taplink-muted-text-color"
              label={t('taplink.mutedTextColor')}
              value={document.theme.mutedTextColor}
              onChange={(mutedTextColor) => updateTheme({ mutedTextColor })}
            />
            <ThemeColorField
              id="taplink-surface-color"
              label={t('taplink.surfaceColor')}
              value={document.theme.surfaceColor}
              onChange={(surfaceColor) => updateTheme({ surfaceColor })}
            />
          </div>
        </section>

        <section className="taplink-theme-section" aria-labelledby="taplink-theme-buttons-title">
          <div className="taplink-theme-section-heading">
            <div>
              <h3 id="taplink-theme-buttons-title">{t('taplink.buttons')}</h3>
              <p>{t('taplink.buttonsHint')}</p>
            </div>
          </div>
          <div className="form-grid form-grid-2">
            <div className="field-group">
              <label className="field-label" htmlFor="taplink-button-style">
                {t('taplink.buttonStyle')}
              </label>
              <select
                id="taplink-button-style"
                className="input-classic"
                value={document.theme.buttonStyle}
                onChange={(event) =>
                  updateTheme({
                    buttonStyle: event.target.value as TaplinkDocument['theme']['buttonStyle'],
                  })
                }
              >
                {(['soft', 'outlined', 'solid'] as const).map((style) => (
                  <option key={style} value={style}>
                    {t(`taplink.buttonStyle.${style}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="taplink-radius">
                {t('taplink.radius')}: {document.theme.radius}px
              </label>
              <input
                id="taplink-radius"
                type="range"
                min="12"
                max="32"
                step="1"
                value={document.theme.radius}
                onChange={(event) => updateTheme({ radius: event.target.valueAsNumber })}
              />
            </div>
            <ThemeColorField
              id="taplink-button-background-color"
              label={t('taplink.buttonBackgroundColor')}
              value={document.theme.buttonBackgroundColor}
              onChange={(buttonBackgroundColor) => updateTheme({ buttonBackgroundColor })}
            />
            <ThemeColorField
              id="taplink-button-text-color"
              label={t('taplink.buttonTextColor')}
              value={document.theme.buttonTextColor}
              onChange={(buttonTextColor) => updateTheme({ buttonTextColor })}
            />
            <ThemeColorField
              id="taplink-primary-button-background-color"
              label={t('taplink.primaryButtonBackgroundColor')}
              value={document.theme.primaryButtonBackgroundColor}
              onChange={(primaryButtonBackgroundColor) =>
                updateTheme({ primaryButtonBackgroundColor })
              }
            />
            <ThemeColorField
              id="taplink-primary-button-text-color"
              label={t('taplink.primaryButtonTextColor')}
              value={document.theme.primaryButtonTextColor}
              onChange={(primaryButtonTextColor) => updateTheme({ primaryButtonTextColor })}
            />
          </div>
        </section>

        <section className="taplink-theme-section" aria-labelledby="taplink-theme-motion-title">
          <div className="taplink-theme-section-heading">
            <div>
              <h3 id="taplink-theme-motion-title">{t('taplink.motion')}</h3>
              <p>{t('taplink.motionHint')}</p>
            </div>
          </div>
          <div className="form-grid form-grid-2">
            <div className="field-group">
              <label className="field-label" htmlFor="taplink-animation">
                {t('taplink.animation')}
              </label>
              <select
                id="taplink-animation"
                className="input-classic"
                value={document.theme.animation}
                onChange={(event) =>
                  updateTheme({
                    animation: event.target.value as TaplinkDocument['theme']['animation'],
                  })
                }
              >
                {(['none', 'fade', 'rise', 'stagger'] as const).map((animation) => (
                  <option key={animation} value={animation}>
                    {t(`taplink.animation.${animation}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="taplink-button-effect">
                {t('taplink.buttonEffect')}
              </label>
              <select
                id="taplink-button-effect"
                className="input-classic"
                value={document.theme.buttonEffect}
                onChange={(event) =>
                  updateTheme({
                    buttonEffect: event.target.value as TaplinkDocument['theme']['buttonEffect'],
                  })
                }
              >
                {(['none', 'lift', 'glow', 'shine'] as const).map((effect) => (
                  <option key={effect} value={effect}>
                    {t(`taplink.buttonEffect.${effect}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section
          className="taplink-contrast-status"
          aria-labelledby="taplink-contrast-title"
          aria-live="polite"
          data-testid="taplink-contrast-status"
        >
          <div className="taplink-theme-section-heading">
            <div>
              <h3 id="taplink-contrast-title">{t('taplink.contrast')}</h3>
              <p>{t('taplink.contrastHint')}</p>
            </div>
          </div>
          <div className="taplink-contrast-grid">
            <ContrastStatus
              label={t('taplink.contrastSurface')}
              foreground={document.theme.textColor}
              background={document.theme.surfaceColor}
            />
            <ContrastStatus
              label={t('taplink.contrastMuted')}
              foreground={document.theme.mutedTextColor}
              background={document.theme.surfaceColor}
            />
            <ContrastStatus
              label={t('taplink.contrastButton')}
              foreground={document.theme.buttonTextColor}
              background={document.theme.buttonBackgroundColor}
            />
            <ContrastStatus
              label={t('taplink.contrastPrimary')}
              foreground={document.theme.primaryButtonTextColor}
              background={document.theme.primaryButtonBackgroundColor}
            />
          </div>
        </section>

        <button
          type="button"
          className="btn-outline taplink-theme-reset"
          onClick={() => updateTheme(BULKA_THEME_DEFAULTS)}
        >
          <RotateCcw aria-hidden="true" size={17} />
          {t('taplink.resetTheme')}
        </button>
      </div>
    </fieldset>
  );
}
