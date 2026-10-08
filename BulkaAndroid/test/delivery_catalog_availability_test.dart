import 'dart:convert';

import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _home = DeliveryAddress(
  id: 'home',
  title: 'Дом',
  house: '1',
  location: DeliveryLocation(
    city: 'Актау',
    address: 'Улица',
    latitude: 43.65,
    longitude: 51.15,
  ),
);
const _closed = BakeryLocation(
  id: 'nearest-closed',
  name: 'Nearest closed',
  city: 'Актау',
  address: 'Near',
  latitude: 43.6501,
  longitude: 51.1501,
  deliveryEnabled: true,
  hours: {
    'daily': {'closed': true},
  },
);
const _open = BakeryLocation(
  id: 'farther-open',
  name: 'Farther open',
  city: 'Актау',
  address: 'Far',
  latitude: 43.66,
  longitude: 51.16,
  deliveryEnabled: true,
  hours: {
    'daily': {'open': '00:00', 'close': '24:00'},
  },
);

class _CatalogApi extends BulkaApiClient {
  _CatalogApi({
    required this.locations,
    required this.slots,
    http.Client? client,
  }) : super(
         client: client ?? MockClient((_) async => http.Response('{}', 200)),
       );

  final List<BakeryLocation> locations;
  final Map<String, Object> slots;
  final slotReads = <String>[];

  @override
  Stream<Map<String, dynamic>> get customerEvents => const Stream.empty();

  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async => locations;

  @override
  Future<List<FulfillmentSlot>> getFulfillmentSlots({
    required String branchId,
    required String orderType,
    int days = 7,
    List<String> productIds = const [],
  }) async {
    expect(orderType, 'delivery');
    expect(days, 1);
    slotReads.add(branchId);
    final result = slots[branchId] ?? <FulfillmentSlot>[];
    if (result is List<FulfillmentSlot>) return result;
    throw result;
  }
}

