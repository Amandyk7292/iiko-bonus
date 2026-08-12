import { Bell, Send } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { api, type StaffPushDevice } from '../lib/api';
import { useI18n } from '../lib/i18n';
import {
  hasStaffPushBridge,
  hasNativeStaffPushCapability,
  isStaffPushReadyEvent,
  parseStaffPushTokenRefresh,
  requestStaffPushBridge,
  STAFF_PUSH_LOGOUT_FAILED,
  STAFF_PUSH_LOGOUT_ROUTE_REQUIRED,
  STAFF_PUSH_READY_EVENT,
  STAFF_PUSH_TOKEN_EVENT,
} from '../lib/staff-push-bridge';
import { createStaffPushTokenQueue } from '../lib/staff-push-token-queue';

type PushState = 'checking' | 'idle' | 'enabling' | 'enabled' | 'disabling' | 'denied' | 'error';

export interface StaffPushControlHandle {
  unregisterBeforeLogout: () => Promise<void>;
}

function safeDeviceFromNative(value: {
  platform?: StaffPushDevice['platform'];
  installationId?: string;
}): StaffPushDevice | null {
  if (!value.platform || !value.installationId) return null;
  return { platform: value.platform, installationId: value.installationId };
}

const permissionAllowsPush = (permission?: string) =>
  permission === 'authorized' || permission === 'provisional';

