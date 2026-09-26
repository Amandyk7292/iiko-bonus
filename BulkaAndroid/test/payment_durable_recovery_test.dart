import 'dart:convert';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _PaymentApi extends BulkaApiClient {
  _PaymentApi(this.status);
  final String status;
  int calls = 0;
  @override
  Future<Map<String, dynamic>> checkFortePaymentStatus(
    String operationId,
  ) async {
    calls++;
    if (status == 'offline') throw Exception('offline');
    return {'paymentStatus': status};
  }

  @override
  Future<Map<String, dynamic>> checkForteCheckoutStatus(String checkoutId) =>
      checkFortePaymentStatus(checkoutId);
  @override
  Stream<Map<String, dynamic>> get customerEvents => const Stream.empty();
  @override
  Future<List<DeliveryAddress>> getCustomerAddresses() async => [];
  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async => [];
  @override
  Future<bool> isFortePaymentAvailable() async => false;
  @override
  Future<Map<String, dynamic>> getPersonalAccount() async => {'enabled': false};
}

const _checkout = '4c230b1a-8b2c-434a-86de-c152b4a0c112';
Future<SharedPreferences> _saveOld(
  _PaymentApi api, {
  bool withOperation = true,
  int days = 3,
}) async {
  final prefs = await SharedPreferences.getInstance();
  final date = DateTime.now()
      .subtract(Duration(days: days))
      .toUtc()
      .toIso8601String();
  if (withOperation) {
    await prefs.setString(
      'pending_forte_operation_v1_session',
      jsonEncode({
        'operationId': 'old-operation',
        'checkoutId': _checkout,
        'cartRevision': 'same-cart',
        'createdAt': date,
      }),
    );
  }
  await prefs.setString(
    customerPreferenceKey('checkout_id', api.sessionCacheScope),
    _checkout,
  );
  await prefs.setString(
    customerPreferenceKey('checkout_cart_revision', api.sessionCacheScope),
    'same-cart',
  );
  await prefs.setString(
    customerPreferenceKey('checkout_id_created_at', api.sessionCacheScope),
    date,
  );
  return prefs;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({}));
  for (final status in ['paid', 'pending', 'offline', 'failed']) {
    for (final withOperation in [true, false]) {
      test(
        'old $status payment is resolved with operation=$withOperation',
        () async {
          final api = _PaymentApi(status);
          final prefs = await _saveOld(api, withOperation: withOperation);
          final result = await PendingForteOperationStore.resolveForCheckout(
            api,
            cartRevision: 'same-cart',
          );
          expect(api.calls, 1);
          expect(result?.checkoutId, status == 'failed' ? isNull : _checkout);
          expect(
            prefs.getString(
              customerPreferenceKey('checkout_id', api.sessionCacheScope),
            ),
            status == 'failed' ? isNull : _checkout,
          );
          api.dispose();
        },
      );
    }
  }
  test(
    'clock moving backwards does not forget an unresolved payment',
    () async {
      final api = _PaymentApi('offline');
      await _saveOld(api, days: -30);
      final result = await PendingForteOperationStore.resolveForCheckout(
        api,
        cartRevision: 'same-cart',
      );
      expect(result?.checkoutId, _checkout);
      expect(api.calls, 1);
      api.dispose();
    },
  );
  test(
    'an unresolved gift keeps its request id after a month offline',
    () async {
      final api = _PaymentApi('offline');
      final draft = PendingGiftPurchase(
        requestId: _checkout,
        amount: 5000,
        recipientPhone: '+77000000000',
        paymentMethod: 'forte',
        createdAt: DateTime.now().subtract(const Duration(days: 30)),
        purchaseId: 'gift-purchase',
      );
      await PendingGiftPurchaseStore.save(api, draft);
      final restored = await PendingGiftPurchaseStore.load(api);
      expect(restored?.requestId, _checkout);
      expect(restored?.purchaseId, 'gift-purchase');
      api.dispose();
    },
  );
  test('old unresolved payment still blocks a changed cart', () async {
    final api = _PaymentApi('pending');
    await _saveOld(api);
    await expectLater(
      PendingForteOperationStore.resolveForCheckout(
        api,
        cartRevision: 'changed-cart',
      ),
      throwsA(isA<ApiException>()),
    );
    expect((await PendingForteOperationStore.load(api))?.checkoutId, _checkout);
    api.dispose();
  });
  testWidgets('loading checkout preferences never deletes an old checkout id', (
    tester,
  ) async {
    final api = _PaymentApi('offline');
    final prefs = await _saveOld(api, withOperation: false);
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: buildCheckoutScreenForTest(
          api: api,
          total: 10,
          cartItems: const [
            {'id': 'bun', 'quantity': 1},
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      prefs.getString(
        customerPreferenceKey('checkout_id', api.sessionCacheScope),
      ),
      _checkout,
    );
    await tester.pumpWidget(const SizedBox.shrink());
    api.dispose();
  });
}
