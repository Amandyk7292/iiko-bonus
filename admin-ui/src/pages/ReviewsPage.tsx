import {
  AlertTriangle,
  CheckCircle2,
  MessageSquareText,
  RefreshCw,
  Search,
  Star,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from '../lib/router';
import PageState from '../components/PageState';
import SelectControl from '../components/SelectControl';
import { useFeedback } from '../components/Feedback';
import { api } from '../lib/api';
import { useAdminRealtimeEvents } from '../lib/admin-realtime';
import { useI18n } from '../lib/i18n';

const reviewLabelKeys: Record<string, string> = {
  published: 'reviews.reviewStatus.published',
  hidden: 'reviews.reviewStatus.hidden',
  requires_attention: 'reviews.reviewStatus.requiresAttention',
  resolved: 'reviews.reviewStatus.resolved',
};

export default function ReviewsPage() {
  const { formatDate, t } = useI18n();
  const { toast } = useFeedback();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [search, setSearch] = useState(params.get('search') || '');
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const pageSize = 30;

  const updateParams = useCallback(
    (updates: Record<string, string | number | null>) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, String(value));
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if ((params.get('search') || '') !== search.trim()) {
        updateParams({ search: search.trim(), page: null });
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [params, search, updateParams]);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const response = await api.getReviews({
          status,
          search: params.get('search') || '',
          page,
          pageSize,
        });
        setItems(response.reviews ?? []);
        setTotal(response.total);
        setError('');
      } catch (caught) {
        if (!silent) {
          setError(caught instanceof Error ? caught.message : t('common.loadError'));
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [page, params, status, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useAdminRealtimeEvents(['review.updated'], () => void load(true), [load]);

  const updateReview = async (id: string, next: string) => {
    setSaving(id);
    try {
      await api.updateReviewStatus(id, next);
      await load(true);
      toast(t('reviews.reviewSaved'));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('reviews.reviewSaveError'), 'error');
    } finally {
      setSaving('');
    }
  };

  const reviewLabels = Object.fromEntries(
    Object.entries(reviewLabelKeys).map(([value, key]) => [value, t(key)]),
  );
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (loading && !items.length) return <PageState type="loading" />;
  if (error && !items.length) return <PageState type="error" description={error} onRetry={load} />;

  return (
    <div className="page-stack">
      <div className="page-actions-row">
        <div>
          <h2 className="content-heading">Отзывы клиентов</h2>
          <p className="page-help">
            Проверяйте оценки, жалобы на блюда и скрывайте некорректные отзывы.
          </p>
        </div>
        <button
          className="btn-outline px-5 inline-flex items-center gap-2"
          type="button"
          onClick={() => void load()}
        >
          <RefreshCw aria-hidden="true" size={17} />
          {t('common.refresh')}
        </button>
      </div>

      <section className="sagi-filter">
        <div className="field-group filter-search">
          <label className="field-label" htmlFor="review-search">
            {t('common.search')}
          </label>
          <div className="input-with-icon">
            <Search aria-hidden="true" size={18} />
            <input
              id="review-search"
              name="reviewSearch"
              type="search"
              className="input-classic"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Номер заказа или текст отзыва"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="feedback-status">
            {t('common.status')}
          </label>
          <SelectControl
            compact
            id="feedback-status"
            className="compact-select"
            value={status}
            onChange={(value) => updateParams({ status: value, page: null })}
            options={[
              { value: '', label: t('reviews.allStatuses') },
              ...Object.entries(reviewLabels).map(([value, label]) => ({ value, label })),
            ]}
          />
        </div>
      </section>

      {error && <div className="inline-alert inline-alert-error">{error}</div>}

      {items.length === 0 ? (
        <PageState type="empty" title={t('reviews.noReviews')} />
      ) : (
        <section className="review-grid">
          {items.map((review) => (
            <article
              className={`card review-card ${review.status === 'requires_attention' ? 'review-attention' : ''}`}
              key={review.id}
            >
              <header>
                <div>
                  <span className="review-stars" aria-label={`${review.rating} из 5`}>
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Star
                        aria-hidden="true"
                        key={index}
                        size={18}
                        fill={index < review.rating ? 'currentColor' : 'none'}
                      />
                    ))}
                  </span>
                  <h3>
                    {t('reviews.orderNumber', {
                      number: review.kaspi_orders?.order_number || '—',
                    })}
                  </h3>
                </div>
                <span
                  className={`status-pill ${review.status === 'requires_attention' ? 'status-danger' : 'status-active'}`}
                >
                  {reviewLabels[review.status] || review.status}
                </span>
              </header>
              <p className="review-customer">
                {review.customers?.name || t('reviews.customer')} · {review.customers?.phone || '—'}{' '}
                · {formatDate(review.created_at)}
              </p>
              {review.comment && <blockquote>{review.comment}</blockquote>}
              {(review.order_review_items || []).map((item: any) => (
                <div
                  className={`review-item ${item.complaint_reason ? 'has-complaint' : ''}`}
                  key={item.id}
                >
                  <strong>{item.product_name}</strong>
                  {item.rating && <span>{item.rating}/5</span>}
                  {item.complaint_reason && (
                    <p>
                      <AlertTriangle size={15} />
                      {item.complaint_reason}
                    </p>
                  )}
                  {item.comment && <small>{item.comment}</small>}
                </div>
              ))}
              <footer>
                <SelectControl
                  compact
                  ariaLabel={t('reviews.reviewStatusLabel')}
                  className="compact-select"
                  value={review.status}
                  disabled={saving === review.id}
                  onChange={(value) => void updateReview(review.id, value)}
                  options={Object.entries(reviewLabels).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
                {review.status === 'requires_attention' ? (
                  <AlertTriangle size={20} />
                ) : review.status === 'resolved' ? (
                  <CheckCircle2 size={20} />
                ) : (
                  <MessageSquareText size={20} />
                )}
              </footer>
            </article>
          ))}
        </section>
      )}

      {totalPages > 1 && (
        <div className="table-pagination">
          <button
            type="button"
            className="btn-outline px-4"
            disabled={page <= 1 || loading}
            onClick={() => updateParams({ page: page - 1 })}
          >
            Назад
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className="btn-outline px-4"
            disabled={page >= totalPages || loading}
            onClick={() => updateParams({ page: page + 1 })}
          >
            Далее
          </button>
        </div>
      )}
    </div>
  );
}
