import 'dart:io';
import 'package:bulka_bonus/core/product_image_cache.dart';
import 'package:flutter/services.dart';
import 'package:bulka_bonus/main.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory cacheDirectory;
  setUpAll(() async {
    cacheDirectory = await Directory.systemTemp.createTemp(
      'bulka-motion-cache-',
    );
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('plugins.flutter.io/path_provider'),
          (_) async => cacheDirectory.path,
        );
  });
  tearDownAll(() async {
    await productImageCache.dispose();
    await cacheDirectory.delete(recursive: true);
  });
  test('story prefetch shares the native decoded image cache key', () async {
    const url = 'https://example.com/story.png';
    final prefetched = networkImageCacheProvider(
      url,
      pixelWidth: 384,
      pixelHeight: 768,
      isWeb: false,
    );
    final displayed = ResizeImage.resizeIfNeeded(
      384,
      768,
      const CachedNetworkImageProvider(url),
    );
    expect(
      await prefetched.obtainKey(ImageConfiguration.empty),
      await displayed.obtainKey(ImageConfiguration.empty),
    );
    expect(
      networkImageCacheProvider(
        url,
        pixelWidth: 384,
        pixelHeight: 768,
        isWeb: true,
      ),
      const NetworkImage(url),
    );
  });

  for (final reduced in [false, true]) {
    testWidgets('product route is reversible on iOS, reduced=$reduced', (
      tester,
    ) async {
      late BulkaPageRoute<void> route;
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme().copyWith(platform: TargetPlatform.iOS),
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(disableAnimations: reduced),
            child: child!,
          ),
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () {
                  route = BulkaPageRoute<void>(
                    reduceMotion: reduced,
                    builder: (context) => Scaffold(
                      body: TextButton(
                        onPressed: () => Navigator.pop(context),
                        child: const Text('close'),
                      ),
                    ),
                  );
                  Navigator.push(context, route);
                },
                child: const Text('open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 80));
      expect(route.opaque, isTrue);
      if (reduced) {
        expect(route.transitionDuration, Duration.zero);
        expect(route.reverseTransitionDuration, Duration.zero);
        expect(route.animation!.value, 1);
      } else {
        expect(route.animation!.value, inExclusiveRange(0, 1));
        expect(find.byType(CupertinoPageTransition), findsWidgets);
      }
      await tester.pumpAndSettle();
      if (reduced) {
        await tester.tap(find.text('close'));
      } else {
        // Native edge swipe must remain interactive, not just a decorative slide.
        final gesture = await tester.startGesture(const Offset(1, 200));
        await gesture.moveBy(const Offset(500, 0));
        await tester.pump(const Duration(milliseconds: 80));
        await gesture.up();
      }
      await tester.pumpAndSettle();
      expect(find.text('open'), findsOneWidget);
      expect(find.text('close'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('avatar sheet opens and closes without motion when requested', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme().copyWith(platform: TargetPlatform.iOS),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(disableAnimations: true),
          child: child!,
        ),
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () =>
                  showCustomerAvatarPicker(context, selectedKey: null),
              child: const Text('open avatar'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open avatar'));
    await tester.pump();
    final sheet = tester.element(find.byType(BottomSheet));
    final route = ModalRoute.of(sheet)!;
    expect(route.animation!.value, 1);
    Navigator.of(sheet).pop();
    await tester.pumpAndSettle();
    expect(find.byType(BottomSheet), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
