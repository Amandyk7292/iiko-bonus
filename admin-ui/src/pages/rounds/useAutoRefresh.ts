import { useEffect, useRef } from 'react';

/** Refresh read-only data while the admin is present, without remounting open forms. */
export function useAutoRefresh(onRefresh: () => void) {
  const callback = useRef(onRefresh);
  callback.current = onRefresh;
  useEffect(() => {
    let lastRefresh = 0;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      // Returning to a tab can fire both visibilitychange and focus.
      if (now - lastRefresh < 1000) return;
      lastRefresh = now;
      callback.current();
    };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
}
