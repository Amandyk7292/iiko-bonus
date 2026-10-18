import 'dart:async';
import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _AddressApi extends BulkaApiClient {
  bool offline = false;
  bool delaySelection = false;
  String defaultId = 'home';
  final selections = <Completer<void>>[];

  @override
  bool get isAuthenticated => true;
  @override
  String get sessionCacheScope => '77000000001';

  @override
  Future<List<DeliveryAddress>> getCustomerAddresses() async {
    if (offline) throw ApiException('temporary read failure');
    return [
      for (final id in ['home', 'work'])
        DeliveryAddress(
          id: id,
          title: id,
          location: const DeliveryLocation(
            city: 'Актау',
            address: '19 микрорайон',
            latitude: 43.65,
            longitude: 51.16,
          ),
          house: id == 'home' ? '1' : '2',
          isDefault: id == defaultId,
        ),
    ];
  }

  @override
  Future<void> setDefaultCustomerAddress(String id) async {
    if (delaySelection) {
      final completer = Completer<void>();
      selections.add(completer);
      await completer.future;
    }
    defaultId = id;
  }
}

class _PopObserver extends NavigatorObserver {
  final popped = <String?>[];

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    popped.add(route.settings.name);
  }
}

Future<GlobalKey<NavigatorState>> _openAddressPicker(
  WidgetTester tester,
  _AddressApi api,
  _PopObserver observer,
) async {
  final navigation = GlobalKey<NavigatorState>();
  await tester.pumpWidget(
    MaterialApp(
      navigatorKey: navigation,
      navigatorObservers: [observer],
      theme: buildBulkaTheme(),
      home: const Scaffold(body: Text('root page')),
    ),
  );
  unawaited(
    navigation.currentState!.push(
      MaterialPageRoute<void>(
        settings: const RouteSettings(name: 'checkout'),
        builder: (_) => const Scaffold(body: Text('checkout page')),
      ),
    ),
  );
  await tester.pumpAndSettle();
  unawaited(
    navigation.currentState!.push(
      MaterialPageRoute<DeliveryAddress>(
        settings: const RouteSettings(name: 'address'),
        builder: (_) => AddressSelectionScreen(api: api),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return navigation;
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    appLanguageNotifier.value = 'ru';
  });

  test('selected default survives a later failed address refresh', () async {
    final api = _AddressApi();
    addTearDown(api.dispose);
    final repository = AddressRepository(api: api);
    await repository.loadAddresses();
    await repository.selectAddress('work');
    api.offline = true;

    expect((await repository.loadSelectedAddress())?.id, 'work');
    final cached = await repository.loadAddresses();
    expect(cached.where((address) => address.isDefault).single.id, 'work');
    expect(cached.singleWhere((address) => address.id == 'home').house, '1');
  });

  test('explicit selected ID wins over an older cached default flag', () async {
    final api = _AddressApi();
    addTearDown(api.dispose);
    final addresses = await api.getCustomerAddresses();
    SharedPreferences.setMockInitialValues({
      customerPreferenceKey('delivery_addresses', api.sessionCacheScope): [
        for (final address in addresses) jsonEncode(address.toJson()),
      ],
      customerPreferenceKey(
        'selected_delivery_address_id',
        api.sessionCacheScope,
      ): 'work',
    });
    api.offline = true;

    expect(
      (await AddressRepository(api: api).loadSelectedAddress())?.id,
      'work',
    );
  });

  testWidgets('rapid Continue taps save once and keep checkout open', (
    tester,
  ) async {
    final api = _AddressApi()..delaySelection = true;
    addTearDown(api.dispose);
    final observer = _PopObserver();
    await _openAddressPicker(tester, api, observer);

    await tester.tap(find.text('Продолжить'));
    await tester.tap(find.text('Продолжить'));
    expect(api.selections, hasLength(1));
    api.selections.single.complete();
    await tester.pumpAndSettle();

    expect(observer.popped, ['address']);
    expect(find.text('checkout page'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('failed confirmation shows feedback and can be retried', (
    tester,
  ) async {
    final api = _AddressApi()..delaySelection = true;
    addTearDown(api.dispose);
    final observer = _PopObserver();
    await _openAddressPicker(tester, api, observer);

    await tester.tap(find.text('Продолжить'));
    api.selections.single.completeError(ApiException('Network unavailable'));
    await tester.pumpAndSettle();
    expect(find.byType(SnackBar), findsOneWidget);
    expect(observer.popped, isEmpty);
    expect(tester.takeException(), isNull);
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Продолжить'));
    expect(api.selections, hasLength(2));
    api.selections.last.complete();
    await tester.pumpAndSettle();
    expect(observer.popped, ['address']);
    expect(find.text('checkout page'), findsOneWidget);
  });

  testWidgets('a response arriving during Back does not pop checkout', (
    tester,
  ) async {
    final api = _AddressApi()..delaySelection = true;
    addTearDown(api.dispose);
    final observer = _PopObserver();
    final navigation = await _openAddressPicker(tester, api, observer);

    await tester.tap(find.text('Продолжить'));
    navigation.currentState!.pop();
    api.selections.single.complete();
    await tester.pumpAndSettle();

    expect(observer.popped, ['address']);
    expect(find.text('checkout page'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
