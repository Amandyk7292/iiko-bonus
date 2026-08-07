import { AlertTriangle, Check, ExternalLink, LoaderCircle, Save, Send } from 'lucide-react';
import { useFeedback } from '../../components/Feedback';
import { useI18n } from '../../lib/i18n';
import TaplinkBlockEditor from './TaplinkBlockEditor';
import TaplinkBlockList from './TaplinkBlockList';
import TaplinkPhonePreview from './TaplinkPhonePreview';
import type { TaplinkBuilderActions, TaplinkBuilderState } from './taplink.types';

export default function TaplinkBuilderView({
  state,
  actions,
  canPublish,
}: {
  state: TaplinkBuilderState;
  actions: TaplinkBuilderActions;
  canPublish: boolean;
}) {
  const { t, formatDate } = useI18n();
  const { confirm } = useFeedback();
  const busy = state.saving || state.publishing;

  const publish = async () => {
    if (
      !(await confirm({
        title: t('taplink.publishTitle'),
        body: t('taplink.publishBody'),
        confirmLabel: t('taplink.publish'),
      }))
    )
      return;
    await actions.publish();
  };

  return (
    <div className="page-stack taplink-builder-page">
      <div className="taplink-command-bar card">
        <div className="taplink-command-status">
          <span className={`status-pill ${state.dirty ? 'status-warning' : 'status-active'}`}>
            {state.dirty ? (
              <AlertTriangle aria-hidden="true" size={15} />
            ) : (
              <Check aria-hidden="true" size={15} />
            )}
            {t(state.dirty ? 'taplink.unsaved' : 'taplink.draftCurrent')}
          </span>
          <p>
            {state.page.publishedAt
              ? t('taplink.lastPublished', {
                  date: formatDate(state.page.publishedAt, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }),
                })
              : t('taplink.notPublished')}
          </p>
        </div>

        <div className="taplink-command-actions">
          <a href="/taplink" target="_blank" rel="noopener noreferrer" className="btn-outline px-4">
            <ExternalLink aria-hidden="true" size={17} />
            {t('taplink.openPublic')}
          </a>
          <button
            type="button"
            className="btn-outline px-4"
            onClick={() => void actions.saveDraft()}
            disabled={!state.dirty || busy || state.conflict}
          >
            {state.saving ? (
              <LoaderCircle className="spin" aria-hidden="true" size={17} />
            ) : (
              <Save aria-hidden="true" size={17} />
            )}
            {t(state.saving ? 'taplink.saving' : 'taplink.saveDraft')}
          </button>
          <button
            type="button"
            className="btn-classic px-5"
            onClick={() => void publish()}
            disabled={!canPublish || busy || state.conflict}
            title={canPublish ? undefined : t('taplink.publishOwnerOnly')}
          >
            {state.publishing ? (
              <LoaderCircle className="spin" aria-hidden="true" size={17} />
            ) : (
              <Send aria-hidden="true" size={17} />
            )}
            {t(state.publishing ? 'taplink.publishing' : 'taplink.publish')}
          </button>
        </div>
      </div>

      {state.conflict && (
        <div className="inline-alert inline-alert-error taplink-conflict" role="alert">
          <AlertTriangle aria-hidden="true" size={20} />
          <div>
            <strong>{t('taplink.conflictTitle')}</strong>
            <p>{t('taplink.conflictBody')}</p>
          </div>
          <button type="button" className="btn-outline px-4" onClick={() => void actions.reload()}>
            {t('taplink.reload')}
          </button>
        </div>
      )}

      <div className="taplink-language-toolbar card">
        <span>{t('taplink.contentLanguage')}</span>
        <div className="language-tabs" role="tablist" aria-label={t('taplink.contentLanguage')}>
          {(['kk', 'ru'] as const).map((locale) => (
            <button
              key={locale}
              type="button"
              role="tab"
              aria-selected={state.activeLocale === locale}
              className={
                state.activeLocale === locale ? 'language-tab language-tab-active' : 'language-tab'
              }
              onClick={() => actions.setActiveLocale(locale)}
            >
              {t(`language.${locale}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="taplink-builder-grid">
        <TaplinkBlockList
          blocks={state.document.blocks}
          activeLocale={state.activeLocale}
          selected={state.selected}
          busy={busy}
          actions={actions}
        />
        <TaplinkBlockEditor
          document={state.document}
          activeLocale={state.activeLocale}
          selected={state.selected}
          busy={busy}
          actions={actions}
        />
        <TaplinkPhonePreview
          document={state.document}
          activeLocale={state.activeLocale}
          onLocaleChange={actions.setActiveLocale}
        />
      </div>
    </div>
  );
}
