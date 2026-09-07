import 'dart:async';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class LiveDirectoryApi extends BulkaApiClient {
  final events = StreamController<Map<String, dynamic>>.broadcast();
  String address = 'Старый адрес';
  @override
  Stream<Map<String, dynamic>> get customerEvents => events.stream;
  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async => [
    BakeryLocation(id: 'one', name: 'Филиал', city: 'Актау', address: address),
  ];
}

void main() {
  testWidgets(
    'guest directory and its open branch sheet update without losing search',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      appLanguageNotifier.value = 'ru';
      final api = LiveDirectoryApi();
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: Scaffold(body: LocationDirectoryScreen(api: api)),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'Филиал');
      await tester.pumpAndSettle();
      await tester.tap(find.text('Филиал').last);
      await tester.pumpAndSettle();
      expect(find.text('Актау, Старый адрес'), findsOneWidget);
      api.address = 'Новый полный адрес';
      api.events.add({
        'type': 'client.data.changed',
        'data': {
          'domains': ['locations'],
        },
      });
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pumpAndSettle();
      expect(find.text('Актау, Новый полный адрес'), findsOneWidget);
      expect(find.text('Актау, Старый адрес'), findsNothing);
      await tester.tap(find.byIcon(Icons.close).last);
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'Филиал',
      );
      api.address = 'После переподключения';
      api.events.add({'type': 'connected'});
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pumpAndSettle();
      expect(find.text('После переподключения'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      await api.events.close();
      api.dispose();
    },
  );
}
