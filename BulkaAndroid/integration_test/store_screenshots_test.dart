import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:bulka_bonus/main.dart' as app;

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('capture three distinct real application screens', (tester) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('app_lang_code', 'ru');
    await prefs.setBool('bulka_welcome_completed_v1', true);
    await prefs.setBool('bulka_permissions_welcome_v1', true);
    await prefs.setInt('lastMainTab', 1);
    await prefs.setString('lastAppScreen', 'main');
    final locations = await app.BulkaApiClient().getFulfillmentLocations();
    final branch = locations.firstWhere((b) => b.id == '62fa7ada-3d67-4f85-bb37-5b13f0e1345c');
    await prefs.setString('selected_order_type', 'pickup');
    await prefs.setString('selected_fulfillment_city_explicit', branch.city);
    await prefs.setBool('selected_fulfillment_city_confirmed', true);
    for (final suffix in ['', '_pickup']) {
      await prefs.setString('selected_bakery_location$suffix', branch.displayLabel);
      await prefs.setString('selected_bakery_location_id$suffix', branch.id);
    }
    app.main();
    Future<void> ready(Finder finder) async {
      for (var i = 0; i < 90; i++) {
        await tester.pump(const Duration(seconds: 1));
        if (finder.evaluate().isNotEmpty) return;
      }
      fail('Expected screen did not appear: $finder');
    }
    Future<void> capture(String name, int tab) async {
      final slot = find.byKey(ValueKey('tab-slot-$tab'));
      await ready(slot);
      expect(tester.widget<Offstage>(slot).offstage, false);
      // Allow public images and data to finish loading after the verified tab switch.
      for (var i=0; i<15; i++) { await tester.pump(const Duration(seconds: 1)); }
      expect(tester.widget<Offstage>(slot).offstage, false);
      await binding.takeScreenshot(name);
    }
    await ready(find.text('Главная'));
    await ready(find.text('Булочки')); 
    await capture('01-catalog', 1);
    await tester.tap(find.text('Главная').last);
    await capture('02-home', 0);
    await tester.tap(find.text('Локации').last);
    await capture('03-locations', 3);
  }, timeout: const Timeout(Duration(minutes: 8)));
}
