import { LoaderCircle, Save } from 'lucide-react';
import Modal from '../../components/Modal';
import { categoryLabels } from '../whatsapp-page.helpers';
import type { WhatsAppPageController } from './use-whatsapp-page-controller';

export default function WhatsAppKnowledgeModal({
  controller,
}: {
  controller: WhatsAppPageController;
}) {
  const {
    busy,
    knowledgeModalOpen,
    editingKnowledgeId,
    knowledgeDraft,
    setKnowledgeDraft,
    closeKnowledgeModal,
    saveKnowledge,
  } = controller;

  return (
    <Modal
      open={knowledgeModalOpen}
      title={editingKnowledgeId ? 'Редактировать материал' : 'Новый материал'}
      description="Ассистент использует только активные материалы."
      onClose={() => void closeKnowledgeModal()}
      size="lg"
    >
      <form className="form-stack" onSubmit={saveKnowledge}>
        <div className="form-grid form-grid-2">
          <div className="field-group">
            <label className="field-label" htmlFor="knowledge-title">
              Название
            </label>
            <input
              id="knowledge-title"
              className="input-classic"
              autoFocus
              value={knowledgeDraft.title}
              onChange={(event) =>
                setKnowledgeDraft({ ...knowledgeDraft, title: event.target.value })
              }
              maxLength={160}
              required
            />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="knowledge-category">
              Раздел
            </label>
            <select
              id="knowledge-category"
              className="input-classic"
              value={knowledgeDraft.category}
              onChange={(event) =>
                setKnowledgeDraft({ ...knowledgeDraft, category: event.target.value })
              }
            >
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="knowledge-content">
            Информация для ассистента
          </label>
          <textarea
            id="knowledge-content"
            className="input-classic"
            rows={12}
            value={knowledgeDraft.content}
            onChange={(event) =>
              setKnowledgeDraft({ ...knowledgeDraft, content: event.target.value })
            }
            maxLength={12000}
            required
            placeholder="Один материал должен описывать одну понятную тему."
          />
          <p className="field-hint">
            Не добавляйте пароли, API-ключи и персональные данные клиентов.
          </p>
        </div>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={knowledgeDraft.isActive}
            onChange={(event) =>
              setKnowledgeDraft({ ...knowledgeDraft, isActive: event.target.checked })
            }
          />
          <span className="switch-control" aria-hidden="true" />
          <span>Сразу использовать в ответах</span>
        </label>
        <div className="modal-actions">
          <button
            type="button"
            className="btn-outline px-5"
            onClick={() => void closeKnowledgeModal()}
          >
            Отмена
          </button>
          <button
            type="submit"
            className="btn-classic px-5"
            disabled={
              !knowledgeDraft.title.trim() || !knowledgeDraft.content.trim() || busy === 'knowledge'
            }
          >
            {busy === 'knowledge' ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Save aria-hidden="true" size={17} />
            )}{' '}
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}