FulfillmentSlot _slot({DateTime? now, int remaining = 1, bool stale = false}) {
  final serverTime = now ?? DateTime.now().toUtc();
  final startsAt = serverTime.add(Duration(minutes: stale ? -30 : 30));
  return FulfillmentSlot(
    startsAt: startsAt,
    endsAt: startsAt.add(const Duration(minutes: 30)),
    capacity: 1,
    remaining: remaining,
    serverTime: serverTime,
  );
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    appLanguageNotifier.value = 'ru';
  });

  test(
    'nearest unavailable delivery branch falls back to a serving branch',
    () async {
      final api = _CatalogApi(
        locations: const [_closed, _open],
        slots: {
          _closed.id: FulfillmentSlotsUnavailable('Closed'),
          _open.id: [_slot()],
        },
      );
      addTearDown(api.dispose);
      expect((await resolveCatalogDeliveryBranch(api, _home))?.id, _open.id);
      expect(api.slotReads, [_closed.id, _open.id]);
    },
  );

  test(
    'delivery candidates preserve city, activation and coordinate bounds',
    () async {
      final api = _CatalogApi(
        locations: const [
          BakeryLocation(
            id: 'other-city',
            name: '',
            address: '',
            city: 'Алматы',
            latitude: 43.65,
            longitude: 51.15,
            deliveryEnabled: true,
          ),
          BakeryLocation(
            id: 'inactive',
            name: '',
            address: '',
            city: 'Актау',
            latitude: 43.65,
            longitude: 51.15,
            deliveryEnabled: true,
            active: false,
          ),
          BakeryLocation(
            id: 'pickup-only',
            name: '',
            address: '',
            city: 'Актау',
            latitude: 43.65,
            longitude: 51.15,
          ),
          BakeryLocation(
            id: 'invalid-coordinates',
            name: '',
            address: '',
            city: 'Актау',
            latitude: 143.65,
            longitude: 51.15,
            deliveryEnabled: true,
          ),
          BakeryLocation(
            id: 'normalized-city',
            name: '',
            address: '',
            city: 'г. «Актау»',
            latitude: 43.66,
            longitude: 51.16,
            deliveryEnabled: true,
          ),
        ],
        slots: {
          'normalized-city': [_slot()],
        },
      );
      addTearDown(api.dispose);
      expect(
        (await resolveCatalogDeliveryBranch(api, _home))?.id,
        'normalized-city',
      );
      expect(api.slotReads, ['normalized-city']);
    },
  );

  test('full or stale slots are skipped using the server clock', () async {
    final serverTime = DateTime.utc(2026, 10, 8, 10);
    for (final unusable in [
      _slot(now: serverTime, remaining: 0),
      _slot(now: serverTime, stale: true),
    ]) {
      final api = _CatalogApi(
        locations: const [_closed, _open],
        slots: {
          _closed.id: [unusable],
          _open.id: [_slot(now: serverTime)],
        },
      );
      addTearDown(api.dispose);
      // Device time cannot invalidate slots produced using the server clock.
      expect(
        (await resolveCatalogDeliveryBranch(
          api,
          _home,
          now: DateTime.utc(2030),
        ))?.id,
        _open.id,
      );
    }
  });

  test(
    'nearest branch with a future server slot is usable before opening',
    () async {
      final api = _CatalogApi(
        locations: const [_closed, _open],
        slots: {
          _closed.id: [_slot()],
          _open.id: [_slot()],
        },
      );
      addTearDown(api.dispose);
      expect((await resolveCatalogDeliveryBranch(api, _home))?.id, _closed.id);
      expect(api.slotReads, [_closed.id]);
    },
  );

  test(
    'offline fallback keeps Kazakhstan overnight hours and nearest order',
    () async {
      const night = BakeryLocation(
        id: 'night',
        name: '',
        address: '',
        city: 'Актау',
        latitude: 43.66,
        longitude: 51.16,
        deliveryEnabled: true,
        hours: {
          'sat': {'open': '08:00', 'close': '02:00'},
          'sun': {'closed': true},
        },
      );
      final api = _CatalogApi(
        locations: const [_closed, night],
        slots: {
          _closed.id: ApiException('Offline'),
          night.id: ApiException('Offline'),
        },
      );
      addTearDown(api.dispose);
      expect(
        (await resolveCatalogDeliveryBranch(
          api,
          _home,
          now: DateTime.utc(2026, 9, 12, 19, 30),
        ))?.id,
        night.id,
      );
    },
  );

  for (final futureNearestSlot in [false, true]) {
    testWidgets(
      'delivery Add accepts ${futureNearestSlot ? 'future nearest' : 'open alternative'} branch',
      (tester) async {
        final branchReads = <String?>[];
        final api = _CatalogApi(
          locations: const [_closed, _open],
          slots: {
            _closed.id: futureNearestSlot ? [_slot()] : <FulfillmentSlot>[],
            _open.id: [_slot()],
          },
          client: _menuClient(branchReads),
        );
        addTearDown(api.dispose);
        await AddressRepository(api: api).saveAddress(_home);
        final cart = CartProvider();
        await cart.restored;
        addTearDown(cart.dispose);
        await _renderCatalog(tester, api, cart, 'delivery');
        expect(branchReads, isNotEmpty);
        expect(
          branchReads,
          everyElement(futureNearestSlot ? _closed.id : _open.id),
        );
        await _tapAdd(tester);
        expect(find.byKey(const ValueKey('branch-closed-sheet')), findsNothing);
        expect(cart.items.values.single.id, 'bun');
        expect(cart.items.values.single.quantity, 1);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }

  testWidgets(
    'closed pickup branch still blocks Add without delivery slot reads',
    (tester) async {
      SharedPreferences.setMockInitialValues({
        'selected_bakery_location_pickup': _closed.displayLabel,
        'selected_bakery_location_id_pickup': _closed.id,
      });
      final api = _CatalogApi(
        locations: const [_closed, _open],
        slots: {
          _open.id: [_slot()],
        },
        client: _menuClient(<String?>[]),
      );
      addTearDown(api.dispose);
      final cart = CartProvider();
      await cart.restored;
      addTearDown(cart.dispose);
      await _renderCatalog(tester, api, cart, 'pickup');
      await _tapAdd(tester);
      expect(find.byKey(const ValueKey('branch-closed-sheet')), findsOneWidget);
      expect(cart.items, isEmpty);
      expect(api.slotReads, isEmpty);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}

http.Client _menuClient(List<String?> branchReads) =>
    MockClient((request) async {
      if (request.url.path == '/api/guest/menu') {
        branchReads.add(request.url.queryParameters['branchId']);
        return http.Response(
          jsonEncode({
            'success': true,
            'categories': [
              {'id': 'buns', 'name': 'Булочки'},
            ],
            'products': [
              {
                'id': 'bun',
                'name': 'Плюшка',
                'price': 300,
                'categoryId': 'buns',
                'imageUrl': '',
                'onlineOrderable': true,
                'availableQuantity': 10,
                'quantityStep': 1,
              },
            ],
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }
      return http.Response(
        '{"success":true,"productIds":[],"options":{},"products":[]}',
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });

Future<void> _renderCatalog(
  WidgetTester tester,
  _CatalogApi api,
  CartProvider cart,
  String orderType,
) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ChangeNotifierProvider.value(
      value: cart,
      child: MaterialApp(
        theme: buildBulkaTheme(),
        home: CatalogScreen(
          api: api,
          orderType: orderType,
          hasSelectedOrderType: true,
          initialClientUri: Uri(
            pathSegments: ['', 'catalog', 'category', 'Булочки'],
          ),
        ),
      ),
    ),
  );
  for (var frame = 0; frame < 20; frame++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> _tapAdd(WidgetTester tester) async {
  final add = find.byKey(const ValueKey('catalog-image-add')).first;
  await tester.ensureVisible(add);
  await tester.tap(add);
  for (var frame = 0; frame < 12; frame++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}
