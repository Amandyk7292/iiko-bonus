import type { StaffPushPlatform } from './api-types';

export const STAFF_PUSH_RESPONSE_EVENT = 'bulka:staff-push-response';
export const STAFF_PUSH_TOKEN_EVENT = 'bulka:staff-push-token';
export const STAFF_PUSH_READY_EVENT = 'bulka:staff-push-ready';
export const STAFF_PUSH_LOGOUT_ROUTE_REQUIRED = 'STAFF_PUSH_LOGOUT_ROUTE_REQUIRED';
export const STAFF_PUSH_LOGOUT_FAILED = 'STAFF_PUSH_LOGOUT_FAILED';

export type StaffPushBridgeAction = 'register' | 'unregister' | 'status';

export interface StaffPushBridgeRequest {
  version: 1;
  requestId: string;
  action: StaffPushBridgeAction;
}

export interface StaffPushBridgeResponse {
  version: 1;
  requestId: string;
  action: StaffPushBridgeAction;
  ok: boolean;
  permission?: string;
  error?: string;
  platform?: StaffPushPlatform;
  installationId?: string;
  fcmToken?: string;
  staffEnrollmentIntent?: boolean;
}

export interface StaffPushTokenRefresh {
  version: 1;
  platform: StaffPushPlatform;
  installationId: string;
  fcmToken: string;
}

declare global {
  interface Window {
    readonly __bulkaStaffPushCapabilityV1?: 1;
    BulkaStaffPushBridge?: {
      request: (payload: StaffPushBridgeRequest) => boolean;
    };
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPlatform = (value: unknown): value is StaffPushPlatform =>
  value === 'ios' || value === 'android';

const isBoundedString = (value: unknown, maxLength: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;

export function hasStaffPushBridge() {
  return typeof window.BulkaStaffPushBridge?.request === 'function';
}

export function hasNativeStaffPushCapability() {
  return window.__bulkaStaffPushCapabilityV1 === 1;
}

export function isStaffPushReadyEvent(event: Event) {
  if (!(event instanceof CustomEvent) || !isRecord(event.detail)) return false;
  return event.detail.version === 1 && isPlatform(event.detail.platform);
}

export function createStaffPushRequestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export function parseStaffPushResponse(
  value: unknown,
  expected: Pick<StaffPushBridgeRequest, 'requestId' | 'action'>,
): StaffPushBridgeResponse | null {
  if (!isRecord(value)) return null;
  if (
    value.version !== 1 ||
    value.requestId !== expected.requestId ||
    value.action !== expected.action ||
    typeof value.ok !== 'boolean' ||
    (value.permission !== undefined &&
      (typeof value.permission !== 'string' || value.permission.length > 64)) ||
    (value.error !== undefined &&
      (typeof value.error !== 'string' || value.error.length > 128)) ||
    (value.staffEnrollmentIntent !== undefined &&
      typeof value.staffEnrollmentIntent !== 'boolean')
  ) {
    return null;
  }
  if (value.platform !== undefined && !isPlatform(value.platform)) return null;
  if (
    value.installationId !== undefined &&
    !isBoundedString(value.installationId, 256)
  ) {
    return null;
  }
  if (value.fcmToken !== undefined && !isBoundedString(value.fcmToken, 8192)) return null;
  if (expected.action !== 'register' && value.fcmToken !== undefined) return null;
  return value as unknown as StaffPushBridgeResponse;
}

export function parseStaffPushTokenRefresh(value: unknown): StaffPushTokenRefresh | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isPlatform(value.platform) ||
    !isBoundedString(value.installationId, 256) ||
    !isBoundedString(value.fcmToken, 8192)
  ) {
    return null;
  }
  return value as unknown as StaffPushTokenRefresh;
}

export function requestStaffPushBridge(
  action: StaffPushBridgeAction,
  timeoutMs = 15_000,
) {
  return new Promise<StaffPushBridgeResponse>((resolve, reject) => {
    const bridge = window.BulkaStaffPushBridge;
    if (typeof bridge?.request !== 'function') {
      reject(new Error('STAFF_PUSH_BRIDGE_UNAVAILABLE'));
      return;
    }

    const request: StaffPushBridgeRequest = {
      version: 1,
      requestId: createStaffPushRequestId(),
      action,
    };
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener(STAFF_PUSH_RESPONSE_EVENT, handleResponse);
    };
    const handleResponse = (event: Event) => {
      const response = parseStaffPushResponse(
        event instanceof CustomEvent ? event.detail : null,
        request,
      );
      if (!response || settled) return;
      settled = true;
      cleanup();
      resolve(response);
    };
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('STAFF_PUSH_BRIDGE_TIMEOUT'));
    }, timeoutMs);

    window.addEventListener(STAFF_PUSH_RESPONSE_EVENT, handleResponse);
    try {
      const accepted = bridge.request(request);
      if (accepted !== true) throw new Error('STAFF_PUSH_BRIDGE_REJECTED');
    } catch {
      settled = true;
      cleanup();
      reject(new Error('STAFF_PUSH_BRIDGE_FAILED'));
    }
  });
}