const StaffPushControl = forwardRef<StaffPushControlHandle, { active: boolean; embedded: boolean }>(
  function StaffPushControl({ active, embedded }, ref) {
    const { t } = useI18n();
    const [bridgeAvailable, setBridgeAvailable] = useState(
      () => active && embedded && hasStaffPushBridge(),
    );
    const [state, setState] = useState<PushState>('checking');
    const [testState, setTestState] = useState<'idle' | 'testing' | 'sent' | 'error'>('idle');
    const deviceRef = useRef<StaffPushDevice | null>(null);
    const suppressRefreshRef = useRef(false);
    const nativeBridgeCapableRef = useRef(
      embedded && (hasNativeStaffPushCapability() || hasStaffPushBridge()),
    );
    const tokenQueueRef = useRef<ReturnType<typeof createStaffPushTokenQueue> | null>(null);
    const createTokenQueue = () =>
      createStaffPushTokenQueue({
        register: (token) =>
          api.registerStaffPushDevice({
            fcmToken: token.fcmToken,
            installationId: token.installationId,
            platform: token.platform,
          }),
        onLatestSuccess: (token) => {
          deviceRef.current = {
            installationId: token.installationId,
            platform: token.platform,
          };
          setState('enabled');
        },
        onLatestError: () => setState('error'),
      });
    tokenQueueRef.current ??= createTokenQueue();

    useEffect(() => {
      tokenQueueRef.current ??= createTokenQueue();
      return () => {
        tokenQueueRef.current?.dispose();
        tokenQueueRef.current = null;
        deviceRef.current = null;
      };
    }, []);

    useEffect(() => {
      if (active) {
        suppressRefreshRef.current = false;
        return;
      }
      suppressRefreshRef.current = true;
      tokenQueueRef.current?.clear();
      deviceRef.current = null;
    }, [active]);

    useEffect(() => {
      if (!embedded) {
        setBridgeAvailable(false);
        return;
      }
      const refreshAvailability = (event?: Event) => {
        if (event && !isStaffPushReadyEvent(event)) return;
        if (event || hasNativeStaffPushCapability()) nativeBridgeCapableRef.current = true;
        setBridgeAvailable(active && hasStaffPushBridge());
      };
      window.addEventListener(STAFF_PUSH_READY_EVENT, refreshAvailability);
      refreshAvailability();
      return () => window.removeEventListener(STAFF_PUSH_READY_EVENT, refreshAvailability);
    }, [active, embedded]);

    useEffect(() => {
      if (!active || !embedded || !bridgeAvailable) return;
      let effectActive = true;
      const synchronizeExistingEnrollment = async () => {
        setState('checking');
        try {
          const status = await requestStaffPushBridge('status');
          const device = safeDeviceFromNative(status);
          if (!effectActive) return;
          if (!device) {
            setState(status.permission === 'denied' ? 'denied' : 'idle');
            return;
          }
          const backendStatus = await api.getStaffPushDeviceStatus(device);
          if (!effectActive) return;
          const denied = status.permission === 'denied' || status.error === 'permission_denied';
          const shouldRepairNativeEnrollment =
            !backendStatus.enabled &&
            status.ok &&
            status.staffEnrollmentIntent === true &&
            permissionAllowsPush(status.permission);
          if (!backendStatus.enabled && !shouldRepairNativeEnrollment) {
            suppressRefreshRef.current = true;
            tokenQueueRef.current?.clear();
            deviceRef.current = null;
            setState(denied ? 'denied' : 'idle');
            return;
          }
          if (backendStatus.enabled) {
            deviceRef.current = backendStatus.device ?? device;
            tokenQueueRef.current?.setDevice(deviceRef.current);
          }
          if (backendStatus.enabled && denied) {
            suppressRefreshRef.current = true;
            await tokenQueueRef.current?.clearAndWait();
            await api.unregisterStaffPushDevice(device).catch(() => undefined);
            if (!effectActive) return;
            deviceRef.current = null;
            setState('denied');
            return;
          }
          if (!status.ok) {
            setState('error');
            return;
          }
          suppressRefreshRef.current = false;
          // This does not prompt: either the backend enrollment already exists or
          // native persisted the employee's prior opt-in and permission is allowed.
          // It refreshes the current token and reactivates native token forwarding.
          const refreshVersion = tokenQueueRef.current?.captureRefreshVersion() ?? 0;
          const refresh = await requestStaffPushBridge('register');
          const refreshedDevice = safeDeviceFromNative(refresh);
          if (!effectActive) return;
          if (!refresh.ok || !refreshedDevice || !refresh.fcmToken) {
            const refreshDenied =
              refresh.permission === 'denied' || refresh.error === 'permission_denied';
            if (refreshDenied) {
              suppressRefreshRef.current = true;
              await tokenQueueRef.current?.clearAndWait();
              if (backendStatus.enabled) {
                await api.unregisterStaffPushDevice(device).catch(() => undefined);
              }
              deviceRef.current = null;
            }
            setState(refreshDenied ? 'denied' : 'error');
            return;
          }
          deviceRef.current = refreshedDevice;
          tokenQueueRef.current?.setDeviceAndSeed(
            refreshedDevice,
            {
              version: 1,
              ...refreshedDevice,
              fcmToken: refresh.fcmToken,
            },
            refreshVersion,
          );
        } catch {
          if (effectActive) setState('error');
        }
      };
      void synchronizeExistingEnrollment();
      return () => {
        effectActive = false;
      };
    }, [active, bridgeAvailable, embedded]);

    useEffect(() => {
      if (!active || !embedded || !bridgeAvailable || state !== 'enabled') return;
      let effectActive = true;
      let heartbeatInFlight = false;
      const heartbeat = async () => {
        const device = deviceRef.current;
        if (
          !effectActive ||
          heartbeatInFlight ||
          !device ||
          document.visibilityState !== 'visible' ||
          !navigator.onLine
        ) {
          return;
        }
        heartbeatInFlight = true;
        try {
          const response = await api.touchStaffPushDeviceHeartbeat(device);
          if (effectActive && response.active !== true) setState('error');
        } catch {
          // A transient heartbeat failure is surfaced by the durable no-iPad
          // monitor if the device does not recover within the freshness window.
        } finally {
          heartbeatInFlight = false;
        }
      };
      const resumeHeartbeat = () => void heartbeat();
      const interval = window.setInterval(resumeHeartbeat, 30_000);
      document.addEventListener('visibilitychange', resumeHeartbeat);
      window.addEventListener('online', resumeHeartbeat);
      void heartbeat();
      return () => {
        effectActive = false;
        window.clearInterval(interval);
        document.removeEventListener('visibilitychange', resumeHeartbeat);
        window.removeEventListener('online', resumeHeartbeat);
      };
    }, [active, bridgeAvailable, embedded, state]);

    useEffect(() => {
      if (!active || !embedded || !bridgeAvailable) return;
      let effectActive = true;
      const handleTokenRefresh = (event: Event) => {
        if (!effectActive || suppressRefreshRef.current || !(event instanceof CustomEvent)) return;
        const token = parseStaffPushTokenRefresh(event.detail);
        if (token) tokenQueueRef.current?.enqueue(token);
      };
      window.addEventListener(STAFF_PUSH_TOKEN_EVENT, handleTokenRefresh);
      return () => {
        effectActive = false;
        window.removeEventListener(STAFF_PUSH_TOKEN_EVENT, handleTokenRefresh);
      };
    }, [active, bridgeAvailable, embedded]);

    const enable = useCallback(async () => {
      if (!bridgeAvailable || state === 'enabling' || state === 'disabling') return;
      suppressRefreshRef.current = false;
      setState('enabling');
      try {
        const refreshVersion = tokenQueueRef.current?.captureRefreshVersion() ?? 0;
        const response = await requestStaffPushBridge('register');
        const device = safeDeviceFromNative(response);
        if (!response.ok || !device || !response.fcmToken) {
          setState(
            response.permission === 'denied' || response.error === 'permission_denied'
              ? 'denied'
              : 'error',
          );
          return;
        }
        deviceRef.current = device;
        tokenQueueRef.current?.setDeviceAndSeed(
          device,
          { version: 1, ...device, fcmToken: response.fcmToken },
          refreshVersion,
        );
        setTestState('idle');
      } catch {
        await tokenQueueRef.current?.clearAndWait();
        deviceRef.current = null;
        await requestStaffPushBridge('unregister', 2_000).catch(() => undefined);
        setState('error');
      }
    }, [bridgeAvailable, state]);

    const disable = useCallback(async () => {
      const device = deviceRef.current;
      if (!device || state === 'enabling' || state === 'disabling') return;
      suppressRefreshRef.current = true;
      setState('disabling');
      await tokenQueueRef.current?.clearAndWait();
      try {
        await api.unregisterStaffPushDevice(device);
        const nativeResult = await requestStaffPushBridge('unregister');
        if (!nativeResult.ok) throw new Error(STAFF_PUSH_LOGOUT_FAILED);
        deviceRef.current = null;
        setTestState('idle');
        setState('idle');
      } catch {
        setState('error');
      }
    }, [state]);

    useImperativeHandle(
      ref,
      () => ({
        unregisterBeforeLogout: async () => {
          suppressRefreshRef.current = true;
          await tokenQueueRef.current?.clearAndWait();
          if (!embedded) return;
          // Legacy installed apps used ?embedded=app before the native staff-push
          // bridge existed. Server logout remains safe for them because session
          // revocation removes every backend binding.
          if (!nativeBridgeCapableRef.current) return;
          if (!active || !bridgeAvailable) {
            throw new Error(STAFF_PUSH_LOGOUT_ROUTE_REQUIRED);
          }
          try {
            let device = deviceRef.current;
            if (!device) {
              const status = await requestStaffPushBridge('status', 2_000);
              if (!status.ok) throw new Error(STAFF_PUSH_LOGOUT_FAILED);
              device = safeDeviceFromNative(status);
            }
            if (!device) throw new Error(STAFF_PUSH_LOGOUT_FAILED);
            await api.unregisterStaffPushDevice(device);
            const nativeResult = await requestStaffPushBridge('unregister', 2_000);
            if (!nativeResult.ok) throw new Error(STAFF_PUSH_LOGOUT_FAILED);
            deviceRef.current = null;
          } catch {
            throw new Error(STAFF_PUSH_LOGOUT_FAILED);
          }
        },
      }),
      [active, bridgeAvailable, embedded],
    );

    const testNotification = useCallback(async () => {
      const device = deviceRef.current;
      if (!device || state !== 'enabled' || testState === 'testing') return;
      setTestState('testing');
      try {
        const response = await api.testStaffPushDevice(device);
        if (response.delivery.delivered !== 1) throw new Error('STAFF_PUSH_TEST_FAILED');
        setTestState('sent');
      } catch {
        setTestState('error');
      }
    }, [state, testState]);

    if (!active || !embedded || !bridgeAvailable) return null;

    const pending = state === 'checking' || state === 'enabling' || state === 'disabling';
    const enabled = state === 'enabled';
    const label = t(`staff.push.${state}`);
    return (
      <div className="cashier-push-wrap">
        <button
          type="button"
          className={`btn-outline cashier-push-toggle cashier-push-${state}`}
          aria-label={label}
          aria-pressed={enabled}
          disabled={pending}
          title={t(`staff.push.${state}Hint`)}
          onClick={() => void (enabled || deviceRef.current ? disable() : enable())}
        >
          <Bell aria-hidden="true" size={18} className={pending ? 'is-pending' : undefined} />
          <span>{label}</span>
        </button>
        {enabled && (
          <button
            type="button"
            className="btn-outline cashier-push-test"
            disabled={testState === 'testing'}
            onClick={() => void testNotification()}
          >
            <Send aria-hidden="true" size={18} />
            <span>
              {t(
                testState === 'testing'
                  ? 'staff.push.testing'
                  : testState === 'sent'
                    ? 'staff.push.testSent'
                    : testState === 'error'
                      ? 'staff.push.testError'
                      : 'staff.push.test',
              )}
            </span>
          </button>
        )}
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {label}
          {enabled
            ? ` ${t(
                testState === 'testing'
                  ? 'staff.push.testing'
                  : testState === 'sent'
                    ? 'staff.push.testSent'
                    : testState === 'error'
                      ? 'staff.push.testError'
                      : 'staff.push.test',
              )}`
            : ''}
        </span>
      </div>
    );
  },
);

export default StaffPushControl;
