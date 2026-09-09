import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _RecoveryApi extends BulkaApiClient {
  _RecoveryApi(this.status);
  final String status;

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
}
