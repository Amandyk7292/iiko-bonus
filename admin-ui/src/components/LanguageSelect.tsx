import { Languages } from 'lucide-react';
import { useI18n, type Locale } from '../lib/i18n';
import SelectControl from './SelectControl';

export default function LanguageSelect({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className={`language-select ${compact ? 'language-select-compact' : ''}`}>
      <Languages aria-hidden="true" size={18} />
      {!compact && <span>{t('language.label')}</span>}
      <SelectControl
        bare
        compact
        value={locale}
        displayValue={compact ? locale.toUpperCase() : undefined}
        ariaLabel={t('language.label')}
        onChange={(value) => setLocale(value as Locale)}
        options={[
          { value: 'ru', label: t('language.ru') },
          { value: 'kk', label: t('language.kk') },
          { value: 'en', label: t('language.en') },
        ]}
      />
    </div>
  );
}
