import { request } from './api';

export interface FaqInput {
  questionRu: string;
  answerRu: string;
  questionKk: string;
  answerKk: string;
  sortOrder: number;
  isActive: boolean;
}

export interface FaqItem extends FaqInput {
  id: string;
}

type FaqResponse = { success: boolean; item: FaqItem };
const globalScope = { branchScope: '' };

export const faqApi = {
  list: async (signal?: AbortSignal) => {
    const response = await request<{ success: boolean; items: FaqItem[] }>(
      '/faq',
      { signal },
      globalScope,
    );
    return response.items;
  },
  create: async (input: FaqInput) => {
    const response = await request<FaqResponse>(
      '/faq',
      { method: 'POST', body: JSON.stringify(input) },
      globalScope,
    );
    return response.item;
  },
  update: async (id: string, input: FaqInput) => {
    const response = await request<FaqResponse>(
      `/faq/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify(input) },
      globalScope,
    );
    return response.item;
  },
  hide: async (id: string) => {
    const response = await request<FaqResponse>(
      `/faq/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      globalScope,
    );
    return response.item;
  },
};

export function sortFaqItems(items: FaqItem[]) {
  return [...items].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
}
