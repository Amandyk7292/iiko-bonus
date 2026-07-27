import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _testApp({required bool reduceMotion, required Widget child}) {
  return MaterialApp(
    home: MediaQuery(
      data: MediaQueryData(disableAnimations: reduceMotion),
      child: Scaffold(
        body: Center(child: SizedBox(width: 220, height: 220, child: child)),
      ),
    ),
  );
}

void main() {
  testWidgets('loading placeholder shows an animated shimmer', (tester) async {
    await tester.pumpWidget(
      _testApp(
        reduceMotion: false,
        child: const BulkaImagePlaceholder(isLoading: true),
      ),
    );

    expect(
      find.byKey(const ValueKey('network-image-loading-placeholder')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('network-image-shimmer')), findsOneWidget);

    await tester.pump(const Duration(milliseconds: 400));
    expect(tester.takeException(), isNull);
  });

  testWidgets('loading placeholder respects reduced motion', (tester) async {
    await tester.pumpWidget(
      _testApp(
        reduceMotion: true,
        child: const BulkaImagePlaceholder(isLoading: true),
      ),
    );

    expect(
      find.byKey(const ValueKey('network-image-loading-placeholder')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('network-image-shimmer')), findsNothing);
  });

  testWidgets('failed image uses a stable fallback without shimmer', (
    tester,
  ) async {
    await tester.pumpWidget(
      _testApp(reduceMotion: false, child: const BulkaImagePlaceholder()),
    );

    expect(
      find.byKey(const ValueKey('network-image-error-placeholder')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('network-image-shimmer')), findsNothing);
  });
}
