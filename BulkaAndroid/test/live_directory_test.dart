import 'dart:async';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class LiveDirectoryApi extends BulkaApiClient {
  bool failNext = false;
  int calls = 0;
  final events = StreamController<Map<String, dynamic>>.broadcast();
  String address = 'Старый адрес';
  @override
  Stream<Map<String, dynamic>> get customerEvents => events.stream;
  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async {
    calls++;
    if (failNext) {
      failNext = false;
      throw Exception('temporary network error');
    }
    return [
      BakeryLocation(
        id: 'one',
        name: 'Филиал',
        city: 'Актау',
        address: address,
      ),
    ];
  }
}

void main() {
  testWidgets('an initial failure recovers without leaving the directory', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final api = LiveDirectoryApi()..failNext = true;
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: Scaffold(body: LocationDirectoryScreen(api: api)),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(api.address), findsNothing);
    await tester.pump(const Duration(seconds: 60));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    expect(find.text(api.address), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await api.events.close();
    api.dispose();
  });
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
      api.address = 'Recovered without an event';
      await tester.pump(const Duration(seconds: 60));
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pumpAndSettle();
      expect(find.text('Recovered without an event'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      await api.events.close();
      api.dispose();
    },
  );
  testWidgets('hidden directory pauses polling and refreshes on return', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final api = LiveDirectoryApi();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    Widget app(bool visible) => MaterialApp(
      theme: buildBulkaTheme(),
      home: TickerMode(
        enabled: visible,
        child: Scaffold(body: LocationDirectoryScreen(api: api)),
      ),
    );
    await tester.pumpWidget(app(true));
    await tester.pumpAndSettle();
    final initial = api.calls;
    await tester.pumpWidget(app(false));
    for (var i = 0; i < 3; i++) {
      await tester.pump(const Duration(seconds: 60));
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pumpAndSettle();
    }
    expect(api.calls, initial);
    api.address = 'Changed while hidden';
    await tester.pumpWidget(app(true));
    await tester.pumpAndSettle();
    expect(api.calls, initial + 1);
    expect(find.text(api.address), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await api.events.close();
    api.dispose();
  });
}
