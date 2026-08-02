import 'package:bulka_bonus/main.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('promotion model reads optional detail metadata', () {
    final story = PromoStory.fromJson({
      'id': 7,
      'title': 'Акция',
      'coverUrl': 'https://example.com/cover.webp',
      'contentUrl': 'https://example.com/content.webp',
      'groupId': 'offer',
      'promoType': 'discount',
      'details': 'Подробные условия',
      'startsAt': '2026-08-01T00:00:00.000Z',
      'endsAt': '2026-08-10T00:00:00.000Z',
      'remaining': 3,
      'qrValue': 'BULKA-OFFER-7',
      'createdAt': '2026-07-30T00:00:00.000Z',
      'i18n': {
        'ru': {'details': 'Подробные условия'},
        'kz': {'details': 'Толық шарттар'},
        'en': {'details': 'Full terms'},
      },
    });

    expect(story.promoType, 'discount');
    expect(story.localizedLongDescription, 'Подробные условия');
    expect(story.remaining, 3);
    expect(story.qrValue, 'BULKA-OFFER-7');
  });

  testWidgets('promotion cards preserve the 1080 by 480 cover ratio', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(390, 844);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: PromosScreen(api: _PromoGridApiClient()),
      ),
    );
    await tester.pumpAndSettle();

    final size = tester.getSize(
      find.byKey(const ValueKey('promo-cover-ratio-check')),
    );
    expect(size.width / size.height, closeTo(1080 / 480, 0.001));
  });

  testWidgets('promotions hide the desktop scrollbar but remain scrollable', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(390, 500);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: PromosScreen(api: _PromoGridApiClient()),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('promos-scroll-configuration')),
      findsOneWidget,
    );
    expect(find.byType(Scrollbar), findsNothing);

    final scrollable = find.byType(Scrollable).first;
    final before = tester.state<ScrollableState>(scrollable).position.pixels;
    await tester.drag(scrollable, const Offset(0, -220));
    await tester.pumpAndSettle();
    final after = tester.state<ScrollableState>(scrollable).position.pixels;
    expect(after, greaterThan(before));
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('opening a promotion shows its description and optional QR', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(390, 844);
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: PromosScreen(api: _PromoGridApiClient()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(const ValueKey('promos-grid-card-ratio-check')),
    );
    await tester.pumpAndSettle();

    expect(find.byType(StoryViewer), findsNothing);
    expect(find.text('Полное описание акции'), findsOneWidget);
    expect(find.text('Показать QR-код'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('promo-details-scroll-configuration')),
      findsOneWidget,
    );
    expect(find.byType(Scrollbar), findsNothing);
    final sheetSize = tester.getSize(
      find.byKey(const ValueKey('promo-details-sheet')),
    );
    expect(sheetSize.height, lessThan(844 * 0.85));

    await tester.tap(find.text('Показать QR-код'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('promotion-qr')), findsOneWidget);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('promo cover keeps the 1080 by 480 aspect ratio', (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(390, 844);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PromoBannerSlider(
            groups: const [
              StoryGroup(
                id: 'ratio-check',
                title: 'Banner',
                coverUrl: '',
                stories: [],
              ),
            ],
            viewedGroups: const {},
            onGroupTap: (_) {},
          ),
        ),
      ),
    );
    await tester.pump();

    final size = tester.getSize(
      find.byKey(const ValueKey('promo-card-ratio-check')),
    );
    expect(size.width / size.height, closeTo(1080 / 480, 0.001));
    expect(size.width, 358);
    expect(size.height, closeTo(358 / (1080 / 480), 0.001));
  });

  testWidgets('manual banner paging restarts the five second timer', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(390, 844);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);

    const groups = [
      StoryGroup(id: 'one', title: 'One', coverUrl: '', stories: []),
      StoryGroup(id: 'two', title: 'Two', coverUrl: '', stories: []),
      StoryGroup(id: 'three', title: 'Three', coverUrl: '', stories: []),
    ];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PromoBannerSlider(
            groups: groups,
            viewedGroups: const {},
            onGroupTap: (_) {},
          ),
        ),
      ),
    );
    await tester.pump(const Duration(seconds: 1));
    await tester.fling(find.byType(PageView), const Offset(-330, 0), 1200);
    await tester.pumpAndSettle();

    final controller = tester
        .widget<PageView>(find.byType(PageView))
        .controller!;
    expect(controller.page, closeTo(1, 0.01));

    await tester.pump(const Duration(milliseconds: 4400));
    expect(controller.page, closeTo(1, 0.01));

    await tester.pump(const Duration(milliseconds: 700));
    await tester.pump(BulkaMotion.emphasized);
    expect(controller.page, closeTo(2, 0.01));
  });

  testWidgets('startup surface is solid white and animated', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: SplashScreen(text: 'Loading Bulka')),
    );
    await tester.pump();

    final scaffold = tester.widget<Scaffold>(find.byType(Scaffold));
    expect(scaffold.backgroundColor, Colors.white);
    expect(find.byType(BackdropFilter), findsNothing);
    expect(find.byType(ImageFiltered), findsNothing);
    expect(find.text('Loading Bulka'), findsNothing);
    expect(find.byType(LinearProgressIndicator), findsNothing);
    expect(find.byKey(const ValueKey('splash-clean-logo')), findsOneWidget);
    expect(find.byKey(const ValueKey('splash-logo-pulse')), findsOneWidget);
    final logoSize = tester.getSize(
      find.byKey(const ValueKey('splash-clean-logo')),
    );
    expect(logoSize.width, greaterThanOrEqualTo(250));
    final logoImage = tester.widget<Image>(
      find.descendant(
        of: find.byKey(const ValueKey('splash-clean-logo')),
        matching: find.byType(Image),
      ),
    );
    expect(logoImage.width, 184);

    final pulse = tester.widget<ScaleTransition>(
      find.byKey(const ValueKey('splash-logo-pulse')),
    );
    final initialScale = pulse.scale.value;
    await tester.pump(const Duration(milliseconds: 2250));
    expect(pulse.scale.value, greaterThan(initialScale));
    expect(pulse.scale.value, closeTo(1.05, 0.01));
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('splash-clean-logo')),
        matching: find.byType(DecoratedBox),
      ),
      findsNothing,
    );
  });

  testWidgets('story viewer uses the global white loading surface', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: StoryViewer(
          stories: [
            PromoStory(
              id: 1,
              title: 'Story',
              imageUrl: '',
              contentUrl: '',
              groupId: 'story',
              groupTitle: 'Story',
              groupCoverUrl: '',
            ),
          ],
          initialIndex: 0,
          heroTag: 'story-test',
        ),
      ),
    );
    await tester.pump();

    final scaffold = tester.widget<Scaffold>(find.byType(Scaffold));
    expect(scaffold.backgroundColor, Colors.white);
    expect(find.byKey(const ValueKey('story-loading-effect')), findsOneWidget);
    expect(
      tester.widget(find.byKey(const ValueKey('story-loading-content'))),
      isA<Padding>(),
    );
    final loadingLogo = tester.widget<Image>(
      find.byKey(const ValueKey('story-loading-logo')),
    );
    expect(loadingLogo.width, 160);
    expect(find.byType(LinearProgressIndicator), findsAtLeastNWidgets(2));
  });

  testWidgets('portrait story fills the viewport behind its controls', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(390, 844);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);

    await tester.pumpWidget(
      const MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(
            size: Size(390, 844),
            devicePixelRatio: 1,
            disableAnimations: true,
          ),
          child: StoryViewer(
            stories: [
              PromoStory(
                id: 1,
                title: 'Новинка',
                imageUrl: 'https://example.com/story-1080x1920.jpg',
                contentUrl: '',
                groupId: 'story',
                groupTitle: 'Новинка',
                groupCoverUrl: '',
              ),
            ],
            initialIndex: 0,
            heroTag: 'portrait-story-test',
          ),
        ),
      ),
    );
    await tester.pump();

    final controlsRect = tester.getRect(
      find.byKey(const ValueKey('story-controls')),
    );
    final frameRect = tester.getRect(
      find.byKey(const ValueKey('story-media-frame')),
    );

    expect(frameRect, const Rect.fromLTWH(0, 0, 390, 844));
    expect(find.byType(ImageFiltered), findsOneWidget);
    expect(find.byKey(const ValueKey('story-loading-effect')), findsOneWidget);
    expect(frameRect.contains(controlsRect.center), isTrue);
    expect(controlsRect.top, greaterThanOrEqualTo(frameRect.top));
    expect(controlsRect.bottom, lessThan(frameRect.bottom));
  });

  testWidgets('desktop story stays centered inside a portrait frame', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1440, 900);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);

    await tester.pumpWidget(
      const MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(
            size: Size(1440, 900),
            devicePixelRatio: 1,
            disableAnimations: true,
          ),
          child: StoryViewer(
            stories: [
              PromoStory(
                id: 1,
                title: 'Новинка',
                imageUrl: '',
                contentUrl: '',
                groupId: 'desktop-story',
                groupTitle: 'Новинка',
                groupCoverUrl: '',
              ),
            ],
            initialIndex: 0,
            heroTag: 'desktop-story-test',
          ),
        ),
      ),
    );
    await tester.pump();

    final frameRect = tester.getRect(
      find.byKey(const ValueKey('story-desktop-frame')),
    );
    final controlsRect = tester.getRect(
      find.byKey(const ValueKey('story-controls')),
    );

    expect(
      find.byKey(const ValueKey('story-desktop-backdrop')),
      findsOneWidget,
    );
    expect(frameRect.width, lessThanOrEqualTo(540));
    expect(frameRect.height, lessThanOrEqualTo(868));
    expect(frameRect.width / frameRect.height, closeTo(9 / 16, 0.001));
    expect(frameRect.center.dx, closeTo(720, 0.01));
    expect(frameRect.center.dy, closeTo(450, 0.01));
    expect(frameRect.contains(controlsRect.center), isTrue);
  });

  testWidgets('story navigation rotates two faces as a 3D cube', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(390, 844);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);

    await tester.pumpWidget(
      const MaterialApp(
        home: StoryViewer(
          stories: [
            PromoStory(
              id: 1,
              title: 'Первая',
              imageUrl: '',
              contentUrl: '',
              groupId: 'cube',
              groupTitle: 'Первая',
              groupCoverUrl: '',
              duration: 10,
            ),
            PromoStory(
              id: 2,
              title: 'Вторая',
              imageUrl: '',
              contentUrl: '',
              groupId: 'cube',
              groupTitle: 'Вторая',
              groupCoverUrl: '',
              duration: 10,
            ),
          ],
          initialIndex: 0,
          heroTag: 'cube-story-test',
        ),
      ),
    );
    await tester.pump();

    expect(find.byKey(const ValueKey('story-cube-stage')), findsOneWidget);
    expect(find.byKey(const ValueKey('story-target-face')), findsNothing);

    await tester.tapAt(const Offset(330, 420));
    await tester.pump();
    await tester.pump(
      Duration(microseconds: BulkaMotion.emphasized.inMicroseconds ~/ 2),
    );

    final currentFace = tester.widget<Transform>(
      find.descendant(
        of: find.byKey(const ValueKey('story-current-face')),
        matching: find.byType(Transform),
      ),
    );
    final targetFace = tester.widget<Transform>(
      find.descendant(
        of: find.byKey(const ValueKey('story-target-face')),
        matching: find.byType(Transform),
      ),
    );
    expect(currentFace.transform.entry(2, 0).abs(), greaterThan(0.01));
    expect(targetFace.transform.entry(2, 0).abs(), greaterThan(0.01));
    expect(currentFace.transform.entry(3, 2), isNot(0));

    await tester.pump(BulkaMotion.emphasized);
    expect(find.byKey(const ValueKey('story-target-face')), findsNothing);
    expect(find.text('Вторая'), findsWidgets);
  });

  testWidgets('story cube follows a horizontal drag before settling', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(390, 844);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);

    await tester.pumpWidget(
      const MaterialApp(
        home: StoryViewer(
          stories: [
            PromoStory(
              id: 1,
              title: 'Первая',
              imageUrl: '',
              contentUrl: '',
              groupId: 'drag',
              groupTitle: 'Первая',
              groupCoverUrl: '',
              duration: 10,
            ),
            PromoStory(
              id: 2,
              title: 'Вторая',
              imageUrl: '',
              contentUrl: '',
              groupId: 'drag',
              groupTitle: 'Вторая',
              groupCoverUrl: '',
              duration: 10,
            ),
          ],
          initialIndex: 0,
          heroTag: 'drag-story-test',
        ),
      ),
    );
    await tester.pump();

    final gesture = await tester.startGesture(const Offset(300, 420));
    await gesture.moveBy(const Offset(-24, 0));
    await tester.pump();
    await gesture.moveBy(const Offset(-171, 0));
    await tester.pump();

    expect(find.byKey(const ValueKey('story-target-face')), findsOneWidget);
    final currentFace = tester.widget<Transform>(
      find.descendant(
        of: find.byKey(const ValueKey('story-current-face')),
        matching: find.byType(Transform),
      ),
    );
    expect(currentFace.transform.entry(2, 0).abs(), greaterThan(0.1));

    await gesture.up();
    await tester.pump();
    await tester.pump(BulkaMotion.emphasized);
    await tester.pump();
    expect(find.text('Вторая'), findsWidgets);
    expect(find.byKey(const ValueKey('story-target-face')), findsNothing);
  });
}

class _PromoGridApiClient extends BulkaApiClient {
  @override
  Future<List<PromoStory>> getStories() async => const [
    PromoStory(
      id: 1,
      title: 'Banner',
      imageUrl: '',
      contentUrl: '',
      groupId: 'ratio-check',
      groupTitle: 'Banner',
      groupCoverUrl: '',
      duration: 1,
      description: 'Краткое описание',
      details: 'Полное описание акции',
      qrValue: 'BULKA-PROMO-1',
    ),
    PromoStory(
      id: 2,
      title: 'Second banner',
      imageUrl: '',
      contentUrl: '',
      groupId: 'next-story',
      groupTitle: 'Second banner',
      groupCoverUrl: '',
      duration: 1,
      sortOrder: 1,
    ),
  ];
}
