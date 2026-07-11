import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Download, Gift, LoaderCircle, Pencil, RefreshCw, Search, Trash2 } from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
import { useFeedback } from '../components/Feedback';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';

interface Customer {
  id: string;
  name?: string;
  phone?: string;
  balance?: number;
  total_spent?: number;
}

export default function CustomersPage() {
  const { t, formatNumber } = useI18n();
  const { toast, confirm } = useFeedback();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [bonusCustomer, setBonusCustomer] = useState<Customer | null>(null);
  const [bonusAmount, setBonusAmount] = useState('');
  const [bonusReason, setBonusReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [formError, setFormError] = useState('');

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getCustomers();
      setCustomers(Array.isArray(data) ? data : data.customers ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void fetchCustomers(); }, [fetchCustomers]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return customers.filter(customer => `${customer.name ?? ''} ${customer.phone ?? ''}`.toLocaleLowerCase().includes(query));
  }, [customers, search]);

  const handleExport = () => {
    const rows: Array<Array<string | number>> = [[t('common.name'), t('transactions.phone'), t('customers.balance'), t('customers.purchases')]];
    filtered.forEach(customer => rows.push([customer.name || '', customer.phone || '', customer.balance || 0, customer.total_spent || 0]));
    const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `bulka-customers-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const notifyInactive = async () => {
    if (!await confirm({ title: t('customers.notifyTitle'), body: t('customers.notifyBody'), confirmLabel: t('customers.notify') })) return;
    setBusyAction('notify');
    try {
      const data = await api.notifyInactive();
      toast(t('customers.notified', { count: data.notifiedCount ?? 0 }));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const expireInactive = async () => {
    if (!await confirm({ title: t('customers.expireTitle'), body: t('customers.expireBody'), confirmLabel: t('customers.expire'), destructive: true })) return;
    setBusyAction('expire');
    try {
      const data = await api.expireInactive();
      toast(t('customers.expired', { count: data.expiredCount ?? 0, amount: formatNumber(data.totalExpiredAmount ?? 0) }));
      await fetchCustomers();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const deleteCustomer = async (customer: Customer) => {
    if (!await confirm({ title: t('customers.deleteTitle'), body: t('customers.deleteBody'), confirmLabel: t('common.delete'), destructive: true })) return;
    setBusyAction(customer.id);
    try {
      await api.deleteCustomer(customer.id);
      setCustomers(current => current.filter(item => item.id !== customer.id));
      toast(t('customers.deleted'));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const openBonus = (customer: Customer) => {
    setBonusCustomer(customer);
    setBonusAmount('');
    setBonusReason('');
    setFormError('');
  };

  const saveBonus = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(bonusAmount);
    if (!bonusCustomer || !Number.isFinite(amount) || amount === 0) {
      setFormError(t('customers.bonusAmountHint'));
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      await api.addCustomerBonus(bonusCustomer.id, amount, bonusReason.trim() || t('customers.reasonPlaceholder'));
      setBonusCustomer(null);
      toast(t('customers.bonusSaved'));
      await fetchCustomers();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingCustomer) return;
    setSubmitting(true);
    setFormError('');
    try {
      await api.updateCustomer(editingCustomer.id, {
        name: editingCustomer.name ?? '', phone: editingCustomer.phone ?? '',
        balance: Number(editingCustomer.balance ?? 0), total_spent: Number(editingCustomer.total_spent ?? 0),
      });
      setEditingCustomer(null);
      toast(t('common.saved'));
      await fetchCustomers();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && customers.length === 0) return <PageState type="loading" />;
  if (error && customers.length === 0) return <PageState type="error" description={error} onRetry={fetchCustomers} />;

  return (
    <div className="page-stack">
      <div className="page-actions-row">
        <div className="action-cluster">
          <button type="button" className="btn-outline px-4 inline-flex items-center gap-2" onClick={notifyInactive} disabled={Boolean(busyAction)}>{busyAction === 'notify' ? <LoaderCircle className="spin" size={17} /> : <RefreshCw aria-hidden="true" size={17} />}{t('customers.notify')}</button>
          <button type="button" className="btn-outline danger-outline px-4" onClick={expireInactive} disabled={Boolean(busyAction)}>{t('customers.expire')}</button>
        </div>
        <button type="button" onClick={handleExport} disabled={filtered.length === 0} className="btn-outline px-4 inline-flex items-center gap-2"><Download aria-hidden="true" size={17} />{t('customers.export')}</button>
      </div>
      {error && <div className="inline-alert inline-alert-error" role="alert">{error}</div>}

      <section className="sagi-filter">
        <div className="field-group filter-search"><label className="field-label" htmlFor="customer-search">{t('common.search')}</label><div className="input-with-icon"><Search aria-hidden="true" size={18} /><input id="customer-search" type="search" className="input-classic" value={search} onChange={event => setSearch(event.target.value)} placeholder={t('customers.searchPlaceholder')} /></div></div>
      </section>

      {filtered.length === 0 ? <PageState type="empty" title={t('customers.empty')} description={t('customers.emptyHint')} /> : (
        <section className="card table-card"><div className="responsive-table-wrap"><table className="data-table customers-table">
          <thead><tr><th>#</th><th>{t('common.name')}</th><th>{t('transactions.phone')}</th><th className="text-right">{t('customers.balance')}</th><th className="text-right">{t('customers.purchases')}</th><th className="text-right">{t('customers.manage')}</th></tr></thead>
          <tbody>{filtered.map((customer, index) => <tr key={customer.id}>
            <td data-label="#" className="row-number">{index + 1}</td><td data-label={t('common.name')}><strong>{customer.name || t('customers.noName')}</strong></td>
            <td data-label={t('transactions.phone')}>{customer.phone || '—'}</td><td data-label={t('customers.balance')} className="text-right tabular value-info"><strong>{formatNumber(customer.balance ?? 0)}</strong></td>
            <td data-label={t('customers.purchases')} className="text-right tabular">{formatNumber(customer.total_spent ?? 0)}</td>
            <td data-label={t('customers.manage')}><div className="row-actions justify-end">
              <button type="button" className="icon-button" onClick={() => openBonus(customer)} aria-label={t('customers.bonus')} title={t('customers.bonus')}><Gift aria-hidden="true" size={17} /></button>
              <button type="button" className="icon-button" onClick={() => { setEditingCustomer({ ...customer }); setFormError(''); }} aria-label={t('common.edit')} title={t('common.edit')}><Pencil aria-hidden="true" size={17} /></button>
              <button type="button" className="icon-button icon-button-danger" onClick={() => deleteCustomer(customer)} disabled={Boolean(busyAction)} aria-label={t('common.delete')} title={t('common.delete')}>{busyAction === customer.id ? <LoaderCircle className="spin" size={17} /> : <Trash2 aria-hidden="true" size={17} />}</button>
            </div></td>
          </tr>)}</tbody>
        </table></div></section>
      )}

      <Modal open={Boolean(editingCustomer)} onClose={() => !submitting && setEditingCustomer(null)} title={t('customers.editTitle')} size="md">
        {editingCustomer && <form className="modal-body form-stack" onSubmit={saveEdit}>
          {formError && <div className="inline-alert inline-alert-error" role="alert">{formError}</div>}
          <div className="field-group"><label className="field-label" htmlFor="customer-name">{t('common.name')}</label><input id="customer-name" className="input-classic" value={editingCustomer.name ?? ''} onChange={event => setEditingCustomer(current => current && ({ ...current, name: event.target.value }))} autoComplete="name" /></div>
          <div className="field-group"><label className="field-label" htmlFor="customer-phone">{t('transactions.phone')}</label><input id="customer-phone" type="tel" className="input-classic" value={editingCustomer.phone ?? ''} onChange={event => setEditingCustomer(current => current && ({ ...current, phone: event.target.value }))} autoComplete="tel" /></div>
          <div className="form-grid form-grid-2">
            <div className="field-group"><label className="field-label" htmlFor="customer-balance">{t('customers.balance')}</label><input id="customer-balance" type="number" step="0.01" className="input-classic" value={editingCustomer.balance ?? 0} onChange={event => setEditingCustomer(current => current && ({ ...current, balance: Number(event.target.value) }))} /></div>
            <div className="field-group"><label className="field-label" htmlFor="customer-spent">{t('customers.totalPurchases')}</label><input id="customer-spent" type="number" min="0" step="0.01" className="input-classic" value={editingCustomer.total_spent ?? 0} onChange={event => setEditingCustomer(current => current && ({ ...current, total_spent: Number(event.target.value) }))} /></div>
          </div>
          <div className="modal-actions"><button type="button" className="btn-outline px-5" onClick={() => setEditingCustomer(null)} disabled={submitting}>{t('common.cancel')}</button><button type="submit" className="btn-classic px-5 inline-flex items-center gap-2" disabled={submitting}>{submitting && <LoaderCircle className="spin" size={17} />}{submitting ? t('common.saving') : t('common.save')}</button></div>
        </form>}
      </Modal>

      <Modal open={Boolean(bonusCustomer)} onClose={() => !submitting && setBonusCustomer(null)} title={t('customers.bonusTitle')} size="sm">
        <form className="modal-body form-stack" onSubmit={saveBonus}>
          <p className="modal-context"><strong>{bonusCustomer?.name || t('customers.noName')}</strong><span>{bonusCustomer?.phone}</span></p>
          {formError && <div className="inline-alert inline-alert-error" role="alert">{formError}</div>}
          <div className="field-group"><label className="field-label" htmlFor="bonus-amount">{t('customers.bonusAmount')} *</label><input id="bonus-amount" type="number" step="0.01" className="input-classic" value={bonusAmount} onChange={event => setBonusAmount(event.target.value)} required autoFocus /><p className="field-hint">{t('customers.bonusAmountHint')}</p></div>
          <div className="field-group"><label className="field-label" htmlFor="bonus-reason">{t('customers.reason')}</label><textarea id="bonus-reason" rows={3} className="input-classic" value={bonusReason} onChange={event => setBonusReason(event.target.value)} placeholder={t('customers.reasonPlaceholder')} maxLength={240} /></div>
          <div className="modal-actions"><button type="button" className="btn-outline px-5" onClick={() => setBonusCustomer(null)} disabled={submitting}>{t('common.cancel')}</button><button type="submit" className="btn-classic px-5 inline-flex items-center gap-2" disabled={submitting}>{submitting && <LoaderCircle className="spin" size={17} />}{submitting ? t('common.saving') : t('common.save')}</button></div>
        </form>
      </Modal>
    </div>
  );
}
