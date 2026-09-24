import { useState } from 'react';
import PageState from '../../components/PageState';
import { useI18n } from '../../lib/i18n';
import type {
  CustomerBonusEntry,
  CustomerFinancialDetailsResponse,
  CustomerPersonalAccountEntry,
} from '../../lib/api';
import './customer-financial-details.css';

const accountLabels: Record<string, string> = {
  topup: 'customers.accountType.topup',
  payment: 'customers.accountType.payment',
  refund: 'customers.accountType.refund',
  reversal: 'customers.accountType.reversal',
};

function contextText(
  entry: Pick<CustomerBonusEntry | CustomerPersonalAccountEntry, 'orderNumber' | 'branch'>,
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  return [
    entry.orderNumber ? t('customers.orderNumber', { number: entry.orderNumber }) : '',
    entry.branch?.name || '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function Amount({ value, suffix = '' }: { value: number; suffix?: string }) {
  const { formatNumber } = useI18n();
  const positive = value > 0;
  return (
    <strong className={`customer-ledger-amount ${positive ? 'is-positive' : 'is-negative'}`}>
      {positive ? '+' : ''}
      {formatNumber(value)}
      {suffix}
    </strong>
  );
}

function BonusRow({ entry }: { entry: CustomerBonusEntry }) {
  const { t, formatDate } = useI18n();
  const context = contextText(entry, t);
  return (
    <article className="customer-ledger-row">
      <span className={`customer-ledger-icon ${entry.amount >= 0 ? 'is-positive' : 'is-negative'}`}>
        {entry.amount >= 0 ? '+' : '−'}
      </span>
      <div className="customer-ledger-copy">
        <strong>{t('customers.bonusOperation')}</strong>
        <p>{entry.description || t('customers.reasonUnavailable')}</p>
        <small>
          {formatDate(entry.timestamp, { dateStyle: 'short', timeStyle: 'short' })}
          {context ? ` · ${context}` : ''}
        </small>
      </div>
      <Amount value={entry.amount} />
    </article>
  );
}

function AccountRow({ entry }: { entry: CustomerPersonalAccountEntry }) {
  const { t, formatDate } = useI18n();
  const context = contextText(entry, t);
  return (
    <article className="customer-ledger-row">
      <span className={`customer-ledger-icon ${entry.amount >= 0 ? 'is-positive' : 'is-negative'}`}>
        {entry.amount >= 0 ? '+' : '−'}
      </span>
      <div className="customer-ledger-copy">
        <strong>{t(accountLabels[entry.kind] || 'customers.accountType.other')}</strong>
        <p>{entry.description || context || t('customers.accountOperation')}</p>
        <small>
          {formatDate(entry.createdAt, { dateStyle: 'short', timeStyle: 'short' })}
          {entry.topupStatus ? ` · ${entry.topupStatus}` : ''}
        </small>
      </div>
      <Amount value={entry.amount} suffix=" ₸" />
    </article>
  );
}

export default function CustomerFinancialDetails({
  details,
  loading,
  error,
  onRetry,
  canAdjustAccount,
  onAdjustAccount,
}: {
  details: CustomerFinancialDetailsResponse | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  canAdjustAccount: boolean;
  onAdjustAccount: () => void;
}) {
  const { t, formatNumber } = useI18n();
  const [tab, setTab] = useState<'bonus' | 'account'>('bonus');
  if (loading && !details) return <PageState type="loading" />;
  if (error && !details) return <PageState type="error" description={error} onRetry={onRetry} />;
  if (!details) return null;
  const entries = tab === 'bonus' ? details.bonus.entries : details.personalAccount.entries;
  return (
    <div className="modal-body customer-financial-details">
      {error && (
        <div className="inline-alert inline-alert-error" role="alert">
          {error}
        </div>
      )}
      <div className="customer-financial-summary">
        <article>
          <span>{t('customers.bonusBalance')}</span>
          <strong>{formatNumber(details.bonus.balance)}</strong>
        </article>
        <article>
          <span>{t('customers.personalAccount')}</span>
          <strong>{formatNumber(details.personalAccount.balance)} ₸</strong>
          {details.personalAccount.blocked && <small>{t('customers.accountBlocked')}</small>}
          {canAdjustAccount && (
            <button type="button" className="customer-account-adjust" onClick={onAdjustAccount}>
              {t('common.edit')}
            </button>
          )}
        </article>
        <article>
          <span>{t('customers.totalPurchases')}</span>
          <strong>{formatNumber(details.customer.total_spent || 0)} ₸</strong>
        </article>
      </div>
      <div className="customer-financial-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'bonus'}
          onClick={() => setTab('bonus')}
        >
          {t('customers.bonusHistory')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'account'}
          onClick={() => setTab('account')}
        >
          {t('customers.personalAccount')}
        </button>
      </div>
      <div className="customer-ledger-list" role="tabpanel">
        {entries.length === 0 ? (
          <div className="customer-ledger-empty">{t('customers.noFinancialOperations')}</div>
        ) : tab === 'bonus' ? (
          (entries as CustomerBonusEntry[]).map((entry) => (
            <BonusRow key={entry.id} entry={entry} />
          ))
        ) : (
          (entries as CustomerPersonalAccountEntry[]).map((entry) => (
            <AccountRow key={entry.id} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
}
