import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { motionDurations, useReducedMotion } from '../lib/motion';

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}
export default function Modal({
  open,
  title,
  description,
  onClose,
  children,
  size = 'md',
}: ModalProps) {
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(open);
  const [exiting, setExiting] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const reactId = useId();
  const titleId = `${reactId}-title`;
  const descriptionId = `${reactId}-description`;

  onCloseRef.current = onClose;

  useEffect(() => {
    if (open) {
      setMounted(true);
      setExiting(false);
      return undefined;
    }
    if (!mounted) return undefined;
    setExiting(true);
    const timer = window.setTimeout(
      () => {
        setMounted(false);
        setExiting(false);
      },
      reducedMotion ? 80 : motionDurations.fast,
    );
    return () => window.clearTimeout(timer);
  }, [mounted, open, reducedMotion]);

  useEffect(() => {
    if (!mounted) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusableSelector =
      'a[href], button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const timer = window.setTimeout(() => {
      const firstAutofocus = panelRef.current?.querySelector<HTMLElement>('[autofocus]');
      const firstFocusable = panelRef.current?.querySelector<HTMLElement>(focusableSelector);
      (firstAutofocus ?? firstFocusable ?? closeRef.current)?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => !element.hasAttribute('disabled') && element.tabIndex !== -1);
      if (focusable.length === 0) {
        event.preventDefault();
        closeRef.current?.focus();
        return;
      }
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
  }, [mounted]);

  if (!mounted) return null;
  return createPortal(
    <div
      className={`modal-backdrop ${exiting ? 'is-exiting' : ''}`}
      role="presentation"
      onMouseDown={(event) => !exiting && event.target === event.currentTarget && onClose()}
    >
      <section
        ref={panelRef}
        className={`modal-panel modal-panel-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId} className="modal-title">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="modal-description">
                {description}
              </p>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}
