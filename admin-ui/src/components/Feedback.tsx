import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useI18n } from '../lib/i18n';

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem { id: number; message: string; tone: ToastTone }
interface ConfirmOptions { title: string; body: string; confirmLabel?: string; destructive?: boolean }

interface FeedbackValue {
  toast: (message: string, tone?: ToastTone) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}
const FeedbackContext = createContext<FeedbackValue | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const confirmTitleId = `${useId()}-confirm-title`;
  const confirmBodyId = `${useId()}-confirm-body`;

  const toast = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(items => [...items, { id, message, tone }]);
    window.setTimeout(() => setToasts(items => items.filter(item => item.id !== id)), 4500);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => {
    setDialog({ ...options, resolve });
  }), []);

  const settle = useCallback((result: boolean) => {
    setDialog(current => {
      current?.resolve(result);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusableSelector = 'a[href], button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const timer = window.setTimeout(() => {
      (dialog.destructive ? cancelButtonRef.current : confirmButtonRef.current)?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        settle(false);
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(focusableSelector))
        .filter(element => !element.hasAttribute('disabled') && element.tabIndex !== -1);
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

      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {toasts.map(item => {
          const Icon = item.tone === 'success' ? CheckCircle2 : item.tone === 'error' ? AlertCircle : Info;
          return (
            <div key={item.id} className={`toast toast-${item.tone}`} role="status">
              <Icon aria-hidden="true" size={18} />
              <span>{item.message}</span>
              <button
                type="button"
                className="icon-button icon-button-sm"
                onClick={() => setToasts(items => items.filter(toastItem => toastItem.id !== item.id))}
                aria-label={t('common.close')}
              >
                <X aria-hidden="true" size={16} />
              </button>
            </div>
          );
        })}
      </div>

      {dialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && settle(false)}>
          <section ref={panelRef} className="modal-panel modal-panel-sm" role="alertdialog" aria-modal="true" aria-labelledby={confirmTitleId} aria-describedby={confirmBodyId}>
            <div className="modal-header">
              <div>
                <h2 id={confirmTitleId} className="modal-title">{dialog.title}</h2>
                <p id={confirmBodyId} className="modal-description">{dialog.body}</p>
              </div>
              <button type="button" className="icon-button" onClick={() => settle(false)} aria-label={t('common.close')}>
                <X aria-hidden="true" size={20} />
              </button>
            </div>
            <div className="modal-actions">
              <button ref={cancelButtonRef} type="button" className="btn-outline px-5" onClick={() => settle(false)}>{t('common.cancel')}</button>
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
