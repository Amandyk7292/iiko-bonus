import { useEffect, useState } from 'react';
import { Gift, Pencil, Plus, QrCode, Trophy } from '../../components/BulkaIcons';
import PageState from '../../components/PageState';
import { useFeedback } from '../../components/Feedback';
import { useI18n } from '../../lib/i18n';
import { Link } from '../../lib/router';
import CampaignEditor from './CampaignEditor';
import FortuneQr from './FortuneQr';
import WinnersPanel from './WinnersPanel';
import { campaignStatus, WheelPreview } from './Fields';
import { loadFortune } from './api';
import { newCampaign, type Campaign, type Dashboard } from './model';
import './fortune.css';

type Dialog = { type: 'editor' | 'qr' | 'winners'; campaign: Campaign } | null;
export default function FortunePage({ role = 'viewer' }: { role?: string }) {
  const { locale, formatNumber } = useI18n();
  const text = (ru: string, kk: string) => (locale === 'kk' ? kk : ru);
  const { toast } = useFeedback();
  const allowed = ['owner', 'admin'].includes(role);
  const [data, setData] = useState<Dashboard | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [dialog, setDialog] = useState<Dialog>(null);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void loadFortune(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setError(caught instanceof Error ? caught.message : 'Не удалось загрузить рулетки.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [allowed, revision]);
  const saved = () => {
    setDialog(null);
    toast(text('Настройки рулетки сохранены', 'Рулетка баптаулары сақталды'));
    setRevision((current) => current + 1);
  };
  if (!allowed)
    return (
      <PageState
        type="empty"
        title={text('Раздел доступен администратору', 'Бөлім әкімшіге қолжетімді')}
      />
    );
  return (
    <div className="fortune-admin">
      <header className="fortune-header">
        <div>
          <span className="fortune-eyebrow">Bulka</span>
          <h1>{text('Рулетка подарков', 'Сыйлық рулеткасы')}</h1>
          <p>
            {text(
              'Призы за покупки в ваших филиалах.',
              'Филиалдарыңыздағы сатып алулар үшін сыйлықтар.',
            )}
          </p>
        </div>
        <div className="fortune-actions">
          <Link to="/fortune/redeem" className="btn-outline">
            {text('Выдать приз', 'Сыйлықты беру')}
          </Link>
          <button
            type="button"
            className="btn-primary"
            disabled={!data || loading}
            onClick={() => setDialog({ type: 'editor', campaign: newCampaign(text) })}
          >
            <Plus size={19} />
            {text('Создать рулетку', 'Рулетка жасау')}
          </button>
        </div>
      </header>
      {loading ? (
        <PageState type="loading" />
      ) : error ? (
        <PageState
          type="error"
          description={error}
          onRetry={() => setRevision((current) => current + 1)}
        />
      ) : !data?.campaigns.length ? (
        <section className="card fortune-empty">
          <div className="fortune-empty-icon">
            <Gift size={32} />
          </div>
          <h2>{text('Ваша первая рулетка', 'Алғашқы рулеткаңыз')}</h2>
          <p>
            {text(
              'Добавьте призы, выберите филиалы и скачайте QR.',
              'Сыйлықтар қосып, филиалдарды таңдап, QR жүктеңіз.',
            )}
          </p>
        </section>
      ) : (
        <div className="fortune-campaign-grid">
          {data.campaigns.map((campaign) => {
            const branches = data.branches.filter((branch) =>
              campaign.branchIds.includes(branch.id),
            );
            return (
              <article className="card fortune-campaign" key={campaign.id}>
                <div className="fortune-campaign-heading">
                  <h2>{campaign.title}</h2>
                  <span className={`fortune-status fortune-status-${campaign.status}`}>
                    {campaignStatus(campaign.status, text)}
                  </span>
                </div>
                <div className="fortune-card-body">
                  <WheelPreview prizes={campaign.prizes} text={text} />
                  <div className="fortune-card-info">
                    <p>
                      {branches
                        .map((branch) => branch.name)
                        .slice(0, 3)
                        .join(', ') || text('Филиалы не выбраны', 'Филиалдар таңдалмаған')}
                      {branches.length > 3 && ` +${branches.length - 3}`}
                    </p>
                    <dl>
                      <div>
                        <dt>{text('От суммы чека', 'Чек сомасынан')}</dt>
                        <dd>{formatNumber(campaign.minReceiptAmount)} ₸</dd>
                      </div>
                      <div>
                        <dt>{text('Чек действует', 'Чек жарамдылығы')}</dt>
                        <dd>
                          {campaign.maxReceiptAgeHours} {text('ч.', 'сағ.')}
                        </dd>
                      </div>
                      <div>
                        <dt>{text('Выдано призов', 'Берілген сыйлықтар')}</dt>
                        <dd>
                          {formatNumber(
                            campaign.prizes
                              .filter((prize) => prize.kind !== 'none')
                              .reduce((sum, prize) => sum + prize.issuedCount, 0),
                          )}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
                <div className="fortune-card-actions">
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => setDialog({ type: 'editor', campaign })}
                  >
                    <Pencil size={17} />
                    {text('Настройки', 'Баптаулар')}
                  </button>
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => setDialog({ type: 'winners', campaign })}
                  >
                    <Trophy size={17} />
                    {text('Выигрыши', 'Ұтыстар')}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => setDialog({ type: 'qr', campaign })}
                    disabled={!branches.length}
                  >
                    <QrCode size={17} />
                    {text('QR филиалов', 'Филиалдар QR коды')}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {data && dialog?.type === 'editor' && (
        <CampaignEditor
          campaign={dialog.campaign}
          branches={data.branches}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {data && dialog?.type === 'qr' && (
        <FortuneQr
          campaign={dialog.campaign}
          branches={data.branches}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'winners' && (
        <WinnersPanel campaign={dialog.campaign} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
