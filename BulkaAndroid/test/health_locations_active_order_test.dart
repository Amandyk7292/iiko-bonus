import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _LocationsApi extends BulkaApiClient {
  _LocationsApi(this.fail);
  final bool fail;
  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async {
    if (fail) throw ApiException('offline');
    return const [
      BakeryLocation(
        id: 'branch',
        name: '19А',
        address: '11 дом',
        city: 'Актау',
      ),
    ];
  }
}

class _HomeApi extends BulkaApiClient {
  @override
  Future<List<PromoStory>> getStories() async => const [];
}

void main() {
  test(
    'locations use a recent cache when the network is unavailable',
    () async {
      SharedPreferences.setMockInitialValues({});
      final fresh = await LocationCacheRepository(
        api: _LocationsApi(false),
      ).load();
      expect(fresh.fromCache, isFalse);
      final cached = await LocationCacheRepository(
        api: _LocationsApi(true),
      ).load();
      expect(cached.fromCache, isTrue);
      expect(cached.locations.single.id, 'branch');
    },
  );

  testWidgets('home shows an active order and opens its details', (
    tester,
  ) async {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({});
    String? opened;
    final order = CustomerOrder.fromJson({
      'id': 'order',
      'number': 101,
      'paymentStatus': 'paid',
      'orderStatus': 'preparing',
      'amount': 1200,
      'subtotal': 1200,
      'discount': 0,
      'branch': '19А',
      'items': [],
      'earnedBonus': 0,
      'createdAt': '2026-09-24T08:00:00Z',
      'fulfillmentType': 'pickup',
      'deliveryStatus': 'unassigned',
    });
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => CartProvider(),
        child: MaterialApp(
          theme: buildBulkaTheme(),
          home: HomeScreen(
            api: _HomeApi(),
            customer: null,
            transactions: const [],
            activeOrder: order,
            onHistoryTap: () {},
            onProfileTap: () {},
            onRequireAuth: () async => false,
            onOpenCatalog: (_) async {},
            onOpenOrders: (id) async => opened = id,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('home-active-order')), findsOneWidget);
    expect(find.text('Заказ №101'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('home-active-order')));
    expect(opened, 'order');
  });
}
