import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/widgets/yandex_map/yandex_map.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _aktauDelivery = BakeryLocation(
  id: 'aktau-delivery',
  name: 'Bulka delivery Aktau',
  address: '19-й микрорайон',
  city: 'Актау',
  latitude: 43.65,
  longitude: 51.16,
  deliveryEnabled: true,
);

const _astanaDelivery = BakeryLocation(
  id: 'astana-delivery',
  name: 'Bulka delivery Astana',
  address: 'Кабанбай батыра',
  city: ' Астана ',
  latitude: 51.12,
  longitude: 71.43,
  deliveryEnabled: true,
);

const _pickupOnly = BakeryLocation(
  id: 'pickup-only',
  name: 'Bulka pickup',
  address: '9-й микрорайон',
  city: 'Актау',
  latitude: 43.66,
  longitude: 51.17,
  deliveryEnabled: false,
);

const _missingCoordinates = BakeryLocation(
  id: 'delivery-without-coordinates',
  name: 'Bulka missing coordinates',
  address: 'Абая',
  city: 'Алматы',
  deliveryEnabled: true,
);

class _DeliveryMapApi extends BulkaApiClient {
  _DeliveryMapApi(this.locations, {this.failLocations = false});

  final List<BakeryLocation> locations;
  final bool failLocations;
  String? searchedCity;

  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async {
    if (failLocations) throw StateError('Locations unavailable');
    return locations;
  }

  @override
  Future<List<Map<String, dynamic>>> searchDeliveryAddress(
    String query, {
    String? city,
  }) async {
    searchedCity = city;
    return const [];
  }
}

