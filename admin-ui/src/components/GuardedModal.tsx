import { useEffect, useRef, useState, type ComponentProps, type MouseEvent } from 'react';
import Modal from './Modal';
import { useI18n } from '../lib/i18n';
import { useNavigationBlocker, useNavigate } from '../lib/router';
/** Editing dialogs retain drafts until the user explicitly discards them. */
export default function GuardedModal({
  dirty: controlledDirty,
  dismissDisabled = false,
  ...props
}: ComponentProps<typeof Modal> & { dirty?: boolean; dismissDisabled?: boolean }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [observedDirty, setDirty] = useState(false),
    [confirm, setConfirm] = useState(false);
  const dirty = controlledDirty ?? observedDirty;
  const pending = useRef<string | null>(null),
    allowNavigation = useRef(false);
  useEffect(() => {
    if (!props.open) {
      setDirty(false);
      setConfirm(false);
      pending.current = null;
      allowNavigation.current = false;
    }
  }, [props.open]);
  useEffect(() => {
    if (!dirty || !props.open) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, props.open]);
  useNavigationBlocker((dirty || dismissDisabled) && props.open, (next) => {
    if (allowNavigation.current) return true;
    if (dismissDisabled) return false;
    pending.current = next.pathname + next.search + next.hash;
    setConfirm(true);
    return false;
  });
  const close = () => {
    if (dismissDisabled) return;
    if (dirty) setConfirm(true);
    else props.onClose();
  };
  const captureClick = (event: MouseEvent<HTMLDivElement>) => {
    const element = event.target as HTMLElement;
    if (element.closest('[role=option], [data-unsaved-change]')) setDirty(true);
    const button = element.closest('button');
    if (
      button &&
      (button.hasAttribute('data-modal-dismiss') ||
        button.textContent?.trim() === t('common.cancel'))
    ) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };
  return (
    <>
      <Modal
        {...props}
        onClose={close}
        footer={props.footer && <div onClickCapture={captureClick}>{props.footer}</div>}
      >
        <div
          onChangeCapture={() => setDirty(true)}
          onClickCapture={captureClick}
          onKeyDownCapture={(e) => {
            if (
              ['Enter', 'ArrowUp', 'ArrowDown'].includes(e.key) &&
              (e.target as HTMLElement).closest('[role=combobox]')
            )
              setDirty(true);
          }}
        >
          {props.children}
        </div>
      </Modal>
      <Modal
        open={confirm}
        title={t('common.unsavedTitle')}
        onClose={() => {
          pending.current = null;
          setConfirm(false);
        }}
        size="sm"
      >
        <div className="modal-body form-stack">
          <p>{t('common.unsavedBody')}</p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn-outline"
              onClick={() => {
                pending.current = null;
                setConfirm(false);
              }}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn-classic"
              disabled={dismissDisabled}
              onClick={() => {
                const next = pending.current;
                pending.current = null;
                allowNavigation.current = true;
                setDirty(false);
                setConfirm(false);
                props.onClose();
                if (next) navigate(next);
              }}
            >
              {t('inventory.discardAndContinue')}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
