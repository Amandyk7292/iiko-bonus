import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  FileText,
  GripVertical,
  Heading,
  Link2,
  Plus,
  Trash2,
} from 'lucide-react';
import { useFeedback } from '../../components/Feedback';
import type { TaplinkBlock, TaplinkLocale } from '../../lib/api-types';
import { useI18n } from '../../lib/i18n';
import { taplinkBlockName } from './taplink.helpers';
import type { TaplinkBuilderActions, TaplinkSelection } from './taplink.types';

export default function TaplinkBlockList({
  blocks,
  activeLocale,
  selected,
  busy,
  actions,
}: {
  blocks: TaplinkBlock[];
  activeLocale: TaplinkLocale;
  selected: TaplinkSelection;
  busy: boolean;
  actions: TaplinkBuilderActions;
}) {
  const { t } = useI18n();
  const { confirm } = useFeedback();
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const remove = async (block: TaplinkBlock) => {
    if (
      !(await confirm({
        title: t('taplink.deleteTitle'),
        body: t('taplink.deleteBody', { name: taplinkBlockName(block, activeLocale) }),
        confirmLabel: t('common.delete'),
        destructive: true,
      }))
    )
      return;
    actions.removeBlock(block.id);
  };

  return (
    <section className="card taplink-block-panel" aria-labelledby="taplink-blocks-title">
      <div className="taplink-panel-heading">
        <div>
          <h2 id="taplink-blocks-title">{t('taplink.blocks')}</h2>
          <p>{t('taplink.blocksHint')}</p>
        </div>
      </div>

      <div className="taplink-add-buttons">
        <button
          type="button"
          className="btn-outline taplink-add-button"
          onClick={() => actions.addBlock('section')}
          disabled={busy}
        >
          <Plus aria-hidden="true" size={16} />
          <Heading aria-hidden="true" size={17} />
          {t('taplink.addSection')}
        </button>
        <button
          type="button"
          className="btn-outline taplink-add-button"
          onClick={() => actions.addBlock('link')}
          disabled={busy}
        >
          <Plus aria-hidden="true" size={16} />
          <Link2 aria-hidden="true" size={17} />
          {t('taplink.addLink')}
        </button>
      </div>

      <div className="taplink-block-list">
        <button
          type="button"
          className={`taplink-block-item taplink-page-item ${selected === 'page' ? 'is-selected' : ''}`}
          onClick={() => actions.select('page')}
          aria-pressed={selected === 'page'}
        >
          <span className="taplink-block-kind">
            <FileText aria-hidden="true" size={18} />
          </span>
          <span className="taplink-block-copy">
            <strong>{t('taplink.header')}</strong>
            <small>{t('taplink.pageSettingsHint')}</small>
          </span>
        </button>

        {blocks.length === 0 ? (
          <p className="taplink-empty-blocks">{t('taplink.emptyBlocks')}</p>
        ) : (
          blocks.map((block, index) => {
            const BlockIcon = block.type === 'section' ? Heading : Link2;
            const selectedBlock = selected === block.id;
            return (
              <article
                key={block.id}
                className={`taplink-block-item ${selectedBlock ? 'is-selected' : ''} ${!block.enabled ? 'is-disabled' : ''} ${draggingId === block.id ? 'is-dragging' : ''}`}
                onDragOver={(event) => {
                  if (draggingId && draggingId !== block.id) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceId = draggingId || event.dataTransfer.getData('text/plain');
                  if (sourceId) actions.reorderBlock(sourceId, block.id);
                  setDraggingId(null);
                }}
              >
                <span
                  className="taplink-drag-handle"
                  title={t('taplink.drag')}
                  aria-hidden="true"
                  draggable={!busy}
                  onDragStart={(event) => {
                    setDraggingId(block.id);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', block.id);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                >
                  <GripVertical size={18} />
                </span>
                <button
                  type="button"
                  className="taplink-block-select"
                  onClick={() => actions.select(block.id)}
                  aria-pressed={selectedBlock}
                >
                  <span className="taplink-block-kind">
                    <BlockIcon aria-hidden="true" size={17} />
                  </span>
                  <span className="taplink-block-copy">
                    <strong>{taplinkBlockName(block, activeLocale)}</strong>
                    <small>
                      {t(block.type === 'section' ? 'taplink.section' : 'taplink.link')}
                      {!block.enabled ? ` · ${t('taplink.hidden')}` : ''}
                    </small>
                  </span>
                </button>
                <div className="taplink-block-controls">
                  <button
                    type="button"
                    className="icon-button icon-button-sm"
                    onClick={() => actions.moveBlock(block.id, -1)}
                    disabled={busy || index === 0}
                    aria-label={t('taplink.moveUp')}
                    title={t('taplink.moveUp')}
                  >
                    <ArrowUp aria-hidden="true" size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button-sm"
                    onClick={() => actions.moveBlock(block.id, 1)}
                    disabled={busy || index === blocks.length - 1}
                    aria-label={t('taplink.moveDown')}
                    title={t('taplink.moveDown')}
                  >
                    <ArrowDown aria-hidden="true" size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button-sm"
                    onClick={() => actions.duplicateBlock(block.id)}
                    disabled={busy}
                    aria-label={t('taplink.duplicate')}
                    title={t('taplink.duplicate')}
                  >
                    <Copy aria-hidden="true" size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button-sm icon-button-danger"
                    onClick={() => void remove(block)}
                    disabled={busy}
                    aria-label={t('taplink.delete')}
                    title={t('taplink.delete')}
                  >
                    <Trash2 aria-hidden="true" size={15} />
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
