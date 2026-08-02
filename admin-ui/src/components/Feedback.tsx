import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { motionDurations, useReducedMotion } from '../lib/motion';

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  exiting: boolean;
}
interface ToastTimer {
  timer: number | null;
  startedAt: number;
  remaining: number;
}
interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel?: string;
  destructive?: boolean;
}
type ConfirmDialog = ConfirmOptions & { resolve: (value: boolean) => void };

const TOAST_DURATION_MS = 4500;

interface FeedbackValue {
  toast: (message: string, tone?: ToastTone) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}
const FeedbackContext = createContext<FeedbackValue | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dialog, setDialog] = useState<ConfirmDialog | null>(null);
  const [dialogClosing, setDialogClosing] = useState(false);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const timersRef = useRef<Set<number>>(new Set());
  const toastTimersRef = useRef<Map<number, ToastTimer>>(new Map());
  const nextToastIdRef = useRef(0);
  const closingToastIdsRef = useRef<Set<number>>(new Set());
  const dialogRef = useRef<ConfirmDialog | null>(null);
  const dialogSettlingRef = useRef(false);
  const confirmTitleId = `${useId()}-confirm-title`;
  const confirmBodyId = `${useId()}-confirm-body`;

  const schedule = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      timersRef.current.delete(timer);
      callback();
    }, delay);
    timersRef.current.add(timer);
    return timer;
  }, []);

  useEffect(
    () => () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current.clear();
      toastTimersRef.current.forEach(({ timer }) => {
        if (timer !== null) window.clearTimeout(timer);
      });
      toastTimersRef.current.clear();
    },
    [],
  );

  const clearToastTimer = useCallback((id: number) => {
    const active = toastTimersRef.current.get(id);
    if (active?.timer !== null && active?.timer !== undefined) window.clearTimeout(active.timer);
    toastTimersRef.current.delete(id);
  }, []);

  const removeToast = useCallback(
    (id: number) => {
      if (closingToastIdsRef.current.has(id)) return;
      clearToastTimer(id);
      closingToastIdsRef.current.add(id);
      setToasts((items) =>
        items.map((item) => (item.id === id ? { ...item, exiting: true } : item)),
      );
      schedule(
        () => {
          closingToastIdsRef.current.delete(id);
          setToasts((items) => items.filter((item) => item.id !== id));
        },
        reducedMotion ? 80 : motionDurations.fast,
      );
    },
    [clearToastTimer, reducedMotion, schedule],
  );

  const scheduleToastRemoval = useCallback(
    (id: number, delay: number) => {
      const active = toastTimersRef.current.get(id);
      if (active?.timer !== null && active?.timer !== undefined) window.clearTimeout(active.timer);
      const remaining = Math.max(0, delay);
      const startedAt = Date.now();
      if (document.visibilityState === 'hidden') {
        toastTimersRef.current.set(id, { timer: null, startedAt, remaining });
        return;
      }
      const timer = window.setTimeout(() => {
        toastTimersRef.current.delete(id);
        removeToast(id);
      }, remaining);
      toastTimersRef.current.set(id, { timer, startedAt, remaining });
    },
    [removeToast],
  );

  const pauseToast = useCallback((id: number) => {
    const active = toastTimersRef.current.get(id);
    if (!active || active.timer === null) return;
    window.clearTimeout(active.timer);
    toastTimersRef.current.set(id, {
      timer: null,
      startedAt: Date.now(),
      remaining: Math.max(0, active.remaining - (Date.now() - active.startedAt)),
    });
  }, []);

  const resumeToast = useCallback(
    (id: number) => {
      const active = toastTimersRef.current.get(id);
      if (!active || active.timer !== null) return;
      scheduleToastRemoval(id, active.remaining);
    },
    [scheduleToastRemoval],
  );

  useEffect(() => {
    const onVisibilityChange = () => {
      const ids = [...toastTimersRef.current.keys()];
      ids.forEach((id) =>
        document.visibilityState === 'hidden' ? pauseToast(id) : resumeToast(id),
      );
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [pauseToast, resumeToast]);

  const toast = useCallback(
    (message: string, tone: ToastTone = 'success') => {
      const id = ++nextToastIdRef.current;
      setToasts((items) => [...items, { id, message, tone, exiting: false }]);
      scheduleToastRemoval(id, TOAST_DURATION_MS);
    },
    [scheduleToastRemoval],
  );

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        const nextDialog = { ...options, resolve };
        dialogRef.current = nextDialog;
        dialogSettlingRef.current = false;
        setDialogClosing(false);
        setDialog(nextDialog);
      }),
    [],
  );

  const settle = useCallback(
    (result: boolean) => {
      const current = dialogRef.current;
      if (!current || dialogSettlingRef.current) return;
      dialogSettlingRef.current = true;
      current.resolve(result);
      setDialogClosing(true);
      schedule(
        () => {
          dialogRef.current = null;
          dialogSettlingRef.current = false;
          setDialog(null);
          setDialogClosing(false);
        },
        reducedMotion ? 80 : motionDurations.fast,
      );
    },
    [reducedMotion, schedule],
  );

  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusableSelector =
      'a[href], button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const timer = window.setTimeout(() => {
      (dialog.destructive ? cancelButtonRef.current : confirmButtonRef.current)?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        settle(false);
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => !element.hasAttribute('disabled') && element.tabIndex !== -1);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.classList.add('modal-open');
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('modal-open');
      previous?.focus();
    };
  }, [dialog, settle]);

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}

      <div className="toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map((item) => {
          const Icon =
            item.tone === 'success' ? CheckCircle2 : item.tone === 'error' ? AlertCircle : Info;
          return (
            <div
              key={item.id}
              className={`toast toast-${item.tone} ${item.exiting ? 'is-exiting' : ''}`}
              role={item.tone === 'error' ? 'alert' : 'status'}
              aria-atomic="true"
              onMouseEnter={() => pauseToast(item.id)}
              onMouseLeave={() => resumeToast(item.id)}
              onFocusCapture={() => pauseToast(item.id)}
              onBlurCapture={() => resumeToast(item.id)}
            >
              <Icon aria-hidden="true" size={18} />
              <span>{item.message}</span>
              <button
                type="button"
                className="icon-button icon-button-sm"
                onClick={() => removeToast(item.id)}
                aria-label={t('common.close')}
              >
                <X aria-hidden="true" size={16} />
              </button>
            </div>
          );
        })}
      </div>

      {dialog && (
        <div
          className={`modal-backdrop ${dialogClosing ? 'is-exiting' : ''}`}
          role="presentation"
          onMouseDown={(event) =>
            !dialogClosing && event.target === event.currentTarget && settle(false)
          }
        >
          <section
            ref={panelRef}
            className="modal-panel modal-panel-sm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={confirmTitleId}
            aria-describedby={confirmBodyId}
          >
            <div className="modal-header">
              <div>
                <h2 id={confirmTitleId} className="modal-title">
                  {dialog.title}
                </h2>
                <p id={confirmBodyId} className="modal-description">
                  {dialog.body}
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => settle(false)}
                aria-label={t('common.close')}
              >
                <X aria-hidden="true" size={20} />
              </button>
            </div>
            <div className="modal-actions">
              <button
                ref={cancelButtonRef}
                type="button"
                className="btn-outline px-5"
                onClick={() => settle(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                ref={confirmButtonRef}
                type="button"
                className={dialog.destructive ? 'btn-danger px-5' : 'btn-classic px-5'}
                onClick={() => settle(true)}
              >
                {dialog.confirmLabel ?? t('common.confirm')}
              </button>
            </div>
          </section>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error('useFeedback must be used inside FeedbackProvider');
  return value;
}
