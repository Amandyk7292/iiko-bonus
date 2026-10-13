import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Package, Plus, RefreshCw, Search, ShoppingBag, Store, Trash2 } from '../components/BulkaIcons';
import PageState from '../components/PageState';
import { useFeedback } from '../components/Feedback';
import { ApiError, api, type AdminScopeLocation } from '../lib/api';
import { useI18n } from '../lib/i18n';
import {
  compatibleVirtualPosPayments, readPendingVirtualPosSale, removePendingVirtualPosSale, savePendingVirtualPosSale,
  validVirtualPosQuantity, virtualPosLineTotal, virtualPosPendingKey,
  type PendingVirtualPosSale, type VirtualPosCartLine, type VirtualPosCatalog, type VirtualPosSale,
} from '../lib/virtual-pos';
import { virtualPosCopy } from './virtual-pos-copy';
import '../styles/virtual-pos.css';

export default function VirtualPosPage({ username }: { username: string }) {
  const { locale, formatNumber } = useI18n();
  const text = virtualPosCopy[locale === 'kk' ? 'kk' : 'ru'];
  const { confirm } = useFeedback();
  const branchPreference = `bulkaVirtualPosBranch:${encodeURIComponent(username)}`;
  const [branches, setBranches] = useState<AdminScopeLocation[]>([]);
  const [scopeReady, setScopeReady] = useState(false);
  const [branchId, setBranchId] = useState('');
  const [catalog, setCatalog] = useState<VirtualPosCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<VirtualPosCartLine[]>([]);
  const [paymentTypeId, setPaymentTypeId] = useState('');
  const [pending, setPending] = useState<PendingVirtualPosSale | null>(null);
  const [completed, setCompleted] = useState<VirtualPosSale | null>(null);
  const [busy, setBusy] = useState(false);
  const [missingSale, setMissingSale] = useState(false);
  const submitting = useRef(false);
  const currentBranch = useRef(branchId);
  currentBranch.current = branchId;
  const catalogRequest = useRef<AbortController | null>(null);
  const catalogRequestBranch = useRef('');
  const alive = useRef(true);
  const statusChecking = useRef(false);
  const currentOperation = useRef<PendingVirtualPosSale | null>(null);
  const money = (amount: number) => `${formatNumber(amount, { maximumFractionDigits: 2 })} ₸`;

  const adoptOperation = useCallback((operation: PendingVirtualPosSale | null) => {
    currentOperation.current = operation;
    setPending(operation);
    if (operation) {
      setCart(operation.cart);
      setPaymentTypeId(operation.request.paymentTypeId);
      setCompleted(null);
    }
  }, []);

  const loadScope = useCallback(async () => {
    try {
      const result = await api.getAdminScope();
      if (!alive.current) return;
      const assigned = result.locations.filter((branch) => branch.active !== false);
      setBranches(assigned);
      let preferred = '';
      try { preferred = sessionStorage.getItem(branchPreference) || ''; } catch { /* Selection remains local. */ }
      setBranchId((selected) => assigned.some((branch) => branch.id === selected) ? selected
        : assigned.some((branch) => branch.id === preferred) ? preferred : assigned.length === 1 ? assigned[0].id : '');
      setError('');
    } catch (caught) {
      if (alive.current) setError(caught instanceof Error ? caught.message : text.loadError);
    } finally {
      if (alive.current) setScopeReady(true);
    }
  }, [branchPreference, text.loadError]);

  const loadCatalog = useCallback(async () => {
    if (!branchId) return;
    if (catalogRequest.current && !catalogRequest.current.signal.aborted && catalogRequestBranch.current === branchId) return;
    catalogRequest.current?.abort();
    const controller = new AbortController();
    catalogRequest.current = controller;
    catalogRequestBranch.current = branchId;
    setLoading(true);
    try {
      const result = await api.getVirtualPosCatalog(branchId, controller.signal);
      if (!controller.signal.aborted && alive.current && currentBranch.current === branchId) {
        if (result.branch.id !== branchId) throw new Error(text.loadError);
        setCatalog(result);
        setError('');
      }
    } catch (caught) {
      if (!controller.signal.aborted && alive.current && currentBranch.current === branchId) {
        setCatalog(null);
        setError(caught instanceof Error ? caught.message : text.loadError);
      }
    } finally {
      if (catalogRequest.current === controller) catalogRequest.current = null;
      if (!controller.signal.aborted && alive.current && currentBranch.current === branchId) setLoading(false);
    }
  }, [branchId, text.loadError]);

  useEffect(() => {
    alive.current = true;
    void loadScope();
    return () => { alive.current = false; catalogRequest.current?.abort(); };
  }, [loadScope]);

  useEffect(() => {
    setCatalog(null);
    setSearch('');
    setCompleted(null);
    setMissingSale(false);
    const restored = branchId ? readPendingVirtualPosSale(username, branchId) : null;
    adoptOperation(restored);
    setCart(restored?.cart || []);
    setPaymentTypeId(restored?.request.paymentTypeId || '');
    if (branchId) {
      try { sessionStorage.setItem(branchPreference, branchId); } catch { /* Selection remains local. */ }
    }
  }, [branchId, username, branchPreference, adoptOperation]);

  useEffect(() => { if (branchId) void loadCatalog(); }, [branchId, loadCatalog]);

  useEffect(() => {
    if (!branchId || pending || busy) return;
    const refresh = () => { if (!document.hidden) void loadCatalog(); };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [branchId, Boolean(pending), busy, loadCatalog]);

  const acceptSale = useCallback((sale: VirtualPosSale, operation: PendingVirtualPosSale) => {
    if (!alive.current || currentBranch.current !== branchId || sale.id !== operation.request.requestId) return;
    setMissingSale(false);
    setError('');
    if (sale.status === 'completed') {
      const next = removePendingVirtualPosSale(username, branchId, operation.request.requestId);
      if (next) { adoptOperation(next); return; }
      if (currentOperation.current?.request.requestId !== operation.request.requestId) return;
      adoptOperation(null);
      setCart([]);
      setPaymentTypeId('');
      setCompleted(sale);
      void loadCatalog();
    } else {
      const saved = readPendingVirtualPosSale(username, branchId);
      if (saved && saved.request.requestId !== operation.request.requestId) { adoptOperation(saved); return; }
      if (!saved || currentOperation.current?.request.requestId !== operation.request.requestId) return;
      const updated = { ...operation, sale };
      savePendingVirtualPosSale(username, branchId, updated);
      adoptOperation(updated);
    }
  }, [branchId, username, loadCatalog, adoptOperation]);

  const checkSale = useCallback(async (operation: PendingVirtualPosSale) => {
    if (statusChecking.current || !branchId) return;
    statusChecking.current = true;
    try {
      const result = await api.getVirtualPosSale(branchId, operation.request.requestId);
      acceptSale(result.sale, operation);
    } catch (caught) {
      if (alive.current && currentBranch.current === branchId) {
        setMissingSale(caught instanceof ApiError && caught.status === 404);
        setError(text.noResponse);
      }
    } finally { statusChecking.current = false; }
  }, [branchId, acceptSale, text.noResponse]);

  useEffect(() => {
    if (!pending) return;
    if (pending.sale?.status === 'rejected') return;
    void checkSale(pending);
    const timer = window.setInterval(() => { if (!document.hidden) void checkSale(pending); }, 2500);
    const resume = () => { if (!document.hidden) void checkSale(pending); };
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => { clearInterval(timer); window.removeEventListener('online', resume); document.removeEventListener('visibilitychange', resume); };
  }, [pending?.request.requestId, pending?.sale?.status, checkSale]);

  useEffect(() => {
    const storage = (event: StorageEvent) => {
      const key = virtualPosPendingKey(username, branchId);
      if ((!event.key || (event.key !== key && !event.key.startsWith(`${key}:request:`))) || submitting.current) return;
      const operation = readPendingVirtualPosSale(username, branchId);
      if (operation) adoptOperation(operation);
      else if (pending) void checkSale(pending);
    };
    window.addEventListener('storage', storage);
    return () => window.removeEventListener('storage', storage);
  }, [username, branchId, pending, checkSale, adoptOperation]);

  const payments = catalog ? compatibleVirtualPosPayments(catalog, cart) : [];
  const total = cart.reduce((sum, line) => sum + Math.round(virtualPosLineTotal(line.price, line.quantity) * 100), 0) / 100;
  const cartValid = Boolean(catalog && cart.length && cart.length <= 100 && cart.every((line) => {
    const product = catalog.products.find((item) => item.id === line.productId);
    return product?.available && product.price === line.price && validVirtualPosQuantity(line.quantity, product);
  }));
  const availability = !catalog ? '' : !catalog.canSell ? catalog.unavailableReason || text.blocked
    : !catalog.terminal?.connected ? text.disconnected : !catalog.cashShift?.isOpen || !catalog.cashShift.id ? text.closedShift : !catalog.revision ? text.blocked : '';
  const canSubmit = Boolean(catalog && !availability && cartValid && Number.isFinite(total) && total > 0 && total <= 100000000 &&
    payments.some((payment) => payment.id === paymentTypeId) && !pending && !busy && !loading);
  const locked = Boolean(pending || busy);

  const submit = async (existing?: PendingVirtualPosSale) => {
    if (submitting.current || (!existing && !canSubmit) || !catalog?.terminal || !catalog.cashShift?.id || !catalog.revision) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const session = await api.session();
      if (session.user.username !== username) throw new Error(text.accountChanged);
      const saved = readPendingVirtualPosSale(username, branchId);
      if (!existing && saved) {
        adoptOperation(saved);
        await checkSale(saved);
        return;
      }
      const operation = existing || {
        request: {
          requestId: crypto.randomUUID(), terminalId: catalog.terminal.id,
          snapshotRevision: catalog.revision, cashShiftId: catalog.cashShift.id, paymentTypeId,
          items: cart.map((line) => ({ productId: line.productId, quantity: Number(line.quantity.replace(',', '.')) })),
          expectedTotal: total,
        },
        cart: cart.map((line) => ({ ...line })),
        paymentName: payments.find((payment) => payment.id === paymentTypeId)?.name || '',
        branchName: catalog.branch.name,
      };
      try {
        savePendingVirtualPosSale(username, branchId, operation);
      } catch { throw new Error(text.storage); }
      adoptOperation(operation);
      setCompleted(null);
      try {
        const result = await api.createVirtualPosSale(branchId, operation.request);
        acceptSale(result.sale, operation);
      } catch (caught) {
        if (caught instanceof ApiError && caught.safelyRejected) {
          acceptSale({ id: operation.request.requestId, status: 'rejected', total: operation.request.expectedTotal, error: caught.message }, operation);
          return;
        }
        if (alive.current) setError(caught instanceof Error ? caught.message : text.noResponse);
        await checkSale(operation);
      }
    } catch (caught) {
      if (alive.current) setError(caught instanceof Error ? caught.message : text.noResponse);
    } finally {
      submitting.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const changeBranch = async (next: string) => {
    if (locked || next === branchId) return;
    if (cart.length && !(await confirm({ title: text.branchConfirm, body: text.branchConfirmBody, confirmLabel: text.branchConfirmAction }))) return;
    setCart([]); setPaymentTypeId(''); setError(''); setBranchId(next);
  };
  const addProduct = (productId: string) => {
    if (locked || !catalog || availability) return;
    const product = catalog.products.find((item) => item.id === productId);
    if (!product?.available) return;
    setCompleted(null);
    setCart((current) => {
      const found = current.find((line) => line.productId === productId);
      if (found) return current.map((line) => line.productId === productId
        ? { ...line, quantity: String(Math.min(9999, Math.round((Number(line.quantity.replace(',', '.')) + 1) * 1000) / 1000)) } : line);
      if (current.length >= 100) return current;
      return [...current, { productId, name: product.name, price: product.price, unit: product.unit, quantity: '1' }];
    });
  };
  const updateQuantity = (productId: string, quantity: string) => {
    if (!locked) setCart((current) => current.map((line) => line.productId === productId ? { ...line, quantity } : line));
  };
  const editRejected = () => {
    if (pending?.sale?.status !== 'rejected' || busy) return;
    const saved = readPendingVirtualPosSale(username, branchId);
    if (saved && saved.request.requestId !== pending.request.requestId) { adoptOperation(saved); return; }
    const next = removePendingVirtualPosSale(username, branchId, pending.request.requestId);
    adoptOperation(next); setMissingSale(false); setError(''); void loadCatalog();
  };
  const visible = catalog?.products.filter((product) => product.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) || [];
  const pendingStatus = pending?.sale?.status;

  return <div className="virtual-pos page-stack">
    <div className="pos-heading">
      <div><p>{text.intro}</p><label className="pos-branch"><Store size={18} aria-hidden="true" /><span>{text.branch}</span>
        <select className="input-classic" aria-label={text.branch} value={branchId} disabled={locked || !scopeReady} onChange={(event) => void changeBranch(event.target.value)}>
          <option value="">{text.chooseBranch}</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select></label>{locked && <small>{text.pendingBranch}</small>}</div>
      <button className="btn-outline" type="button" disabled={loading || busy} onClick={() => void (branchId ? loadCatalog() : loadScope())}><RefreshCw size={18} aria-hidden="true" />{text.refresh}</button>
    </div>
    {!scopeReady ? <PageState type="loading" /> : !branches.length ? <PageState type={error ? 'error' : 'empty'} title={error ? text.loadError : text.noBranches} description={error || text.noBranchesHint} onRetry={loadScope} />
      : !branchId ? <PageState type="empty" title={text.chooseBranch} /> : <>
        {availability && <div className="pos-notice" role="status">{availability}</div>}
        {error && <p className="pos-error" role="alert">{error}</p>}
        <div className="pos-layout">
          <section className="pos-catalog" aria-label={text.products}>
            <label className="pos-search"><Search size={20} aria-hidden="true" /><span className="sr-only">{text.search}</span><input aria-label={text.search} value={search} placeholder={text.searchHint} onChange={(event) => setSearch(event.target.value)} /></label>
            {loading && !catalog ? <PageState type="loading" /> : !catalog ? <PageState type="error" title={text.loadError} description={error} onRetry={loadCatalog} />
              : !visible.length ? <PageState type="empty" title={search ? text.noResults : text.noProducts} description={search ? text.noResultsHint : undefined} />
                : <div className="pos-products">{visible.map((product) => <button key={product.id} className="pos-product" type="button" disabled={locked || Boolean(availability) || !product.available || (cart.length >= 100 && !cart.some((line) => line.productId === product.id))} onClick={() => addProduct(product.id)} aria-label={`${text.add}: ${product.name}`}>
                  <span className="pos-product-symbol"><Package size={24} aria-hidden="true" /></span><strong>{product.name}</strong><span className="pos-product-price">{money(product.price)} <small>/ {product.unit}</small></span>
                  <span className="pos-product-action">{product.available ? <><Plus size={17} aria-hidden="true" />{text.add}</> : product.unavailableReason || text.unavailable}</span>
                </button>)}</div>}
          </section>
          <section className="pos-sale" aria-label={text.sale}>
            <div className="pos-sale-title"><ShoppingBag size={23} aria-hidden="true" /><h2>{text.sale}</h2>{catalog?.cashShift?.isOpen && <small>{text.shift} {catalog.cashShift.number ?? ''}</small>}</div>
            {completed && <div className="pos-result pos-completed" role="status"><Check size={23} aria-hidden="true" /><h3>{text.complete}</h3><p>{text.completeHint}</p>{completed.frontOrderNumber && <p>{text.orderNumber}: {completed.frontOrderNumber}</p>}<strong>{money(completed.total)}</strong><button className="btn-outline" type="button" onClick={() => setCompleted(null)}>{text.next}</button></div>}
            {!cart.length && !completed && <div className="pos-empty"><ShoppingBag size={36} aria-hidden="true" /><p>{text.emptyMobile}</p></div>}
            {!!cart.length && <ul className="pos-cart">{cart.map((line) => {
              const product = catalog?.products.find((item) => item.id === line.productId);
              const valid = product && validVirtualPosQuantity(line.quantity, product);
              return <li key={line.productId} className="pos-cart-line"><div className="pos-cart-name"><strong>{line.name}</strong><span>{money(line.price)} / {line.unit}</span></div>
                <button className="pos-remove" aria-label={`${text.remove}: ${line.name}`} title={text.remove} type="button" disabled={locked} onClick={() => setCart((current) => current.filter((item) => item.productId !== line.productId))}><Trash2 size={18} aria-hidden="true" /></button>
                <div className="pos-quantity"><button type="button" aria-label={`${text.minus}: ${line.name}`} disabled={locked || !product || Number(line.quantity.replace(',', '.')) <= (product?.quantityStep || 1)} onClick={() => updateQuantity(line.productId, String(Math.max(product?.quantityStep || 1, Math.round((Number(line.quantity.replace(',', '.')) - (product?.quantityStep || 1)) * 1000) / 1000)))}><span aria-hidden="true">−</span></button>
                  <input type="text" inputMode={product?.quantityStep === 1 ? 'numeric' : 'decimal'} value={line.quantity} disabled={locked} aria-label={`${text.quantity}: ${line.name}`} aria-invalid={!locked && !valid} onChange={(event) => updateQuantity(line.productId, event.target.value)} />
                  <button type="button" aria-label={`${text.plus}: ${line.name}`} disabled={locked || !product || Number(line.quantity.replace(',', '.')) >= 9999} onClick={() => updateQuantity(line.productId, String(Math.min(9999, Math.round((Number(line.quantity.replace(',', '.')) + (product?.quantityStep || 1)) * 1000) / 1000)))}><Plus size={18} aria-hidden="true" /></button>
                </div><strong className="pos-line-total">{Number.isFinite(Number(line.quantity.replace(',', '.'))) ? money(virtualPosLineTotal(line.price, line.quantity)) : '—'}</strong>
                {!locked && !valid && <p className="pos-error">{text.invalidQuantity} {product?.quantityStep ?? '—'}</p>}
                {!locked && (!product?.available || product.price !== line.price) && <p className="pos-error">{text.changed}</p>}
              </li>;
            })}</ul>}
            <label className="pos-payment"><span>{text.payment}</span><select className="input-classic" aria-label={text.payment} value={paymentTypeId} disabled={locked || Boolean(availability) || !cart.length} onChange={(event) => setPaymentTypeId(event.target.value)}><option value="">{payments.length ? text.choosePayment : text.noPayment}</option>{pending ? <option value={pending.request.paymentTypeId}>{pending.paymentName}</option> : payments.map((payment) => <option key={payment.id} value={payment.id}>{payment.name}</option>)}</select></label>
            <p className="pos-caption">{text.paymentHint}</p>
            <div className="pos-total"><span>{text.total}</span><strong>{money(Number.isFinite(total) ? total : 0)}</strong></div>
            {!locked && cart.length >= 100 && <p className="pos-caption" role="status">{text.lineLimit}</p>}
            {!locked && total > 100000000 && <p className="pos-error" role="alert">{text.totalLimit}</p>}
            {pending ? <div className={`pos-result${pendingStatus === 'needs_reconciliation' ? ' pos-review' : ''}`} role="status"><h3>{pendingStatus === 'rejected' ? text.rejected : pendingStatus === 'needs_reconciliation' ? text.reconcile : text.waiting}</h3><p>{pending.sale?.error || (pendingStatus === 'needs_reconciliation' ? text.reconcileHint : pendingStatus === 'rejected' ? '' : text.waitingHint)}</p>
              {pendingStatus === 'rejected' ? <button className="btn-outline" type="button" disabled={busy} onClick={editRejected}>{text.edit}</button> : <button className="btn-outline" type="button" disabled={busy} onClick={() => void checkSale(pending)}>{text.check}</button>}
              {missingSale && !pending.sale && <button className="btn-outline" type="button" disabled={busy || Boolean(availability)} onClick={() => void submit(pending)}>{text.resend}</button>}
            </div> : <button className="btn-classic pos-submit" type="button" disabled={!canSubmit} onClick={() => void submit()}>{busy ? text.sending : text.submit}</button>}
          </section>
        </div>
      </>}
  </div>;
}
