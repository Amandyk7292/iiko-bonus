import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigationBlocker, useSearchParams } from '../lib/router';
import {
  Archive,
  Bot,
  BookOpenText,
  BookmarkPlus,
  CheckCheck,
  ChevronLeft,
  CircleAlert,
  Clock3,
  Cpu,
  Eye,
  EyeOff,
  FileText,
  Inbox,
  LoaderCircle,
  KeyRound,
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
  Sparkles,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
import { useFeedback } from '../components/Feedback';
import {
  api,
  type WhatsAppAssistantSettings,
  type WhatsAppConnectionStatus,
  type WhatsAppConversation,
  type WhatsAppKnowledgeDocument,
  type WhatsAppMemory,
  type WhatsAppMessage,
} from '../lib/api';
import { useAdminRealtimeEvents } from '../lib/admin-realtime';
import { useI18n } from '../lib/i18n';
import WhatsAppStatusPanel from './WhatsAppStatusPanel';
import {
  categoryLabels,
  conversationName,
  emptyKnowledgeDraft,
  formatDateTime,
  formatMessageTime,
  formatVoiceDuration,
  initials,
  maxVoiceSeconds,
  newClientMessageId,
  preferredVoiceMimeType,
  providerDescriptions,
  providerLabels,
  providerModels,
  statusLabel,
  toneLabels,
  type ConsoleView,
  type KnowledgeDraft,
  type VoiceMode,
} from './whatsapp-page.helpers';

export default function WhatsAppPage({ role = 'viewer' }: { role?: string }) {
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
  const [search, setSearch] = useState(queryParams.get('search') || '');
  const [searchQuery, setSearchQuery] = useState(queryParams.get('search') || '');
  const [statusFilter, setStatusFilter] = useState(queryParams.get('status') || '');
  const [conversationPage, setConversationPage] = useState(
    Math.max(1, Number(queryParams.get('page')) || 1),
  );
  const [conversationTotal, setConversationTotal] = useState(0);
  const [totalUnread, setTotalUnread] = useState(0);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
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
  const replyText = selectedId ? replyDrafts[selectedId] || '' : '';

  const updateReplyDraft = useCallback((conversationId: string, text: string) => {
    if (!conversationId) return;
    setReplyDrafts((current) => ({ ...current, [conversationId]: text }));
  }, []);

  const clearReplyDraft = useCallback((conversationId: string) => {
    setReplyDrafts((current) => {
      if (!(conversationId in current)) return current;
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
  }, []);

  const updateConversationQuery = useCallback(
    (updates: Record<string, string | number | null>) => {
      const next = new URLSearchParams(queryParams);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, String(value));
      }
      if (next.toString() === queryParams.toString()) return;
      setQueryParams(next, { replace: true });
    },
    [queryParams, setQueryParams],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = search.trim();
      setSearchQuery(next);
      setConversationPage(1);
      const updated = new URLSearchParams(window.location.search);
      if (next) updated.set('search', next);
      else updated.delete('search');
      updated.delete('page');
      setQueryParams(updated, { replace: true });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search, setQueryParams]);

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
                    onClick={() => {
                      setStatusFilter(value);
                      setConversationPage(1);
                      updateConversationQuery({ status: value, page: null });
                    }}
                  >
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
                      >
                        <X aria-hidden="true" size={20} />
                      </button>
                      <button
                        type="button"
                        className="btn-classic whatsapp-send-button"
                        onClick={() => stopVoiceRecording(true)}
                        disabled={voiceMode === 'sending'}
                        aria-label="Отправить голосовое"
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
                      >
                        <Pencil aria-hidden="true" size={18} />
                      </button>
                      <button
                        type="button"
                        className="icon-button icon-button-danger"
                        onClick={() => void removeKnowledge(document)}
                        aria-label="Удалить материал"
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

      {view === 'settings' && settingsDraft && (
        <form className="whatsapp-settings-view" onSubmit={saveSettings}>
          {!canConfigure && (
            <div className="whatsapp-permission-note">
              <ShieldCheck aria-hidden="true" size={20} />
              <span>
                Просмотр настроек доступен. Изменять их может только владелец или администратор.
              </span>
            </div>
          )}
          <div className="whatsapp-settings-main">
            <section className="whatsapp-settings-section">
              <div className="whatsapp-settings-section-heading">
                <Bot aria-hidden="true" size={21} />
                <div>
                  <h2>Режим работы</h2>
                  <p>Управление автоматическими ответами и памятью.</p>
                </div>
              </div>
              <div className="whatsapp-toggle-list">
                <label className="whatsapp-setting-toggle">
                  <span>
                    <strong>ИИ-ассистент включён</strong>
                    <small>Главный выключатель автоматических консультаций.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settingsDraft.assistantEnabled}
                    onChange={(event) =>
                      setSettingsDraft({ ...settingsDraft, assistantEnabled: event.target.checked })
                    }
                    disabled={!canConfigure}
                  />
                  <span className="switch-control" aria-hidden="true" />
                </label>
                <label className="whatsapp-setting-toggle">
                  <span>
                    <strong>Автоматически отвечать</strong>
                    <small>Если выключить, новые сообщения останутся оператору.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settingsDraft.autoReplyEnabled}
                    onChange={(event) =>
                      setSettingsDraft({ ...settingsDraft, autoReplyEnabled: event.target.checked })
                    }
                    disabled={!canConfigure}
                  />
                  <span className="switch-control" aria-hidden="true" />
                </label>
                <label className="whatsapp-setting-toggle">
                  <span>
                    <strong>Использовать память</strong>
                    <small>Подключает заметки и недавнюю переписку к ответу.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settingsDraft.memoryEnabled}
                    onChange={(event) =>
                      setSettingsDraft({ ...settingsDraft, memoryEnabled: event.target.checked })
                    }
                    disabled={!canConfigure}
                  />
                  <span className="switch-control" aria-hidden="true" />
                </label>
              </div>
            </section>

            <section className="whatsapp-settings-section">
              <div className="whatsapp-settings-section-heading">
                <Cpu aria-hidden="true" size={21} />
                <div>
                  <h2>ИИ-провайдер и модель</h2>
                  <p>Переключение сервиса и безопасная замена API-ключа.</p>
                </div>
              </div>
              <div className="form-grid form-grid-2">
                <div className="field-group">
                  <label className="field-label" htmlFor="whatsapp-ai-provider">
                    Провайдер
                  </label>
                  <select
                    id="whatsapp-ai-provider"
                    className="input-classic"
                    value={selectedProvider}
                    onChange={(event) =>
                      changeProvider(event.target.value as WhatsAppAssistantSettings['provider'])
                    }
                    disabled={!canConfigure}
                  >
                    {(Object.keys(providerLabels) as WhatsAppAssistantSettings['provider'][]).map(
                      (provider) => (
                        <option key={provider} value={provider}>
                          {providerLabels[provider]}
                          {settingsDraft.providerKeys?.[provider] ? ' (ключ установлен)' : ''}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <div className="field-group">
                  <label className="field-label" htmlFor="whatsapp-ai-model">
                    Модель
                  </label>
                  <input
                    id="whatsapp-ai-model"
                    className="input-classic"
                    list={`whatsapp-${selectedProvider}-models`}
                    value={settingsDraft.model}
                    onChange={(event) =>
                      setSettingsDraft({ ...settingsDraft, model: event.target.value })
                    }
                    maxLength={120}
                    spellCheck={false}
                    disabled={!canConfigure}
                  />
                  <datalist id={`whatsapp-${selectedProvider}-models`}>
                    {providerModels[selectedProvider].map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="whatsapp-provider-key">
                  Новый API-ключ {providerLabels[selectedProvider]}
                </label>
                <div className="whatsapp-secret-input">
                  <KeyRound aria-hidden="true" size={18} />
                  <input
                    id="whatsapp-provider-key"
                    className="input-classic"
                    type={showProviderApiKey ? 'text' : 'password'}
                    value={providerApiKey}
                    onChange={(event) => setProviderApiKey(event.target.value)}
                    placeholder={
                      settingsDraft.providerKeys?.[selectedProvider]
                        ? 'Оставьте пустым, чтобы сохранить текущий ключ'
                        : 'Вставьте API-ключ'
                    }
                    autoComplete="new-password"
                    maxLength={512}
                    spellCheck={false}
                    disabled={!canConfigure}
                  />
                  <button
                    type="button"
                    onClick={() => setShowProviderApiKey((current) => !current)}
                    aria-label={showProviderApiKey ? 'Скрыть API-ключ' : 'Показать API-ключ'}
                    disabled={!canConfigure || !providerApiKey}
                  >
                    {showProviderApiKey ? (
                      <EyeOff aria-hidden="true" size={18} />
                    ) : (
                      <Eye aria-hidden="true" size={18} />
                    )}
                  </button>
                </div>
                <p
                  className={`whatsapp-key-status ${activeProviderKeyConfigured ? 'is-ready' : 'is-missing'}`}
                  aria-live="polite"
                >
                  {providerApiKey.trim()
                    ? 'Новый ключ будет зашифрован при сохранении.'
                    : activeProviderKeyConfigured
                      ? 'Ключ установлен. Его значение не показывается и не передаётся обратно в браузер.'
                      : 'Для выбранного провайдера ключ ещё не установлен.'}
                </p>
                <p className="field-hint">{providerDescriptions[selectedProvider]}</p>
              </div>
            </section>

            <section className="whatsapp-settings-section">
              <div className="whatsapp-settings-section-heading">
                <Sparkles aria-hidden="true" size={21} />
                <div>
                  <h2>Личность ассистента</h2>
                  <p>Имя, тон и языки общения.</p>
                </div>
              </div>
              <div className="form-grid form-grid-2">
                <div className="field-group">
                  <label className="field-label" htmlFor="whatsapp-bot-name">
                    Имя ассистента
                  </label>
                  <input
                    id="whatsapp-bot-name"
                    className="input-classic"
                    value={settingsDraft.botName}
                    onChange={(event) =>
                      setSettingsDraft({ ...settingsDraft, botName: event.target.value })
                    }
                    maxLength={80}
                    disabled={!canConfigure}
                  />
                </div>
                <div className="field-group">
                  <label className="field-label" htmlFor="whatsapp-tone">
                    Тон общения
                  </label>
                  <select
                    id="whatsapp-tone"
                    className="input-classic"
                    value={settingsDraft.tone}
                    onChange={(event) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        tone: event.target.value as WhatsAppAssistantSettings['tone'],
                      })
                    }
                    disabled={!canConfigure}
                  >
                    {Object.entries(toneLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <fieldset className="whatsapp-language-fieldset" disabled={!canConfigure}>
                <legend>Языки ответов</legend>
                <div>
                  {(['ru', 'kk', 'en'] as const).map((language) => (
                    <label
                      key={language}
                      className={
                        settingsDraft.supportedLanguages.includes(language) ? 'is-active' : ''
                      }
                    >
                      <input
                        type="checkbox"
                        checked={settingsDraft.supportedLanguages.includes(language)}
                        onChange={() => toggleLanguage(language)}
                      />
                      <span>
                        {language === 'ru' ? 'Русский' : language === 'kk' ? 'Қазақша' : 'English'}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="field-group">
                <label className="field-label" htmlFor="whatsapp-history">
                  Сообщений в контексте: {settingsDraft.historyMessages}
                </label>
                <input
                  id="whatsapp-history"
                  type="range"
                  min="0"
                  max="30"
                  step="1"
                  value={settingsDraft.historyMessages}
                  onChange={(event) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      historyMessages: Number(event.target.value),
                    })
                  }
                  disabled={!canConfigure}
                />
                <p className="field-hint">
                  Чем больше контекст, тем точнее продолжение диалога и выше расход лимита.
                </p>
              </div>
            </section>

            <section className="whatsapp-settings-section">
              <div className="whatsapp-settings-section-heading">
                <BookOpenText aria-hidden="true" size={21} />
                <div>
                  <h2>Контекст бизнеса</h2>
                  <p>Главные сведения и правила поведения.</p>
                </div>
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="whatsapp-business-description">
                  Описание Bulka
                </label>
                <textarea
                  id="whatsapp-business-description"
                  className="input-classic"
                  rows={5}
                  value={settingsDraft.businessDescription}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, businessDescription: event.target.value })
                  }
                  maxLength={4000}
                  placeholder="Чем занимается Bulka, чем отличается, какие услуги доступны"
                  disabled={!canConfigure}
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="whatsapp-custom-instructions">
                  Дополнительные инструкции
                </label>
                <textarea
                  id="whatsapp-custom-instructions"
                  className="input-classic"
                  rows={6}
                  value={settingsDraft.customInstructions}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, customInstructions: event.target.value })
                  }
                  maxLength={6000}
                  placeholder="Например: не обещать наличие без проверки, при жалобе передавать оператору"
                  disabled={!canConfigure}
                />
              </div>
            </section>

            <section className="whatsapp-settings-section">
              <div className="whatsapp-settings-section-heading">
                <MessageCircle aria-hidden="true" size={21} />
                <div>
                  <h2>Служебные сообщения</h2>
                  <p>Приветствие и ответ при временной ошибке.</p>
                </div>
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="whatsapp-welcome">
                  Приветствие
                </label>
                <textarea
                  id="whatsapp-welcome"
                  className="input-classic"
                  rows={3}
                  value={settingsDraft.welcomeMessage}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, welcomeMessage: event.target.value })
                  }
                  maxLength={500}
                  disabled={!canConfigure}
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="whatsapp-fallback">
                  Если ИИ недоступен
                </label>
                <textarea
                  id="whatsapp-fallback"
                  className="input-classic"
                  rows={3}
                  value={settingsDraft.fallbackMessage}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, fallbackMessage: event.target.value })
                  }
                  maxLength={500}
                  disabled={!canConfigure}
                />
              </div>
            </section>
          </div>

          <aside className="whatsapp-settings-aside">
            <section className="whatsapp-runtime-card">
              <h2>Состояние сервера</h2>
              <dl>
                <div>
                  <dt>WhatsApp</dt>
                  <dd>{connection?.connected ? 'Подключён' : 'Не подключён'}</dd>
                </div>
                <div>
                  <dt>Провайдер</dt>
                  <dd>{providerLabels[selectedProvider]}</dd>
                </div>
                <div>
                  <dt>API-ключ</dt>
                  <dd>{activeProviderKeyConfigured ? 'Установлен' : 'Нет ключа'}</dd>
                </div>
                <div>
                  <dt>Модель</dt>
                  <dd>{settingsDraft.model}</dd>
                </div>
                <div>
                  <dt>Хранилище</dt>
                  <dd>{settingsDraft.storageReady ? 'Готово' : 'Нужна миграция'}</dd>
                </div>
                <div>
                  <dt>Обновлено</dt>
                  <dd>{formatDateTime(settings?.updatedAt || null, locale)}</dd>
                </div>
              </dl>
            </section>
            <section className="whatsapp-guardrail-card">
              <ShieldCheck aria-hidden="true" size={22} />
              <h2>Защита уже включена</h2>
              <p>
                Ассистент не получает OTP, пароли, полные номера карт и скрывает типовые
                персональные данные перед запросом к выбранному ИИ.
              </p>
            </section>
            {canConfigure && (
              <button
                type="submit"
                className="btn-classic whatsapp-settings-save"
                disabled={
                  busy === 'settings' ||
                  (settingsDraft.assistantEnabled && !activeProviderKeyConfigured)
                }
              >
                {busy === 'settings' ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <Save aria-hidden="true" size={18} />
                )}{' '}
                Сохранить настройки
              </button>
            )}
          </aside>
        </form>
      )}

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
                !knowledgeDraft.title.trim() ||
                !knowledgeDraft.content.trim() ||
                busy === 'knowledge'
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
    </div>
  );
}
