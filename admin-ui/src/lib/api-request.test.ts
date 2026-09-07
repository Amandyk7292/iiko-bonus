import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, applyAdminScopeHeaders, composeRequestAbortSignal } from './api';

describe('admin API request abort composition', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('only sends the literal iikoFront confirmation for kitchen acceptance', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, order: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await api.updateKitchenStatus('order-1', 'ready');
    await api.updateKitchenStatus('order-2', 'preparing', 20, true);

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ status: 'ready' });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      status: 'preparing',
      preparationMinutes: 20,
      iikoManualEntryConfirmed: true,
    });
  });

  it('registers and unregisters a staff device with the strict backend contract', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            device: { platform: 'ios', installationId: 'installation-1' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            enabled: true,
            device: {
              platform: 'ios',
              installationId: 'installation-1',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            delivery: { status: 'sent', attempted: 1, delivered: 1 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, active: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await api.registerStaffPushDevice({
      fcmToken: 'private-token',
      installationId: 'installation-1',
      platform: 'ios',
    });
    await api.getStaffPushDeviceStatus({
      installationId: 'installation-1',
      platform: 'ios',
    });
    await api.testStaffPushDevice({ installationId: 'installation-1', platform: 'ios' });
    await api.touchStaffPushDeviceHeartbeat({
      installationId: 'installation-1',
      platform: 'ios',
    });
    await api.unregisterStaffPushDevice({
      installationId: 'installation-1',
      platform: 'ios',
    });

    expect(fetchMock.mock.calls[0][0]).toBe('/admin/api/staff/push-token');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      fcmToken: 'private-token',
      installationId: 'installation-1',
      platform: 'ios',
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/admin/api/staff/push-token?installationId=installation-1&platform=ios',
    );
    expect(fetchMock.mock.calls[1][1]?.method).toBeUndefined();
    expect(fetchMock.mock.calls[2][0]).toBe('/admin/api/staff/push-test');
    expect(fetchMock.mock.calls[2][1]?.method).toBe('POST');
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      installationId: 'installation-1',
      platform: 'ios',
    });
    expect(fetchMock.mock.calls[3][0]).toBe('/admin/api/staff/push-heartbeat');
    expect(fetchMock.mock.calls[3][1]?.method).toBe('POST');
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toEqual({
      installationId: 'installation-1',
      platform: 'ios',
    });
    expect(fetchMock.mock.calls[4][1]?.method).toBe('DELETE');
    expect(JSON.parse(String(fetchMock.mock.calls[4][1]?.body))).toEqual({
      installationId: 'installation-1',
      platform: 'ios',
    });
  });

  it('does not announce logout until the server confirms session revocation', async () => {
    const unauthorized = vi.fn();
    window.addEventListener('unauthorized', unauthorized);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Internal Server Error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(api.logout()).rejects.toBeDefined();
    expect(unauthorized).not.toHaveBeenCalled();
    window.removeEventListener('unauthorized', unauthorized);
  });

  it('forwards caller cancellation and removes its listener during cleanup', () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener');
    const requestAbort = composeRequestAbortSignal(caller.signal);

    expect(requestAbort.signal.aborted).toBe(false);
    caller.abort();
    expect(requestAbort.signal.aborted).toBe(true);
    expect(requestAbort.didTimeout()).toBe(false);
    vi.advanceTimersByTime(30000);
    expect(requestAbort.didTimeout()).toBe(false);

    requestAbort.cleanup();
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('aborts after 30 seconds and cleanup prevents a later timeout', () => {
    vi.useFakeTimers();

    const timedRequest = composeRequestAbortSignal();
    vi.advanceTimersByTime(29999);
    expect(timedRequest.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(timedRequest.signal.aborted).toBe(true);
    expect(timedRequest.didTimeout()).toBe(true);
    timedRequest.cleanup();

    const completedRequest = composeRequestAbortSignal();
    completedRequest.cleanup();
    vi.advanceTimersByTime(30000);
    expect(completedRequest.signal.aborted).toBe(false);
    expect(completedRequest.didTimeout()).toBe(false);
  });

  it.each([200, 500])(
    'keeps the timeout active while an HTTP %s response body is stalled',
    async (status) => {
      vi.useFakeTimers();
      let signal!: AbortSignal;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((_url: string, options: RequestInit) => {
          signal = options.signal!;
          const body = new ReadableStream({
            start(controller) {
              signal.addEventListener('abort', () =>
                controller.error(new DOMException('Response aborted', 'AbortError')),
              );
            },
          });
          return Promise.resolve(
            new Response(body, { status, headers: { 'Content-Type': 'application/json' } }),
          );
        }),
      );
      let result: unknown;
      const request = api.getSettings().then(
        (value) => {
          result = value;
        },
        (error) => {
          result = error;
        },
      );
      await vi.advanceTimersByTimeAsync(30_000);
      expect(signal.aborted).toBe(true);
      expect(result).toMatchObject({
        code: 'NETWORK_ERROR',
        message: 'Сервер не ответил вовремя. Повторите попытку.',
      });
      await request;
    },
  );

  it('sends every city branch to regular APIs and one technical branch to menu APIs', () => {
    const scope = 'city:%D0%B0%D1%81%D1%82%D0%B0%D0%BD%D0%B0|branch-a,branch-b';
    const operationsHeaders = new Headers();
    applyAdminScopeHeaders(operationsHeaders, '/operations/summary', scope);
    expect(operationsHeaders.get('X-Bulka-Branch-Ids')).toBe('branch-a,branch-b');
    expect(operationsHeaders.has('X-Bulka-Branch-Id')).toBe(false);

    const menuHeaders = new Headers();
    applyAdminScopeHeaders(menuHeaders, '/menu', scope);
    expect(menuHeaders.get('X-Bulka-Branch-Id')).toBe('branch-a');
    expect(menuHeaders.has('X-Bulka-Branch-Ids')).toBe(false);
  });
});
