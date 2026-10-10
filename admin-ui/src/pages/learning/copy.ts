import { useI18n } from '../../lib/i18n';
export function useLearningCopy() {
  const { locale, formatDate, formatNumber } = useI18n();
  return {
    text: (ru: string, kk: string) => (locale === 'kk' ? kk : ru),
    number: formatNumber,
    date: (value: string | number) =>
      formatDate(
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? value + 'T12:00:00Z'
          : value,
        { dateStyle: 'medium', timeZone: 'Asia/Almaty' },
      ),
    datetime: (value: string | number) =>
      formatDate(value, { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Almaty' }),
  };
}
