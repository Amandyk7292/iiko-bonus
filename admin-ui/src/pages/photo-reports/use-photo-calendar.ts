import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../../lib/api';
import { useAdminRealtimeEvents } from '../../lib/admin-realtime';
import type { Calendar } from './model';

export function usePhotoView() {
  const [small, setSmall] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const [choice, setChoice] = useState<'day' | 'calendar' | null>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const change = () => setSmall(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return { view: choice ?? (small ? 'day' : 'calendar'), setView: setChoice };
}

export function usePhotoCalendar(end: string, days: number) {
  const query = `${end}/${days}`;
  const [revision, setRevision] = useState(0);
  const previousRevision = useRef(-1);
  // Only this mounted, authenticated page owns the cache. Never persist reports or QR secrets.
  const cache = useRef(new Map<string, { data: Calendar; savedAt: number }>());
  const [state, setState] = useState<{
    query: string;
    data: Calendar | null;
    loading: boolean;
    error: string;
  }>({ query, data: null, loading: true, error: '' });
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    const force = previousRevision.current !== revision;
    previousRevision.current = revision;
    if (force) cache.current.clear();
    const cached = cache.current.get(query);
    const fresh = !force && cached && Date.now() - cached.savedAt < 30000;
    setState((current) => ({
      query,
      data: cached?.data ?? (current.query === query ? current.data : null),
      loading: !fresh,
      error: '',
    }));
    if (fresh) return () => controller.abort();
    void request<Calendar>(
      `/photo-reports?end=${end}&days=${days}`,
      { signal: controller.signal },
      { branchScope: '' },
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        cache.current.set(query, { data, savedAt: Date.now() });
        if (cache.current.size > 4) cache.current.delete(cache.current.keys().next().value!);
        setState({ query, data, loading: false, error: '' });
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setState((current) => ({
            ...current,
            loading: false,
            error: caught instanceof Error ? caught.message : 'Не удалось загрузить отчёты',
          }));
      });
    return () => controller.abort();
  }, [end, days, query, revision]);
  useAdminRealtimeEvents(['photo-reports.updated'], refresh);
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    const timer = window.setInterval(onVisible, 60000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refresh);
    };
  }, [refresh]);
  return { ...(state.query === query ? state : { data: null, loading: true, error: '' }), refresh };
}
