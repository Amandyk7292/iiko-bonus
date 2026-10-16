import { request } from '../../lib/api';
import type {
  CreateRound,
  Credentials,
  Inspector,
  RoundDetail,
  RoundSummary,
  RoundsData,
} from './types';
const call = <T>(path: string, options: RequestInit = {}) =>
  request<T>(`/rounds${path}`, options, { branchScope: '' });
const body = (method: string, data: unknown): RequestInit => ({
  method,
  body: JSON.stringify(data),
});
export const roundsApi = {
  list: (from: string, to: string, city: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ from, to });
    if (city) params.set('city', city);
    return call<RoundsData>(`?${params}`, { signal });
  },
  createInspector: (data: Pick<Inspector, 'name' | 'city' | 'branchIds'>) =>
    call<{ inspector: Inspector; credentials: Credentials }>('/inspectors', body('POST', data)),
  updateInspector: (
    id: string,
    data: Partial<Pick<Inspector, 'name' | 'city' | 'branchIds' | 'active'>>,
  ) => call<{ inspector: Inspector }>(`/inspectors/${encodeURIComponent(id)}`, body('PATCH', data)),
  password: (id: string) =>
    call<{ credentials: Credentials }>(
      `/inspectors/${encodeURIComponent(id)}/password`,
      body('POST', {}),
    ),
  create: (data: CreateRound) => call<{ rounds: RoundSummary[] }>('', body('POST', data)),
  detail: (id: string, signal?: AbortSignal) =>
    call<{ round: RoundDetail }>(`/${encodeURIComponent(id)}`, { signal }),
  cancel: (id: string) =>
    call<{ round: RoundDetail }>(`/${encodeURIComponent(id)}/cancel`, body('POST', {})),
};
