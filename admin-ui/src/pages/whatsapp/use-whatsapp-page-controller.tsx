import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigationBlocker, useSearchParams } from '../../lib/router';
import { useFeedback } from '../../components/Feedback';
import {
  api,
  type WhatsAppAssistantSettings,
  type WhatsAppConnectionStatus,
  type WhatsAppConversation,
  type WhatsAppKnowledgeDocument,
  type WhatsAppMemory,
  type WhatsAppMessage,
} from '../../lib/api';
import { useAdminRealtimeEvents } from '../../lib/admin-realtime';
import { useI18n } from '../../lib/i18n';
import {
  emptyKnowledgeDraft,
  maxVoiceSeconds,
  newClientMessageId,
  preferredVoiceMimeType,
  providerModels,
  type ConsoleView,
  type KnowledgeDraft,
  type VoiceMode,
} from '../whatsapp-page.helpers';
import { useWhatsAppConversationQuery } from './use-whatsapp-conversation-query';

export type WhatsAppPageProps = { role?: string };

export function useWhatsAppPageController({ role = 'viewer' }: WhatsAppPageProps) {
  const { locale, t } = useI18n();
  const { toast, confirm } = useFeedback();
  const canConfigure = role === 'admin' || role === 'owner';
  const canWrite = role !== 'viewer';
  const isConversationOnly = role === 'whatsapp_operator';
  const [queryParams, setQueryParams] = useSearchParams();
  const location = useLocation();
  const [view, setView] = useState<ConsoleView>('inbox');
  const [connection, setConnection] = useState<WhatsAppConnectionStatus | null>(null);
  const [settings, setSettings] = useState<WhatsAppAssistantSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<WhatsAppAssistantSettings | null>(null);
  const [providerApiKey, setProviderApiKey] = useState('');
  const [showProviderApiKey, setShowProviderApiKey] = useState(false);
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedConversation, setSelectedConversation] = useState<WhatsAppConversation | null>(
    null,
  );
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [memories, setMemories] = useState<WhatsAppMemory[]>([]);
  const [documents, setDocuments] = useState<WhatsAppKnowledgeDocument[]>([]);
  const [conversationTotal, setConversationTotal] = useState(0);
  const [totalUnread, setTotalUnread] = useState(0);
  const {
    search,
    setSearch,
    searchQuery,
    statusFilter,
    setStatusFilter,
    conversationPage,
    setConversationPage,
    replyDrafts,
    replyText,
    updateReplyDraft,
    clearReplyDraft,
    updateConversationQuery,
  } = useWhatsAppConversationQuery({ queryParams, setQueryParams, selectedId });
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('idle');
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [memoryLabel, setMemoryLabel] = useState('Заметка о клиенте');
  const [memoryContent, setMemoryContent] = useState('');
  const [memorySourceMessageId, setMemorySourceMessageId] = useState<string | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [loadingKnowledge, setLoadingKnowledge] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [knowledgeModalOpen, setKnowledgeModalOpen] = useState(false);
  const [editingKnowledgeId, setEditingKnowledgeId] = useState<string | null>(null);
  const [knowledgeDraft, setKnowledgeDraft] = useState<KnowledgeDraft>(emptyKnowledgeDraft);
  const [knowledgeBaseline, setKnowledgeBaseline] = useState<KnowledgeDraft>(emptyKnowledgeDraft);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceActionRef = useRef<'cancel' | 'send'>('cancel');
  const voiceStartedAtRef = useRef(0);
  const voiceTimerRef = useRef<number | null>(null);
  const voiceConversationIdRef = useRef('');
  const voiceClientMessageIdRef = useRef('');
  const replyRequestRef = useRef<{
    conversationId: string;
    text: string;
    clientMessageId: string;
  } | null>(null);
  const selectedIdRef = useRef(selectedId);
  const conversationListRequestRef = useRef<{
    controller: AbortController;
    sequence: number;
  } | null>(null);
  const conversationListSequenceRef = useRef(0);
  const conversationDetailRequestRef = useRef<{
    controller: AbortController;
    sequence: number;
  } | null>(null);
  const conversationDetailSequenceRef = useRef(0);
  const conversationPageSize = 50;
  const releaseVoiceResources = useCallback(() => {
    if (voiceTimerRef.current !== null) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
  }, []);

  const stopVoiceRecording = useCallback((shouldSend: boolean) => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    voiceActionRef.current = shouldSend ? 'send' : 'cancel';
    if (voiceTimerRef.current !== null) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    setVoiceMode(shouldSend ? 'sending' : 'idle');
    try {
      recorder.requestData();
    } catch {
      // Some Safari versions do not support requestData directly before stop.
    }
    recorder.stop();
  }, []);

  const submitVoiceNote = useCallback(
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

  const startVoiceRecording = async () => {
    if (
      !selectedConversation ||
      selectedConversation.id !== selectedIdRef.current ||
      !canWrite ||
      busy ||
      voiceMode !== 'idle'
    ) {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast('Этот браузер не поддерживает запись голосовых', 'error');
      return;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const mimeType = preferredVoiceMimeType();
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, {
          ...(mimeType ? { mimeType } : {}),
          audioBitsPerSecond: 32_000,
        });
      } catch {
        recorder = new MediaRecorder(stream);
      }

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      voiceChunksRef.current = [];
      voiceActionRef.current = 'cancel';
      voiceConversationIdRef.current = selectedConversation.id;
      voiceClientMessageIdRef.current = newClientMessageId();
      voiceStartedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) voiceChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        voiceActionRef.current = 'cancel';
        releaseVoiceResources();
        setVoiceMode('idle');
        setVoiceSeconds(0);
        toast('Браузер прервал запись голосового', 'error');
      };
      recorder.onstop = () => {
        const shouldSend = voiceActionRef.current === 'send';
        const durationSeconds = Math.max(
          1,
          Math.min(maxVoiceSeconds, Math.ceil((Date.now() - voiceStartedAtRef.current) / 1000)),
        );
        const chunks = voiceChunksRef.current;
        const recordedType = recorder.mimeType || chunks[0]?.type || mimeType || 'audio/webm';
        const audio = new Blob(chunks, { type: recordedType });
        const conversationId = voiceConversationIdRef.current;
        const clientMessageId = voiceClientMessageIdRef.current || newClientMessageId();
        releaseVoiceResources();
        voiceChunksRef.current = [];
        if (!shouldSend) {
          setVoiceMode('idle');
          setVoiceSeconds(0);
          return;
        }
        if (audio.size < 16) {
          setVoiceMode('idle');
          setVoiceSeconds(0);
          toast('Запись получилась пустой. Попробуйте ещё раз.', 'error');
          return;
        }
        void submitVoiceNote(conversationId, audio, durationSeconds, clientMessageId);
      };

      recorder.start(250);
      setVoiceSeconds(0);
      setVoiceMode('recording');
      voiceTimerRef.current = window.setInterval(() => {
        const seconds = Math.min(
          maxVoiceSeconds,
          Math.ceil((Date.now() - voiceStartedAtRef.current) / 1000),
        );
        setVoiceSeconds(seconds);
        if (seconds >= maxVoiceSeconds && recorder.state === 'recording') {
          voiceActionRef.current = 'send';
          if (voiceTimerRef.current !== null) {
            window.clearInterval(voiceTimerRef.current);
            voiceTimerRef.current = null;
          }
          setVoiceMode('sending');
          recorder.stop();
        }
      }, 250);
    } catch (caught) {
      stream?.getTracks().forEach((track) => track.stop());
      releaseVoiceResources();
      setVoiceMode('idle');
      const denied = caught instanceof DOMException && caught.name === 'NotAllowedError';
      toast(
        denied
          ? 'Разрешите доступ к микрофону в настройках браузера'
          : 'Не удалось включить микрофон',
        'error',
      );
    }
  };

  useEffect(() => {
    selectedIdRef.current = selectedId;
    if (
      mediaRecorderRef.current?.state === 'recording' &&
      voiceConversationIdRef.current &&
      voiceConversationIdRef.current !== selectedId
    ) {
      stopVoiceRecording(false);
    }
  }, [selectedId, stopVoiceRecording]);

  useEffect(
    () => () => {
      voiceActionRef.current = 'cancel';
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
        recorder.stop();
      }
      conversationListRequestRef.current?.controller.abort();
      conversationDetailRequestRef.current?.controller.abort();
      releaseVoiceResources();
    },
    [releaseVoiceResources],
  );

  const loadStatus = useCallback(async () => {
    const response = await api.getWhatsAppConsoleStatus();
    setConnection(response.connection);
    if (response.settings) {
      setSettings(response.settings);
      setSettingsDraft((current) => current ?? response.settings);
    }
  }, []);

  const loadConversations = useCallback(
    async (silent = false) => {
      conversationListRequestRef.current?.controller.abort();
      const controller = new AbortController();
      const sequence = ++conversationListSequenceRef.current;
      conversationListRequestRef.current = { controller, sequence };
      if (!silent) setLoadingOverview(true);
      try {
        const response = await api.getWhatsAppConversations(
          {
            search: searchQuery,
            status: statusFilter,
            page: conversationPage,
            pageSize: conversationPageSize,
          },
          controller.signal,
        );
        if (controller.signal.aborted || sequence !== conversationListSequenceRef.current) return;
        setConversations(response.conversations);
        setConversationTotal(response.total);
        setTotalUnread(response.unread);
        setSelectedId((current) => {
          if (current) return current;
          const next = response.conversations[0]?.id || '';
          selectedIdRef.current = next;
          return next;
        });
        setError('');
      } catch (caught) {
        if (
          !controller.signal.aborted &&
          !silent &&
          sequence === conversationListSequenceRef.current
        )
          setError(caught instanceof Error ? caught.message : 'Не удалось загрузить диалоги');
      } finally {
        if (!silent && sequence === conversationListSequenceRef.current) setLoadingOverview(false);
      }
    },
    [conversationPage, searchQuery, statusFilter],
  );

  const loadConversation = useCallback(
    async (id: string, silent = false) => {
      conversationDetailRequestRef.current?.controller.abort();
      const controller = new AbortController();
      const sequence = ++conversationDetailSequenceRef.current;
      conversationDetailRequestRef.current = { controller, sequence };
      if (!id) {
        setSelectedConversation(null);
        setMessages([]);
        setMemories([]);
        setLoadingConversation(false);
        return;
      }
      if (!silent) {
        setLoadingConversation(true);
        setSelectedConversation(null);
        setMessages([]);
        setMemories([]);
      }
      try {
        const response = await api.getWhatsAppConversation(id, controller.signal);
        if (
          controller.signal.aborted ||
          sequence !== conversationDetailSequenceRef.current ||
          selectedIdRef.current !== id ||
          response.conversation.id !== id
        ) {
          return;
        }
        setSelectedConversation(response.conversation);
        setMessages(response.messages);
        setMemories(response.memories);
        if (response.conversation.unreadCount > 0 && canWrite) {
          const marked = await api.updateWhatsAppConversation(id, { markRead: true });
          if (
            controller.signal.aborted ||
            sequence !== conversationDetailSequenceRef.current ||
            selectedIdRef.current !== id ||
            marked.conversation.id !== id
          ) {
            return;
          }
          setSelectedConversation(marked.conversation);
          setConversations((current) =>
            current.map((item) => (item.id === id ? marked.conversation : item)),
          );
        }
      } catch (caught) {
        if (
          !controller.signal.aborted &&
          !silent &&
          sequence === conversationDetailSequenceRef.current
        )
          toast(caught instanceof Error ? caught.message : 'Не удалось открыть диалог', 'error');
      } finally {
        if (!silent && sequence === conversationDetailSequenceRef.current)
          setLoadingConversation(false);
      }
    },
    [canWrite, toast],
  );

  const loadKnowledge = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingKnowledge(true);
      try {
        const response = await api.getWhatsAppKnowledge();
        setDocuments(response.documents);
      } catch (caught) {
        if (!silent)
          toast(
            caught instanceof Error ? caught.message : 'Не удалось загрузить базу знаний',
            'error',
          );
      } finally {
        if (!silent) setLoadingKnowledge(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    let active = true;
    Promise.all([loadStatus(), loadConversations()])
      .catch((caught) => {
        if (active)
          setError(caught instanceof Error ? caught.message : 'Не удалось открыть WhatsApp');
      })
      .finally(() => {
        if (active) setLoadingOverview(false);
      });
    return () => {
      active = false;
    };
  }, [loadConversations, loadStatus]);

  useEffect(() => {
    if (selectedId) void loadConversation(selectedId);
  }, [loadConversation, selectedId]);

  useEffect(() => {
    if (view === 'knowledge' && documents.length === 0) void loadKnowledge();
  }, [documents.length, loadKnowledge, view]);

  useAdminRealtimeEvents(
    [
      'whatsapp.message.created',
      'whatsapp.message.updated',
      'whatsapp.outbox.updated',
      'whatsapp.conversation.updated',
      'whatsapp.connection.updated',
      'whatsapp.settings.updated',
    ],
    (event) => {
      if (event.type === 'whatsapp.connection.updated') {
        void loadStatus().catch(() => undefined);
        return;
      }
      void loadConversations(true);
      if (
        selectedId &&
        view === 'inbox' &&
        String(event.data.conversationId || '') === selectedId
      ) {
        void loadConversation(selectedId, true);
      }
    },
    [loadConversation, loadConversations, loadStatus, selectedId, view],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void loadStatus().catch(() => undefined);
      void loadConversations(true);
      if (selectedId && view === 'inbox') void loadConversation(selectedId, true);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadConversation, loadConversations, loadStatus, selectedId, view]);

  useEffect(() => {
    if (!canConfigure || connection?.connected) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadStatus().catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [canConfigure, connection?.connected, loadStatus]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const filteredUnread = useMemo(() => totalUnread, [totalUnread]);
  const selectedProvider = settingsDraft?.provider || 'gemini';
  const activeProviderKeyConfigured = Boolean(
    settingsDraft?.providerKeys?.[selectedProvider] || providerApiKey.trim(),
  );
  const settingsDirty = Boolean(
    providerApiKey.trim() ||
    (settings && settingsDraft && JSON.stringify(settingsDraft) !== JSON.stringify(settings)),
  );
  const knowledgeDirty =
    knowledgeModalOpen && JSON.stringify(knowledgeDraft) !== JSON.stringify(knowledgeBaseline);
  const replyDirty = Object.values(replyDrafts).some((value) => value.trim());

  useEffect(() => {
    if (!settingsDirty && !knowledgeDirty && !replyDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [knowledgeDirty, replyDirty, settingsDirty]);

  useNavigationBlocker(
    settingsDirty || knowledgeDirty || replyDirty,
    (nextLocation) =>
      nextLocation.pathname === location.pathname || window.confirm(t('common.unsavedBody')),
  );

  const changeView = async (nextView: ConsoleView) => {
    if (nextView === view) return;
    if (
      view === 'settings' &&
      settingsDirty &&
      !(await confirm({
        title: t('common.unsavedTitle'),
        body: t('common.unsavedBody'),
        confirmLabel: t('common.close'),
        destructive: true,
      }))
    ) {
      return;
    }
    if (view === 'settings' && settings) {
      setSettingsDraft(settings);
      setProviderApiKey('');
      setShowProviderApiKey(false);
    }
    setView(nextView);
  };

  const selectConversation = async (id: string) => {
    if (busy) return;
    if (id === selectedId) {
      setMobileChatOpen(true);
      return;
    }
    if (
      replyText.trim() &&
      !(await confirm({
        title: t('whatsapp.switchDraftTitle'),
        body: t('whatsapp.switchDraftBody'),
        confirmLabel: t('whatsapp.switchDraftConfirm'),
      }))
    ) {
      return;
    }
    selectedIdRef.current = id;
    setSelectedId(id);
    setMobileChatOpen(true);
  };

  const sendReply = async (event: FormEvent) => {
    event.preventDefault();
    const text = replyText.trim();
    if (
      !selectedConversation ||
      selectedConversation.id !== selectedId ||
      selectedIdRef.current !== selectedId ||
      !text ||
      busy
    ) {
      return;
    }
    const targetId = selectedId;
    const previousRequest = replyRequestRef.current;
    const clientMessageId =
      previousRequest?.conversationId === selectedConversation.id && previousRequest.text === text
        ? previousRequest.clientMessageId
        : newClientMessageId();
    replyRequestRef.current = {
      conversationId: selectedConversation.id,
      text,
      clientMessageId,
    };
    setBusy('reply');
    try {
      const response = await api.sendWhatsAppReply(targetId, text, clientMessageId);
      if (response.conversation.id !== targetId) {
        toast(t('whatsapp.recipientMismatch'), 'error');
        return;
      }
      if (selectedIdRef.current === targetId) {
        setMessages((current) => [...current, response.message]);
        setSelectedConversation(response.conversation);
      }
      setConversations((current) =>
        current.map((item) =>
          item.id === response.conversation.id ? response.conversation : item,
        ),
      );
      clearReplyDraft(targetId);
      replyRequestRef.current = null;
      toast(
        response.queued
          ? 'Сообщение сохранено в очереди и отправится после подключения WhatsApp.'
          : 'Сообщение отправлено. ИИ для этого диалога поставлен на паузу.',
      );
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Не удалось отправить сообщение', 'error');
    } finally {
      setBusy('');
    }
  };

  const toggleConversationAssistant = async () => {
    if (!selectedConversation || busy) return;
    setBusy('conversation-assistant');
    try {
      const response = await api.updateWhatsAppConversation(selectedConversation.id, {
        assistantEnabled: !selectedConversation.assistantEnabled,
      });
      setSelectedConversation(response.conversation);
      setConversations((current) =>
        current.map((item) =>
          item.id === response.conversation.id ? response.conversation : item,
        ),
      );
      toast(
        response.conversation.assistantEnabled
          ? 'ИИ снова отвечает клиенту'
          : 'ИИ поставлен на паузу',
      );
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : 'Не удалось изменить режим диалога',
        'error',
      );
    } finally {
      setBusy('');
    }
  };

  const toggleConversationStatus = async () => {
    if (!selectedConversation || busy) return;
    setBusy('conversation-status');
    try {
      const response = await api.updateWhatsAppConversation(selectedConversation.id, {
        status: selectedConversation.status === 'closed' ? 'open' : 'closed',
      });
      setSelectedConversation(response.conversation);
      setConversations((current) =>
        current.map((item) =>
          item.id === response.conversation.id ? response.conversation : item,
        ),
      );
      toast(response.conversation.status === 'closed' ? 'Диалог закрыт' : 'Диалог открыт');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Не удалось изменить статус', 'error');
    } finally {
      setBusy('');
    }
  };

  const prepareMemoryFromMessage = (message: WhatsAppMessage) => {
    setMemoryLabel(message.senderType === 'customer' ? 'Факт от клиента' : 'Важная информация');
    setMemoryContent(message.content);
    setMemorySourceMessageId(message.id);
    requestAnimationFrame(() => document.getElementById('whatsapp-memory-content')?.focus());
  };

  const saveMemory = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedConversation || !memoryContent.trim() || busy) return;
    setBusy('memory');
    try {
      const response = await api.createWhatsAppMemory(selectedConversation.id, {
        label: memoryLabel.trim() || 'Заметка',
        content: memoryContent.trim(),
        sourceType: memorySourceMessageId ? 'message' : 'manual',
        sourceMessageId: memorySourceMessageId,
      });
      setMemories((current) => [response.memory, ...current]);
      setMemoryContent('');
      setMemorySourceMessageId(null);
      toast('Информация сохранена в памяти ассистента');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Не удалось сохранить память', 'error');
    } finally {
      setBusy('');
    }
  };

  const removeMemory = async (memory: WhatsAppMemory) => {
    if (!selectedConversation) return;
    const accepted = await confirm({
      title: 'Удалить заметку из памяти?',
      body: 'Ассистент больше не будет использовать эту информацию в ответах.',
      confirmLabel: 'Удалить',
      destructive: true,
    });
    if (!accepted) return;
    try {
      await api.deleteWhatsAppMemory(selectedConversation.id, memory.id);
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      toast('Заметка удалена');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Не удалось удалить заметку', 'error');
    }
  };

  const openCreateKnowledge = () => {
    const draft = emptyKnowledgeDraft();
    setEditingKnowledgeId(null);
    setKnowledgeDraft(draft);
    setKnowledgeBaseline(draft);
    setKnowledgeModalOpen(true);
  };

  const openEditKnowledge = (document: WhatsAppKnowledgeDocument) => {
    setEditingKnowledgeId(document.id);
    const draft = {
      title: document.title,
      category: document.category,
      content: document.content,
      isActive: document.isActive,
    };
    setKnowledgeDraft(draft);
    setKnowledgeBaseline(draft);
    setKnowledgeModalOpen(true);
  };

  const closeKnowledgeModal = async () => {
    if (
      knowledgeDirty &&
      !(await confirm({
        title: t('common.unsavedTitle'),
        body: t('common.unsavedBody'),
        confirmLabel: t('common.close'),
        destructive: true,
      }))
    ) {
      return;
    }
    setKnowledgeModalOpen(false);
  };

  const saveKnowledge = async (event: FormEvent) => {
    event.preventDefault();
    if (!knowledgeDraft.title.trim() || !knowledgeDraft.content.trim() || busy) return;
    setBusy('knowledge');
    try {
      if (editingKnowledgeId) {
        await api.updateWhatsAppKnowledge(editingKnowledgeId, knowledgeDraft);
      } else {
        await api.createWhatsAppKnowledge(knowledgeDraft);
      }
      setKnowledgeModalOpen(false);
      await loadKnowledge(true);
      toast('База знаний обновлена');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Не удалось сохранить информацию', 'error');
    } finally {
      setBusy('');
    }
  };

  const removeKnowledge = async (document: WhatsAppKnowledgeDocument) => {
    const accepted = await confirm({
      title: 'Удалить материал?',
      body: `«${document.title}» больше не будет доступен ассистенту.`,
      confirmLabel: 'Удалить',
      destructive: true,
    });
    if (!accepted) return;
    try {
      await api.deleteWhatsAppKnowledge(document.id);
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      toast('Материал удалён');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Не удалось удалить материал', 'error');
    }
  };

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!settingsDraft || busy) return;
    setBusy('settings');
    try {
      const response = await api.updateWhatsAppSettings({
        ...settingsDraft,
        ...(providerApiKey.trim() ? { apiKey: providerApiKey.trim() } : {}),
      });
      setSettings(response.settings);
      setSettingsDraft(response.settings);
      setProviderApiKey('');
      setShowProviderApiKey(false);
      toast('Настройки ассистента сохранены');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Не удалось сохранить настройки', 'error');
    } finally {
      setBusy('');
    }
  };

  const changeProvider = (provider: WhatsAppAssistantSettings['provider']) => {
    if (!settingsDraft) return;
    setSettingsDraft({
      ...settingsDraft,
      provider,
      model: providerModels[provider][0],
      keyConfigured: Boolean(settingsDraft.providerKeys?.[provider]),
    });
    setProviderApiKey('');
    setShowProviderApiKey(false);
  };

  const toggleLanguage = (language: 'ru' | 'kk' | 'en') => {
    if (!settingsDraft) return;
    const exists = settingsDraft.supportedLanguages.includes(language);
    if (exists && settingsDraft.supportedLanguages.length === 1) {
      toast('Оставьте хотя бы один язык', 'error');
      return;
    }
    setSettingsDraft({
      ...settingsDraft,
      supportedLanguages: exists
        ? settingsDraft.supportedLanguages.filter((item) => item !== language)
        : [...settingsDraft.supportedLanguages, language],
    });
  };

  const refreshCurrentView = async () => {
    setBusy('refresh');
    try {
      await Promise.all([
        loadStatus(),
        loadConversations(true),
        view === 'knowledge' ? loadKnowledge(true) : Promise.resolve(),
        selectedId && view === 'inbox' ? loadConversation(selectedId, true) : Promise.resolve(),
      ]);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Не удалось обновить данные', 'error');
    } finally {
      setBusy('');
    }
  };

  const resetPairing = async () => {
    const accepted = await confirm({
      title: 'Создать новый QR-код?',
      body: 'Текущая серверная привязка WhatsApp будет очищена. После этого отсканируйте новый QR-код рабочим телефоном.',
      confirmLabel: 'Создать QR',
      destructive: true,
    });
    if (!accepted) return;

    setBusy('pairing-reset');
    setConnection((current) =>
      current
        ? {
            ...current,
            state: 'connecting',
            connected: false,
            connectedAt: null,
            phone: '',
            qrDataUrl: '',
            qrReceivedAt: null,
            lastError: '',
          }
        : current,
    );
    try {
      const response = await api.resetWhatsAppPairing();
      setConnection(response.connection);
      toast('Старая привязка очищена. Новый QR-код появится автоматически.');
    } catch (caught) {
      void loadStatus().catch(() => undefined);
      toast(caught instanceof Error ? caught.message : 'Не удалось создать новый QR-код', 'error');
    } finally {
      setBusy('');
    }
  };

  return {
    role,
    locale,
    canConfigure,
    canWrite,
    isConversationOnly,
    view,
    connection,
    settings,
    settingsDraft,
    setSettingsDraft,
    providerApiKey,
    setProviderApiKey,
    showProviderApiKey,
    setShowProviderApiKey,
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
    knowledgeModalOpen,
    editingKnowledgeId,
    knowledgeDraft,
    setKnowledgeDraft,
    messagesEndRef,
    conversationPageSize,
    replyText,
    updateReplyDraft,
    updateConversationQuery,
    stopVoiceRecording,
    startVoiceRecording,
    filteredUnread,
    selectedProvider,
    activeProviderKeyConfigured,
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
    closeKnowledgeModal,
    saveKnowledge,
    removeKnowledge,
    saveSettings,
    changeProvider,
    toggleLanguage,
    refreshCurrentView,
    resetPairing,
  };
}

export type WhatsAppPageController = ReturnType<typeof useWhatsAppPageController>;
