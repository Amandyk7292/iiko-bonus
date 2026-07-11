import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../lib/i18n';

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}
export default function Modal({ open, title, description, onClose, children, size = 'md' }: ModalProps) {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = `modal-title-${title.replace(/\W/g, '').slice(0, 12)}`;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKeyDown);
    document.body.classList.add('modal-open');
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('modal-open');
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className={`modal-panel modal-panel-${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-header">
          <div>
            <h2 id={titleId} className="modal-title">{title}</h2>
            {description && <p className="modal-description">{description}</p>}
          </div>
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label={t('common.close')}>
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
