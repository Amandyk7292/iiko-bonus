import { useMemo } from 'react';
import { useI18n } from '../../lib/i18n';

export type Kind = 'hall' | 'baker';
export interface Branch {
  id: string;
  name: string;
  city: string;
  active?: boolean;
}
export interface Photo {
  id: string;
  available: boolean;
  expiresAt: string;
  url: string | null;
}
export interface Report {
  id: string;
  branchId: string;
  date: string;
  kind: Kind;
  photoCount: number;
  submittedAt: string;
  photos?: Photo[];
}
export interface Calendar {
  businessDate: string;
  from: string;
  to: string;
  branches: Branch[];
  reports: Report[];
}
export interface Detail {
  branch: Branch;
  date: string;
  reports: Report[];
}
export interface Selection {
  branch: Branch;
  date: string;
  kind: Kind;
}
export const kinds: Kind[] = ['hall', 'baker'];
// Kazakhstan UTC+5, with a 04:00 local business-day boundary.
export const currentBusinessDate = () => new Date(Date.now() + 3600000).toISOString().slice(0, 10);
export const reportKey = (branch: string, date: string, kind: Kind) => `${branch}/${date}/${kind}`;
export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function datesBetween(from: string, to: string) {
  const dates: string[] = [];
  for (let date = from; date <= to; date = shiftDate(date, 1)) dates.push(date);
  return dates.reverse();
}
export function usePhotoCopy() {
  const { locale } = useI18n();
  return useMemo(() => {
    const text = (ru: string, kk: string) => (locale === 'kk' ? kk : ru);
    const language = locale === 'kk' ? 'kk-KZ' : 'ru-KZ';
    const kindLabel = (kind: Kind) =>
      kind === 'hall' ? text('Зал', 'Зал') : text('Пекарь', 'Наубайшы');
    const dateLabel = (date: string, long = false) =>
      new Intl.DateTimeFormat(language, {
        day: '2-digit',
        month: long ? 'long' : '2-digit',
        ...(long ? { year: 'numeric' as const } : {}),
        timeZone: 'UTC',
      }).format(new Date(`${date}T12:00:00Z`));
    const timeLabel = (date: string, short = false) =>
      new Intl.DateTimeFormat(language, {
        ...(!short ? { day: '2-digit' as const, month: '2-digit' as const } : {}),
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Almaty',
      }).format(new Date(date));
    const reportLabel = (branch: Branch, date: string, kind: Kind, report?: Report) =>
      `${branch.city} · ${branch.name} · ${kindLabel(kind)} · ${dateLabel(date, true)} · ${report ? `${text('Отправлен', 'Жіберілді')} · ${report.photoCount} фото` : text('Не отправлен', 'Жіберілмеді')}`;
    return { text, kindLabel, dateLabel, timeLabel, reportLabel };
  }, [locale]);
}
export type PhotoCopy = ReturnType<typeof usePhotoCopy>;
