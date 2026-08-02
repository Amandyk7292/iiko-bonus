import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Locale = 'ru' | 'kk' | 'en';

const localeTags: Record<Locale, string> = {
  ru: 'ru-KZ',
  kk: 'kk-KZ',
  en: 'en-KZ',
};

import ru from './i18n/messages/ru';
import kk from './i18n/messages/kk';
import en from './i18n/messages/en';

const messages: Record<Locale, Record<string, string>> = { ru, kk, en };

type TranslationVars = Record<string, string | number>;

function interpolate(template: string, vars?: TranslationVars) {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key] ?? ''));
}

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: TranslationVars) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function initialLocale(): Locale {
  const stored = localStorage.getItem('adminLocale');
  if (stored === 'ru' || stored === 'kk' || stored === 'en') return stored;
  return 'ru';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);

  useEffect(() => {
    localStorage.setItem('adminLocale', locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key, vars) =>
        interpolate(
          messages[locale][key] ??
            messages.ru[key] ??
            messages[locale]['common.unknown'] ??
            messages.ru['common.unknown'],
          vars,
        ),
      formatNumber: (number, options) =>
        new Intl.NumberFormat(localeTags[locale], options).format(Number(number) || 0),
      formatDate: (date, options) => {
        const parsed = date instanceof Date ? date : new Date(date);
        if (Number.isNaN(parsed.getTime())) return '—';
        return new Intl.DateTimeFormat(
          localeTags[locale],
          options ?? { dateStyle: 'medium', timeStyle: 'short' },
        ).format(parsed);
      },
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}

export function contentLanguage(locale: Locale): 'ru' | 'kz' | 'en' {
  return locale === 'kk' ? 'kz' : locale;
}
