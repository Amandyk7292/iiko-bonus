import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _RecoveryApi extends BulkaApiClient {
  _RecoveryApi(this.status);
  final String status;

  @override
  Future<Map<String, dynamic>> checkForteCheckoutStatus(String checkoutId) =>
      checkFortePaymentStatus(checkoutId);

  @override
  Future<Map<String, dynamic>> checkFortePaymentStatus(
    String operationId,
  ) async {
    if (status == 'offline') throw Exception('offline');
    return {'paymentStatus': status};
  }
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  for (final status in ['refunded', 'expired', 'failed', 'cancelled']) {
    test(
      'a $status payment cannot restore an old bank session for a new cart',
      () async {
        final api = _RecoveryApi(status);
        await PendingForteOperationStore.save(
          api,
          operationId: 'old-payment',
          checkoutId: 'old-checkout',
        );
        final prefs = await SharedPreferences.getInstance();
        final key = customerPreferenceKey('checkout_id', api.sessionCacheScope);
        await prefs.setString(key, 'old-checkout');
        expect(
          await PendingForteOperationStore.resolveForCheckout(api),
          isNull,
        );
        expect(await PendingForteOperationStore.load(api), isNull);
        expect(prefs.getString(key), isNull);
        expect(isTerminalForteFailure(status), isTrue);
      },
    );
  }

  for (final status in ['pending', 'paid', 'offline']) {
    test(
      '$status keeps the original operation to avoid a second charge',
      () async {
        final api = _RecoveryApi(status);
        await PendingForteOperationStore.save(
          api,
          operationId: 'existing-payment',
          checkoutId: 'existing-checkout',
        );
        final pending = await PendingForteOperationStore.resolveForCheckout(
          api,
        );
        expect(pending?.operationId, 'existing-payment');
        expect(pending?.checkoutId, 'existing-checkout');
      },
    );
  }

  for (final status in ['paid', 'refunded', 'expired', 'failed', 'cancelled']) {
    test('explicit reorder starts fresh after $status', () async {
      final api = _RecoveryApi(status);
      await PendingForteOperationStore.save(
        api,
        operationId: 'old-payment',
        checkoutId: 'old-checkout',
      );
      final prefs = await SharedPreferences.getInstance();
      final key = customerPreferenceKey('checkout_id', api.sessionCacheScope);
      final schedule = customerPreferenceKey(
        'checkout_scheduled_at',
        api.sessionCacheScope,
      );
      await prefs.setString(key, 'old-checkout');
      await prefs.setString(schedule, 'old-time');
      await PendingForteOperationStore.prepareNewCheckout(api);
      expect(await PendingForteOperationStore.load(api), isNull);
      expect(prefs.getString(key), isNull);
      expect(prefs.getString(schedule), isNull);
    });
  }

  for (final status in ['pending', 'offline']) {
    test('reorder preserves an unresolved $status payment', () async {
      final api = _RecoveryApi(status);
      await PendingForteOperationStore.save(
        api,
        operationId: 'existing-payment',
        checkoutId: 'existing-checkout',
      );
      await expectLater(
        PendingForteOperationStore.prepareNewCheckout(api),
        throwsA(isA<ApiException>()),
      );
      expect(
        (await PendingForteOperationStore.load(api))?.checkoutId,
        'existing-checkout',
      );
    });
  }

  test('reorder resolves a checkout whose create response was lost', () async {
    final api = _RecoveryApi('paid');
    final prefs = await SharedPreferences.getInstance();
    final key = customerPreferenceKey('checkout_id', api.sessionCacheScope);
    await prefs.setString(key, 'saved-request-without-operation');
    await PendingForteOperationStore.prepareNewCheckout(api);
    expect(prefs.getString(key), isNull);
  });

  test(
    'late result from a previous checkout cannot erase the new payment',
    () async {
      final api = _RecoveryApi('paid');
      final prefs = await SharedPreferences.getInstance();
      final key = customerPreferenceKey('checkout_id', api.sessionCacheScope);
      await prefs.setString(key, 'new-checkout');
      await PendingForteOperationStore.save(
        api,
        operationId: 'new-payment',
        checkoutId: 'new-checkout',
      );
      await PendingForteOperationStore.clear(
        api,
        expectedCheckoutId: 'old-checkout',
      );
      expect(prefs.getString(key), 'new-checkout');
      expect(
        (await PendingForteOperationStore.load(api))?.operationId,
        'new-payment',
      );
    },
  );
}
