import { describe, expect, it } from 'vitest';
import type { SupportMessage } from './api';
import {
  canCloseSupportRequest,
  latestPublicSupportMessage,
  publicSupportDraft,
} from './support';

const message = (
  senderType: SupportMessage['senderType'],
  body: string,
  internal = false,
): SupportMessage => ({
  id: crypto.randomUUID(),
  requestId: 'request-1',
  senderType,
  senderId: senderType === 'admin' ? 'admin' : 'customer-1',
  body,
  attachments: [],
  internal,
  createdAt: new Date().toISOString(),
});

describe('support closure rules', () => {
  it('allows closure when the latest public message is an admin reply', () => {
    const messages = [
      message('customer', 'Помогите'),
      message('admin', 'Проблема решена'),
      message('admin', 'Служебная заметка', true),
    ];

    expect(latestPublicSupportMessage(messages)?.body).toBe('Проблема решена');
    expect(canCloseSupportRequest(messages, '', false)).toBe(true);
  });

  it('requires another reply when the customer wrote last', () => {
    const messages = [
      message('admin', 'Первый ответ'),
      message('customer', 'У меня остался вопрос'),
      message('admin', 'Внутренняя заметка', true),
    ];

    expect(canCloseSupportRequest(messages, '', false)).toBe(false);
    expect(canCloseSupportRequest(messages, 'Новый ответ', false)).toBe(true);
  });

  it('never treats an internal draft as a customer reply', () => {
    expect(publicSupportDraft('Только для сотрудников', true)).toBe('');
    expect(
      canCloseSupportRequest([message('customer', 'Нужен ответ')], 'Служебная заметка', true),
    ).toBe(false);
  });
});
