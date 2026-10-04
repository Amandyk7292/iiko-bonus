import { useEffect, useRef } from 'react';
import { useFeedback } from '../components/Feedback';
import { useI18n } from './i18n';
import { useLocation, useNavigate, useNavigationBlocker } from './router';

/** Allow changes of view in the same workspace while protecting a dirty draft on exit. */
export function useUnsavedChanges(dirty: boolean, busy = false) {
  const { t } = useI18n();
  const { confirm } = useFeedback();
  const location = useLocation();
  const navigate = useNavigate();
  const bypass = useRef(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);
  useNavigationBlocker(dirty || busy, (next) => {
    if (bypass.current || next.pathname === location.pathname) return true;
    if (busy || pending.current) return false;
    pending.current = true;
    void confirm({
      title: t('common.unsavedTitle'),
      body: t('common.unsavedBody'),
      confirmLabel: t('inventory.discardAndContinue'),
      destructive: true,
    }).then((discard) => {
      pending.current = false;
      if (!discard || !mounted.current) return;
      bypass.current = true;
      navigate(next.pathname + next.search + next.hash, { state: next.state });
      bypass.current = false;
    });
    return false;
  });
}
