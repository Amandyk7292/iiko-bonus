import { useCallback, useEffect, useState } from 'react';
import type { useSearchParams } from '../../lib/router';

type SetSearchParams = ReturnType<typeof useSearchParams>[1];

export function useWhatsAppConversationQuery({
  queryParams,
  setQueryParams,
  selectedId,
}: {
  queryParams: URLSearchParams;
  setQueryParams: SetSearchParams;
  selectedId: string;
}) {
  const [search, setSearch] = useState(queryParams.get('search') || '');
  const [searchQuery, setSearchQuery] = useState(queryParams.get('search') || '');
  const [statusFilter, setStatusFilter] = useState(queryParams.get('status') || '');
  const [conversationPage, setConversationPage] = useState(
    Math.max(1, Number(queryParams.get('page')) || 1),
  );
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const replyText = selectedId ? replyDrafts[selectedId] || '' : '';

  const updateReplyDraft = useCallback((conversationId: string, text: string) => {
    if (!conversationId) return;
    setReplyDrafts((current) => ({ ...current, [conversationId]: text }));
  }, []);

  const clearReplyDraft = useCallback((conversationId: string) => {
    setReplyDrafts((current) => {
      if (!(conversationId in current)) return current;
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
  }, []);

  const updateConversationQuery = useCallback(
    (updates: Record<string, string | number | null>) => {
      const next = new URLSearchParams(queryParams);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, String(value));
      }
      if (next.toString() === queryParams.toString()) return;
      setQueryParams(next, { replace: true });
    },
    [queryParams, setQueryParams],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = search.trim();
      setSearchQuery(next);
      setConversationPage(1);
      const updated = new URLSearchParams(window.location.search);
      if (next) updated.set('search', next);
      else updated.delete('search');
      updated.delete('page');
      setQueryParams(updated, { replace: true });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search, setQueryParams]);

  return {
    search,
    setSearch,
    searchQuery,
    statusFilter,
    setStatusFilter,
    conversationPage,
    setConversationPage,
    replyDrafts,
    replyText,
    updateReplyDraft,
    clearReplyDraft,
    updateConversationQuery,
  };
}
