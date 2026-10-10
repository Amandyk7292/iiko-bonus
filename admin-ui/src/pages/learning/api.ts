import { request } from '../../lib/api';
import type { Achievement, Answer, Attempt, Cabinet, Catalog, Course, Progress } from './types';

const call = <T>(path: string, options: RequestInit = {}) =>
  request<T>(`/learning${path}`, options, { branchScope: '' });
const post = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
  signal,
});
export const learningApi = {
  me: (signal?: AbortSignal) => call<Cabinet>('/me', { signal }),
  catalog: (signal?: AbortSignal) => call<Catalog>('/catalog', { signal }),
  course: (id: string, signal?: AbortSignal) =>
    call<{ course: Course; progress: Progress }>(`/courses/${encodeURIComponent(id)}`, { signal }),
  complete: (id: string) =>
    call<{ progress: Progress; achievements: Achievement[] }>(
      `/lessons/${encodeURIComponent(id)}/progress`,
      post({ completed: true }),
    ),
  start: (id: string) =>
    call<{ attempt: Attempt }>(`/assessments/${encodeURIComponent(id)}/attempts`, post({})),
  attempt: (id: string, signal?: AbortSignal) =>
    call<{ attempt: Attempt }>(`/attempts/${encodeURIComponent(id)}`, { signal }),
  submit: (id: string, answers: Answer[]) =>
    call<{ attempt: Attempt; progress: Progress; achievements: Achievement[] }>(
      `/attempts/${encodeURIComponent(id)}/submit`,
      post({ answers }),
    ),
};
