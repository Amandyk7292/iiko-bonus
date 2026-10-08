import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { api, type WhatsAppConversation, type WhatsAppMessage } from '../../lib/api';
import type { VoiceMode } from '../whatsapp-page.helpers';

type StateSetter<T> = Dispatch<SetStateAction<T>>;
type VoiceDeliveryOptions = {
  selectedIdRef: RefObject<string>;
  setBusy: StateSetter<string>;
  setMessages: StateSetter<WhatsAppMessage[]>;
  setSelectedConversation: StateSetter<WhatsAppConversation | null>;
  setConversations: StateSetter<WhatsAppConversation[]>;
  toast: (message: string, type?: 'success' | 'error' | 'info') => void;
  setVoiceMode: StateSetter<VoiceMode>;
  setVoiceSeconds: StateSetter<number>;
};

export function useWhatsAppVoiceDelivery({
  selectedIdRef, setBusy, setMessages, setSelectedConversation, setConversations,
  toast, setVoiceMode, setVoiceSeconds,
}: VoiceDeliveryOptions) {
  return useCallback(
    async (
      conversationId: string,
      audio: Blob,
      durationSeconds: number,
      clientMessageId: string,
    ) => {
      setBusy('voice');
      try {
        const response = await api.sendWhatsAppVoice(
          conversationId,
          audio,
          durationSeconds,
          clientMessageId,
        );
        if (selectedIdRef.current === response.conversation.id) {
          setMessages((current) => [...current, response.message]);
          setSelectedConversation(response.conversation);
        }
        setConversations((current) =>
          current.map((item) =>
            item.id === response.conversation.id ? response.conversation : item,
          ),
        );
        toast(
          response.queued
            ? 'Голосовое сохранено в очереди и отправится после подключения WhatsApp.'
            : 'Голосовое отправлено. ИИ для этого диалога поставлен на паузу.',
        );
      } catch (caught) {
        toast(caught instanceof Error ? caught.message : 'Не удалось отправить голосовое', 'error');
      } finally {
        setBusy('');
        setVoiceMode('idle');
        setVoiceSeconds(0);
      }
    },
    [toast],
  );
}
