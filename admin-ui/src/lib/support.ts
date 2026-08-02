import type { SupportMessage } from './api';

export const CLOSED_SUPPORT_STATUSES = new Set(['resolved', 'rejected']);

export function latestPublicSupportMessage(messages: SupportMessage[]) {
  return [...messages].reverse().find((message) => !message.internal) ?? null;
}

export function publicSupportDraft(reply: string, internal: boolean) {
  return internal ? '' : reply.trim();
}

export function canCloseSupportRequest(
  messages: SupportMessage[],
  reply: string,
  internal: boolean,
) {
  if (publicSupportDraft(reply, internal)) return true;
  return latestPublicSupportMessage(messages)?.senderType === 'admin';
}
