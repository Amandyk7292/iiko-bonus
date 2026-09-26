import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _CartApi extends BulkaApiClient {
  _CartApi(this.newPaymentStatus, {this.wallet = false}) {
    setSession(accessToken: 'test-session');
  }
  final String newPaymentStatus;
  final bool wallet;
  String? submittedMethod;
  double? submittedTotal;
  @override
  Future<Map<String, dynamic>> getPersonalAccount() async => {
    'enabled': wallet,
    'balance': 100,
    'blocked': false,
    'entries': [],
  };
  final attempts = <String>[];
  final time = DateTime.now().toUtc().add(const Duration(hours: 2));
  @override
  void trackEvent(
    String event, {
    String? productId,
    String? categoryId,
    String? branchId,
    String? orderId,
    Map<String, dynamic> properties = const {},
  }) {}
  @override
  Future<Map<String, dynamic>> checkForteCheckoutStatus(String id) async => {
    'paymentStatus': 'paid',
  };
  @override
  Future<List<DeliveryAddress>> getCustomerAddresses() async => [];
  @override
  Future<bool> isFortePaymentAvailable() async => true;
  @override
  Future<List<Map<String, dynamic>>> getFortePaymentMethods() async => [
    {'id': 'card-one', 'brand': 'visa', 'lastFour': '0000', 'isDefault': true},
  ];
  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async => [
    const BakeryLocation(
      id: 'branch-one',
      name: 'Филиал',
      address: 'Дом 1',
      city: 'Актау',
    ),
  ];
  @override
  Future<List<FulfillmentSlot>> getFulfillmentSlots({
    required String branchId,
    required String orderType,
    int days = 7,
    List<String> productIds = const [],
  }) async => [
    FulfillmentSlot(
      startsAt: time,
      endsAt: time.add(const Duration(hours: 1)),
      capacity: 10,
      remaining: 10,
      serverTime: time.subtract(const Duration(hours: 2)),
    ),
  ];
  @override
  Future<Map<String, dynamic>> quoteForteOrder({
    required List<Map<String, dynamic>> cartItems,
    String? orderType,
    String? branch,
    String? branchId,
    String? scheduledAt,
    String? preorderFulfillmentType,
    DeliveryAddress? deliveryAddress,
    String? promoCode,
    bool useBonuses = false,
  }) async => {
    'success': true,
    'subtotal': 35,
    'discount': 0,
    'deliveryFee': 0,
    'bonusAvailable': 0,
    'bonusMaximum': 0,
    'bonusSpent': 0,
    'total': 35,
  };
  @override
  Future<Map<String, dynamic>> createFortePayment({
    String paymentMethod = 'forte_card',
    double? expectedTotal,
    required List<Map<String, dynamic>> cartItems,
    required String orderType,
    required String? scheduledAt,
    required String checkoutId,
    String? savedPaymentMethodId,
    bool useBonuses = false,
    int expectedBonusSpent = 0,
    String? deliveryQuoteToken,
    String? preorderFulfillmentType,
    String? branch,
    String? branchId,
    DeliveryAddress? deliveryAddress,
    String? additionalPhone,
    String? promoCode,
    String? comment,
    String substitutionPreference = 'call_customer',
  }) async {
    attempts.add(checkoutId);
    submittedMethod = paymentMethod;
    submittedTotal = expectedTotal;
    if (wallet) expect(savedPaymentMethodId, isNull);
    return {
      'success': true,
      'operationId': checkoutId,
      'paymentStatus': newPaymentStatus,
    };
  }
}

void main() {
  for (final scenario in [
    ('paid', false),
    ('pending', false),
    ('paid', true),
  ]) {
    final (status, wallet) = scenario;
    testWidgets(
      'new cart does not reuse old success; new payment is $status wallet=$wallet',
      (tester) async {
        appLanguageNotifier.value = 'ru';
        SharedPreferences.setMockInitialValues({});
        tester.view.physicalSize = const Size(430, 1800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final api = _CartApi(status, wallet: wallet);
        final prefs = await SharedPreferences.getInstance();
        const previousCheckout = '4c230b1a-8b2c-434a-86de-c152b4a0c112';
        await prefs.setString(
          customerPreferenceKey('checkout_id', api.sessionCacheScope),
          previousCheckout,
        );
        await prefs.setString(
          customerPreferenceKey(
            'checkout_id_created_at',
            api.sessionCacheScope,
          ),
          DateTime.now().toUtc().toIso8601String(),
        );
        await prefs.setString('selected_bakery_location', 'Филиал');
        await prefs.setString('selected_bakery_location_id', 'branch-one');
        await prefs.setString(
          customerPreferenceKey('checkout_scheduled_at', api.sessionCacheScope),
          api.time.toIso8601String(),
        );
        final cart = CartProvider();
        await cart.restored;
        cart.addItem(
          productId: 'bun',
          name: 'Булочка',
          price: 35,
          imageUrl: '',
        );
        await tester.pumpWidget(
          ChangeNotifierProvider.value(
            value: cart,
            child: MaterialApp(
              theme: buildBulkaTheme(),
              home: OrdersScreen(
                api: api,
                customer: Customer.fromJson({
                  'id': 'customer',
                  'name': 'Покупатель',
                  'phone': '77000000000',
                }),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('Оформить заказ'));
        await tester.pumpAndSettle();
        if (wallet) {
          expect(
            find.byKey(const ValueKey('checkout-payment-method')),
            findsOneWidget,
          );
          await tester.tap(
            find.byKey(const ValueKey('checkout-personal-account')),
          );
          await tester.pumpAndSettle();
          expect(
            find.byKey(const ValueKey('checkout-card-payment-choice')),
            findsOneWidget,
          );
          expect(
            find.byKey(const ValueKey('checkout-payment-method')),
            findsNothing,
          );
          expect(find.text('•••• 0000'), findsNothing);

          await tester.tap(
            find.byKey(const ValueKey('checkout-card-payment-choice')),
          );
          await tester.pumpAndSettle();
          expect(
            find.byKey(const ValueKey('checkout-payment-method')),
            findsOneWidget,
          );
          expect(find.text('•••• 0000'), findsOneWidget);

          await tester.tap(
            find.byKey(const ValueKey('checkout-personal-account')),
          );
          await tester.pumpAndSettle();
        }
        final submit = find.byKey(const ValueKey('checkout-submit'));
        expect(tester.widget<GradientButton>(submit).onPressed, isNotNull);
        await tester.tap(submit);
        await tester.pumpAndSettle();
        expect(api.attempts, hasLength(1));
        expect(api.submittedMethod, wallet ? 'personal_account' : 'forte_card');
        expect(api.submittedTotal, 35);
        expect(api.attempts.single, isNot(previousCheckout));
        expect(
          find.text('Ваш заказ успешно оформлен!'),
          status == 'paid' ? findsOneWidget : findsNothing,
        );
        expect(cart.items.isEmpty, status == 'paid');
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
        await cart.persisted;
        api.dispose();
      },
    );
  }
}
