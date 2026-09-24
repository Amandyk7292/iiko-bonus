import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health/health.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

HealthDataPoint stepPoint(int steps, RecordingMethod method, String id) =>
    HealthDataPoint(
      uuid: id,
      value: NumericHealthValue(numericValue: steps),
      type: HealthDataType.STEPS,
      unit: HealthDataUnit.COUNT,
      dateFrom: DateTime(2026, 9, 24, 8),
      dateTo: DateTime(2026, 9, 24, 9),
      sourcePlatform: HealthPlatformType.appleHealth,
      sourceDeviceId: 'phone',
      sourceId: 'com.apple.health',
      sourceName: 'iPhone',
      recordingMethod: method,
    );

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
  test('daily step challenge excludes manual and unknown records', () {
    final steps = verifiedStepTotal([
      stepPoint(4200, RecordingMethod.automatic, 'automatic'),
      stepPoint(1800, RecordingMethod.active, 'active'),
      stepPoint(10000, RecordingMethod.manual, 'manual'),
      stepPoint(9000, RecordingMethod.unknown, 'unknown'),
    ]);
    expect(steps, 6000);
  });

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
