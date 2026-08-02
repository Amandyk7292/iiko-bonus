import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider, useI18n } from './i18n';

const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nProvider>{children}</I18nProvider>
);

describe('admin interface locale', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'ru';
  });

  it('persists locale and translates the interface', () => {
    localStorage.setItem('adminLocale', 'ru');
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.locale).toBe('ru');

    act(() => result.current.setLocale('kk'));

    expect(result.current.locale).toBe('kk');
    expect(result.current.t('common.save')).toBe('Сақтау');
    expect(localStorage.getItem('adminLocale')).toBe('kk');
    expect(document.documentElement.lang).toBe('kk');
  });

  it('uses a localized unknown label for a missing translated key', () => {
    localStorage.setItem('adminLocale', 'en');
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.t('common.save')).toBe('Save');
    expect(result.current.t('missing.key')).toBe('Unknown');
  });
});
