import { useEffect, useState } from 'react';
import { AlertCircle, Check, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import Modal from '../../components/Modal';
import PageState from '../../components/PageState';
import { request } from '../../lib/api';
import { kinds, type Detail, type Photo, type PhotoCopy, type Selection } from './model';

function PhotoViewer({
  photos,
  copy,
  kindLabel,
}: {
  photos: Photo[];
  copy: PhotoCopy;
  kindLabel: string;
}) {
  const [index, setIndex] = useState(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const active = photos[Math.min(index, photos.length - 1)];
  const source = active.url! + (retry ? `?retry=${retry}` : '');
  const select = (next: number) => {
    if (next === index) return;
    setState('loading');
    setRetry(0);
    setIndex(next);
  };
  return (
    <>
      <div className="closing-photo-viewer">
        <div className="closing-photo-frame" aria-busy={state === 'loading'}>
          {state === 'loading' && (
            <div
              className="closing-photo-loading closing-skeleton"
              role="status"
              aria-label={copy.text('Загрузка фото', 'Фото жүктелуде')}
            />
          )}
          {state === 'error' ? (
            <div className="closing-photo-error" role="alert">
              <AlertCircle size={30} aria-hidden="true" />
              <span>{copy.text('Фото не загрузилось', 'Фото жүктелмеді')}</span>
              <button
                type="button"
                className="btn-outline"
                onClick={() => {
                  setState('loading');
                  setRetry((v) => v + 1);
                }}
              >
                <RefreshCw size={17} aria-hidden="true" />
                {copy.text('Повторить', 'Қайталау')}
              </button>
            </div>
          ) : (
            <img
              key={source}
              src={source}
              alt={`${kindLabel} · ${index + 1}`}
              onLoad={() => setState('loaded')}
              onError={() => setState('error')}
            />
          )}
        </div>
        <div className="closing-photo-controls">
          <button
            className="icon-button"
            type="button"
            aria-label={copy.text('Предыдущее фото', 'Алдыңғы фото')}
            disabled={photos.length < 2}
            onClick={() => select((index - 1 + photos.length) % photos.length)}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <span aria-live="polite">
            {index + 1} / {photos.length}
          </span>
          <button
            className="icon-button"
            type="button"
            aria-label={copy.text('Следующее фото', 'Келесі фото')}
            disabled={photos.length < 2}
            onClick={() => select((index + 1) % photos.length)}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </div>
      {photos.length > 1 && (
        <div
          className="closing-photo-thumbs"
          aria-label={copy.text('Фото отчёта', 'Есеп фотолары')}
        >
          {photos.map((photo, n) => (
            <button
              key={photo.id}
              type="button"
              aria-label={`Фото ${n + 1}`}
              aria-pressed={index === n}
              className={index === n ? 'is-active' : ''}
              onClick={() => select(n)}
            >
              <img loading="lazy" src={photo.url!} alt="" />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
function DetailBody({
  selection,
  setKind,
  copy,
}: {
  selection: Selection;
  setKind: (kind: Selection['kind']) => void;
  copy: PhotoCopy;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void request<Detail>(
      `/photo-reports/branches/${selection.branch.id}?date=${selection.date}`,
      { signal: controller.signal },
      { branchScope: '' },
    )
      .then((result) => {
        if (!controller.signal.aborted) setDetail(result);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(caught.message);
      });
    return () => controller.abort();
  }, [selection.branch.id, selection.date, revision]);
  const report = detail?.reports.find((r) => r.kind === selection.kind);
  const photos = report?.photos?.filter((photo) => photo.available && photo.url) ?? [];
  return (
    <div className="closing-detail">
      <div
        className="segmented-control closing-kind-tabs"
        role="group"
        aria-label={copy.text('Вид отчёта', 'Есеп түрі')}
      >
        {kinds.map((kind) => (
          <button
            type="button"
            key={kind}
            aria-pressed={selection.kind === kind}
            className={selection.kind === kind ? 'is-active' : ''}
            onClick={() => setKind(kind)}
          >
            {copy.kindLabel(kind)}
          </button>
        ))}
      </div>
      {error ? (
        <PageState
          type="error"
          description={error}
          onRetry={() => setRevision((v) => v + 1)}
          compact
        />
      ) : !detail ? (
        <PageState type="loading" compact />
      ) : !report ? (
        <PageState
          type="empty"
          title={copy.text('Отчёт не отправлен', 'Есеп жіберілмеді')}
          compact
        />
      ) : (
        <>
          <div className="closing-submitted">
            <Check size={20} aria-hidden="true" />
            <div>
              <strong>{copy.text('Отчёт отправлен', 'Есеп жіберілді')}</strong>
              <span>
                {copy.timeLabel(report.submittedAt)} · {report.photoCount} фото
              </span>
            </div>
          </div>
          {photos.length ? (
            <PhotoViewer
              key={report.id}
              photos={photos}
              copy={copy}
              kindLabel={copy.kindLabel(selection.kind)}
            />
          ) : (
            <div className="closing-expired">
              <strong>
                {copy.text('Срок хранения фото истёк', 'Фото сақтау мерзімі аяқталды')}
              </strong>
            </div>
          )}
        </>
      )}
    </div>
  );
}
export default function ReportDetail({
  selection,
  onChange,
  copy,
}: {
  selection: Selection | null;
  onChange: (selection: Selection | null) => void;
  copy: PhotoCopy;
}) {
  return (
    <Modal
      open={Boolean(selection)}
      onClose={() => onChange(null)}
      title={selection?.branch.name ?? ''}
      description={
        selection ? `${selection.branch.city} · ${copy.dateLabel(selection.date, true)}` : ''
      }
      size="lg"
    >
      {selection && (
        <DetailBody
          key={`${selection.branch.id}/${selection.date}`}
          selection={selection}
          setKind={(kind) => onChange({ ...selection, kind })}
          copy={copy}
        />
      )}
    </Modal>
  );
}
