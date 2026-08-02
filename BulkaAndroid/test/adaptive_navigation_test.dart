import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('wide layouts use a persistent navigation rail', (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => CartProvider(),
        child: MaterialApp(
          theme: buildBulkaTheme(),
          home: MainShell(
            api: _AdaptiveNavigationApiClient(),
            customer: null,
            transactions: const [],
            onLogout: () async {},
            onRefreshProfile: () async {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(NavigationRail), findsOneWidget);
    expect(find.byType(FloatingNavBar), findsNothing);
    expect(find.text('Главная'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('desktop web frame keeps the customer app in mobile layout', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => CartProvider(),
        child: MaterialApp(
          theme: buildBulkaTheme(),
          builder: (context, child) => BulkaDesktopPhoneViewport(
            desktopModeOverride: true,
            child: child ?? const SizedBox.shrink(),
          ),
          home: MainShell(
            api: _AdaptiveNavigationApiClient(),
            customer: null,
            transactions: const [],
            onLogout: () async {},
            onRefreshProfile: () async {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('bulka-desktop-phone-frame')),
      findsOneWidget,
    );
    expect(
      tester.getSize(find.byKey(const ValueKey('bulka-desktop-phone-content'))),
      BulkaDesktopPhoneViewport.phoneContentSize,
    );
    expect(find.byType(FloatingNavBar), findsOneWidget);
    expect(find.byType(NavigationRail), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('desktop phone caps its scale and publishes safe insets', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(2560, 1440);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => BulkaDesktopPhoneViewport(
          desktopModeOverride: true,
          child: child ?? const SizedBox.shrink(),
        ),
        home: const _DesktopViewportProbe(),
      ),
    );
    await tester.pumpAndSettle();

    final frameRect = tester.getRect(
      find.byKey(const ValueKey('bulka-desktop-phone-frame')),
    );
    expect(
      frameRect.width,
      closeTo(446 * BulkaDesktopPhoneViewport.maxDesktopScale, 0.01),
    );
    expect(
      frameRect.height,
      closeTo(884 * BulkaDesktopPhoneViewport.maxDesktopScale, 0.01),
    );
    expect(find.text('430x860 / 10x10'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

class _DesktopViewportProbe extends StatelessWidget {
  const _DesktopViewportProbe();

  @override
  Widget build(BuildContext context) {
    final mediaQuery = MediaQuery.of(context);
    return ColoredBox(
      color: Colors.white,
      child: Center(
        child: Text(
          '${mediaQuery.size.width.toInt()}x'
          '${mediaQuery.size.height.toInt()} / '
          '${mediaQuery.padding.top.toInt()}x'
          '${mediaQuery.padding.bottom.toInt()}',
        ),
      ),
    );
  }
}

class _AdaptiveNavigationApiClient extends BulkaApiClient {
  @override
  Future<List<PromoStory>> getStories() async => const [];

  @override
  Future<List<NewsItem>> getNews() async => const [];

  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async => const [];
}
