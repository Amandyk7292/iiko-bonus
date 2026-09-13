// Simulator-only entry point: real guest UI and live public catalog.
import 'dart:io';
import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'main.dart' as app;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  await prefs.setString('app_lang_code', 'ru');
  await prefs.setBool('bulka_welcome_completed_v1', true);
  await prefs.setBool('bulka_permissions_welcome_v1', true);
  await prefs.setInt('lastMainTab', int.parse(Platform.environment['BULKA_SCREEN'] ?? '1'));
  await prefs.setString('lastAppScreen', 'main');
  final locations = await app.BulkaApiClient().getFulfillmentLocations();
  final branch = locations.firstWhere((b) => b.id == '62fa7ada-3d67-4f85-bb37-5b13f0e1345c');
  await prefs.setString('selected_order_type', 'pickup');
  for (final suffix in ['', '_pickup']) {
    await prefs.setString('selected_bakery_location$suffix', branch.displayLabel);
    await prefs.setString('selected_bakery_location_id$suffix', branch.id);
  }
  app.main();
}
