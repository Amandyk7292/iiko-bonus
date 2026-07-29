import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('cart restores after restart and keeps product configuration', () async {
    SharedPreferences.setMockInitialValues({
      'bulka_cart_v1':
          '[{"id":"cake","cartKey":"cake::size","name":"Торт","price":12000,"basePrice":10000,"imageUrl":"","quantity":2,"configuration":{"weight":"2kg"},"modifiers":[]}]',
    });
    final cart = CartProvider();
    final deadline = DateTime.now().add(const Duration(seconds: 2));
    while (!cart.isRestored && DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }

    expect(cart.isRestored, isTrue);
    expect(cart.itemCount, 2);
    expect(cart.totalAmount, 24000);
    expect(cart.items.values.single.configuration?['weight'], '2kg');
  });

  test('cart quantity is capped at the customer-safe limit', () async {
    SharedPreferences.setMockInitialValues({});
    final cart = CartProvider();
    final deadline = DateTime.now().add(const Duration(seconds: 2));
    while (!cart.isRestored && DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }

    for (var index = 0; index < CartProvider.maxItemQuantity + 10; index++) {
      cart.addItem(productId: 'bun', name: 'Булочка', price: 300, imageUrl: '');
    }
    expect(cart.items['bun']?.quantity, CartProvider.maxItemQuantity);

    cart.setQuantity('bun', CartProvider.maxItemQuantity + 50);
    expect(cart.items['bun']?.quantity, CartProvider.maxItemQuantity);
  });

  test('offline order round-trip preserves ETA and courier tracking', () {
    final original = CustomerOrder(
      id: 'order-42',
      number: 1042,
      paymentStatus: 'paid',
      orderStatus: 'preparing',
      amount: 5600,
      subtotal: 6000,
      discount: 400,
      branch: 'Bulka, 17-й микрорайон',
      items: const [
        {'id': 'bun', 'name': 'Булочка', 'quantity': 2, 'price': 2800},
      ],
      earnedBonus: 280,
      createdAt: DateTime.utc(2026, 7, 16, 12),
      fulfillmentType: 'delivery',
      deliveryStatus: 'en_route',
      estimatedDeliveryAt: DateTime.utc(2026, 7, 16, 12, 35),
      promisedReadyAt: DateTime.utc(2026, 7, 16, 12, 20),
      preparationMinutes: 20,
      etaMinAt: DateTime.utc(2026, 7, 16, 12, 30),
      etaMaxAt: DateTime.utc(2026, 7, 16, 12, 40),
      etaConfidence: 'high',
      etaUpdatedAt: DateTime.utc(2026, 7, 16, 12, 16),
      routeDistanceKm: 5.2,
      courier: OrderCourier(
        id: 'courier-7',
        name: 'Али',
        phone: '+77000000000',
        latitude: 43.64,
        longitude: 51.17,
        locationUpdatedAt: DateTime.utc(2026, 7, 16, 12, 15),
      ),
    );

    final restored = CustomerOrder.fromJson(original.toJson());

    expect(restored.id, original.id);
    expect(restored.eta, original.estimatedDeliveryAt);
    expect(restored.preparationMinutes, 20);
    expect(restored.etaMinAt, original.etaMinAt);
    expect(restored.etaMaxAt, original.etaMaxAt);
    expect(restored.etaConfidence, 'high');
    expect(restored.routeDistanceKm, 5.2);
    expect(restored.courier?.name, 'Али');
    expect(restored.courier?.latitude, 43.64);
    expect(restored.isClosed, false);
  });

  test(
    'preorder delivery keeps its actual receiving method and delivery ETA',
    () {
      final estimatedDeliveryAt = DateTime.utc(2026, 7, 30, 14, 40);
      final promisedReadyAt = DateTime.utc(2026, 7, 30, 14, 10);
      final order = CustomerOrder.fromJson({
        'id': 'preorder-delivery',
        'number': 1043,
        'paymentStatus': 'paid',
        'orderStatus': 'ready',
        'amount': 4200,
        'subtotal': 4200,
        'discount': 0,
        'branch': 'Bulka, Актау',
        'items': const [],
        'earnedBonus': 210,
        'createdAt': '2026-07-30T12:00:00.000Z',
        'fulfillmentType': 'preorder',
        'preorderFulfillmentType': 'delivery',
        'effectiveFulfillmentType': 'delivery',
        'deliveryStatus': 'assigned',
        'estimatedDeliveryAt': estimatedDeliveryAt.toIso8601String(),
        'promisedReadyAt': promisedReadyAt.toIso8601String(),
      });

      expect(order.fulfillmentType, 'preorder');
      expect(order.preorderFulfillmentType, 'delivery');
      expect(order.effectiveFulfillmentType, 'delivery');
      expect(order.usesDelivery, isTrue);
      expect(order.eta, estimatedDeliveryAt);

      final restored = CustomerOrder.fromJson(order.toJson());
      expect(restored.preorderFulfillmentType, 'delivery');
      expect(restored.effectiveFulfillmentType, 'delivery');
      expect(restored.eta, estimatedDeliveryAt);
    },
  );

  test(
    'legacy preorder derives pickup or delivery without the new API field',
    () {
      final delivery = CustomerOrder.fromJson({
        'fulfillmentType': 'preorder',
        'preorderFulfillmentType': 'delivery',
      });
      final pickup = CustomerOrder.fromJson({'fulfillmentType': 'preorder'});

      expect(delivery.effectiveFulfillmentType, 'delivery');
      expect(delivery.usesDelivery, isTrue);
      expect(pickup.effectiveFulfillmentType, 'pickup');
      expect(pickup.usesDelivery, isFalse);
    },
  );

  test('notification settings serialize all customer choices', () {
    const preferences = NotificationPreferences(
      ordersEnabled: true,
      bonusEnabled: false,
      promosEnabled: false,
      supportEnabled: true,
      quietHoursEnabled: true,
      quietStart: '21:30',
      quietEnd: '08:15',
      timezone: 'Asia/Aqtau',
    );

    final restored = NotificationPreferences.fromJson(preferences.toJson());

    expect(restored.ordersEnabled, true);
    expect(restored.bonusEnabled, false);
    expect(restored.promosEnabled, false);
    expect(restored.supportEnabled, true);
    expect(restored.quietHoursEnabled, true);
    expect(restored.quietStart, '21:30');
    expect(restored.quietEnd, '08:15');
    expect(restored.timezone, 'Asia/Aqtau');
  });
}
