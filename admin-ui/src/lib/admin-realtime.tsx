import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, type AdminUser, type OperationsSummary } from './api';
import { parseAdminScopeSelection } from './admin-city-scope';
import { playAdminEventOnce, subscribeAdminEvents } from './admin-event-broker';

export interface AdminRealtimeEvent {
  id: string;
  type: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

type RealtimeListener = (event: AdminRealtimeEvent) => void;
export type AdminRealtimeStatus = 'connecting' | 'online' | 'reconnecting' | 'offline';

interface AdminRealtimeValue {
  summary: OperationsSummary | null;
  summaryLoading: boolean;
  summaryError: boolean;
  connectionStatus: AdminRealtimeStatus;
  lastUpdatedAt: number | null;
  refreshSummary: () => Promise<void>;
  subscribe: (types: string[], listener: RealtimeListener) => () => void;
  soundEnabled: boolean;
  soundReady: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  unlockSound: () => Promise<boolean>;
  playOrderAlarm: (kitchenAlarm?: boolean) => boolean;
  stopOrderAlarm: () => void;
}

const EVENT_TYPES = [
  'connected',
  'order.created',
  'order.updated',
  'order.customer_arrived',
  'delivery.updated',
  'courier.updated',
  'menu.updated',
  'locations.updated',
  'review.updated',
  'support.created',
  'support.updated',
  'whatsapp.message.created',
  'whatsapp.message.updated',
  'whatsapp.outbox.updated',
  'whatsapp.conversation.updated',
  'whatsapp.connection.updated',
  'whatsapp.settings.updated',
  'loyalty.balance.updated',
  'customer.updated',
  'transaction.created',
];

const SUMMARY_EVENT_TYPES = new Set([
  'connected',
  'order.created',
  'order.updated',
  'order.customer_arrived',
  'delivery.updated',
  'menu.updated',
  'support.created',
  'support.updated',
  'whatsapp.message.created',
  'whatsapp.message.updated',
  'whatsapp.conversation.updated',
]);

const AdminRealtimeContext = createContext<AdminRealtimeValue | null>(null);

declare global {
  interface Window {
    BulkaOrderAudio?: {
      prepare(): Promise<void>;
      play(kitchen: boolean): Promise<void>;
      stop(): Promise<void>;
    };
  }
}
let nativeOrderAudioReady = false;
function nativeOrderAudioFailed() {
  nativeOrderAudioReady = false;
  notifyOrderAudioState();
}

let orderAudioContext: AudioContext | null = null;
let lastOrderToneAt = 0;
let activeKitchenAlarm: { oscillator: OscillatorNode; gain: GainNode } | null = null;
const orderAudioStateListeners = new Set<() => void>();

function stopOrderAlarm() {
  void window.BulkaOrderAudio?.stop().catch(nativeOrderAudioFailed);
  const active = activeKitchenAlarm;
  activeKitchenAlarm = null;
  if (!active) return;
  try {
    active.oscillator.stop();
    active.oscillator.disconnect();
    active.gain.disconnect();
  } catch {
    // The browser may already have closed the audio context.
  }
}

function notifyOrderAudioState() {
  for (const listener of orderAudioStateListeners) {
    try {
      listener();
    } catch {
      // One mounted consumer must not break audio recovery for the others.
    }
  }
}

function discardOrderAudioContext(context: AudioContext | null) {
  stopOrderAlarm();
  if (orderAudioContext === context) orderAudioContext = null;
  lastOrderToneAt = 0;
  if (context) {
    try {
      const closeRequest = context.close?.();
      if (closeRequest) void closeRequest.catch(() => undefined);
    } catch {
      // Some WebKit implementations can throw while tearing down a failed graph.
    }
  }
  notifyOrderAudioState();
}

function getOrderAudioContext() {
  const AudioContextClass =
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  try {
    if (orderAudioContext && orderAudioContext.state !== 'closed') return orderAudioContext;
  } catch {
    discardOrderAudioContext(orderAudioContext);
  }
  try {
    const context = new AudioContextClass();
    orderAudioContext = context;
    context.addEventListener('statechange', notifyOrderAudioState);
    return context;
  } catch {
    discardOrderAudioContext(orderAudioContext);
    return null;
  }
}

function isOrderAudioReady() {
  if (window.BulkaOrderAudio) return nativeOrderAudioReady;
  try {
    return orderAudioContext?.state === 'running';
  } catch {
    return false;
  }
}

function playOrderTone(force = false, kitchenAlarm = false) {
  if (window.BulkaOrderAudio) {
    if (!nativeOrderAudioReady || document.hidden) return false;
    const now = Date.now();
    if (!force && !kitchenAlarm && now - lastOrderToneAt < 4000) return true;
    lastOrderToneAt = now;
    void window.BulkaOrderAudio.play(kitchenAlarm).catch(nativeOrderAudioFailed);
    return true;
  }
  const context = getOrderAudioContext();
  if (!context) return false;
  try {
    if (context.state !== 'running') return false;
    if (activeKitchenAlarm) return true;
    const now = Date.now();
    if (!force && !kitchenAlarm && now - lastOrderToneAt < 4_000) return true;
    const duration = kitchenAlarm ? 10 : 0.8;
    const volume = kitchenAlarm ? 0.5 : 0.16;
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(volume, context.currentTime + 0.03);
    gain.gain.setValueAtTime(volume, context.currentTime + duration - 0.22);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration - 0.02);
    for (let step = 0; step < duration / 0.2; step++) {
      oscillator.frequency.setValueAtTime(step % 2 ? 960 : 720, context.currentTime + step * 0.2);
    }
    oscillator.connect(gain);
    gain.connect(context.destination);
    if (kitchenAlarm) activeKitchenAlarm = { oscillator, gain };
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
    oscillator.addEventListener(
      'ended',
      () => {
        if (activeKitchenAlarm?.oscillator === oscillator) activeKitchenAlarm = null;
        try {
          oscillator.disconnect();
        } catch {
          // The context may already have been discarded after an iOS audio interruption.
        }
        try {
          gain.disconnect();
        } catch {
          // The context may already have been discarded after an iOS audio interruption.
        }
      },
      { once: true },
    );
    lastOrderToneAt = now;
    return true;
  } catch {
    discardOrderAudioContext(context);
    return false;
  }
}