Future<void> _openMap(
  WidgetTester tester,
  _DeliveryMapApi api, {
  String? initialCity,
  DeliveryAddress? initialAddress,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: buildBulkaTheme(),
      home: AddressMapScreen(
        api: api,
        initialCity: initialCity,
        initialAddress: initialAddress,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

YandexMapView _map(WidgetTester tester) =>
    tester.widget<YandexMapView>(find.byType(YandexMapView));

DropdownButton<String> _cityPicker(WidgetTester tester) =>
    tester.widget<DropdownButton<String>>(find.byType(DropdownButton<String>));

List<String> _cities(WidgetTester tester) =>
    _cityPicker(tester).items!.map((item) => item.value!).toList();

void main() {
  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({});
  });

  Future<void> configureView(WidgetTester tester) async {
    tester.view.physicalSize = const Size(390, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  }

  testWidgets(
    'delivery map hides pickup, inactive and unknown delivery branches',
    (tester) async {
      await configureView(tester);
      final api = _DeliveryMapApi([
        _pickupOnly,
        _aktauDelivery,
        _astanaDelivery,
        const BakeryLocation(
          id: 'inactive-delivery',
          name: 'Inactive',
          address: '19-й микрорайон',
          city: 'Актау',
          latitude: 43.651,
          longitude: 51.161,
          active: false,
          deliveryEnabled: true,
        ),
        BakeryLocation.fromJson({
          'id': 'legacy-without-delivery-policy',
          'name': 'Legacy pickup',
          'address': '19-й микрорайон',
          'city': 'Актау',
          'latitude': 43.652,
          'longitude': 51.162,
        }),
      ]);
      addTearDown(api.dispose);
      await _openMap(tester, api);

      expect(_map(tester).branches.map((branch) => branch.id), [
        'aktau-delivery',
      ]);
      expect(
        _map(tester).branches.single.toPayload()['deliveryEnabled'],
        isTrue,
      );
      expect(_cities(tester), ['Актау', 'Астана']);
      expect(api.locations, hasLength(5));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'city switch updates delivery markers, center and address search',
    (tester) async {
      await configureView(tester);
      final api = _DeliveryMapApi([
        _pickupOnly,
        _aktauDelivery,
        _astanaDelivery,
        _missingCoordinates,
      ]);
      addTearDown(api.dispose);
      await _openMap(tester, api);
      expect(_cities(tester), ['Актау', 'Астана']);

      await tester.tap(find.byKey(const ValueKey('delivery-address-city')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Астана').last);
      await tester.pumpAndSettle();

      expect(_map(tester).branches.map((branch) => branch.id), [
        'astana-delivery',
      ]);
      expect(_map(tester).center.latitude, _astanaDelivery.latitude);
      expect(_map(tester).center.longitude, _astanaDelivery.longitude);
      expect(_map(tester).selectedPoint, isNull);
      await tester.enterText(
        find.byKey(const ValueKey('delivery-address-search')),
        'Кабанбай',
      );
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      expect(api.searchedCity, 'Астана');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('missing and invalid coordinates use a real delivery fallback', (
    tester,
  ) async {
    await configureView(tester);
    final api = _DeliveryMapApi([
      _missingCoordinates,
      _pickupOnly,
      const BakeryLocation(
        id: 'out-of-range',
        name: 'Invalid coordinates',
        address: 'Абая',
        city: 'Алматы',
        latitude: 91,
        longitude: 71,
        deliveryEnabled: true,
      ),
      const BakeryLocation(
        id: 'nonfinite',
        name: 'Invalid coordinates',
        address: 'Абая',
        city: 'Алматы',
        latitude: double.nan,
        longitude: 71,
        deliveryEnabled: true,
      ),
      _astanaDelivery,
    ]);
    addTearDown(api.dispose);
    await _openMap(tester, api, initialCity: 'Алматы');

    expect(_cities(tester), ['Астана']);
    expect(_map(tester).branches.map((branch) => branch.id), [
      'astana-delivery',
    ]);
    expect(_map(tester).center.latitude, _astanaDelivery.latitude);
    expect(_map(tester).center.longitude, _astanaDelivery.longitude);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'disabled delivery cannot fall back to pickup or save an old address',
    (tester) async {
      await configureView(tester);
      final api = _DeliveryMapApi([_pickupOnly, _missingCoordinates]);
      addTearDown(api.dispose);
      await _openMap(
        tester,
        api,
        initialAddress: const DeliveryAddress(
          id: 'old-address',
          title: 'Дом',
          house: '1',
          location: DeliveryLocation(
            city: 'Актау',
            address: '19-й микрорайон',
            latitude: 43.65,
            longitude: 51.16,
          ),
        ),
      );

      expect(_map(tester).branches, isEmpty);
      expect(_cities(tester), isEmpty);
      expect(_cityPicker(tester).onChanged, isNull);
      await tester.tap(find.text('Сохранить изменения'));
      await tester.pump();
      expect(find.text('Нет доступных филиалов для доставки'), findsOneWidget);
      expect(find.byType(AddressMapScreen), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('old unsupported city can switch to the sole delivery city', (
    tester,
  ) async {
    await configureView(tester);
    final api = _DeliveryMapApi([_missingCoordinates, _astanaDelivery]);
    addTearDown(api.dispose);
    await _openMap(
      tester,
      api,
      initialAddress: const DeliveryAddress(
        id: 'unsupported-city-address',
        title: 'Дом',
        house: '1',
        location: DeliveryLocation(
          city: 'Алматы',
          address: 'Абая',
          latitude: 43.25,
          longitude: 76.9,
        ),
      ),
    );

    expect(_cities(tester), ['Астана']);
    expect(_cityPicker(tester).value, isNull);
    expect(_cityPicker(tester).onChanged, isNotNull);
    expect(_map(tester).branches, isEmpty);
    expect(_map(tester).selectedPoint!.latitude, 43.25);
    await tester.tap(find.byKey(const ValueKey('delivery-address-city')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Астана').last);
    await tester.pumpAndSettle();

    expect(_cityPicker(tester).value, 'Астана');
    expect(_map(tester).branches.map((branch) => branch.id), [
      'astana-delivery',
    ]);
    expect(_map(tester).center.latitude, _astanaDelivery.latitude);
    expect(_map(tester).center.longitude, _astanaDelivery.longitude);
    expect(_map(tester).selectedPoint, isNull);
    await tester.tap(find.text('Сохранить изменения'));
    await tester.pump();
    expect(find.byType(SnackBar), findsOneWidget);
    expect(find.byType(AddressMapScreen), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('failed location loading never adds pickup markers', (
    tester,
  ) async {
    await configureView(tester);
    final api = _DeliveryMapApi([_pickupOnly], failLocations: true);
    addTearDown(api.dispose);
    await _openMap(tester, api);

    expect(_map(tester).branches, isEmpty);
    expect(_cities(tester), isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('adding an address ignores a saved pickup-only branch', (
    tester,
  ) async {
    await configureView(tester);
    SharedPreferences.setMockInitialValues({
      'selected_bakery_location_id': _pickupOnly.id,
      'selected_bakery_location_id_pickup': _pickupOnly.id,
      'selected_bakery_location_pickup': _pickupOnly.displayLabel,
    });
    final api = _DeliveryMapApi([_pickupOnly, _astanaDelivery]);
    addTearDown(api.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: AddressSelectionScreen(api: api),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Добавить адрес'));
    await tester.pumpAndSettle();

    expect(_map(tester).branches.map((branch) => branch.id), [
      'astana-delivery',
    ]);
    expect(_map(tester).center.latitude, _astanaDelivery.latitude);
    expect(_map(tester).center.longitude, _astanaDelivery.longitude);
    expect(_cities(tester), ['Астана']);
    expect(tester.takeException(), isNull);
  });

  testWidgets('location directory still displays pickup-only branches', (
    tester,
  ) async {
    await configureView(tester);
    final api = _DeliveryMapApi([_pickupOnly, _aktauDelivery]);
    addTearDown(api.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: Scaffold(body: LocationDirectoryScreen(api: api)),
      ),
    );
    await tester.pumpAndSettle();

    expect(_map(tester).directoryMode, isTrue);
    expect(
      _map(tester).branches.map((branch) => branch.id),
      containsAll(['pickup-only', 'aktau-delivery']),
    );
    expect(tester.takeException(), isNull);
  });
}
