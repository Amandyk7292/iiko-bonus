import 'dart:async';

import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/widgets/yandex_map/yandex_map.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _aktau = BakeryLocation(
  id: 'aktau',
  name: 'Bulka',
  address: 'Батыр',
  city: 'Актау',
  latitude: 43.65,
  longitude: 51.16,
  deliveryEnabled: true,
);
const _astana = BakeryLocation(
  id: 'astana',
  name: 'Bulka',
  address: 'Абая',
  city: 'Астана',
  latitude: 51.12,
  longitude: 71.43,
  deliveryEnabled: true,
);

class _AddressApi extends BulkaApiClient {
  final pending = <Completer<Map<String, dynamic>>>[];
  final requested = <LatLng>[];
  bool failReverse = false;
  bool delayReverse = false;
  List<Map<String, dynamic>> searchResults = const [];

  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async => [
    _aktau,
    _astana,
  ];

  @override
  Future<List<Map<String, dynamic>>> searchDeliveryAddress(
    String query, {
    String? city,
  }) async => searchResults;

  @override
  Future<Map<String, dynamic>> reverseDeliveryAddress({
    required double latitude,
    required double longitude,
  }) async {
    requested.add(LatLng(latitude, longitude));
    if (failReverse) throw StateError('Geocoder unavailable');
    if (delayReverse) {
      final response = Completer<Map<String, dynamic>>();
      pending.add(response);
      return response.future;
    }
    return {'address': 'Батыр, 14', 'city': 'Актау'};
  }
}

YandexMapView _map(WidgetTester tester) =>
    tester.widget(find.byType(YandexMapView));
final _street = find.byKey(const ValueKey('delivery-address-search'));

