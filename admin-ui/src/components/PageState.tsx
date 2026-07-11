import { AlertCircle, Inbox, LoaderCircle, RefreshCw } from 'lucide-react';
import { useI18n } from '../lib/i18n';

interface PageStateProps {
  type: 'loading' | 'error' | 'empty';
  title?: string;
  description?: string;
  onRetry?: () => void;
  action?: React.ReactNode;
  compact?: boolean;
}
export default function PageState({ type, title, description, onRetry, action, compact = false }: PageStateProps) {
  const { t } = useI18n();
  const Icon = type === 'loading' ? LoaderCircle : type === 'error' ? AlertCircle : Inbox;
  const fallbackTitle = type === 'loading' ? t('common.loading') : type === 'error' ? t('common.loadError') : t('common.noData');
  const fallbackDescription = type === 'error' ? t('common.tryAgainHint') : undefined;

  return (
    <div className={`page-state ${compact ? 'page-state-compact' : ''}`} role={type === 'error' ? 'alert' : 'status'} aria-live="polite">
      <span className={`page-state-icon page-state-${type}`}><Icon aria-hidden="true" className={type === 'loading' ? 'spin' : ''} size={24} /></span>
      <h3>{title ?? fallbackTitle}</h3>
      {(description ?? fallbackDescription) && <p>{description ?? fallbackDescription}</p>}
      <div className="page-state-actions">
        {onRetry && (
          <button type="button" className="btn-outline px-4 inline-flex items-center gap-2" onClick={onRetry}>
            <RefreshCw aria-hidden="true" size={16} /> {t('common.retry')}
          </button>
        )}
        {action}
      </div>
    </div>
  );
}
