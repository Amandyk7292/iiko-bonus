import { act, createRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import {
  STAFF_PUSH_READY_EVENT,
  STAFF_PUSH_RESPONSE_EVENT,
  STAFF_PUSH_TOKEN_EVENT,
  type StaffPushBridgeRequest,
} from '../lib/staff-push-bridge';
import StaffPushControl, { type StaffPushControlHandle } from './StaffPushControl';

const apiMocks = vi.hoisted(() => ({
  registerStaffPushDevice: vi.fn(),
  getStaffPushDeviceStatus: vi.fn(),
  unregisterStaffPushDevice: vi.fn(),
  touchStaffPushDeviceHeartbeat: vi.fn(),
  testStaffPushDevice: vi.fn(),
}));

vi.mock('../lib/api', () => ({ api: apiMocks }));

const renderControl = (
  ref = createRef<StaffPushControlHandle>(),
  props: { active?: boolean; embedded?: boolean } = {},
) => ({
  ref,
  ...render(
    <I18nProvider>
      <StaffPushControl ref={ref} active={props.active ?? true} embedded={props.embedded ?? true} />
    </I18nProvider>,
  ),
});

function respondingBridge(
  onRequest?: (request: StaffPushBridgeRequest) => Partial<{
    ok: boolean;
    permission: string;
    platform: 'ios' | 'android';
    installationId: string;
    fcmToken: string;
    staffEnrollmentIntent: boolean;
    error: string;
  }> | void,
) {
  window.BulkaStaffPushBridge = {
    request: (request) => {
      const overrides = onRequest?.(request) ?? {};
      queueMicrotask(() =>
        window.dispatchEvent(
          new CustomEvent(STAFF_PUSH_RESPONSE_EVENT, {
            detail: {
              version: 1,
              requestId: request.requestId,
              action: request.action,
              ok: true,
              permission: 'authorized',
              platform: 'ios',
              installationId: 'installation-1',
              ...(request.action === 'register' ? { fcmToken: 'private-token' } : {}),
              ...overrides,
            },
          }),
        ),
      );
      return true;
    },
  };
}

describe('embedded cashier staff push control', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('adminLocale', 'ru');
    apiMocks.registerStaffPushDevice.mockReset().mockResolvedValue({
      success: true,
      device: { platform: 'ios', installationId: 'installation-1' },
    });
    apiMocks.getStaffPushDeviceStatus.mockReset().mockResolvedValue({
      success: true,
      enabled: false,
      device: null,
    });
    apiMocks.unregisterStaffPushDevice.mockReset().mockResolvedValue(undefined);
    apiMocks.touchStaffPushDeviceHeartbeat.mockReset().mockResolvedValue({
      success: true,
      active: true,
    });
    apiMocks.testStaffPushDevice.mockReset().mockResolvedValue({
      success: true,
      delivery: { status: 'sent', attempted: 1, delivered: 1 },
    });
    delete window.BulkaStaffPushBridge;
    window.history.replaceState({}, '', '/admin/kitchen');
  });

  it('stays hidden in a regular browser even if a page imitates the embedded query', () => {
    renderControl();
    expect(screen.queryByRole('button', { name: /Push/ })).not.toBeInTheDocument();

    window.history.replaceState({}, '', '/admin/kitchen?embedded=app');
    const view = renderControl();
    expect(screen.queryByRole('button', { name: /Push/ })).not.toBeInTheDocument();
    view.unmount();
  });

  it('allows legacy embedded logout when no native bridge capability was observed', async () => {
    window.history.replaceState({}, '', '/admin/kitchen?embedded=app');
    const { ref } = renderControl();

    await expect(ref.current?.unregisterBeforeLogout()).resolves.toBeUndefined();
    expect(apiMocks.unregisterStaffPushDevice).not.toHaveBeenCalled();
  });

  it('keeps modern embedded logout fail-closed after navigating away from kitchen', async () => {
    window.history.replaceState({}, '', '/admin/kitchen?embedded=app');
    const ref = createRef<StaffPushControlHandle>();
    const view = renderControl(ref);
    respondingBridge();
    act(() => {
      window.dispatchEvent(
        new CustomEvent(STAFF_PUSH_READY_EVENT, {
          detail: { version: 1, platform: 'ios' },
        }),
      );
    });
    await screen.findByRole('button', { name: 'Push выключен' });

    window.history.replaceState({}, '', '/admin/orders?embedded=app');
    view.rerender(
      <I18nProvider>
        <StaffPushControl ref={ref} active={false} embedded />
      </I18nProvider>,
    );

    await expect(ref.current?.unregisterBeforeLogout()).rejects.toThrow(
      'STAFF_PUSH_LOGOUT_ROUTE_REQUIRED',
    );
    expect(apiMocks.unregisterStaffPushDevice).not.toHaveBeenCalled();
  });

  it('detects a modern native app after a full reload outside kitchen and fails logout closed', async () => {
    window.history.replaceState({}, '', '/admin/orders?embedded=app');
    const { ref } = renderControl(createRef<StaffPushControlHandle>(), { active: false });
    expect(window.BulkaStaffPushBridge).toBeUndefined();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(STAFF_PUSH_READY_EVENT, {
          detail: { version: 1, platform: 'ios' },
        }),
      );
    });

    await expect(ref.current?.unregisterBeforeLogout()).rejects.toThrow(
      'STAFF_PUSH_LOGOUT_ROUTE_REQUIRED',
    );
    expect(apiMocks.unregisterStaffPushDevice).not.toHaveBeenCalled();
  });

  it('uses the immutable native capability marker when READY fired before the off-kitchen remount', async () => {
    window.history.replaceState({}, '', '/admin/orders?embedded=app');
    Object.defineProperty(window, '__bulkaStaffPushCapabilityV1', {
      value: 1,
      configurable: true,
    });
    try {
      const { ref } = renderControl(createRef<StaffPushControlHandle>(), { active: false });

      await expect(ref.current?.unregisterBeforeLogout()).rejects.toThrow(
        'STAFF_PUSH_LOGOUT_ROUTE_REQUIRED',
      );
      expect(window.BulkaStaffPushBridge).toBeUndefined();
      expect(apiMocks.unregisterStaffPushDevice).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(window, '__bulkaStaffPushCapabilityV1');
    }
  });

  it('reveals support only after a valid ready event and requires a user click', async () => {
    window.history.replaceState({}, '', '/admin/kitchen?embedded=app');
    renderControl();
    respondingBridge();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(STAFF_PUSH_READY_EVENT, {
          detail: { version: 1, platform: 'browser' },
        }),
      );
    });
    expect(screen.queryByRole('button', { name: /Push/ })).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(STAFF_PUSH_READY_EVENT, {
          detail: { version: 1, platform: 'ios' },
        }),
      );
    });
    expect(await screen.findByRole('button', { name: 'Push выключен' })).toBeInTheDocument();
    expect(apiMocks.registerStaffPushDevice).not.toHaveBeenCalled();
  });

  it('registers after a user click without persisting the token', async () => {
    window.history.replaceState({}, '', '/admin/kitchen?embedded=app');
    respondingBridge();
    renderControl();

    await userEvent.click(await screen.findByRole('button', { name: 'Push выключен' }));

    expect(await screen.findByRole('button', { name: 'Push включён' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(apiMocks.registerStaffPushDevice).toHaveBeenCalledWith({
      fcmToken: 'private-token',
      installationId: 'installation-1',
      platform: 'ios',
    });
    expect(JSON.stringify({ ...localStorage })).not.toContain('private-token');
  });

  it('buffers a token refresh emitted during the initial native registration', async () => {
    window.history.replaceState({}, '', '/admin/kitchen?embedded=app');
    respondingBridge((request) => {
      if (request.action !== 'register') return;
      window.dispatchEvent(
        new CustomEvent(STAFF_PUSH_TOKEN_EVENT, {
          detail: {
            version: 1,
            platform: 'ios',
            installationId: 'installation-1',
            fcmToken: 'early-refresh-token',
          },
        }),
      );
    });
    renderControl();

    await userEvent.click(await screen.findByRole('button', { name: 'Push выключен' }));
    await screen.findByRole('button', { name: 'Push включён' });

    await waitFor(() => expect(apiMocks.registerStaffPushDevice).toHaveBeenCalledTimes(1));
    expect(
      apiMocks.registerStaffPushDevice.mock.calls.map(([payload]) => payload.fcmToken),
    ).toEqual(['early-refresh-token']);
  });

  it('keeps a newer refresh as the final token while restoring enrollment', async () => {
    window.history.replaceState({}, '', '/admin/kitchen?embedded=app');
    apiMocks.getStaffPushDeviceStatus.mockResolvedValue({
      success: true,
      enabled: true,
      device: { platform: 'ios', installationId: 'installation-1' },
    });
    respondingBridge((request) => {
      if (request.action !== 'register') return;
      window.dispatchEvent(
        new CustomEvent(STAFF_PUSH_TOKEN_EVENT, {
          detail: {
            version: 1,
            platform: 'ios',
            installationId: 'installation-1',
            fcmToken: 'restore-refresh-token',
          },
        }),
      );
    });
    renderControl();

    await screen.findByRole('button', { name: 'Push включён' });
    await waitFor(() => expect(apiMocks.registerStaffPushDevice).toHaveBeenCalledTimes(1));
    expect(apiMocks.registerStaffPushDevice).toHaveBeenLastCalledWith({
      fcmToken: 'restore-refresh-token',
      installationId: 'installation-1',
      platform: 'ios',
    });
  });

  it('restores an existing backend enrollment and refreshes its token after reload', async () => {
    window.history.replaceState({}, '', '/admin/kitchen?embedded=app');
    const actions: string[] = [];
    apiMocks.getStaffPushDeviceStatus.mockResolvedValue({
      success: true,
      enabled: true,
      device: { platform: 'ios', installationId: 'installation-1' },
    });
    respondingBridge((request) => {
      actions.push(request.action);
    });
    renderControl();

    expect(await screen.findByRole('button', { name: 'Push включён' })).toBeInTheDocument();
    expect(actions).toEqual(['status', 'register']);
    expect(apiMocks.registerStaffPushDevice).toHaveBeenCalledWith({
      fcmToken: 'private-token',
      installationId: 'installation-1',
      platform: 'ios',
    });
  });

  it('repairs a terminal-deactivated token only for a persisted native opt-in', async () => {
    window.history.replaceState({}, '', '/admin/kitchen?embedded=app');
    const actions: string[] = [];
    respondingBridge((request) => {
      actions.push(request.action);
      return { staffEnrollmentIntent: true };
    });
    renderControl();

    expect(await screen.findByRole('button', { name: 'Push включён' })).toBeInTheDocument();
    expect(actions).toEqual(['status', 'register']);
    expect(apiMocks.registerStaffPushDevice).toHaveBeenCalledWith({
      fcmToken: 'private-token',
      installationId: 'installation-1',
      platform: 'ios',
    });
  });

  it.each([
    { name: 'false', staffEnrollmentIntent: false, permission: 'authorized' },
    { name: 'absent', staffEnrollmentIntent: undefined, permission: 'authorized' },
    { name: 'true without permission', staffEnrollmentIntent: true, permission: 'notDetermined' },
  ])(
    'does not auto-enable a backend-disabled device when native opt-in is $name',
    async ({ staffEnrollmentIntent, permission }) => {
      window.history.replaceState({}, '', '/admin/kitchen?embedded=app');
      const actions: string[] = [];
      respondingBridge((request) => {
        actions.push(request.action);
        return {
          permission,
          ...(staffEnrollmentIntent === undefined ? {} : { staffEnrollmentIntent }),
        };
      });
      renderControl();

      expect(await screen.findByRole('button', { name: 'Push выключен' })).toBeInTheDocument();
      expect(actions).toEqual(['status']);
      expect(apiMocks.registerStaffPushDevice).not.toHaveBeenCalled();
    },
  );

  it('removes a stale backend binding when iPad notification permission is denied', async () => {
    window.history.replaceState({}, '', '/admin/kitchen?embedded=app');
    apiMocks.getStaffPushDeviceStatus.mockResolvedValue({
      success: true,
      enabled: true,
      device: { platform: 'ios', installationId: 'installation-1' },
    });
    window.BulkaStaffPushBridge = {
      request: (request) => {
        queueMicrotask(() =>
          window.dispatchEvent(
            new CustomEvent(STAFF_PUSH_RESPONSE_EVENT, {
              detail: {
                version: 1,
                requestId: request.requestId,
                action: request.action,
                ok: false,
                permission: 'denied',
                error: 'permission_denied',
                platform: 'ios',
                installationId: 'installation-1',
              },
            }),
          ),
        );
        return true;
      },
    };
    renderControl();

    expect(await screen.findByRole('button', { name: 'Push запрещён' })).toBeInTheDocument();
    expect(apiMocks.unregisterStaffPushDevice).toHaveBeenCalledWith({
      platform: 'ios',
      installationId: 'installation-1',
    });
    expect(apiMocks.registerStaffPushDevice).not.toHaveBeenCalled();
  });

  it('does not let a token refresh event re-enable a backend-disabled device', async () => {
    window.history.replaceState({}, '', '/admin/kitchen?embedded=app');
    respondingBridge();
    renderControl();
    await screen.findByRole('button', { name: 'Push выключен' });

    act(() => {
      window.dispatchEvent(
        new CustomEvent(STAFF_PUSH_TOKEN_EVENT, {
          detail: {
            version: 1,
            platform: 'ios',
            installationId: 'installation-1',
            fcmToken: 'unexpected-token',
          },
        }),
      );
    });

    expect(apiMocks.registerStaffPushDevice).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Push выключен' })).toBeInTheDocument();
  });

  it('revokes the authenticated backend device before native unregister on logout', async () => {
    window.history.replaceState({}, '', '/admin/kitchen?embedded=app');
    const order: string[] = [];
    apiMocks.unregisterStaffPushDevice.mockImplementation(async () => {
      order.push('backend');
    });
    respondingBridge((request) => {
      if (request.action === 'unregister') order.push('native');
    });
    const { ref } = renderControl();
    await userEvent.click(await screen.findByRole('button', { name: 'Push выключен' }));
    await screen.findByRole('button', { name: 'Push включён' });

    await act(async () => {
      await ref.current?.unregisterBeforeLogout();
    });

    await waitFor(() => expect(order).toEqual(['backend', 'native']));
    expect(apiMocks.unregisterStaffPushDevice).toHaveBeenCalledWith({
      installationId: 'installation-1',
      platform: 'ios',
    });
  });

  it('blocks logout after native unregister fails and clears intent on retry', async () => {
    window.history.replaceState({}, '', '/admin/kitchen?embedded=app');
    let nativeUnregisterAttempts = 0;
    respondingBridge((request) => {
      if (request.action !== 'unregister') return;
      nativeUnregisterAttempts += 1;
      return nativeUnregisterAttempts === 1
        ? { ok: false, error: 'native_unavailable' }
        : { ok: true };
    });
    const { ref } = renderControl();
    await userEvent.click(await screen.findByRole('button', { name: 'Push выключен' }));
    await screen.findByRole('button', { name: 'Push включён' });

    await expect(ref.current?.unregisterBeforeLogout()).rejects.toThrow('STAFF_PUSH_LOGOUT_FAILED');
    expect(apiMocks.unregisterStaffPushDevice).toHaveBeenCalledTimes(1);

    await expect(ref.current?.unregisterBeforeLogout()).resolves.toBeUndefined();
    expect(apiMocks.unregisterStaffPushDevice).toHaveBeenCalledTimes(2);
    expect(nativeUnregisterAttempts).toBe(2);
  });

  it('retries native unregister after backend disable without registering again', async () => {
    window.history.replaceState({}, '', '/admin/kitchen?embedded=app');
    let nativeRegisterAttempts = 0;
    let nativeUnregisterAttempts = 0;
    respondingBridge((request) => {
      if (request.action === 'register') nativeRegisterAttempts += 1;
      if (request.action !== 'unregister') return;
      nativeUnregisterAttempts += 1;
      return nativeUnregisterAttempts === 1
        ? { ok: false, error: 'native_unavailable' }
        : { ok: true };
    });
    renderControl();
    await userEvent.click(await screen.findByRole('button', { name: 'Push выключен' }));
    await screen.findByRole('button', { name: 'Push включён' });

    await userEvent.click(screen.getByRole('button', { name: 'Push включён' }));
    const retry = await screen.findByRole('button', { name: 'Push: повторить' });
    expect(apiMocks.unregisterStaffPushDevice).toHaveBeenCalledTimes(1);

    await userEvent.click(retry);
    expect(await screen.findByRole('button', { name: 'Push выключен' })).toBeInTheDocument();
    expect(apiMocks.unregisterStaffPushDevice).toHaveBeenCalledTimes(2);
    expect(nativeRegisterAttempts).toBe(1);
    expect(nativeUnregisterAttempts).toBe(2);
  });

  it('waits for an in-flight token refresh before deleting the device', async () => {
    window.history.replaceState({}, '', '/admin/kitchen?embedded=app');
    let finishRefresh!: () => void;
    apiMocks.registerStaffPushDevice
      .mockResolvedValueOnce({
        success: true,
        device: { platform: 'ios', installationId: 'installation-1' },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRefresh = () =>
              resolve({
                success: true,
                device: { platform: 'ios', installationId: 'installation-1' },
              });
          }),
      );
    respondingBridge();
    renderControl();
    await userEvent.click(await screen.findByRole('button', { name: 'Push выключен' }));
    await screen.findByRole('button', { name: 'Push включён' });

    act(() => {
      window.dispatchEvent(
        new CustomEvent(STAFF_PUSH_TOKEN_EVENT, {
          detail: {
            version: 1,
            platform: 'ios',
            installationId: 'installation-1',
            fcmToken: 'rotated-token',
          },
        }),
      );
    });
    await waitFor(() => expect(apiMocks.registerStaffPushDevice).toHaveBeenCalledTimes(2));

    await userEvent.click(screen.getByRole('button', { name: 'Push включён' }));
    expect(screen.getByRole('button', { name: 'Отключаем push…' })).toBeDisabled();
    expect(apiMocks.unregisterStaffPushDevice).not.toHaveBeenCalled();

    finishRefresh();
    expect(await screen.findByRole('button', { name: 'Push выключен' })).toBeInTheDocument();
    expect(apiMocks.unregisterStaffPushDevice).toHaveBeenCalledTimes(1);
  });

  it('sends a test notification only after explicit enrollment and explicit test click', async () => {
    window.history.replaceState({}, '', '/admin/kitchen?embedded=app');
    respondingBridge();
    renderControl();
    await userEvent.click(await screen.findByRole('button', { name: 'Push выключен' }));
    await screen.findByRole('button', { name: 'Push включён' });

    expect(apiMocks.testStaffPushDevice).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Проверить push' }));

    expect(await screen.findByRole('button', { name: 'Тест отправлен' })).toBeInTheDocument();
    expect(apiMocks.testStaffPushDevice).toHaveBeenCalledWith({
      installationId: 'installation-1',
      platform: 'ios',
    });
  });

  it('heartbeats only after native enrollment becomes active', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    window.history.replaceState({}, '', '/admin/kitchen?embedded=app');
    respondingBridge();
    const view = renderControl();
    expect(apiMocks.touchStaffPushDeviceHeartbeat).not.toHaveBeenCalled();

    await userEvent.click(await screen.findByRole('button', { name: 'Push выключен' }));
    await screen.findByRole('button', { name: 'Push включён' });
    await waitFor(() =>
      expect(apiMocks.touchStaffPushDeviceHeartbeat).toHaveBeenCalledWith({
        installationId: 'installation-1',
        platform: 'ios',
      }),
    );

    const heartbeatTimer = setIntervalSpy.mock.calls.find(([, delay]) => delay === 30_000);
    expect(heartbeatTimer).toBeDefined();
    apiMocks.touchStaffPushDeviceHeartbeat.mockClear();
    const heartbeatTick = heartbeatTimer?.[0] as () => void;
    act(() => heartbeatTick());
    await waitFor(() => expect(apiMocks.touchStaffPushDeviceHeartbeat).toHaveBeenCalledTimes(1));

    const timerId = setIntervalSpy.mock.results.find(
      (_, index) => setIntervalSpy.mock.calls[index]?.[1] === 30_000,
    )?.value;
    view.unmount();
    expect(clearIntervalSpy).toHaveBeenCalledWith(timerId);
  });
});