Future<void> _open(
  WidgetTester tester,
  _AddressApi api,
  ValueChanged<DeliveryAddress?> onSave,
) async {
  tester.view.physicalSize = const Size(390, 700);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: buildBulkaTheme(),
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () async => onSave(
              await Navigator.of(context).push<DeliveryAddress>(
                MaterialPageRoute(
                  builder: (_) =>
                      AddressMapScreen(api: api, initialCity: 'Актау'),
                ),
              ),
            ),
            child: const Text('Открыть адрес'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Открыть адрес'));
  await tester.pumpAndSettle();
}

Future<void> _fill(WidgetTester tester, {String? street}) async {
  if (street != null) await tester.enterText(_street, street);
  await tester.enterText(find.byType(TextFormField).first, 'Дом');
  await tester.enterText(find.byType(TextFormField).at(1), '14');
  tester.testTextInput.hide();
  await tester.pumpAndSettle();
}

Future<void> _save(WidgetTester tester) async {
  ScaffoldMessenger.of(
    tester.element(find.byType(AddressMapScreen)),
  ).hideCurrentSnackBar();
  await tester.pumpAndSettle();
  await tester.tap(find.text('Использовать адрес'));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets(
    'a visible chosen pin and manual street save when reverse geocoding fails',
    (tester) async {
      final api = _AddressApi()..failReverse = true;
      addTearDown(api.dispose);
      DeliveryAddress? saved;
      await _open(tester, api, (address) => saved = address);
      _map(tester).onTap!(const LatLng(43.661, 51.173));
      await tester.pumpAndSettle();
      await _fill(tester, street: 'Батыр, улица Жана, 14');
      expect(api.requested, [const LatLng(43.661, 51.173)]);
      expect(_map(tester).selectedPoint, const LatLng(43.661, 51.173));
      await _save(tester);
      expect(saved!.location.address, 'Батыр, улица Жана, 14');
      expect(saved!.location.city, 'Актау');
      expect(saved!.location.latitude, 43.661);
      expect(saved!.location.longitude, 51.173);
    },
  );

  testWidgets(
    'typing an address, zooming or programmatic centering does not invent a selected pin',
    (tester) async {
      final api = _AddressApi();
      addTearDown(api.dispose);
      DeliveryAddress? saved;
      await _open(tester, api, (address) => saved = address);
      expect(_map(tester).selectedPoint, isNull);
      expect(_map(tester).controller.command!.payload['selected'], isNull);
      _map(tester).onCameraChanged!(const LatLng(43.66, 51.17), 16);
      await _fill(tester, street: 'Батыр, улица Жана');
      expect(_map(tester).center, const LatLng(43.66, 51.17));
      expect(_map(tester).selectedPoint, isNull);
      await _save(tester);
      expect(saved, isNull);
      expect(find.text('Выберите точку на карте'), findsOneWidget);
      expect(api.requested, isEmpty);
    },
  );

  testWidgets(
    'a failed geocoder with no manual street asks for an address, not another map pin',
    (tester) async {
      final api = _AddressApi()..failReverse = true;
      addTearDown(api.dispose);
      DeliveryAddress? saved;
      await _open(tester, api, (address) => saved = address);
      _map(tester).onTap!(const LatLng(43.661, 51.173));
      await tester.pump(const Duration(milliseconds: 310));
      await tester.pumpAndSettle();
      await _fill(tester);
      await _save(tester);
      expect(saved, isNull);
      expect(find.text('Адрес не найден. Уточните запрос.'), findsOneWidget);
      expect(find.text('Выберите точку на карте'), findsNothing);
    },
  );

  testWidgets(
    'manual address save is independent of a slow geocoder and stays unchanged',
    (tester) async {
      final api = _AddressApi()..delayReverse = true;
      addTearDown(api.dispose);
      DeliveryAddress? saved;
      await _open(tester, api, (address) => saved = address);
      _map(tester).onTap!(const LatLng(43.663, 51.175));
      await tester.pump(const Duration(milliseconds: 310));
      await _fill(tester, street: 'Батыр, новая улица, 14');
      expect(api.pending.length, 1);
      await _save(tester);
      expect(saved!.location.address, 'Батыр, новая улица, 14');
      expect(saved!.location.latitude, 43.663);
      api.pending.single.complete({
        'address': 'Другое название',
        'city': 'Астана',
      });
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'an old reverse response cannot overwrite the newest pin or its city validation',
    (tester) async {
      final api = _AddressApi()..delayReverse = true;
      addTearDown(api.dispose);
      DeliveryAddress? saved;
      await _open(tester, api, (address) => saved = address);
      _map(tester).onTap!(const LatLng(43.66, 51.17));
      await tester.pump(const Duration(milliseconds: 310));
      _map(tester).onTap!(const LatLng(43.67, 51.18));
      await tester.pump(const Duration(milliseconds: 310));
      api.pending[1].complete({'address': 'Новый адрес', 'city': 'Актау'});
      await tester.pumpAndSettle();
      api.pending[0].complete({'address': 'Старый адрес', 'city': 'Астана'});
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(_street).controller!.text, 'Новый адрес');
      await _fill(tester);
      await _save(tester);
      expect(saved!.location.address, 'Новый адрес');
      expect(saved!.location.city, 'Актау');
      expect(saved!.location.latitude, 43.67);
      expect(saved!.location.longitude, 51.18);
    },
  );

  testWidgets(
    'reverse response after an explicit city change cannot restore an old pin',
    (tester) async {
      final api = _AddressApi()..delayReverse = true;
      addTearDown(api.dispose);
      DeliveryAddress? saved;
      await _open(tester, api, (address) => saved = address);
      _map(tester).onTap!(const LatLng(43.66, 51.17));
      await tester.pump(const Duration(milliseconds: 310));
      await tester.tap(find.byKey(const ValueKey('delivery-address-city')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Астана').last);
      await tester.pumpAndSettle();
      api.pending.single.complete({'address': 'Старый адрес', 'city': 'Актау'});
      await tester.pumpAndSettle();
      expect(_map(tester).selectedPoint, isNull);
      expect(_map(tester).center, const LatLng(51.12, 71.43));
      expect(_map(tester).controller.command!.payload['selected'], isNull);
      expect(tester.widget<TextField>(_street).controller!.text, isEmpty);
      await _fill(tester, street: 'Абая');
      await _save(tester);
      expect(saved, isNull);
    },
  );

  testWidgets(
    'a known different city remains blocked and is never silently relabeled',
    (tester) async {
      final api = _AddressApi()..delayReverse = true;
      addTearDown(api.dispose);
      DeliveryAddress? saved;
      await _open(tester, api, (address) => saved = address);
      _map(tester).onTap!(const LatLng(51.12, 71.43));
      await tester.pump(const Duration(milliseconds: 310));
      api.pending.single.complete({'address': 'Абая', 'city': 'Астана'});
      await tester.pumpAndSettle();
      await _fill(tester, street: 'Абая');
      await _save(tester);
      expect(saved, isNull);
      expect(
        tester
            .widget<DropdownButton<String>>(find.byType(DropdownButton<String>))
            .value,
        'Актау',
      );
      expect(find.text('Нет доступных филиалов для доставки'), findsWidgets);
    },
  );

  testWidgets('zero coordinates are not accepted as a chosen point', (
    tester,
  ) async {
    final api = _AddressApi();
    addTearDown(api.dispose);
    DeliveryAddress? saved;
    await _open(tester, api, (address) => saved = address);
    _map(tester).onTap!(const LatLng(0, 0));
    await _fill(tester, street: 'Батыр');
    expect(_map(tester).selectedPoint, isNull);
    await _save(tester);
    expect(saved, isNull);
    expect(api.requested, isEmpty);
  });

  testWidgets(
    'rapidly moving the chosen pin debounces reverse geocoding to the visible final point',
    (tester) async {
      final api = _AddressApi();
      addTearDown(api.dispose);
      await _open(tester, api, (_) {});
      _map(tester).onTap!(const LatLng(43.66, 51.17));
      await tester.pump(const Duration(milliseconds: 100));
      _map(tester).onTap!(const LatLng(43.67, 51.18));
      await tester.pump(const Duration(milliseconds: 100));
      _map(tester).onTap!(const LatLng(43.68, 51.19));
      await tester.pump(const Duration(milliseconds: 310));
      await tester.pumpAndSettle();
      expect(api.requested, [const LatLng(43.68, 51.19)]);
      expect(_map(tester).selectedPoint, const LatLng(43.68, 51.19));
    },
  );

  testWidgets(
    'clearing the visible street cannot save an old hidden geocoder address',
    (tester) async {
      final api = _AddressApi();
      addTearDown(api.dispose);
      DeliveryAddress? saved;
      await _open(tester, api, (address) => saved = address);
      _map(tester).onTap!(const LatLng(43.661, 51.173));
      await tester.pump(const Duration(milliseconds: 310));
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(_street).controller!.text, 'Батыр, 14');
      await _fill(tester, street: '');
      await _save(tester);
      expect(saved, isNull);
      expect(find.text('Адрес не найден. Уточните запрос.'), findsOneWidget);
    },
  );

  testWidgets(
    'a late geocoder cannot replace a manually entered street for the selected pin',
    (tester) async {
      final api = _AddressApi()..delayReverse = true;
      addTearDown(api.dispose);
      DeliveryAddress? saved;
      await _open(tester, api, (address) => saved = address);
      _map(tester).onTap!(const LatLng(43.661, 51.173));
      await tester.pump(const Duration(milliseconds: 310));
      await _fill(tester, street: 'Жана, ручной адрес');
      api.pending.single.complete({
        'address': 'Старое название',
        'city': 'Актау',
      });
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(_street).controller!.text,
        'Жана, ручной адрес',
      );
      await _save(tester);
      expect(saved!.location.address, 'Жана, ручной адрес');
    },
  );

  testWidgets(
    'a confirmed search result saves its visible address without requiring a second geocoder',
    (tester) async {
      final api = _AddressApi()
        ..failReverse = true
        ..searchResults = [
          {
            'address': 'Батыр, 14',
            'displayName': 'Батыр, 14, Актау',
            'city': 'Актау',
            'latitude': 43.661,
            'longitude': 51.173,
          },
        ];
      addTearDown(api.dispose);
      DeliveryAddress? saved;
      await _open(tester, api, (address) => saved = address);
      await tester.enterText(_street, 'Батыр');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Батыр, 14, Актау'));
      await tester.pumpAndSettle();
      expect(_map(tester).selectedPoint, const LatLng(43.661, 51.173));
      expect(tester.widget<TextField>(_street).controller!.text, 'Батыр, 14');
      expect(api.requested, isEmpty);
      await _fill(tester);
      await _save(tester);
      expect(saved!.location.address, 'Батыр, 14');
    },
  );
}
