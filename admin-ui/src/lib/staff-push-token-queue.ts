import type { StaffPushDevice } from './api-types';
import type { StaffPushTokenRefresh } from './staff-push-bridge';

interface StaffPushTokenQueueOptions {
  register: (token: StaffPushTokenRefresh) => Promise<unknown>;
  onLatestSuccess: (token: StaffPushTokenRefresh) => void;
  onLatestError: () => void;
}

const sameDevice = (device: StaffPushDevice, token: StaffPushTokenRefresh) =>
  device.platform === token.platform && device.installationId === token.installationId;

/**
 * Keeps at most one pending refresh and performs writes serially. A token that
 * arrives while a previous write is in flight replaces the pending token, so
 * the last completed backend write is always the newest observed token.
 */
export function createStaffPushTokenQueue(options: StaffPushTokenQueueOptions) {
  let active = true;
  let device: StaffPushDevice | null = null;
  let pending: StaffPushTokenRefresh | null = null;
  let running = false;
  let generation = 0;
  let refreshVersion = 0;
  const refreshVersionByDevice = new Map<string, number>();
  const idleWaiters = new Set<() => void>();

  const deviceKey = (value: StaffPushDevice) =>
    `${value.platform}:${value.installationId}`;

  const assignDevice = (nextDevice: StaffPushDevice) => {
    const changed = !device ||
      device.platform !== nextDevice.platform ||
      device.installationId !== nextDevice.installationId;
    device = nextDevice;
    if (changed) generation += 1;
  };

  const resolveIdleWaiters = () => {
    if (running) return;
    idleWaiters.forEach((resolve) => resolve());
    idleWaiters.clear();
  };

  const drain = async () => {
    if (!active || running || !device || !pending) return;
    running = true;
    const startedGeneration = generation;
    try {
      while (active && device && pending && generation === startedGeneration) {
        const token = pending;
        pending = null;
        if (!sameDevice(device, token)) continue;
        let succeeded = false;
        try {
          await options.register(token);
          succeeded = true;
        } catch {
          succeeded = false;
        }
        if (!active || generation !== startedGeneration) return;
        // A newer token supersedes both success and failure feedback from this
        // request. Process it before exposing a final UI state.
        if (pending) continue;
        if (succeeded) options.onLatestSuccess(token);
        else options.onLatestError();
      }
    } finally {
      running = false;
      if (active && device && pending) void drain();
      else resolveIdleWaiters();
    }
  };

  return {
    captureRefreshVersion() {
      return refreshVersion;
    },
    setDevice(nextDevice: StaffPushDevice) {
      assignDevice(nextDevice);
      void drain();
    },
    setDeviceAndSeed(
      nextDevice: StaffPushDevice,
      seed: StaffPushTokenRefresh,
      refreshVersionBeforeRequest: number,
    ) {
      assignDevice(nextDevice);
      const matchingRefreshVersion = refreshVersionByDevice.get(deviceKey(nextDevice)) ?? 0;
      if (matchingRefreshVersion <= refreshVersionBeforeRequest) {
        pending = seed;
      } else if (pending && !sameDevice(nextDevice, pending)) {
        pending = null;
      }
      void drain();
    },
    enqueue(token: StaffPushTokenRefresh) {
      if (!active) return;
      refreshVersion += 1;
      const key = deviceKey(token);
      if (!refreshVersionByDevice.has(key) && refreshVersionByDevice.size >= 8) {
        const oldestKey = refreshVersionByDevice.keys().next().value;
        if (oldestKey !== undefined) refreshVersionByDevice.delete(oldestKey);
      }
      refreshVersionByDevice.set(key, refreshVersion);
      pending = token;
      void drain();
    },
    clear() {
      generation += 1;
      device = null;
      pending = null;
      refreshVersionByDevice.clear();
    },
    async clearAndWait() {
      generation += 1;
      device = null;
      pending = null;
      refreshVersionByDevice.clear();
      if (!running) return;
      await new Promise<void>((resolve) => idleWaiters.add(resolve));
    },
    dispose() {
      active = false;
      generation += 1;
      device = null;
      pending = null;
      refreshVersionByDevice.clear();
      resolveIdleWaiters();
    },
  };
}
