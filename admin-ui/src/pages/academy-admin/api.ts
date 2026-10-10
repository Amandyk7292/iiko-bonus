import { request } from '../../lib/api';
import type { Dashboard } from './model';

export function learningRequest<T>(path: string, options: RequestInit = {}) {
  return request<T>(`/learning/manage${path}`, options, { branchScope: '' });
}
export const loadDashboard = () => learningRequest<Dashboard>('/dashboard');
export const saveLearning = <T>(path: string, data: unknown, method = 'POST') =>
  learningRequest<T>(path, { method, body: JSON.stringify(data) });
