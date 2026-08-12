import 'dart:convert';

const staffPushBridgeVersion = 1;
const staffPushBridgeReadyEvent = 'bulka:staff-push-ready';
const staffPushBridgeResponseEvent = 'bulka:staff-push-response';
const staffPushBridgeTokenEvent = 'bulka:staff-push-token';
const staffPushNativeChannel = '_BulkaStaffPushNative';
const staffPushCapabilityMarker = '__bulkaStaffPushCapabilityV1';

enum StaffPushBridgeAction {
  status('status'),
  register('register'),
  unregister('unregister');

  const StaffPushBridgeAction(this.wireName);

  final String wireName;
}

final class StaffPushBridgeRequest {
  const StaffPushBridgeRequest({
    required this.requestId,
    required this.action,
    required this.userInitiated,
  });

  final String requestId;
  final StaffPushBridgeAction action;
  final bool userInitiated;

  static StaffPushBridgeRequest? tryParse(
    String raw, {
    required String expectedNonce,
  }) {
    if (raw.isEmpty || raw.length > 4096 || expectedNonce.isEmpty) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic> ||
          decoded.length != 5 ||
          decoded['version'] != staffPushBridgeVersion ||
          decoded['nonce'] != expectedNonce) {
        return null;
      }
      if (!decoded.keys.every(
        const {
          'version',
          'requestId',
          'action',
          'nonce',
          'userInitiated',
        }.contains,
      )) {
        return null;
      }
      final requestId = decoded['requestId'];
      final action = decoded['action'];
      final userInitiated = decoded['userInitiated'];
      if (requestId is! String ||
          !RegExp(r'^[A-Za-z0-9_-]{8,80}$').hasMatch(requestId) ||
          action is! String ||
          userInitiated is! bool) {
        return null;
      }
      final parsedAction = StaffPushBridgeAction.values
          .where((candidate) => candidate.wireName == action)
          .firstOrNull;
      if (parsedAction == null) return null;
      return StaffPushBridgeRequest(
        requestId: requestId,
        action: parsedAction,
        userInitiated: userInitiated,
      );
    } catch (_) {
      return null;
    }
  }
}

typedef StaffPushBridgeHandler =
    Future<Map<String, Object?>> Function(StaffPushBridgeRequest request);

bool isStaffPushBridgePath(String path) {
  final normalized = path.length > 1 && path.endsWith('/')
      ? path.substring(0, path.length - 1)
      : path;
  return normalized == '/admin/kitchen';
}

bool isStaffPushCapabilityPath(String path) {
  final normalized = path.length > 1 && path.endsWith('/')
      ? path.substring(0, path.length - 1)
      : path;
  return normalized == '/admin' || normalized.startsWith('/admin/');
}

/// Builds the page-local capability bootstrap. Every trusted admin page learns
/// that it is inside the native app, so logout can fail closed off-kitchen.
/// The request channel and wrapper are emitted only for the exact kitchen path.
String buildStaffPushBridgeBootstrap({
  required String platform,
  required String? nonce,
  required bool exposeRequestBridge,
}) {
  final readyEventJson = jsonEncode(staffPushBridgeReadyEvent);
  final platformJson = jsonEncode(platform);
  final requestBootstrap = exposeRequestBridge && nonce != null
      ? '''
          const nativeChannel = window.$staffPushNativeChannel;
          if (nativeChannel && typeof nativeChannel.postMessage === 'function') {
            const nonce = ${jsonEncode(nonce)};
            const bridge = Object.freeze({
              version: $staffPushBridgeVersion,
              request(request) {
                if (!request || typeof request !== 'object') return false;
                nativeChannel.postMessage(JSON.stringify({
                  version: request.version,
                  requestId: request.requestId,
                  action: request.action,
                  nonce,
                  userInitiated: Boolean(
                    navigator.userActivation && navigator.userActivation.isActive
                  ),
                }));
                return true;
              },
            });
            Object.defineProperty(window, 'BulkaStaffPushBridge', {
              value: bridge,
              configurable: true,
              enumerable: false,
              writable: false,
            });
          }
        '''
      : '''
          try { delete window.BulkaStaffPushBridge; } catch (_) {}
        ''';
  return '''
    (() => {
      if (window.top !== window) return;
      const capabilityKey = '$staffPushCapabilityMarker';
      const requestBridgeWasAvailable = Boolean(
        window.BulkaStaffPushBridge &&
        typeof window.BulkaStaffPushBridge.request === 'function'
      );
      const capabilityWasMissing =
        window[capabilityKey] !== $staffPushBridgeVersion;
      const announceCapability = capabilityWasMissing ||
        (${exposeRequestBridge ? 'true' : 'false'} && !requestBridgeWasAvailable);
      if (capabilityWasMissing) {
        try {
          Object.defineProperty(window, capabilityKey, {
            value: $staffPushBridgeVersion,
            configurable: false,
            enumerable: false,
            writable: false,
          });
        } catch (_) {}
      }
      $requestBootstrap
      if (announceCapability) {
        window.dispatchEvent(new CustomEvent($readyEventJson, {
          detail: Object.freeze({
            version: $staffPushBridgeVersion,
            platform: $platformJson,
          }),
        }));
      }
    })();
  ''';
}

bool supportsNativeStaffPushBridge({
  required bool isWeb,
  required String platform,
}) {
  if (isWeb) return false;
  return platform == 'ios' || platform == 'android';
}
