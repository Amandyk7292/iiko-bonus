import {
  Archive,
  Bot,
  BookOpenText,
  BookmarkPlus,
  Check,
  CheckCheck,
  ChevronLeft,
  CircleAlert,
  Clock3,
  FileText,
  Inbox,
  LoaderCircle,
  MemoryStick,
  MessageCircle,
  Mic,
  Pencil,
  Plus,
  Save,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import PageState from '../../components/PageState';
import WhatsAppStatusPanel from '../WhatsAppStatusPanel';
import {
  categoryLabels,
  conversationName,
  formatDateTime,
  formatMessageTime,
  formatVoiceDuration,
  initials,
  statusLabel,
} from '../whatsapp-page.helpers';
import type { WhatsAppPageController } from './use-whatsapp-page-controller';
import WhatsAppSettingsPanel from './WhatsAppSettingsPanel';
import WhatsAppKnowledgeModal from './WhatsAppKnowledgeModal';

export default function WhatsAppPageView({ controller }: { controller: WhatsAppPageController }) {
  const {
    role,
    locale,
    canConfigure,
    canWrite,
    isConversationOnly,
    view,
    connection,
    conversations,
    selectedId,
    selectedConversation,
    messages,
    memories,
    documents,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    conversationPage,
    setConversationPage,
    conversationTotal,
    voiceMode,
    voiceSeconds,
    memoryLabel,
    setMemoryLabel,
    memoryContent,
    setMemoryContent,
    memorySourceMessageId,
    loadingOverview,
    loadingConversation,
    loadingKnowledge,
    busy,
    error,
    mobileChatOpen,
    setMobileChatOpen,
    messagesEndRef,
    conversationPageSize,
    replyText,
    updateReplyDraft,
    updateConversationQuery,
    stopVoiceRecording,
    startVoiceRecording,
    filteredUnread,
    changeView,
    selectConversation,
    sendReply,
    toggleConversationAssistant,
    toggleConversationStatus,
    prepareMemoryFromMessage,
    saveMemory,
    removeMemory,
    openCreateKnowledge,
    openEditKnowledge,
    removeKnowledge,
    refreshCurrentView,
    resetPairing,
  } = controller;

  return (
    <div className="page-stack whatsapp-console-page">
      <WhatsAppStatusPanel
        connection={connection}
        canConfigure={canConfigure}
        conversationOnly={isConversationOnly}
        unread={filteredUnread}
        busy={busy}
        onRefresh={() => void refreshCurrentView()}
        onResetPairing={() => void resetPairing()}
      />

      {!isConversationOnly && (
        <div className="whatsapp-view-tabs" role="tablist" aria-label="Разделы WhatsApp">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'inbox'}
            className={view === 'inbox' ? 'is-active' : ''}
            onClick={() => void changeView('inbox')}
          >
            <Inbox aria-hidden="true" size={18} /> Диалоги
            {filteredUnread > 0 && <span className="whatsapp-tab-count">{filteredUnread}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'knowledge'}
            className={view === 'knowledge' ? 'is-active' : ''}
            onClick={() => void changeView('knowledge')}
          >
            <BookOpenText aria-hidden="true" size={18} /> База знаний
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'settings'}
            className={view === 'settings' ? 'is-active' : ''}
            onClick={() => void changeView('settings')}
          >
            <Settings2 aria-hidden="true" size={18} /> Настройки ИИ
          </button>
        </div>
      )}

      {view === 'inbox' && (
        <section
          className={`whatsapp-workspace ${isConversationOnly ? 'is-conversation-only' : ''} ${mobileChatOpen ? 'mobile-chat-open' : ''}`}
        >
          <aside className="whatsapp-conversation-pane" aria-label="Список диалогов">
            <div className="whatsapp-pane-header">
              <div>
                <h2>Входящие</h2>
                <p>{conversationTotal} диалогов</p>
              </div>
            </div>
            <div className="whatsapp-conversation-tools">
              <label className="input-with-icon" aria-label="Поиск диалогов">
                <Search aria-hidden="true" size={17} />
                <input
                  id="whatsapp-conversation-search"
                  name="whatsappConversationSearch"
                  type="search"
                  className="input-classic"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Имя или телефон"
                  autoComplete="off"
                />
              </label>
              <div className="whatsapp-filter-row" role="group" aria-label="Фильтр статуса">
                {[
                  ['', 'Все'],
                  ['open', 'Открытые'],
                  ['closed', 'Закрытые'],
                ].map(([value, label]) => (
                  <button
                    key={value || 'all'}
                    type="button"
                    className={statusFilter === value ? 'is-active' : ''}
                    aria-pressed={statusFilter === value}
                    onClick={() => {
                      setStatusFilter(value);
                      setConversationPage(1);
                      updateConversationQuery({ status: value, page: null });
                    }}
                  >
                    <Check
                      className="whatsapp-filter-check"
                      aria-hidden="true"
                      size={14}
                      strokeWidth={3}
                    />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="whatsapp-conversation-list">
              {loadingOverview ? (
                <div className="whatsapp-list-state">
                  <LoaderCircle className="spin" size={22} /> Загружаем диалоги
                </div>
              ) : error ? (
                <div className="whatsapp-list-state whatsapp-list-error">
                  <CircleAlert size={22} /> {error}
                </div>
              ) : conversations.length === 0 ? (
                <div className="whatsapp-list-state">
                  <MessageCircle size={24} />
                  <strong>Сообщений пока нет</strong>
                  <span>Новый клиент появится здесь после обращения в WhatsApp.</span>
                </div>
              ) : (
                conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    className={`whatsapp-conversation-item ${selectedId === conversation.id ? 'is-active' : ''}`}
                    aria-current={selectedId === conversation.id ? 'true' : undefined}
                    onClick={() => void selectConversation(conversation.id)}
                  >
                    <span className="whatsapp-avatar" aria-hidden="true">
                      {initials(conversation)}
                    </span>
                    <span className="whatsapp-conversation-summary">
                      <span className="whatsapp-conversation-name">
                        {conversationName(conversation)}
                      </span>
                      <span className="whatsapp-conversation-preview">
                        {conversation.lastMessagePreview || 'Диалог создан'}
                      </span>
                    </span>
                    <span className="whatsapp-conversation-aside">
                      <time>{formatDateTime(conversation.lastMessageAt, locale)}</time>
                      {conversation.unreadCount > 0 && (
                        <span className="whatsapp-unread-count">{conversation.unreadCount}</span>
                      )}
                      {!conversation.assistantEnabled && (
                        <UserRound aria-label="Режим оператора" size={15} />
                      )}
                    </span>
                  </button>
                ))
              )}
            </div>
            {conversationTotal > conversationPageSize && (
              <div className="whatsapp-conversation-pagination">
                <button
                  type="button"
                  className="btn-outline"
                  disabled={conversationPage <= 1 || loadingOverview}
                  onClick={() => {
                    const next = Math.max(1, conversationPage - 1);
                    setConversationPage(next);
                    updateConversationQuery({ page: next === 1 ? null : next });
                  }}
                >
                  Назад
                </button>
                <span>
                  {conversationPage} / {Math.ceil(conversationTotal / conversationPageSize)}
                </span>
                <button
                  type="button"
                  className="btn-outline"
                  disabled={
                    conversationPage >= Math.ceil(conversationTotal / conversationPageSize) ||
                    loadingOverview
                  }
                  onClick={() => {
                    const next = conversationPage + 1;
                    setConversationPage(next);
                    updateConversationQuery({ page: next });
                  }}
                >
                  Далее
                </button>
              </div>
            )}
          </aside>

          <article className="whatsapp-chat-pane">
            {!selectedId ? (
              <PageState
                type="empty"
                title="Выберите диалог"
                description="Здесь появится переписка с клиентом и поле ответа оператора."
              />
            ) : loadingConversation && !selectedConversation ? (
              <PageState type="loading" title="Открываем переписку" />
            ) : selectedConversation ? (
              <>
                <header className="whatsapp-chat-header">
                  <button
                    type="button"
                    className="icon-button whatsapp-mobile-back"
                    onClick={() => setMobileChatOpen(false)}
                    aria-label="К списку диалогов"
                    title="К списку диалогов"
                  >
                    <ChevronLeft aria-hidden="true" size={21} />
                  </button>
                  <span className="whatsapp-avatar" aria-hidden="true">
                    {initials(selectedConversation)}
                  </span>
                  <div className="whatsapp-chat-person">
                    <h2>{conversationName(selectedConversation)}</h2>
                    <p>
                      {selectedConversation.phone || 'Номер скрыт'} ·{' '}
                      {statusLabel(selectedConversation.status)}
                    </p>
                  </div>
                  <div className="whatsapp-chat-actions">
                    {!isConversationOnly && (
                      <button
                        type="button"
                        className={`btn-outline compact-button ${selectedConversation.assistantEnabled ? 'is-assistant-active' : ''}`}
                        onClick={() => void toggleConversationAssistant()}
                        disabled={!canWrite || busy === 'conversation-assistant'}
                        aria-label={
                          selectedConversation.assistantEnabled
                            ? 'Передать ответы оператору'
                            : 'Включить ответы ИИ'
                        }
                        title={
                          selectedConversation.assistantEnabled
                            ? 'Передать ответы оператору'
                            : 'Включить ответы ИИ'
                        }
                      >
                        {selectedConversation.assistantEnabled ? (
                          <Bot aria-hidden="true" size={17} />
                        ) : (
                          <UserRound aria-hidden="true" size={17} />
                        )}
                        {selectedConversation.assistantEnabled
                          ? 'ИИ отвечает'
                          : 'Оператор отвечает'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => void toggleConversationStatus()}
                      disabled={!canWrite || busy === 'conversation-status'}
                      aria-label={
                        selectedConversation.status === 'closed'
                          ? 'Открыть диалог'
                          : 'Закрыть диалог'
                      }
                      title={
                        selectedConversation.status === 'closed'
                          ? 'Открыть диалог'
                          : 'Закрыть диалог'
                      }
                    >
                      <Archive aria-hidden="true" size={19} />
                    </button>
                  </div>
                </header>

                <div className="whatsapp-message-stream" aria-live="polite">
                  {messages.length === 0 ? (
                    <div className="whatsapp-chat-empty">
                      <MessageCircle size={28} />
                      <span>В этом диалоге пока нет сохранённых сообщений.</span>
                    </div>
                  ) : (
                    messages.map((message) => (
                      <div
                        key={message.id}
                        className={`whatsapp-message-row whatsapp-message-${message.direction}`}
                      >
                        <div
                          className={`whatsapp-message-bubble whatsapp-sender-${message.senderType}`}
                        >
                          <div className="whatsapp-message-author">
                            {message.senderType === 'customer'
                              ? 'Клиент'
                              : message.senderType === 'operator'
                                ? 'Оператор'
                                : 'Ассистент'}
                          </div>
                          <p>{message.content}</p>
                          <div className="whatsapp-message-meta">
                            <time>{formatMessageTime(message.createdAt, locale)}</time>
                            {message.direction === 'outbound' &&
                              (message.deliveryStatus === 'pending' ? (
                                <Clock3 aria-label="В очереди на отправку" size={15} />
                              ) : message.deliveryStatus === 'failed' ? (
                                <CircleAlert aria-label="Не удалось отправить" size={15} />
                              ) : (
                                <CheckCheck aria-label={message.deliveryStatus} size={15} />
                              ))}
                            {!isConversationOnly && (
                              <button
                                type="button"
                                onClick={() => prepareMemoryFromMessage(message)}
                                aria-label="Сохранить сообщение в память"
                                title="Сохранить сообщение в память"
                              >
                                <BookmarkPlus aria-hidden="true" size={15} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <form className="whatsapp-composer" onSubmit={sendReply}>
                  {!selectedConversation.assistantEnabled && (
                    <p className="whatsapp-operator-note">
                      <UserRound aria-hidden="true" size={15} /> Режим оператора. ИИ не ответит
                      параллельно.
                    </p>
                  )}
                  {voiceMode === 'idle' ? (
                    <div className="whatsapp-composer-row">
                      <label className="sr-only" htmlFor="whatsapp-reply">
                        Ответ клиенту
                      </label>
                      <textarea
                        id="whatsapp-reply"
                        name="whatsappReply"
                        value={replyText}
                        onChange={(event) => updateReplyDraft(selectedId, event.target.value)}
                        placeholder={
                          canWrite ? 'Напишите ответ клиенту' : 'У вас доступ только для просмотра'
                        }
                        autoComplete="off"
                        disabled={
                          !canWrite || Boolean(busy) || selectedConversation.id !== selectedId
                        }
                        maxLength={10000}
                        rows={2}
                      />
                      <button
                        type="button"
                        className="icon-button whatsapp-voice-button"
                        onClick={() => void startVoiceRecording()}
                        disabled={!canWrite || Boolean(busy)}
                        aria-label="Записать голосовое"
                        title="Записать голосовое"
                      >
                        <Mic aria-hidden="true" size={20} />
                      </button>
                      <button
                        type="submit"
                        className="btn-classic whatsapp-send-button"
                        disabled={
                          !canWrite ||
                          !replyText.trim() ||
                          Boolean(busy) ||
                          selectedConversation.id !== selectedId
                        }
                        aria-label="Отправить сообщение"
                        title="Отправить сообщение"
                      >
                        {busy === 'reply' ? (
                          <LoaderCircle className="spin" size={19} />
                        ) : (
                          <Send aria-hidden="true" size={19} />
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className={`whatsapp-voice-recorder is-${voiceMode}`} role="status">
                      <span className="whatsapp-recording-dot" aria-hidden="true" />
                      <strong>{formatVoiceDuration(voiceSeconds)}</strong>
                      <span className="whatsapp-voice-recorder-label">
                        {voiceMode === 'sending' ? 'Отправляем голосовое' : 'Идёт запись'}
                      </span>
                      <button
                        type="button"
                        className="icon-button whatsapp-voice-cancel"
                        onClick={() => stopVoiceRecording(false)}
                        disabled={voiceMode === 'sending'}
                        aria-label="Отменить голосовое"
                        title="Отменить голосовое"
                      >
                        <X aria-hidden="true" size={20} />
                      </button>
                      <button
                        type="button"
                        className="btn-classic whatsapp-send-button"
                        onClick={() => stopVoiceRecording(true)}
                        disabled={voiceMode === 'sending'}
                        aria-label="Отправить голосовое"
                        title="Отправить голосовое"
                      >
                        {voiceMode === 'sending' ? (
                          <LoaderCircle className="spin" size={19} />
                        ) : (
                          <Send aria-hidden="true" size={19} />
                        )}
                      </button>
                    </div>
                  )}
                </form>
              </>
            ) : null}
          </article>

          {!isConversationOnly && (
            <aside className="whatsapp-memory-pane" aria-label="Память клиента">
              <div className="whatsapp-pane-header">
                <div>
                  <h2>Память клиента</h2>
                  <p>Подтверждённые факты для будущих ответов</p>
                </div>
                <MemoryStick aria-hidden="true" size={20} />
              </div>
              {!selectedConversation ? (
                <div className="whatsapp-memory-empty">Выберите диалог, чтобы увидеть заметки.</div>
              ) : (
                <>
                  <div className="whatsapp-memory-list">
                    {memories.length === 0 ? (
                      <div className="whatsapp-memory-empty">
                        Память пока пуста. Сохраните важный факт из переписки или добавьте заметку.
                      </div>
                    ) : (
                      memories.map((memory) => (
                        <article key={memory.id} className="whatsapp-memory-item">
                          <div>
                            <strong>{memory.label}</strong>
                            <p>{memory.content}</p>
                          </div>
                          <button
                            type="button"
                            className="icon-button icon-button-sm icon-button-danger"
                            onClick={() => void removeMemory(memory)}
                            disabled={!canWrite}
                            aria-label="Удалить заметку"
                            title="Удалить заметку"
                          >
                            <Trash2 aria-hidden="true" size={16} />
                          </button>
                        </article>
                      ))
                    )}
                  </div>
                  <form className="whatsapp-memory-form" onSubmit={saveMemory}>
                    <label className="field-label" htmlFor="whatsapp-memory-label">
                      Название заметки
                    </label>
                    <input
                      id="whatsapp-memory-label"
                      className="input-classic"
                      value={memoryLabel}
                      onChange={(event) => setMemoryLabel(event.target.value)}
                      maxLength={120}
                      disabled={!canWrite}
                    />
                    <label className="field-label" htmlFor="whatsapp-memory-content">
                      Что запомнить
                    </label>
                    <textarea
                      id="whatsapp-memory-content"
                      className="input-classic"
                      value={memoryContent}
                      onChange={(event) => setMemoryContent(event.target.value)}
                      maxLength={2000}
                      rows={4}
                      placeholder="Например: предпочитает хлеб без орехов"
                      disabled={!canWrite}
                    />
                    {memorySourceMessageId && (
                      <p className="field-hint">Текст взят из выбранного сообщения.</p>
                    )}
                    <button
                      type="submit"
                      className="btn-outline"
                      disabled={!canWrite || !memoryContent.trim() || busy === 'memory'}
                    >
                      {busy === 'memory' ? (
                        <LoaderCircle className="spin" size={17} />
                      ) : (
                        <Save aria-hidden="true" size={17} />
                      )}{' '}
                      Сохранить в память
                    </button>
                  </form>
                </>
              )}
            </aside>
          )}
        </section>
      )}

      {view === 'knowledge' && (
        <section className="whatsapp-knowledge-view">
          <div className="whatsapp-section-heading">
            <div>
              <h2>Информация для ассистента</h2>
              <p>
                Добавьте правила, условия доставки, ответы на частые вопросы и подтверждённые факты
                о Bulka.
              </p>
            </div>
            {canConfigure && (
              <button type="button" className="btn-classic" onClick={openCreateKnowledge}>
                <Plus aria-hidden="true" size={18} /> Добавить материал
              </button>
            )}
          </div>
          <div className="whatsapp-knowledge-note">
            <ShieldCheck aria-hidden="true" size={21} />
            <div>
              <strong>Только подтверждённая информация</strong>
              <p>Ассистент использует активные материалы вместе с меню iiko и данными филиалов.</p>
            </div>
          </div>
          {loadingKnowledge ? (
            <PageState type="loading" title="Загружаем базу знаний" />
          ) : documents.length === 0 ? (
            <PageState
              type="empty"
              title="База знаний пока пуста"
              description="Создайте первый материал, например правила предзаказа или ответы по аллергенам."
              action={
                canConfigure ? (
                  <button type="button" className="btn-classic" onClick={openCreateKnowledge}>
                    Добавить материал
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="whatsapp-knowledge-list">
              {documents.map((document) => (
                <article
                  key={document.id}
                  className={`whatsapp-knowledge-item ${!document.isActive ? 'is-muted' : ''}`}
                >
                  <div className="whatsapp-knowledge-icon">
                    <FileText aria-hidden="true" size={21} />
                  </div>
                  <div className="whatsapp-knowledge-content">
                    <div className="whatsapp-knowledge-title-row">
                      <h3>{document.title}</h3>
                      <span>{categoryLabels[document.category] || document.category}</span>
                      <span
                        className={document.isActive ? 'knowledge-active' : 'knowledge-inactive'}
                      >
                        {document.isActive ? 'Используется' : 'Выключен'}
                      </span>
                    </div>
                    <p>{document.content}</p>
                    <time>Обновлено {formatDateTime(document.updatedAt, locale)}</time>
                  </div>
                  {canConfigure && (
                    <div className="whatsapp-knowledge-actions">
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => openEditKnowledge(document)}
                        aria-label="Редактировать материал"
                        title="Редактировать материал"
                      >
                        <Pencil aria-hidden="true" size={18} />
                      </button>
                      <button
                        type="button"
                        className="icon-button icon-button-danger"
                        onClick={() => void removeKnowledge(document)}
                        aria-label="Удалить материал"
                        title="Удалить материал"
                      >
                        <Trash2 aria-hidden="true" size={18} />
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <WhatsAppSettingsPanel controller={controller} />
      <WhatsAppKnowledgeModal controller={controller} />
    </div>
  );
}
