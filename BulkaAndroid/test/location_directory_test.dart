import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

const branch = BakeryLocation(
  id: 'one',
  name: 'Ardager',
  city: 'Актау',
  address: '9-й микрорайон, 30/3',
  latitude: 43.65,
  longitude: 51.16,
  hours: {
    'daily': {'open': '08:00', 'close': '21:00'},
    'sun': {'closed': true},
  },
);

class DirectoryApi extends BulkaApiClient {
  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async => const [
    branch,
    BakeryLocation(
      id: 'two',
      name: 'Almaty bakery',
      city: 'Алматы',
      address: 'Абая, 10',
      deliveryEnabled: true,
    ),
    BakeryLocation(
      id: 'hidden',
      name: 'Inactive',
      city: 'Актау',
      address: '',
      active: false,
    ),
  ];
}

void main() {
  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({});
  });

  test('2GIS uses longitude first and falls back without fake coordinates', () {
    expect(
      Uri.decodeComponent(bakeryDirectionsUri(branch).path),
      '/directions/points/|51.16,43.65',
    );
    expect(
      bakeryDirectionsUri(
        const BakeryLocation(
          id: 'x',
          name: 'Bakery',
          city: '',
          address: '',
          twoGisId: '1234',
        ),
      ).path,
      '/firm/1234',
    );
    expect(
      bakeryDirectionsUri(
        const BakeryLocation(
          id: 'x',
          name: 'Bakery',
          city: 'Актау',
          address: '10',
        ),
      ).path,
      startsWith('/search/'),
    );
  });

  test('hours use branch time, closing boundary and individual days off', () {
    expect(
      bakeryHoursToday(branch, DateTime.utc(2026, 9, 7, 2, 59)).open,
      false,
    );
    expect(bakeryHoursToday(branch, DateTime.utc(2026, 9, 7, 3)).open, true);
    expect(bakeryHoursToday(branch, DateTime.utc(2026, 9, 7, 16)).open, false);
    expect(
      bakeryHoursToday(branch, DateTime.utc(2026, 9, 6, 8)).label,
      'Выходной',
    );
  });

  for (final language in ['ru', 'kk', 'en']) {
    testWidgets('directory city, search and details work in $language', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      appLanguageNotifier.value = language;
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: Scaffold(body: LocationDirectoryScreen(api: DirectoryApi())),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Ardager'), findsOneWidget);
      expect(find.text('Inactive'), findsNothing);
      await tester.tap(find.text('Ardager'));
      await tester.pumpAndSettle();
      expect(find.text('directory_route'.tr), findsOneWidget);
      expect(find.textContaining('08:00 – 21:00'), findsWidgets);
      await tester.tap(find.byTooltip('close_btn'.tr));
      await tester.pumpAndSettle();
      await tester.tap(find.text(localizeCityName('Актау')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Алматы'));
      await tester.pumpAndSettle();
      expect(find.text('Almaty bakery'), findsOneWidget);
      expect(find.text('Ardager'), findsNothing);
      await tester.enterText(find.byType(TextField), 'нет такого адреса');
      await tester.pumpAndSettle();
      expect(find.text('locations_search_empty'.tr), findsOneWidget);
      expect(tester.takeException(), isNull);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('directory_city'), 'Алматы');
      expect(prefs.getString('selected_bakery_location_id'), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }
}
