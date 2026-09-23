import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _SearchAddressApi extends BulkaApiClient {
  String? searchedCity;

  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async => [
    BakeryLocation(
      id: 'aktau-delivery',
      name: 'Bulka',
      city: 'Актау',
      address: '19-й микрорайон',
      latitude: 43.65,
      longitude: 51.16,
      deliveryEnabled: true,
    ),
    BakeryLocation(
      id: 'astana-closed',
      name: 'Bulka Astana',
      city: 'Астана',
      address: 'Кабанбай батыра',
      latitude: 51.12,
      longitude: 71.43,
      deliveryEnabled: false,
    ),
  ];

  @override
  Future<List<Map<String, dynamic>>> searchDeliveryAddress(
    String query, {
    String? city,
  }) async {
    searchedCity = city;
    return [
      {
        'displayName': '19-й микрорайон, Актау',
        'address': '19-й микрорайон',
        'city': 'Актау',
        'latitude': 43.651,
        'longitude': 51.161,
      },
    ];
  }

  @override
  Future<Map<String, dynamic>> reverseDeliveryAddress({
    required double latitude,
    required double longitude,
  }) async => {
    'address': '19-й микрорайон',
    'city': 'Актау',
    'latitude': latitude,
    'longitude': longitude,
  };
}

void main() {
  testWidgets('address search uses the delivery city and selects a map point', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(430, 932);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    appLanguageNotifier.value = 'ru';
    final api = _SearchAddressApi();
    addTearDown(api.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: AddressMapScreen(api: api),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Город доставки'), findsOneWidget);
    expect(find.text('Актау'), findsOneWidget);
    expect(find.text('Астана'), findsNothing);
    await tester.enterText(
      find.byKey(const ValueKey('delivery-address-search')),
      '19 микрорайон',
    );
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(api.searchedCity, 'Актау');
    expect(find.text('19-й микрорайон, Актау'), findsOneWidget);

    await tester.tap(find.text('19-й микрорайон, Актау'));
    await tester.pumpAndSettle();
    expect(find.text('Использовать адрес'), findsOneWidget);
    expect(find.text('19-й микрорайон, Актау'), findsNothing);
  });
}
