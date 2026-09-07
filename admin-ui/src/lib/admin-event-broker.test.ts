import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playAdminEventOnce, subscribeAdminEvents } from './admin-event-broker';

class FakeEventSource extends EventTarget {
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = 1;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;
  readonly options: EventSourceInit;
  constructor(url: string, options: EventSourceInit) {
    super();
    this.url = url;
    this.options = options;
    FakeEventSource.instances.push(this);
  }
  emit(type: string, id: string) {
    this.dispatchEvent(
      new MessageEvent(type, {
        data: JSON.stringify({ id, type, data: { paymentStatus: 'paid' } }),
        lastEventId: id,
      }),
    );
  }
  close() {
    this.closed = true;
  }
}

class FakeChannel {
  static channels = new Set<FakeChannel>();
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly name: string;
  constructor(name: string) {
    this.name = name;
    FakeChannel.channels.add(this);
  }
  postMessage(data: unknown) {
    for (const peer of FakeChannel.channels) {
      if (peer !== this && peer.name === this.name) {
        queueMicrotask(() => {
          if (FakeChannel.channels.has(peer))
            peer.onmessage?.(new MessageEvent('message', { data }));
        });
      }
    }
  }
  close() {
    FakeChannel.channels.delete(this);
  }
}

type Waiter = {
  name: string;
  signal?: AbortSignal;
  callback: () => unknown;
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
};

class FakeLocks {
  active = new Set<string>();
  waiting: Waiter[] = [];
  request(name: string, options: LockOptions | (() => unknown), callback?: () => unknown) {
    const fn = typeof options === 'function' ? options : callback!;
    const signal = typeof options === 'function' ? undefined : options.signal;
    return new Promise((resolve, reject) => {
      const waiter = { name, signal, callback: fn, resolve, reject };
      if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      this.waiting.push(waiter);
      signal?.addEventListener(
        'abort',
        () => {
          if (!this.waiting.includes(waiter)) return;
          this.waiting = this.waiting.filter((candidate) => candidate !== waiter);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
      this.advance(name);
    });
  }
  private advance(name: string) {
    if (this.active.has(name)) return;
    const index = this.waiting.findIndex((waiter) => waiter.name === name);
    if (index < 0) return;
    const [waiter] = this.waiting.splice(index, 1);
    this.active.add(name);
    void Promise.resolve()
      .then(waiter.callback)
      .then(waiter.resolve, waiter.reject)
      .finally(() => {
        this.active.delete(name);
        this.advance(name);
      });
  }
}

const activeSources = () => FakeEventSource.instances.filter((source) => !source.closed);
const cleanup: Array<() => void> = [];

function subscribe(identity = 'owner-public-identity', url = '/admin/api/events?scopeBranchId=1') {
  const onEvent = vi.fn();
  const onStatus = vi.fn();
  const close = subscribeAdminEvents({
    identity,
    url,
    eventTypes: ['connected', 'order.created'],
    onEvent,
    onStatus,
  });
  cleanup.push(close);
  return { close, onEvent, onStatus };
}

describe('cross-tab admin SSE broker', () => {
  let locks: FakeLocks;
  beforeEach(() => {
    locks = new FakeLocks();
    localStorage.clear();
    FakeEventSource.instances = [];
    FakeChannel.channels.clear();
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    vi.stubGlobal('navigator', { locks });
  });
  afterEach(() => {
    for (const close of cleanup.splice(0)) close();
    vi.unstubAllGlobals();
  });

  it('shares one connection, delivers to both tabs, replays on leader close and cleans up', async () => {
    const first = subscribe();
    const second = subscribe();
    await vi.waitFor(() => expect(activeSources()).toHaveLength(1));
    const source = activeSources()[0];
    expect(source.options.withCredentials).toBe(true);
    source.onopen?.();
    source.emit('order.created', '41');
    await vi.waitFor(() => {
      expect(first.onEvent).toHaveBeenCalledTimes(1);
      expect(second.onEvent).toHaveBeenCalledTimes(1);
      expect(second.onStatus).toHaveBeenLastCalledWith('online');
    });
    expect(first.onEvent.mock.calls).toEqual(second.onEvent.mock.calls);

    first.close();
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    expect(activeSources()).toHaveLength(1);
    expect(activeSources()[0].url).toContain('lastEventId=41');
    activeSources()[0].emit('connected', '41');
    activeSources()[0].emit('order.created', '42');
    expect(second.onEvent.mock.calls.map(([type]) => type)).toEqual([
      'order.created',
      'connected',
      'order.created',
    ]);
    expect(first.onEvent).toHaveBeenCalledTimes(1);

    second.close();
    await vi.waitFor(() => expect(locks.active.size).toBe(0));
    expect(activeSources()).toHaveLength(0);
    expect(FakeChannel.channels.size).toBe(0);
    expect(locks.waiting).toHaveLength(0);
  });

  it('gives a late subscriber current status and cancels a closed follower without another SSE', async () => {
    const leader = subscribe();
    await vi.waitFor(() => expect(activeSources()).toHaveLength(1));
    activeSources()[0].onopen?.();
    const follower = subscribe();
    await vi.waitFor(() => expect(follower.onStatus).toHaveBeenLastCalledWith('online'));
    follower.close();
    leader.close();
    await vi.waitFor(() => expect(locks.active.size).toBe(0));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(locks.waiting).toHaveLength(0);
  });

  it('does not share events between different user identities or branch scopes', async () => {
    const first = subscribe();
    const otherUser = subscribe('different-user');
    const otherScope = subscribe('owner-public-identity', '/admin/api/events?scopeBranchId=2');
    await vi.waitFor(() => expect(activeSources()).toHaveLength(3));
    activeSources()[0].emit('order.created', '99');
    await Promise.resolve();
    expect(first.onEvent).toHaveBeenCalledOnce();
    expect(otherUser.onEvent).not.toHaveBeenCalled();
    expect(otherScope.onEvent).not.toHaveBeenCalled();
  });

  it('preserves native realtime when browser sharing APIs are unavailable', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const first = subscribe();
    const second = subscribe();
    expect(activeSources()).toHaveLength(2);
    activeSources()[0].emit('connected', '1');
    expect(first.onEvent).toHaveBeenCalledOnce();
    expect(second.onEvent).not.toHaveBeenCalled();
  });

  it('lets an audible tab play when the first tab is blocked, then deduplicates the event', async () => {
    const blocked = vi.fn(() => false);
    const audible = vi.fn(() => true);
    const duplicate = vi.fn(() => true);
    playAdminEventOnce('owner', '42:2026-09-07', blocked);
    playAdminEventOnce('owner', '42:2026-09-07', audible);
    playAdminEventOnce('owner', '42:2026-09-07', duplicate);
    await vi.waitFor(() => expect(locks.active.size).toBe(0));
    expect(blocked).toHaveBeenCalledOnce();
    expect(audible).toHaveBeenCalledOnce();
    expect(duplicate).not.toHaveBeenCalled();
  });
});