async function unlockOrderAudio(testTone = true) {
  if (window.BulkaOrderAudio) {
    try {
      await window.BulkaOrderAudio.prepare();
      nativeOrderAudioReady = true;
      if (testTone) await window.BulkaOrderAudio.play(false);
      return true;
    } catch {
      nativeOrderAudioFailed();
      return false;
    }
  }
  const context = getOrderAudioContext();
  if (!context) return false;
  try {
    if (context.state !== 'running') await context.resume();
    if (context.state !== 'running') return false;
    if (testTone && !playOrderTone(true)) return false;
    return true;
  } catch {
    discardOrderAudioContext(context);
    return false;
  }
}

export function AdminRealtimeProvider({
  branchId,
  role,
  identity,
  children,
}: {
  branchId: string;
  role: string;
  identity?: AdminUser | null;
  children: ReactNode;
}) {
  const [summary, setSummary] = useState<OperationsSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<AdminRealtimeStatus>('connecting');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [soundEnabled, setSoundEnabledState] = useState(
    () => localStorage.getItem('adminOrderSoundEnabled') !== 'false',
  );
  const [soundReady, setSoundReady] = useState(isOrderAudioReady);
  const listenersRef = useRef(new Set<{ types: Set<string>; listener: RealtimeListener }>());
  const refreshTimerRef = useRef<number | null>(null);
  const summaryRequestRef = useRef<Promise<void> | null>(null);
  const summaryGenerationRef = useRef(0);
  const canLoadSummary = role !== 'whatsapp_operator' && role !== 'courier' && role !== 'cashier';
  const streamIdentity = identity?.username
    ? JSON.stringify([
        identity.username,
        identity.role,
        [...(identity.branchIds || [])].sort(),
        [...(identity.actions || [])].sort(),
      ])
    : undefined;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  useEffect(() => {
    const syncSoundState = () => setSoundReady(isOrderAudioReady());
    orderAudioStateListeners.add(syncSoundState);
    syncSoundState();
    return () => {
      orderAudioStateListeners.delete(syncSoundState);
      if (orderAudioStateListeners.size === 0) discardOrderAudioContext(orderAudioContext);
    };
  }, []);

  const refreshSummary = useCallback(async () => {
    if (!canLoadSummary) return;
    if (summaryRequestRef.current) return summaryRequestRef.current;
    const generation = summaryGenerationRef.current;
    setSummaryLoading(true);
    const request = api
      .getOperationsSummary()
      .then((response) => {
        if (generation !== summaryGenerationRef.current) return;
        if (
          response &&
          typeof response === 'object' &&
          response.counts &&
          response.capabilities &&
          Array.isArray(response.orders)
        ) {
          setSummary(response);
          setSummaryError(false);
          setLastUpdatedAt(Date.now());
        } else {
          throw new Error('Invalid operations summary');
        }
      })
      .catch(() => {
        if (generation === summaryGenerationRef.current) setSummaryError(true);
      })
      .finally(() => {
        if (summaryRequestRef.current === request) {
          summaryRequestRef.current = null;
          if (generation === summaryGenerationRef.current) setSummaryLoading(false);
        }
      });
    summaryRequestRef.current = request;
    return request;
  }, [canLoadSummary]);

  const scheduleSummaryRefresh = useCallback(() => {
    if (!canLoadSummary || refreshTimerRef.current !== null) return;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshSummary();
    }, 350);
  }, [canLoadSummary, refreshSummary]);

  const subscribe = useCallback((types: string[], listener: RealtimeListener) => {
    const subscription = { types: new Set(types), listener };
    listenersRef.current.add(subscription);
    return () => listenersRef.current.delete(subscription);
  }, []);

  const playOrderAlarm = useCallback((kitchenAlarm = false) => {
    const played = playOrderTone(false, kitchenAlarm);
    setSoundReady(isOrderAudioReady());
    return played;
  }, []);

  const unlockSound = useCallback(async (testTone = true) => {
    const unlocked = await unlockOrderAudio(testTone);
    setSoundReady(unlocked);
    return unlocked;
  }, []);

  const setSoundEnabled = useCallback(
    (enabled: boolean) => {
      setSoundEnabledState(enabled);
      localStorage.setItem('adminOrderSoundEnabled', String(enabled));
      if (enabled) void unlockSound();
      else stopOrderAlarm();
    },
    [unlockSound],
  );

  useEffect(() => {
    if (!soundEnabled) return;
    const restoreWhenVisible = () => {
      if (!document.hidden) void unlockSound(false);
    };
    // The native administration allows playback without a fresh gesture. Restore
    // the saved preference silently on every document/foreground transition.
    // Browsers that still block autoplay retain the gesture fallback.
    restoreWhenVisible();
    window.addEventListener('pageshow', restoreWhenVisible);
    window.addEventListener('bulka:order-audio-ready', restoreWhenVisible);
    window.addEventListener('bulka:order-audio-error', nativeOrderAudioFailed);
    document.addEventListener('visibilitychange', restoreWhenVisible);
    return () => {
      window.removeEventListener('pageshow', restoreWhenVisible);
      window.removeEventListener('bulka:order-audio-ready', restoreWhenVisible);
      window.removeEventListener('bulka:order-audio-error', nativeOrderAudioFailed);
      document.removeEventListener('visibilitychange', restoreWhenVisible);
    };
  }, [soundEnabled, unlockSound]);

  useEffect(() => {
    if (!soundEnabled || soundReady) return;
    const unlockFromGesture = () => void unlockSound(false);
    window.addEventListener('pointerdown', unlockFromGesture, { capture: true });
    window.addEventListener('keydown', unlockFromGesture, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', unlockFromGesture, { capture: true });
      window.removeEventListener('keydown', unlockFromGesture, { capture: true });
    };
  }, [soundEnabled, soundReady, unlockSound]);

  useEffect(() => {
    summaryGenerationRef.current++;
    summaryRequestRef.current = null;
    setSummary(null);
    setSummaryError(false);
    setSummaryLoading(false);
    void refreshSummary();
    return () => {
      summaryGenerationRef.current++;
      summaryRequestRef.current = null;
    };
  }, [branchId, refreshSummary]);

  useEffect(() => {
    const params = new URLSearchParams();
    const selection = parseAdminScopeSelection(branchId);
    if (selection.kind === 'branch') params.set('scopeBranchId', selection.branchId);
    if (selection.kind === 'city') {
      params.set(
        'scopeBranchIds',
        selection.branchIds.length ? selection.branchIds.join(',') : 'invalid-city-scope',
      );
    }
    setConnectionStatus('connecting');
    let active = true;
    const unsubscribe = subscribeAdminEvents({
      url: `/admin/api/events${params.size ? `?${params.toString()}` : ''}`,
      identity: streamIdentity,
      eventTypes: EVENT_TYPES,
      onStatus: (status) => {
        setConnectionStatus(status);
        if (status === 'online') setLastUpdatedAt(Date.now());
      },
      onEvent: (type, data) => {
        let event: AdminRealtimeEvent;
        try {
          event = JSON.parse(data) as AdminRealtimeEvent;
        } catch {
          return;
        }
        setLastUpdatedAt(Date.now());
        if (type === 'connected') setConnectionStatus('online');
        for (const subscription of listenersRef.current) {
          if (subscription.types.has(type)) subscription.listener(event);
        }
        if (SUMMARY_EVENT_TYPES.has(type)) scheduleSummaryRefresh();
        if (
          type === 'order.created' &&
          soundEnabledRef.current &&
          String(event.data.paymentStatus || '') === 'paid'
        ) {
          if (streamIdentity && event.id) {
            playAdminEventOnce(
              streamIdentity,
              `${event.id}:${event.occurredAt}`,
              () => active && soundEnabledRef.current && playOrderAlarm(),
            );
          } else {
            playOrderAlarm();
          }
        }
      },
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [branchId, playOrderAlarm, scheduleSummaryRefresh, streamIdentity]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshSummary();
    }, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshSummary();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    };
  }, [refreshSummary]);

  const value = useMemo(
    () => ({
      summary,
      summaryLoading,
      summaryError,
      connectionStatus,
      lastUpdatedAt,
      refreshSummary,
      subscribe,
      soundEnabled,
      soundReady,
      setSoundEnabled,
      unlockSound,
      playOrderAlarm,
      stopOrderAlarm,
    }),
    [
      connectionStatus,
      lastUpdatedAt,
      refreshSummary,
      setSoundEnabled,
      soundEnabled,
      soundReady,
      subscribe,
      summary,
      summaryLoading,
      summaryError,
      unlockSound,
      playOrderAlarm,
    ],
  );

  return <AdminRealtimeContext.Provider value={value}>{children}</AdminRealtimeContext.Provider>;
}

export function useAdminRealtime() {
  const value = useContext(AdminRealtimeContext);
  if (!value) throw new Error('useAdminRealtime must be used inside AdminRealtimeProvider');
  return value;
}

export function useAdminRealtimeEvents(
  types: string[],
  listener: RealtimeListener,
  dependencies: unknown[] = [],
) {
  const { subscribe } = useAdminRealtime();
  const listenerRef = useRef(listener);
  listenerRef.current = listener;
  const key = types.join('|');
  useEffect(
    () => subscribe(types, (event) => listenerRef.current(event)),
    // The caller controls additional dependencies when the handler captures filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subscribe, key, ...dependencies],
  );
}
