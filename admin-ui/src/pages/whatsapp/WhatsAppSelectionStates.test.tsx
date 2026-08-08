import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  WhatsAppAssistantSettings,
  WhatsAppConversation,
  WhatsAppMessage,
} from '../../lib/api';
import { I18nProvider } from '../../lib/i18n';
import WhatsAppPageView from './WhatsAppPageView';
import WhatsAppSettingsPanel from './WhatsAppSettingsPanel';
import type { WhatsAppPageController } from './use-whatsapp-page-controller';

const settings: WhatsAppAssistantSettings = {
  assistantEnabled: false,
  autoReplyEnabled: true,
  memoryEnabled: true,
  provider: 'gemini',
  model: 'gemini-3.1-flash-lite',
  keyConfigured: true,
  providerKeys: { gemini: true, qwen: false, deepseek: false },
  botName: 'Bulka',
  tone: 'friendly',
  supportedLanguages: ['ru', 'kk'],
  historyMessages: 12,
  businessDescription: 'Пекарня Bulka',
  customInstructions: '',
  welcomeMessage: 'Здравствуйте',
  fallbackMessage: 'Передаём оператору',
  storageReady: true,
  updatedAt: '2026-08-08T08:00:00.000Z',
};

const conversation: WhatsAppConversation = {
  id: 'conversation-1',
  chatJid: '77010000001@s.whatsapp.net',
  phone: '77010000001',
  displayName: 'Амандық',
  status: 'open',
  assistantEnabled: true,
  contextResetAt: null,
  unreadCount: 2,
  lastMessagePreview: 'Здравствуйте',
  lastMessageAt: '2026-08-08T08:00:00.000Z',
  lastCustomerMessageAt: '2026-08-08T08:00:00.000Z',
  lastOperatorMessageAt: null,
  createdAt: '2026-08-08T07:00:00.000Z',
  updatedAt: '2026-08-08T08:00:00.000Z',
};

const message: WhatsAppMessage = {
  id: 'message-1',
  conversationId: conversation.id,
  whatsappMessageId: 'wamid-1',
  outboxId: null,
  direction: 'inbound',
  senderType: 'customer',
  content: 'Мне нужен заказ',
  deliveryStatus: 'received',
  createdAt: '2026-08-08T08:00:00.000Z',
};

function createController(
  overrides: Partial<WhatsAppPageController> = {},
): WhatsAppPageController {
  return {
    role: 'admin',
    locale: 'ru',
    canConfigure: true,
    canWrite: true,
    isConversationOnly: false,
    view: 'inbox',
    connection: null,
    settings,
    settingsDraft: settings,
    setSettingsDraft: vi.fn(),
    providerApiKey: 'secret-key',
    setProviderApiKey: vi.fn(),
    showProviderApiKey: false,
    setShowProviderApiKey: vi.fn(),
    conversations: [conversation],
    selectedId: conversation.id,
    selectedConversation: conversation,
    messages: [message],
    memories: [],
    documents: [],
    search: '',
    setSearch: vi.fn(),
    statusFilter: 'open',
    setStatusFilter: vi.fn(),
    conversationPage: 1,
    setConversationPage: vi.fn(),
    conversationTotal: 1,
    voiceMode: 'idle',
    voiceSeconds: 0,
    memoryLabel: '',
    setMemoryLabel: vi.fn(),
    memoryContent: '',
    setMemoryContent: vi.fn(),
    memorySourceMessageId: '',
    loadingOverview: false,
    loadingConversation: false,
    loadingKnowledge: false,
    busy: '',
    error: '',
    mobileChatOpen: false,
    setMobileChatOpen: vi.fn(),
    knowledgeModalOpen: false,
    editingKnowledgeId: '',
    knowledgeDraft: { title: '', category: 'general', content: '', isActive: true },
    setKnowledgeDraft: vi.fn(),
    messagesEndRef: { current: null },
    conversationPageSize: 50,
    replyText: '',
    updateReplyDraft: vi.fn(),
    updateConversationQuery: vi.fn(),
    stopVoiceRecording: vi.fn(),
    startVoiceRecording: vi.fn(),
    filteredUnread: 2,
    selectedProvider: 'gemini',
    activeProviderKeyConfigured: true,
    changeView: vi.fn(),
    selectConversation: vi.fn(),
    sendReply: vi.fn(),
    toggleConversationAssistant: vi.fn(),
    toggleConversationStatus: vi.fn(),
    prepareMemoryFromMessage: vi.fn(),
    saveMemory: vi.fn(),
    removeMemory: vi.fn(),
    openCreateKnowledge: vi.fn(),
    openEditKnowledge: vi.fn(),
    closeKnowledgeModal: vi.fn(),
    saveKnowledge: vi.fn(),
    removeKnowledge: vi.fn(),
    saveSettings: vi.fn(),
    changeProvider: vi.fn(),
    toggleLanguage: vi.fn(),
    refreshCurrentView: vi.fn(),
    resetPairing: vi.fn(),
    ...overrides,
  } as unknown as WhatsAppPageController;
}

describe('WhatsApp selected and icon control states', () => {
  it('announces active filters and the current conversation, and titles icon-only actions', () => {
    render(
      <I18nProvider>
        <WhatsAppPageView controller={createController()} />
      </I18nProvider>,
    );

    expect(screen.getByRole('button', { name: 'Все' })).toHaveAttribute('aria-pressed', 'false');
    const openFilter = screen.getByRole('button', { name: 'Открытые' });
    expect(openFilter).toHaveAttribute('aria-pressed', 'true');
    expect(openFilter.querySelector('.whatsapp-filter-check')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /Амандық/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Закрыть диалог' })).toHaveAttribute(
      'title',
      'Закрыть диалог',
    );
    expect(screen.getByRole('button', { name: 'Сохранить сообщение в память' })).toHaveAttribute(
      'title',
      'Сохранить сообщение в память',
    );
    expect(screen.getByRole('button', { name: 'Отправить сообщение' })).toHaveAttribute(
      'title',
      'Отправить сообщение',
    );
  });

  it('renders a visible custom checkbox marker for every language and titles the API eye control', () => {
    render(
      <WhatsAppSettingsPanel
        controller={createController({ view: 'settings', selectedId: '', selectedConversation: null })}
      />,
    );

    const russian = screen.getByRole('checkbox', { name: 'Русский' });
    const english = screen.getByRole('checkbox', { name: 'English' });
    expect(russian).toBeChecked();
    expect(english).not.toBeChecked();
    expect(russian.closest('label')?.querySelector('.whatsapp-language-check')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Показать API-ключ' })).toHaveAttribute(
      'title',
      'Показать API-ключ',
    );
  });

  it('keeps audited WhatsApp controls at least 44px and exposes visible focus/current markers', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/styles/whatsapp.css'),
      'utf8',
    );

    expect(css).toMatch(/\.whatsapp-filter-row button\s*\{[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/\.whatsapp-message-meta button\s*\{[^}]*height:\s*44px/s);
    expect(css).toMatch(/\.whatsapp-memory-form \.btn-outline\s*\{[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/\.whatsapp-secret-input button\s*\{[^}]*min-height:\s*44px/s);
    expect(css).toContain('.whatsapp-conversation-item.is-active::before');
    expect(css).toContain(':where(button, a, input, select, textarea):focus-visible');
  });
});
