import 'dart:async';
import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/core/staff_push_bridge_contract.dart';
import 'package:bulka_bonus/core/staff_push_enrollment_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _CustomerPushApi extends BulkaApiClient {
  _CustomerPushApi(String phone) {
    setSession(accessToken: 'test-access-token', cacheScope: phone);
  }

  bool failClear = false;
  int clearCalls = 0;
  String? markerDuringClear;
  String? clearedInstallationId;
  String? clearedToken;

  @override
  Future<void> clearFcmToken({
    required String installationId,
    String? fcmToken,
  }) async {
    clearCalls++;
    clearedInstallationId = installationId;
    clearedToken = fcmToken;
    markerDuringClear = (await SharedPreferences.getInstance()).getString(
      'pendingCustomerPushUnregistersV1',
    );
    if (failClear) throw StateError('offline');
  }
}

void main() {
  const installationId = 'push-installation-test-123';
  const fcmToken = 'customer-fcm-token-value-1234567890';

  setUp(() {
    PushNotifications.deleteInstallationTokenForTesting = null;
    PushNotifications.getInstallationTokenForTesting = null;
    PushNotifications.setStaffPushBridgeActivated(false);
    FlutterSecureStorage.setMockInitialValues({});
    SharedPreferences.setMockInitialValues({
      'pushInstallationIdV1': installationId,
      'lastRegisteredFcmTokenV1': fcmToken,
    });
  });

  tearDown(() {
    PushNotifications.deleteInstallationTokenForTesting = null;
    PushNotifications.getInstallationTokenForTesting = null;
    PushNotifications.setStaffPushBridgeActivated(false);
  });

  test(
    'failed customer unlink remains durable and retries after auth',
    () async {
      final api = _CustomerPushApi('+7 (776) 200-33-90')..failClear = true;

      expect(
        await PushNotifications.unregister(
          api,
          customerIdentity: '+7 (776) 200-33-90',
        ),
        isFalse,
      );

      final prefs = await SharedPreferences.getInstance();
      final pending =
          jsonDecode(prefs.getString('pendingCustomerPushUnregistersV1')!)
              as List<dynamic>;
      expect(api.clearCalls, 1);
      expect(api.markerDuringClear, isNotNull);
      expect(pending, [
        {'customerIdentity': '77762003390', 'installationId': installationId},
      ]);
      expect(prefs.getString('lastRegisteredFcmTokenV1'), fcmToken);

      api.failClear = false;
      expect(
        await PushNotifications.retryPendingCustomerUnregister(api),
        isTrue,
      );
      expect(api.clearCalls, 2);
      expect(api.clearedInstallationId, installationId);
      expect(prefs.getString('pendingCustomerPushUnregistersV1'), isNull);
      expect(prefs.getString('lastRegisteredFcmTokenV1'), isNull);
    },
  );

  test(
    'pending unlink is never replayed with another customer session',
    () async {
      final firstCustomer = _CustomerPushApi('+7 776 200 33 90')
        ..failClear = true;
      expect(
        await PushNotifications.unregister(
          firstCustomer,
          customerIdentity: '+7 776 200 33 90',
        ),
        isFalse,
      );

      final otherCustomer = _CustomerPushApi('+7 701 555 00 11');
      expect(
        await PushNotifications.retryPendingCustomerUnregister(otherCustomer),
        isTrue,
      );
      expect(otherCustomer.clearCalls, 0);
      expect(
        (await SharedPreferences.getInstance()).getString(
          'pendingCustomerPushUnregistersV1',
        ),
        isNotNull,
      );
    },
  );

  test(
    'forced logout invalidates FCM but preserves staff rebind identity',
    () async {
      final api = _CustomerPushApi('+7 776 200 33 90');
      var deleteCalls = 0;
      PushNotifications.deleteInstallationTokenForTesting = () async {
        deleteCalls++;
      };

      await PushNotifications.deferCustomerUnregister(
        api,
        customerIdentity: '+7 776 200 33 90',
        invalidateInstallationToken: true,
      );

      final prefs = await SharedPreferences.getInstance();
      expect(deleteCalls, 1);
      expect(prefs.getString('lastRegisteredFcmTokenV1'), isNull);
      expect(prefs.getBool('pendingFirebaseTokenDeletionV1'), isNull);
      expect(prefs.getString('pendingCustomerPushUnregistersV1'), isNotNull);
      expect(await PushNotifications.installationId(), installationId);
    },
  );

  test(
    'forced rotation rebinds only while trusted enrolled bridge is active',
    () async {
      final api = _CustomerPushApi('+7 776 200 33 90');
      final prefs = await SharedPreferences.getInstance();
      await StaffPushEnrollmentStore.write(true);
      PushNotifications.deleteInstallationTokenForTesting = () async {};
      PushNotifications.getInstallationTokenForTesting = () async =>
          'fresh-staff-fcm-token-value-9876543210';
      final events = <Map<String, Object?>>[];
      final subscription = PushNotifications.staffTokenEvents.listen(
        events.add,
      );

      await PushNotifications.deferCustomerUnregister(
        api,
        customerIdentity: '+7 776 200 33 90',
        invalidateInstallationToken: true,
      );
      await Future<void>.delayed(Duration.zero);
      expect(events, isEmpty);
      expect(prefs.getBool('pendingStaffPushTokenRebindV1'), isTrue);

      PushNotifications.setStaffPushBridgeActivated(true);
      await Future<void>.delayed(const Duration(milliseconds: 20));

      expect(events, hasLength(1));
      expect(events.single['installationId'], installationId);
      expect(
        events.single['fcmToken'],
        'fresh-staff-fcm-token-value-9876543210',
      );
      expect(prefs.getBool('pendingStaffPushTokenRebindV1'), isTrue);
      await subscription.cancel();
    },
  );

  test(
    'refresh away from kitchen is recovered without persisting token',
    () async {
      final prefs = await SharedPreferences.getInstance();
      await StaffPushEnrollmentStore.write(true);
      PushNotifications.getInstallationTokenForTesting = () async =>
          'current-fcm-token-after-return-1234567890';
      final events = <Map<String, Object?>>[];
      final subscription = PushNotifications.staffTokenEvents.listen(
        events.add,
      );

      await PushNotifications.handleStaffTokenRefreshForTesting(
        'rotated-token-while-portal-was-away-1234567890',
      );
      expect(events, isEmpty);
      expect(prefs.getBool('pendingStaffPushTokenRebindV1'), isTrue);
      expect(
        prefs.get('pendingStaffPushTokenRebindV1'),
        isTrue,
        reason: 'the marker must never contain the raw FCM token',
      );

      PushNotifications.setStaffPushBridgeActivated(true);
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(events, hasLength(1));
      expect(
        events.single['fcmToken'],
        'current-fcm-token-after-return-1234567890',
      );
      await subscription.cancel();
    },
  );

  test('explicit staff unregister clears durable enrollment intent', () async {
    final prefs = await SharedPreferences.getInstance();
    await StaffPushEnrollmentStore.write(true);
    await prefs.setBool('pendingStaffPushTokenRebindV1', true);
    final response = await PushNotifications.handleStaffPushBridgeRequest(
      const StaffPushBridgeRequest(
        requestId: 'unregister-staff-test',
        action: StaffPushBridgeAction.unregister,
        userInitiated: true,
      ),
    );

    expect(response['ok'], isTrue);
    expect(response['staffEnrollmentIntent'], isFalse);
    expect(await StaffPushEnrollmentStore.read(), isFalse);
    expect(prefs.getBool('pendingStaffPushTokenRebindV1'), isNull);
  });

  test('confirmed manual unlink never deletes the shared FCM token', () async {
    final api = _CustomerPushApi('+7 776 200 33 90');
    var deleteCalls = 0;
    PushNotifications.deleteInstallationTokenForTesting = () async {
      deleteCalls++;
    };

    expect(
      await PushNotifications.unregister(
        api,
        customerIdentity: '+7 776 200 33 90',
      ),
      isTrue,
    );

    expect(deleteCalls, 0);
    expect(api.clearCalls, 1);
    expect(
      (await SharedPreferences.getInstance()).getBool(
        'pendingFirebaseTokenDeletionV1',
      ),
      isNull,
    );
  });

  test('failed forced token deletion retries at next initialization', () async {
    final api = _CustomerPushApi('+7 776 200 33 90');
    var deleteCalls = 0;
    PushNotifications.deleteInstallationTokenForTesting = () async {
      deleteCalls++;
      if (deleteCalls == 1) throw StateError('offline');
    };

    await PushNotifications.deferCustomerUnregister(
      api,
      customerIdentity: '+7 776 200 33 90',
      invalidateInstallationToken: true,
    );

    final prefs = await SharedPreferences.getInstance();
    expect(deleteCalls, 1);
    expect(prefs.getBool('pendingFirebaseTokenDeletionV1'), isTrue);
    expect(prefs.getString('lastRegisteredFcmTokenV1'), fcmToken);

    await PushNotifications.initialize();

    expect(deleteCalls, 2);
    expect(prefs.getBool('pendingFirebaseTokenDeletionV1'), isNull);
    expect(prefs.getString('lastRegisteredFcmTokenV1'), isNull);
    expect(await PushNotifications.installationId(), installationId);
  });

  test(
    'logged-out foreground resume retries deletion once and gates staff rebind',
    () async {
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('phone'), isNull, reason: 'the app is logged out');
      await prefs.setBool('pendingFirebaseTokenDeletionV1', true);
      await prefs.setBool('pendingStaffPushTokenRebindV1', true);
      await StaffPushEnrollmentStore.write(true);

      final deletionGate = Completer<void>();
      var deletionCalls = 0;
      PushNotifications.deleteInstallationTokenForTesting = () async {
        deletionCalls++;
        await deletionGate.future;
      };
      PushNotifications.getInstallationTokenForTesting = () async =>
          'resume-rebound-staff-token-1234567890';
      final events = <Map<String, Object?>>[];
      final subscription = PushNotifications.staffTokenEvents.listen(
        events.add,
      );

      final firstResume = resumePushNotifications();
      final duplicateResume = resumePushNotifications();
      await Future<void>.delayed(Duration.zero);

      expect(deletionCalls, 1, reason: 'concurrent resumes are coalesced');
      expect(events, isEmpty, reason: 'no trusted kitchen bridge is active');
      deletionGate.complete();
      await Future.wait([firstResume, duplicateResume]);
      expect(prefs.getBool('pendingFirebaseTokenDeletionV1'), isNull);
      expect(events, isEmpty);

      PushNotifications.setStaffPushBridgeActivated(true);
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(events, hasLength(1));
      expect(
        events.single['fcmToken'],
        'resume-rebound-staff-token-1234567890',
      );

      await subscription.cancel();
    },
  );

  test('push processing is blocked while token deletion is pending', () async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('pendingFirebaseTokenDeletionV1', true);

    expect(
      await PushNotifications.claimMessage(const {
        'type': 'staff.order.new',
        'pushOutboxId': '33333333-3333-4333-8333-333333333333',
      }),
      isFalse,
    );
    expect(prefs.getStringList('seenPushOutboxIdsV1'), isNull);
  });

  test(
    'staff dedupe key suppresses replay and aliases the outbox id',
    () async {
      const dedupeKey = 'staff-order:11111111-1111-4111-8111-111111111111';
      const outboxId = '22222222-2222-4222-8222-222222222222';

      expect(
        await PushNotifications.claimMessage(const {
          'type': 'staff.order.new',
          'pushDedupeKey': dedupeKey,
        }),
        isTrue,
      );
      expect(
        await PushNotifications.claimMessage(const {
          'type': 'staff.order.new',
          'pushOutboxId': outboxId,
          'pushDedupeKey': dedupeKey,
        }),
        isFalse,
      );
      expect(
        await PushNotifications.claimMessage(const {
          'type': 'staff.order.new',
          'pushOutboxId': outboxId,
        }),
        isFalse,
      );

      final persisted = (await SharedPreferences.getInstance()).getStringList(
        'seenPushOutboxIdsV1',
      );
      expect(persisted, containsAll(<String>[dedupeKey, outboxId]));
    },
  );

  test('concurrent push claims have exactly one winner', () async {
    const payload = <String, dynamic>{
      'type': 'staff.order.new',
      'pushOutboxId': '44444444-4444-4444-8444-444444444444',
    };

    final claims = await Future.wait(
      List<Future<bool>>.generate(
        12,
        (_) => PushNotifications.claimMessage(payload),
      ),
    );

    expect(claims.where((value) => value), hasLength(1));
  });

  test('unbounded or malformed dedupe values are not persisted', () async {
    final malformed = 'staff-order:${'x' * 250}';
    expect(
      await PushNotifications.claimMessage({
        'type': 'staff.order.new',
        'pushDedupeKey': malformed,
      }),
      isTrue,
    );
    expect(
      (await SharedPreferences.getInstance()).getStringList(
        'seenPushOutboxIdsV1',
      ),
      isNull,
    );
  });
}
