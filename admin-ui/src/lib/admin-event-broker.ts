type StreamStatus = 'connecting' | 'online' | 'reconnecting' | 'offline';

interface StreamOptions {
  url: string;
  // Public identity/permissions only. Never include cookies or access tokens.
  identity?: string;
  eventTypes: readonly string[];
  onEvent: (type: string, data: string, lastEventId: string) => void;
  onStatus: (status: StreamStatus) => void;
}

/** One authenticated SSE per identity and scope, with a lock-backed tab leader. */
export function subscribeAdminEvents(options: StreamOptions): () => void {
  let stopped = false;
  let source: EventSource | null = null;
  let channel: BroadcastChannel | null = null;
  let releaseLeader: (() => void) | undefined;
  let lastEventId = '';
  let status: StreamStatus = 'connecting';
  const abort = new AbortController();
  const eventTypes = new Set(options.eventTypes);
  const key = `bulka-admin-events:v1:${JSON.stringify([options.identity, options.url])}`;

  const setStatus = (next: StreamStatus, broadcast = false) => {
    if (stopped) return;
    status = next;
    options.onStatus(next);
    if (broadcast) channel?.postMessage({ kind: 'status', status: next, lastEventId });
  };
  const receive = (type: string, data: string, cursor: string) => {
    if (stopped) return;
    if (cursor) lastEventId = cursor;
    options.onEvent(type, data, cursor);
  };
  const open = () => {
    if (stopped) return;
    const url = new URL(options.url, window.location.href);
    if (lastEventId) url.searchParams.set('lastEventId', lastEventId);
    setStatus('connecting', true);
    source = new EventSource(url.pathname + url.search, { withCredentials: true });
    const current = source;
    current.onopen = () => setStatus('online', true);
    current.onerror = () =>
      setStatus(current.readyState === EventSource.CLOSED ? 'offline' : 'reconnecting', true);
    for (const type of eventTypes) {
      current.addEventListener(type, (raw) => {
        if (stopped || source !== current || !(raw instanceof MessageEvent)) return;
        const data = String(raw.data);
        const cursor = raw.lastEventId || '';
        receive(type, data, cursor);
        channel?.postMessage({ kind: 'event', type, data, lastEventId: cursor });
      });
    }
  };
  const closeSource = () => {
    if (!source) return;
    source.onopen = null;
    source.onerror = null;
    source.close();
    source = null;
  };

  const supportsSharing =
    Boolean(options.identity) &&
    typeof BroadcastChannel === 'function' &&
    typeof navigator.locks?.request === 'function';
  if (!supportsSharing) {
    open();
  } else {
    try {
      channel = new BroadcastChannel(key);
      channel.onmessage = ({ data: message }) => {
        if (stopped || !message || typeof message !== 'object') return;
        if (message.kind === 'hello' && source) {
          channel?.postMessage({ kind: 'status', status, lastEventId });
        } else if (message.kind === 'status' && !source) {
          if (['connecting', 'online', 'reconnecting', 'offline'].includes(message.status)) {
            if (typeof message.lastEventId === 'string' && message.lastEventId) {
              lastEventId = message.lastEventId;
            }
            setStatus(message.status);
          }
        } else if (
          message.kind === 'event' &&
          !source &&
          eventTypes.has(message.type) &&
          typeof message.data === 'string' &&
          typeof message.lastEventId === 'string'
        ) {
          receive(message.type, message.data, message.lastEventId);
        }
      };
      channel.postMessage({ kind: 'hello' });
      void navigator.locks
        .request(key, { signal: abort.signal }, async () => {
          if (stopped) return;
          try {
            await new Promise<void>((resolve) => {
              releaseLeader = resolve;
              open();
            });
          } finally {
            closeSource();
            releaseLeader = undefined;
          }
        })
        .catch((error) => {
          if (stopped || error?.name === 'AbortError') return;
          // Browser policies may expose but disallow locks. Preserve realtime.
          channel?.close();
          channel = null;
          closeSource();
          open();
        });
    } catch {
      channel?.close();
      channel = null;
      open();
    }
  }

  return () => {
    if (stopped) return;
    stopped = true;
    closeSource();
    abort.abort();
    releaseLeader?.();
    channel?.close();
    channel = null;
  };
}

/** A blocked audio context must not claim an event away from an audible tab. */
export function playAdminEventOnce(identity: string, eventId: string, play: () => boolean) {
  const key = `bulka-admin-event-audio:v1:${identity}`;
  const attempt = () => {
    let recent: string[] = [];
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) || '[]');
      if (Array.isArray(stored)) recent = stored.filter((value) => typeof value === 'string');
    } catch {
      /* Audio must work when storage is unavailable. */
    }
    if (recent.includes(eventId) || !play()) return;
    try {
      localStorage.setItem(key, JSON.stringify([...recent.slice(-63), eventId]));
    } catch {
      /* Storage can be disabled independently of WebAudio. */
    }
  };
  if (typeof navigator.locks?.request === 'function') {
    void navigator.locks.request(key, attempt).catch(() => attempt());
  } else {
    attempt();
  }
}
