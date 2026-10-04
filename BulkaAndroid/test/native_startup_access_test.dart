import 'dart:async';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
// Exercise the native directory boundary without opening a network connection.
// ignore: depend_on_referenced_packages
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';

class _UnavailableLaunchDirectory extends PathProviderPlatform {
  final pending = Completer<String>();
  var reads = 0;
  @override
  Future<String?> getApplicationSupportPath() {
    reads++;
    return pending.future;
  }
}

void main() {
  for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
    testWidgets(
      'native first frame accepts taps without launch media: $platform',
      (tester) async {
        final original = PathProviderPlatform.instance;
        final directory = _UnavailableLaunchDirectory();
        PathProviderPlatform.instance = directory;
        addTearDown(() => PathProviderPlatform.instance = original);
        var taps = 0;
        await tester.pumpWidget(
          MaterialApp(
            theme: buildBulkaTheme().copyWith(platform: platform),
            home: NativeLaunchVideoGate(
              child: Scaffold(
                body: Center(
                  child: TextButton(
                    onPressed: () => taps++,
                    child: const Text('Открыть каталог'),
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Открыть каталог'));
        expect(
          taps,
          1,
          reason:
              'Startup must not wait for native directory/media initialization.',
        );
        expect(
          directory.reads,
          0,
          reason: 'No unused 2MB launch media should be downloaded.',
        );
        await tester.pump(const Duration(seconds: 10));
        await tester.tap(find.text('Открыть каталог'));
        expect(taps, 2);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }

  testWidgets(
    'startup stays accessible with reduced motion and resumed rebuilds',
    (tester) async {
      var taps = 0;
      Widget app(bool reduced) => MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(disableAnimations: reduced),
          child: child!,
        ),
        home: NativeLaunchVideoGate(
          child: Scaffold(
            body: TextButton(
              onPressed: () => taps++,
              child: const Text('Открыть каталог'),
            ),
          ),
        ),
      );
      await tester.pumpWidget(app(true));
      await tester.tap(find.text('Открыть каталог'));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpWidget(app(false));
      await tester.pump(const Duration(seconds: 5));
      await tester.tap(find.text('Открыть каталог'));
      expect(taps, 2);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
