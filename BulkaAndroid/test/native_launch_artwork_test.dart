import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

class _PendingArtworkBundle extends CachingAssetBundle {
  final artwork = Completer<ByteData>();

  @override
  Future<ByteData> load(String key) =>
      key == NativeLaunchArtwork.asset ? artwork.future : rootBundle.load(key);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'native launch surfaces share the original PNG without density scaling',
    () {
      final canonical = File(NativeLaunchArtwork.asset).readAsBytesSync();
      expect(canonical.length, 2231437);
      expect(
        File(
          'android/app/src/main/res/drawable-nodpi/background.png',
        ).readAsBytesSync(),
        orderedEquals(canonical),
      );
      expect(
        File(
          'ios/Runner/Assets.xcassets/LaunchBackground.imageset/background.png',
        ).readAsBytesSync(),
        orderedEquals(canonical),
      );
      for (final folder in [
        'drawable',
        'drawable-v21',
        'drawable-night',
        'drawable-night-v21',
      ]) {
        expect(
          File('android/app/src/main/res/$folder/background.png').existsSync(),
          isFalse,
        );
        expect(
          File(
            'android/app/src/main/res/$folder/launch_background.xml',
          ).readAsStringSync(),
          contains('android:gravity="fill" android:src="@drawable/background"'),
        );
      }
      for (final folder in ['values-v31', 'values-night-v31']) {
        final styles = File(
          'android/app/src/main/res/$folder/styles.xml',
        ).readAsStringSync();
        expect(styles, contains('windowSplashScreenBackground">#FFB329'));
        expect(
          styles,
          contains(
            'windowSplashScreenAnimatedIcon">@android:color/transparent',
          ),
        );
        expect(styles, isNot(contains('@drawable/android12splash')));
      }
      final catalog =
          jsonDecode(
                File(
                  'ios/Runner/Assets.xcassets/LaunchBackground.imageset/Contents.json',
                ).readAsStringSync(),
              )
              as Map<String, dynamic>;
      for (final entry in catalog['images'] as List<dynamic>) {
        if ((entry as Map<String, dynamic>)['filename'] != null) {
          expect(entry['filename'], 'background.png');
        }
      }
      expect(File('assets/brand/launch_animation.mp4').existsSync(), isFalse);
    },
  );

  testWidgets('native first frame waits only for local PNG decode', (
    tester,
  ) async {
    tester.binding.resetFirstFrameSent();
    final initialization = Completer<void>();
    final bundle = _PendingArtworkBundle();
    await tester.pumpWidget(
      DefaultAssetBundle(
        bundle: bundle,
        child: MaterialApp(
          home: BulkaInitializationView(
            initialization: initialization.future,
            child: const Scaffold(body: Text('ready')),
          ),
        ),
      ),
    );
    expect(find.byType(NativeLaunchArtwork), findsOneWidget);
    expect(tester.binding.sendFramesToEngine, isFalse);
    final image = tester.widget<Image>(find.byType(Image));
    expect(image.fit, BoxFit.cover);
    final bytes = await tester.runAsync(
      () => rootBundle.load(NativeLaunchArtwork.asset),
    );
    bundle.artwork.complete(bytes!);
    await tester.runAsync(
      () => precacheImage(
        image.image,
        tester.element(find.byType(NativeLaunchArtwork)),
      ),
    );
    await tester.pump();
    expect(tester.widget<RawImage>(find.byType(RawImage)).image, isNotNull);
    expect(tester.binding.sendFramesToEngine, isTrue);
    expect(find.text('ready'), findsNothing);
    initialization.complete();
    await tester.pump();
    await tester.pump();
    expect(find.text('ready'), findsOneWidget);
    expect(find.byType(NativeLaunchArtwork), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'ready UI releases a pending decode with no late launch overlay',
    (tester) async {
      tester.binding.resetFirstFrameSent();
      final initialization = Completer<void>();
      final bundle = _PendingArtworkBundle();
      var taps = 0;
      await tester.pumpWidget(
        DefaultAssetBundle(
          bundle: bundle,
          child: MaterialApp(
            home: BulkaInitializationView(
              initialization: initialization.future,
              child: Scaffold(
                body: TextButton(
                  onPressed: () => taps++,
                  child: const Text('ready'),
                ),
              ),
            ),
          ),
        ),
      );
      expect(tester.binding.sendFramesToEngine, isFalse);
      initialization.complete();
      await tester.pump();
      await tester.pump();
      expect(tester.binding.sendFramesToEngine, isTrue);
      await tester.tap(find.text('ready'));
      expect(taps, 1);
      final bytes = await tester.runAsync(
        () => rootBundle.load(NativeLaunchArtwork.asset),
      );
      bundle.artwork.complete(bytes!);
      await tester.pump(const Duration(seconds: 5));
      expect(find.byType(NativeLaunchArtwork), findsNothing);
      await tester.tap(find.text('ready'));
      expect(taps, 2);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('failed local artwork releases the first frame', (tester) async {
    tester.binding.resetFirstFrameSent();
    final bundle = _PendingArtworkBundle();
    await tester.pumpWidget(
      DefaultAssetBundle(
        bundle: bundle,
        child: const MaterialApp(
          home: NativeLaunchArtwork(holdFirstFrame: true),
        ),
      ),
    );
    expect(tester.binding.sendFramesToEngine, isFalse);
    bundle.artwork.completeError(StateError('missing local PNG'));
    await tester.pump();
    await tester.pump();
    expect(tester.binding.sendFramesToEngine, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('app stages never defer ready UI behind pending artwork', (
    tester,
  ) async {
    tester.binding.resetFirstFrameSent();
    final bundle = _PendingArtworkBundle();
    final ready = ValueNotifier(false);
    addTearDown(ready.dispose);
    await tester.pumpWidget(
      DefaultAssetBundle(
        bundle: bundle,
        child: MaterialApp(
          home: ValueListenableBuilder<bool>(
            valueListenable: ready,
            builder: (context, value, _) => BulkaAppStage(
              child: value
                  ? const Scaffold(key: ValueKey('ready'), body: Text('ready'))
                  : const SplashScreen(
                      key: ValueKey('loading'),
                      text: 'Загрузка',
                    ),
            ),
          ),
        ),
      ),
    );
    expect(tester.binding.sendFramesToEngine, isTrue);
    ready.value = true;
    await tester.pump();
    expect(
      tester.binding.sendFramesToEngine,
      isTrue,
      reason: 'The retained outgoing fade must not hold a ready first frame.',
    );
    expect(find.text('ready'), findsOneWidget);
    await tester.pumpAndSettle();
    expect(find.byType(NativeLaunchArtwork), findsNothing);
  });

  testWidgets('unmounting pending artwork releases its first-frame hold', (
    tester,
  ) async {
    tester.binding.resetFirstFrameSent();
    final bundle = _PendingArtworkBundle();
    await tester.pumpWidget(
      DefaultAssetBundle(
        bundle: bundle,
        child: const MaterialApp(
          home: NativeLaunchArtwork(holdFirstFrame: true),
        ),
      ),
    );
    expect(tester.binding.sendFramesToEngine, isFalse);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    expect(tester.binding.sendFramesToEngine, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('web initialization keeps its existing empty loading surface', (
    tester,
  ) async {
    tester.binding.resetFirstFrameSent();
    final initialization = Completer<void>();
    await tester.pumpWidget(
      MaterialApp(
        home: BulkaInitializationView(
          initialization: initialization.future,
          isWeb: true,
          child: const Scaffold(body: Text('ready')),
        ),
      ),
    );
    expect(find.byType(NativeLaunchArtwork), findsNothing);
    expect(find.byType(Image), findsNothing);
    expect(tester.binding.sendFramesToEngine, isTrue);
    initialization.complete();
    await tester.pump();
    expect(find.text('ready'), findsOneWidget);
  });

  for (final reduced in [false, true]) {
    testWidgets('native loading stage fades into ready UI, reduced=$reduced', (
      tester,
    ) async {
      final ready = ValueNotifier(false);
      addTearDown(ready.dispose);
      var taps = 0;
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(disableAnimations: reduced),
            child: child!,
          ),
          home: ValueListenableBuilder<bool>(
            valueListenable: ready,
            builder: (context, value, _) => BulkaAppStage(
              child: value
                  ? Scaffold(
                      key: const ValueKey('ready'),
                      body: TextButton(
                        onPressed: () => taps++,
                        child: const Text('ready'),
                      ),
                    )
                  : const SplashScreen(
                      key: ValueKey('loading'),
                      text: 'Загрузка',
                    ),
            ),
          ),
        ),
      );
      expect(find.byType(NativeLaunchArtwork), findsOneWidget);
      final switcher = tester.widget<AnimatedSwitcher>(
        find.byType(AnimatedSwitcher),
      );
      expect(switcher.duration, reduced ? Duration.zero : BulkaMotion.standard);
      ready.value = true;
      await tester.pump();
      await tester.tap(find.text('ready'));
      expect(
        taps,
        1,
        reason: 'The outgoing artwork must not intercept ready UI.',
      );
      await tester.pumpAndSettle();
      expect(find.byType(SplashScreen), findsNothing);
      expect(find.byType(NativeLaunchArtwork), findsNothing);
      expect(tester.takeException(), isNull);
    });
  }
}
