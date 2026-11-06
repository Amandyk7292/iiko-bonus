import 'package:bulka_bonus/core/orientation_policy.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('phones stay portrait in both positions, tablets remain unlocked', () {
    for (final size in [const Size(1179, 2556), const Size(2556, 1179)]) {
      expect(bulkaOrientationsForDisplay(size, 3), [
        DeviceOrientation.portraitUp,
      ]);
    }
    for (final size in [const Size(1536, 2048), const Size(2048, 1536)]) {
      expect(bulkaOrientationsForDisplay(size, 2), isEmpty);
    }
  });

  testWidgets(
    'mobile policy locks once and unlocks when display becomes a tablet',
    (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
      tester.view.display.size = const Size(1179, 2556);
      tester.view.display.devicePixelRatio = 3;
      addTearDown(tester.view.display.resetSize);
      addTearDown(tester.view.display.resetDevicePixelRatio);
      final calls = <Object?>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'SystemChrome.setPreferredOrientations') {
            calls.add(call.arguments);
          }
          return null;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          null,
        ),
      );
      final policy = BulkaOrientationPolicy()..start();
      addTearDown(policy.dispose);
      await tester.pump();
      policy.didChangeMetrics();
      expect(calls, [
        ['DeviceOrientation.portraitUp'],
      ]);
      tester.view.display.size = const Size(2556, 1179);
      policy.didChangeMetrics();
      expect(calls.length, 1);
      tester.view.display.size = const Size(2048, 1536);
      tester.view.display.devicePixelRatio = 2;
      policy.didChangeMetrics();
      await tester.pump();
      expect(calls.last, isEmpty);
      debugDefaultTargetPlatformOverride = null;
    },
  );
}
