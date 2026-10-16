import type { RoundStatus } from './types';
export const todayKz = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Almaty',
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('-');
};
export const shiftDay = (day: string, amount: number) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};
export const calendarDays = (from: string, to: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return [];
  const count =
    Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000) + 1;
  return Number.isFinite(count) && count > 0 && count <= 30
    ? Array.from({ length: count }, (_, index) => shiftDay(from, index))
    : [];
};
export const dayLabel = (day: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Almaty',
  }).format(new Date(`${day}T12:00:00Z`));
export const timeLabel = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Almaty',
      }).format(new Date(value))
    : '—';
export const statusLabels: Record<RoundStatus, string> = {
  pending: 'Назначен',
  in_progress: 'В работе',
  overdue: 'Просрочен',
  completed: 'Выполнен',
  cancelled: 'Отменён',
};
export const evidenceLabels = {
  none: 'Без вложений',
  photo: 'Фото',
  video: 'Видео',
  photo_video: 'Фото и видео',
};
export const safeMediaUrl = (value: string) => {
  // Reports are private and must use the authenticated same-origin media route.
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin &&
      /^\/admin\/api\/rounds\/media\/[^/]+$/.test(url.pathname)
      ? url.pathname
      : '';
  } catch {
    return '';
  }
};
