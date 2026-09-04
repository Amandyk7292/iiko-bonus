import { describe, expect, it } from 'vitest';
import type { WhatsAppAssistantSettings } from '../lib/api';
import { whatsappSettingsUpdatePayload } from './whatsapp-page.helpers';

const settings: WhatsAppAssistantSettings = {
  assistantEnabled: false,
  autoReplyEnabled: true,
  memoryEnabled: false,
  provider: 'gemini',
  model: 'gemini-3.1-flash-lite',
  keyConfigured: true,
  providerKeys: { gemini: true, qwen: false, deepseek: false },
  botName: 'Ассистент Bulka',
  tone: 'warm',
  supportedLanguages: ['ru', 'kk'],
  historyMessages: 12,
  businessDescription: 'Пекарня Bulka',
  customInstructions: 'Не обещать наличие без проверки',
  welcomeMessage: 'Здравствуйте!',
  fallbackMessage: 'Подключаем оператора.',
  storageReady: true,
  updatedAt: '2026-09-04T06:00:00.000Z',
};

describe('whatsappSettingsUpdatePayload', () => {
  it('sends only fields accepted by the strict settings update contract', () => {
    expect(whatsappSettingsUpdatePayload(settings)).toEqual({
      assistantEnabled: false,
      autoReplyEnabled: true,
      memoryEnabled: false,
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite',
      botName: 'Ассистент Bulka',
      tone: 'warm',
      supportedLanguages: ['ru', 'kk'],
      historyMessages: 12,
      businessDescription: 'Пекарня Bulka',
      customInstructions: 'Не обещать наличие без проверки',
      welcomeMessage: 'Здравствуйте!',
      fallbackMessage: 'Подключаем оператора.',
    });
  });
});
