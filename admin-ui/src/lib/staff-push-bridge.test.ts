import { describe, expect, it, vi } from 'vitest';
import {
  hasNativeStaffPushCapability,
  isStaffPushReadyEvent,
  parseStaffPushResponse,
  parseStaffPushTokenRefresh,
  requestStaffPushBridge,
  STAFF_PUSH_RESPONSE_EVENT,
} from './staff-push-bridge';

describe('staff push native bridge contract', () => {
  it('recognizes only the exact native capability marker version', () => {
    Object.defineProperty(window, '__bulkaStaffPushCapabilityV1', {
      value: 1,
      configurable: true,
    });
    expect(hasNativeStaffPushCapability()).toBe(true);

    Object.defineProperty(window, '__bulkaStaffPushCapabilityV1', {
      value: 2,
      configurable: true,
    });
    expect(hasNativeStaffPushCapability()).toBe(false);
    Reflect.deleteProperty(window, '__bulkaStaffPushCapabilityV1');
  });

  it('accepts only the exact versioned response for the pending request', () => {
    const expected = { requestId: 'request-1', action: 'register' as const };
    const valid = {
      version: 1,
      requestId: 'request-1',
      action: 'register',
      ok: true,
      permission: 'authorized',
      platform: 'ios',
      installationId: 'installation-1',
      fcmToken: 'private-token',
    };

    expect(parseStaffPushResponse(valid, expected)).toEqual(valid);
    expect(parseStaffPushResponse({ ...valid, version: 2 }, expected)).toBeNull();
    expect(parseStaffPushResponse({ ...valid, requestId: 'other' }, expected)).toBeNull();
    expect(parseStaffPushResponse({ ...valid, platform: 'web' }, expected)).toBeNull();
    expect(
      parseStaffPushResponse({ ...valid, staffEnrollmentIntent: true }, expected),
    ).toEqual({ ...valid, staffEnrollmentIntent: true });
    expect(
      parseStaffPushResponse({ ...valid, staffEnrollmentIntent: 'true' }, expected),
    ).toBeNull();
    expect(
      parseStaffPushResponse(
        { ...valid, action: 'status' },
        { requestId: 'request-1', action: 'status' },
      ),
    ).toBeNull();
  });

  it('validates ready and token refresh events before trusting their detail', () => {
    expect(
      isStaffPushReadyEvent(
        new CustomEvent('bulka:staff-push-ready', {
          detail: { version: 1, platform: 'ios' },
        }),
      ),
    ).toBe(true);
    expect(
      isStaffPushReadyEvent(
        new CustomEvent('bulka:staff-push-ready', {
          detail: { version: 1, platform: 'browser' },
        }),
      ),
    ).toBe(false);
    expect(
      parseStaffPushTokenRefresh({
        version: 1,
        platform: 'ios',
        installationId: 'installation-1',
        fcmToken: 'rotated-token',
      }),
    ).not.toBeNull();
    expect(
      parseStaffPushTokenRefresh({
        version: 1,
        platform: 'ios',
        installationId: '',
        fcmToken: 'rotated-token',
      }),
    ).toBeNull();
  });

  it('ignores unrelated responses and resolves the matching native response', async () => {
    vi.stubGlobal('crypto', {
      ...crypto,
      randomUUID: () => 'request-1',
    });
    window.BulkaStaffPushBridge = {
      request: vi.fn(() => {
        window.dispatchEvent(
          new CustomEvent(STAFF_PUSH_RESPONSE_EVENT, {
            detail: {
              version: 1,
              requestId: 'wrong-request',
              action: 'register',
              ok: true,
              permission: 'authorized',
            },
          }),
        );
        window.dispatchEvent(
          new CustomEvent(STAFF_PUSH_RESPONSE_EVENT, {
            detail: {
              version: 1,
              requestId: 'request-1',
              action: 'register',
              ok: true,
              permission: 'authorized',
              platform: 'ios',
              installationId: 'installation-1',
              fcmToken: 'private-token',
            },
          }),
        );
        return true;
      }),
    };

    await expect(requestStaffPushBridge('register')).resolves.toMatchObject({
      requestId: 'request-1',
      ok: true,
    });
    expect(window.BulkaStaffPushBridge?.request).toHaveBeenCalledWith({
      version: 1,
      requestId: 'request-1',
      action: 'register',
    });
    vi.unstubAllGlobals();
    delete window.BulkaStaffPushBridge;
  });
});
