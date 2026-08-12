import { describe, expect, it, vi } from 'vitest';
import { createStaffPushTokenQueue } from './staff-push-token-queue';

const device = { platform: 'ios' as const, installationId: 'installation-1' };
const token = (fcmToken: string) => ({ version: 1 as const, ...device, fcmToken });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('staff push token refresh queue', () => {
  it('buffers an initial refresh until the enrollment device is known', async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const onLatestSuccess = vi.fn();
    const queue = createStaffPushTokenQueue({
      register,
      onLatestSuccess,
      onLatestError: vi.fn(),
    });

    queue.enqueue(token('initial-token'));
    await Promise.resolve();
    expect(register).not.toHaveBeenCalled();

    queue.setDevice(device);
    await vi.waitFor(() => expect(register).toHaveBeenCalledWith(token('initial-token')));
    await vi.waitFor(() => expect(onLatestSuccess).toHaveBeenCalledWith(token('initial-token')));
  });

  it('does not seed an older bridge token after a newer refresh was already observed', async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const onLatestSuccess = vi.fn();
    const queue = createStaffPushTokenQueue({
      register,
      onLatestSuccess,
      onLatestError: vi.fn(),
    });
    queue.setDevice(device);
    const beforeNativeRequest = queue.captureRefreshVersion();

    queue.enqueue(token('new-refresh-token'));
    await vi.waitFor(() =>
      expect(onLatestSuccess).toHaveBeenCalledWith(token('new-refresh-token')),
    );
    queue.setDeviceAndSeed(device, token('older-bridge-token'), beforeNativeRequest);
    await Promise.resolve();

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenLastCalledWith(token('new-refresh-token'));
  });

  it('uses the bridge seed when no refresh arrived during the native request', async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const queue = createStaffPushTokenQueue({
      register,
      onLatestSuccess: vi.fn(),
      onLatestError: vi.fn(),
    });
    const beforeNativeRequest = queue.captureRefreshVersion();

    queue.setDeviceAndSeed(device, token('bridge-token'), beforeNativeRequest);

    await vi.waitFor(() => expect(register).toHaveBeenCalledWith(token('bridge-token')));
  });

  it('serializes writes and makes the newest token the final backend write', async () => {
    const first = deferred();
    const second = deferred();
    const register = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const onLatestSuccess = vi.fn();
    const onLatestError = vi.fn();
    const queue = createStaffPushTokenQueue({ register, onLatestSuccess, onLatestError });
    queue.setDevice(device);

    queue.enqueue(token('old-token'));
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    queue.enqueue(token('newer-token'));
    queue.enqueue(token('newest-token'));
    expect(register).toHaveBeenCalledTimes(1);

    first.resolve();
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(2));
    expect(register.mock.calls[1][0]).toEqual(token('newest-token'));
    expect(onLatestSuccess).not.toHaveBeenCalled();

    second.resolve();
    await vi.waitFor(() =>
      expect(onLatestSuccess).toHaveBeenCalledWith(token('newest-token')),
    );
    expect(onLatestError).not.toHaveBeenCalled();
  });

  it('does not let an older failed response overwrite a queued newer token', async () => {
    const first = deferred();
    const register = vi
      .fn()
      .mockReturnValueOnce(first.promise.then(() => Promise.reject(new Error('old failed'))))
      .mockResolvedValueOnce(undefined);
    const onLatestSuccess = vi.fn();
    const onLatestError = vi.fn();
    const queue = createStaffPushTokenQueue({ register, onLatestSuccess, onLatestError });
    queue.setDevice(device);
    queue.enqueue(token('old-token'));
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    queue.enqueue(token('new-token'));

    first.resolve();
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(onLatestSuccess).toHaveBeenCalledWith(token('new-token')));
    expect(onLatestError).not.toHaveBeenCalled();
  });

  it('waits for an in-flight registration before allowing device removal', async () => {
    const registration = deferred();
    const queue = createStaffPushTokenQueue({
      register: vi.fn().mockReturnValue(registration.promise),
      onLatestSuccess: vi.fn(),
      onLatestError: vi.fn(),
    });
    queue.setDevice(device);
    queue.enqueue(token('rotated-token'));
    await Promise.resolve();

    let quiesced = false;
    const waiting = queue.clearAndWait().then(() => {
      quiesced = true;
    });
    await Promise.resolve();
    expect(quiesced).toBe(false);

    registration.resolve();
    await waiting;
    expect(quiesced).toBe(true);
  });
});
