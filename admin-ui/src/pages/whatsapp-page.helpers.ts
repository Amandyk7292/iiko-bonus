import type {
  WhatsAppAssistantSettings,
  WhatsAppAssistantSettingsUpdate,
  WhatsAppConnectionStatus,
  WhatsAppConversation,
  WhatsAppKnowledgeDocument,
} from '../lib/api';

export type ConsoleView = 'inbox' | 'knowledge' | 'settings';
export type VoiceMode = 'idle' | 'recording' | 'sending';
export type KnowledgeDraft = Pick<
  WhatsAppKnowledgeDocument,
  'title' | 'category' | 'content' | 'isActive'
>;

export function whatsappSettingsUpdatePayload(
  settings: WhatsAppAssistantSettings,
): WhatsAppAssistantSettingsUpdate {
  return {
    assistantEnabled: settings.assistantEnabled,
    autoReplyEnabled: settings.autoReplyEnabled,
    memoryEnabled: settings.memoryEnabled,
    provider: settings.provider,
    model: settings.model,
    botName: settings.botName,
    tone: settings.tone,
    supportedLanguages: settings.supportedLanguages,
    historyMessages: settings.historyMessages,
    businessDescription: settings.businessDescription,
    customInstructions: settings.customInstructions,
    welcomeMessage: settings.welcomeMessage,
    fallbackMessage: settings.fallbackMessage,
  };
}

export const emptyKnowledgeDraft = (): KnowledgeDraft => ({
  title: '',
  category: 'general',
  content: '',
  isActive: true,
});

export const categoryLabels: Record<string, string> = {
  general: 'Общее',
  menu: 'Меню',
  delivery: 'Доставка',
  loyalty: 'Бонусы',
  locations: 'Филиалы',
  policies: 'Правила',
};

export const toneLabels: Record<WhatsAppAssistantSettings['tone'], string> = {
  friendly: 'Дружелюбный',
  warm: 'Тёплый',
  concise: 'Краткий',
  formal: 'Официальный',
};

export const providerLabels: Record<WhatsAppAssistantSettings['provider'], string> = {
  gemini: 'Gemini',
  qwen: 'Qwen',
  deepseek: 'DeepSeek',
};

export const providerModels: Record<WhatsAppAssistantSettings['provider'], string[]> = {
  gemini: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'],
  qwen: ['qwen-flash', 'qwen3.6-flash'],
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'],
};

export const providerDescriptions: Record<WhatsAppAssistantSettings['provider'], string> = {
  gemini: 'Flash-Lite доступен во Free Tier. Лимиты определяются проектом Google AI Studio.',
  qwen: 'Используется международный API Alibaba Model Studio. Бесплатная квота зависит от аккаунта.',
  deepseek:
    'Официальный DeepSeek API может тарифицироваться. Бесплатный баланс зависит от аккаунта.',
};

const localeTags = { ru: 'ru-KZ', kk: 'kk-KZ', en: 'en-KZ' } as const;
export const maxVoiceSeconds = 120;

export function newClientMessageId() {
  return (
    globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function formatVoiceDuration(seconds: number) {
  const bounded = Math.max(0, Math.min(maxVoiceSeconds, Math.round(seconds)));
  return `${Math.floor(bounded / 60)}:${String(bounded % 60).padStart(2, '0')}`;
}

export function preferredVoiceMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return (
    ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((type) =>
      MediaRecorder.isTypeSupported(type),
    ) || ''
  );
}

export function formatDateTime(value: string | null, locale: keyof typeof localeTags) {
  if (!value) return 'Нет данных';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Нет данных';
  return new Intl.DateTimeFormat(localeTags[locale], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatMessageTime(value: string, locale: keyof typeof localeTags) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(localeTags[locale], {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function conversationName(conversation: WhatsAppConversation) {
  return conversation.displayName || conversation.phone || 'Клиент WhatsApp';
}

export function initials(conversation: WhatsAppConversation) {
  const name = conversationName(conversation).replace(/^\+/, '').trim();
  return name.slice(0, 2).toUpperCase() || 'WA';
}

export function connectionCopy(
  connection: WhatsAppConnectionStatus | null,
  canManagePairing: boolean,
) {
  if (!connection) return { title: 'Проверяем WhatsApp', detail: 'Получаем состояние подключения' };
  const copy: Record<string, { title: string; detail: string }> = {
    connected: {
      title: 'WhatsApp подключён',
      detail: connection.phone || 'Сессия готова принимать сообщения',
    },
    awaiting_scan: {
      title: 'Нужно связать WhatsApp',
      detail: 'Отсканируйте QR-код телефоном с рабочим номером',
    },
    connecting: { title: 'Подключение', detail: 'Сервер устанавливает защищённую сессию' },
    reconnecting: {
      title: 'Переподключение',
      detail: 'Сообщения появятся после восстановления связи',
    },
    logged_out: {
      title: 'WhatsApp вышел из аккаунта',
      detail: canManagePairing
        ? 'Сервер автоматически готовит новый QR-код'
        : 'Сообщите владельцу, чтобы он повторно подключил номер',
    },
    error: { title: 'Ошибка подключения', detail: connection.lastError || 'Проверьте сервер' },
    starting: { title: 'Запуск WhatsApp', detail: 'Сервис готовится к работе' },
  };
  return copy[connection.state] || copy.starting;
}

export function statusLabel(status: WhatsAppConversation['status']) {
  if (status === 'closed') return 'Закрыт';
  if (status === 'spam') return 'Спам';
  return 'Открыт';
}
