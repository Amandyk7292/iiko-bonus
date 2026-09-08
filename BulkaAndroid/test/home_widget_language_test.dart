import 'package:bulka_bonus/main.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('home_widget');
  test(
    'selected app language updates widget labels and tier; background pushes preserve it',
    () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      SharedPreferences.setMockInitialValues({});
      final data = <String, dynamic>{'widget_tier': 'Платина'};
      var reloads = 0;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            if (call.method == 'saveWidgetData') {
              data[call.arguments['id']] = call.arguments['data'];
            }
            if (call.method == 'getWidgetData') {
              return data[call.arguments['id']];
            }
            if (call.method == 'updateWidget') reloads++;
            return true;
          });
      addTearDown(() {
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, null);
        debugDefaultTargetPlatformOverride = null;
        appLanguageNotifier.value = 'ru';
      });
      for (final language in ['kk', 'en', 'ru']) {
        appLanguageNotifier.value = language;
        await HomeWidgetSync.setLanguage(language);
        expect(data['widget_language'], language);
        expect(data['widget_tier'], localizeTierName('Платина'));
      }
      expect(reloads, 3);
      appLanguageNotifier.value = 'en';
      await HomeWidgetSync.setLanguage('en');
      appLanguageNotifier.value =
          'ru'; // A fresh background isolate defaults to Russian.
      await HomeWidgetSync.updateFromPush({
        'type': 'order',
        'orderId': 'o-1',
        'orderNumber': '100039',
        'orderStatus': 'preparing',
      });
      expect(data['widget_language'], 'en');
    },
  );
}
