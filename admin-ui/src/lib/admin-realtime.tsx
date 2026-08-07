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
import { api, type OperationsSummary } from './api';
import { parseAdminScopeSelection } from './admin-city-scope';

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
  connectionStatus: AdminRealtimeStatus;
  lastUpdatedAt: number | null;
  refreshSummary: () => Promise<void>;
  subscribe: (types: string[], listener: RealtimeListener) => () => void;
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
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

function playOrderTone() {
  const AudioContextClass =
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const gain = context.createGain();
  const oscillator = context.createOscillator();
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.34);
  oscillator.frequency.setValueAtTime(660, context.currentTime);
  oscillator.frequency.setValueAtTime(880, context.currentTime + 0.16);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.36);
  oscillator.addEventListener('ended', () => void context.close(), { once: true });
}

export function AdminRealtimeProvider({
  branchId,
  role,
  children,
}: {
  branchId: string;
  role: string;
  children: ReactNode;
}) {
  const [summary, setSummary] = useState<OperationsSummary | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<AdminRealtimeStatus>('connecting');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [soundEnabled, setSoundEnabledState] = useState(
    () => localStorage.getItem('adminOrderSoundEnabled') === 'true',
  );
  const listenersRef = useRef(new Set<{ types: Set<string>; listener: RealtimeListener }>());
  const refreshTimerRef = useRef<number | null>(null);
  const summaryRequestRef = useRef<Promise<void> | null>(null);
  const canLoadSummary = role !== 'whatsapp_operator' && role !== 'courier' && role !== 'cashier';

  const refreshSummary = useCallback(async () => {
    if (!canLoadSummary) return;
    if (summaryRequestRef.current) return summaryRequestRef.current;
    const request = api
      .getOperationsSummary()
      .then((response) => {
        if (
          response &&
          typeof response === 'object' &&
          response.counts &&
          response.capabilities &&
          Array.isArray(response.orders)
        ) {
          setSummary(response);
          setLastUpdatedAt(Date.now());
        }
      })
      .catch(() => undefined)
      .finally(() => {
        summaryRequestRef.current = null;
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

  const setSoundEnabled = useCallback((enabled: boolean) => {
    setSoundEnabledState(enabled);
    localStorage.setItem('adminOrderSoundEnabled', String(enabled));
    if (enabled) playOrderTone();
  }, []);

  useEffect(() => {
    setSummary(null);
    void refreshSummary();
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
    const source = new EventSource(
      `/admin/api/events${params.size ? `?${params.toString()}` : ''}`,
      { withCredentials: true },
    );
    source.onopen = () => {
      setConnectionStatus('online');
      setLastUpdatedAt(Date.now());
    };
    source.onerror = () => {
      setConnectionStatus(source.readyState === EventSource.CLOSED ? 'offline' : 'reconnecting');
    };
    const handlers = new Map<string, EventListener>();
    for (const type of EVENT_TYPES) {
      const handler: EventListener = (rawEvent) => {
        if (!(rawEvent instanceof MessageEvent)) return;
        let event: AdminRealtimeEvent;
        try {
          event = JSON.parse(String(rawEvent.data)) as AdminRealtimeEvent;
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
          soundEnabled &&
          String(event.data.paymentStatus || '') === 'paid'
        ) {
          playOrderTone();
        }
      };
      handlers.set(type, handler);
      source.addEventListener(type, handler);
    }
    return () => {
      for (const [type, handler] of handlers) source.removeEventListener(type, handler);
      source.onopen = null;
      source.onerror = null;
      source.close();
    };
  }, [branchId, scheduleSummaryRefresh, soundEnabled]);

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
      connectionStatus,
      lastUpdatedAt,
      refreshSummary,
      subscribe,
      soundEnabled,
      setSoundEnabled,
    }),
    [
      connectionStatus,
      lastUpdatedAt,
      refreshSummary,
      setSoundEnabled,
      soundEnabled,
      subscribe,
      summary,
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
