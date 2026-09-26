import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _PerformanceStoriesApi extends BulkaApiClient {
  int reads = 0;
  @override
  Stream<Map<String, dynamic>> get customerEvents => const Stream.empty();
  @override
  Future<List<PromoStory>> getStories() async {
    reads++;
    return List.generate(
      20,
      (index) => PromoStory(
        id: index + 1,
        title: 'Акция $index',
        imageUrl: '',
        contentUrl: '',
        groupId: 'perf-$index',
        groupTitle: 'Акция $index',
        groupCoverUrl: '',
        duration: 5,
        sortOrder: index,
      ),
    );
  }
}

void main() {
  Future<_PerformanceStoriesApi> openPromos(WidgetTester tester) async {
    appLanguageNotifier.value = 'ru';
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _PerformanceStoriesApi();
    addTearDown(api.dispose);
    addTearDown(() => tester.pumpWidget(const SizedBox.shrink()));
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: PromosScreen(api: api),
      ),
    );
    await tester.pumpAndSettle();
    return api;
  }

  testWidgets('promotion scrolling retains the visible card widgets', (
    tester,
  ) async {
    await openPromos(tester);
    final card = find.byKey(const ValueKey('promos-grid-card-perf-0'));
    final before = tester.widget(card);
    final top = tester.getTopLeft(card).dy;
    final scroll = tester
        .state<ScrollableState>(
          find
              .descendant(
                of: find.byKey(const PageStorageKey('promos-list')),
                matching: find.byType(Scrollable),
              )
              .first,
        )
        .position;
    scroll.jumpTo(36);
    await tester.pump();
    expect(tester.getTopLeft(card).dy, closeTo(top - 36, 0.01));
    expect(tester.widget(card), same(before));
    expect(tester.takeException(), isNull);
  });

  testWidgets('promotions refresh once per minute and pause in background', (
    tester,
  ) async {
    final api = await openPromos(tester);
    final before = api.reads;
    await tester.pump(const Duration(seconds: 60));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();
    expect(api.reads, before + 1);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump(const Duration(seconds: 61));
    await tester.pump(const Duration(milliseconds: 300));
    expect(api.reads, before + 1);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(api.reads, before + 2);
  });

  testWidgets('press feedback releases on a drag inside a large card', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: const Scaffold(
          body: Center(
            child: BulkaPressScale(child: SizedBox(width: 300, height: 300)),
          ),
        ),
      ),
    );
    final press = find.byType(BulkaPressScale);
    final transform = find.descendant(
      of: press,
      matching: find.byType(Transform),
    );
    final gesture = await tester.startGesture(tester.getCenter(press));
    await tester.pumpAndSettle();
    expect(
      tester.widget<Transform>(transform).transform.entry(0, 0),
      lessThan(1),
    );
    await gesture.moveBy(const Offset(0, -35));
    await tester.pumpAndSettle();
    expect(
      tester.widget<Transform>(transform).transform.entry(0, 0),
      closeTo(1, 0.0001),
    );
    await gesture.moveBy(const Offset(0, -10));
    await tester.pumpAndSettle();
    expect(
      tester.widget<Transform>(transform).transform.entry(0, 0),
      closeTo(1, 0.0001),
    );
    expect(
      find.descendant(of: press, matching: find.byType(Opacity)),
      findsNothing,
    );
    await gesture.up();
    await tester.pumpAndSettle();
  });
}
