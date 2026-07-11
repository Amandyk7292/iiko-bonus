import { Languages } from 'lucide-react';
import { useI18n, type Locale } from '../lib/i18n';

export default function LanguageSelect({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className={`language-select ${compact ? 'language-select-compact' : ''}`}>
      <Languages aria-hidden="true" size={18} />
      {!compact && <span>{t('language.label')}</span>}
      <select value={locale} onChange={event => setLocale(event.target.value as Locale)} aria-label={t('language.label')}>
        <option value="ru">{t('language.ru')}</option>
        <option value="kk">{t('language.kk')}</option>
        <option value="en">{t('language.en')}</option>
      </select>
    </label>
  );
}
