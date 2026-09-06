import 'dart:async';
import 'dart:convert';
import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

const menu = {
  'categories': [
    {'id': 'bread', 'name': 'Выпечка'},
  ],
  'products': [
    {
      'id': 'bun',
      'name': 'Булочка',
      'categoryId': 'bread',
      'price': 300,
      'imageUrl': '',
      'onlineOrderable': true,
    },
  ],
};
http.Response response(Object value) => http.Response(
  jsonEncode(value),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

class FeedApi extends BulkaApiClient {
  final stories = Completer<List<PromoStory>>();
  final news = Completer<List<NewsItem>>();
  int storyRequests = 0;
  int newsRequests = 0;
  @override
  Future<List<PromoStory>> getStories() {
    storyRequests++;
    return stories.future;
  }

  @override
  Future<List<NewsItem>> getNews() {
    newsRequests++;
    return news.future;
  }
}

Widget home(FeedApi api, {bool visible = true}) => MaterialApp(
  theme: buildBulkaTheme(),
  home: TickerMode(
    enabled: visible,
    child: HomeScreen(
      api: api,
      customer: null,
      transactions: const [],
      onHistoryTap: () {},
      onProfileTap: () {},
      onRequireAuth: () async => false,
      onOpenCatalog: (_) async {},
    ),
  ),
);

Future<void> frames(WidgetTester tester) async {
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

void main() {
  setUp(() {
    appLanguageNotifier.value = 'ru';
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('stories render while news is still pending', (tester) async {
    final api = FeedApi();
    await tester.pumpWidget(home(api));
    await frames(tester);
    api.stories.complete([
      PromoStory.fromJson({
        'id': 1,
        'title': 'Быстрая акция',
        'groupId': 'fast',
      }),
    ]);
    await frames(tester);
    expect(find.byType(PromoBannerSlider), findsOneWidget);
    expect(find.byType(PromoBannerShimmer), findsNothing);
    expect(api.news.isCompleted, isFalse);
    api.news.complete([]);
    await frames(tester);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('news render while stories are still pending', (tester) async {
    final api = FeedApi();
    await tester.pumpWidget(home(api));
    await frames(tester);
    api.news.complete([
      const NewsItem(id: 1, title: 'Быстрая новость', imageUrl: ''),
    ]);
    await frames(tester);
    expect(find.byType(NewsFeed, skipOffstage: false), findsOneWidget);
    expect(api.stories.isCompleted, isFalse);
    api.stories.complete([]);
    await frames(tester);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('hidden home does not poll and visible home resumes polling', (
    tester,
  ) async {
    final api = FeedApi();
    api.stories.complete([]);
    api.news.complete([]);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpWidget(home(api));
    await frames(tester);
    expect(api.storyRequests, 1);
    await tester.pumpWidget(home(api, visible: false));
    await tester.pump(const Duration(minutes: 3));
    expect(api.storyRequests, 1);
    expect(api.newsRequests, 1);
    await tester.pumpWidget(home(api));
    await tester.pump(const Duration(minutes: 1));
    await frames(tester);
    expect(api.storyRequests, 2);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
    'cached catalog renders before a slow response without changing cart prices',
    (tester) async {
      SharedPreferences.setMockInitialValues({
        'catalog_cache_ru_pickup_all': jsonEncode({
          'payload': menu,
          'cachedAt': DateTime.now().toIso8601String(),
        }),
      });
      final pending = Completer<http.Response>();
      var optionRequests = 0;
      final api = BulkaApiClient(
        client: MockClient((request) async {
          if (request.url.path == '/api/guest/menu') return pending.future;
          if (request.url.path.endsWith('/product-options/summary')) {
            optionRequests++;
          }
          return response({'success': true, 'products': {}});
        }),
      );
      final cart = CartProvider();
      await frames(tester);
      cart.addItem(productId: 'bun', name: 'Булочка', price: 500, imageUrl: '');
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: cart,
          child: MaterialApp(
            theme: buildBulkaTheme(),
            home: CatalogScreen(api: api, hasSelectedOrderType: true),
          ),
        ),
      );
      await frames(tester);
      expect(
        find.byKey(const ValueKey('catalog-category-title-Выпечка')),
        findsOneWidget,
      );
      expect(cart.totalAmount, 500);
      expect(optionRequests, 0);
      pending.complete(response(menu));
      await frames(tester);
      expect(cart.totalAmount, 300);
      expect(optionRequests, 1);
      await tester.pumpWidget(const SizedBox());
      api.dispose();
      cart.dispose();
    },
  );

  testWidgets(
    'catalog coalesces update bursts and does not poll a hidden tab',
    (tester) async {
      final events = StreamController<Map<String, dynamic>>.broadcast();
      final pending = Completer<http.Response>();
      var menuRequests = 0;
      final client = MockClient((request) async {
        if (request.url.path == '/api/guest/menu') {
          menuRequests++;
          if (menuRequests == 2) return pending.future;
          return response(menu);
        }
        return response({'success': true, 'products': {}});
      });
      final api = EventMenuApi(client, events.stream);
      final cart = CartProvider();
      Widget host(bool visible) => ChangeNotifierProvider.value(
        value: cart,
        child: MaterialApp(
          theme: buildBulkaTheme(),
          home: TickerMode(
            enabled: visible,
            child: CatalogScreen(api: api, hasSelectedOrderType: true),
          ),
        ),
      );
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpWidget(host(true));
      await frames(tester);
      expect(menuRequests, 1);
      for (var i = 0; i < 5; i++) {
        events.add({'type': 'menu.updated'});
      }
      await frames(tester);
      expect(menuRequests, 2);
      pending.complete(response(menu));
      await frames(tester);
      await tester.pumpWidget(host(false));
      await tester.pump(const Duration(minutes: 3));
      await frames(tester);
      expect(menuRequests, 2);
      await tester.pumpWidget(host(true));
      await tester.pump(const Duration(minutes: 1));
      await frames(tester);
      expect(menuRequests, 3);
      await tester.pumpWidget(const SizedBox());
      await events.close();
      api.dispose();
      cart.dispose();
    },
  );
}

class EventMenuApi extends BulkaApiClient {
  EventMenuApi(http.Client client, this.events) : super(client: client);
  final Stream<Map<String, dynamic>> events;
  @override
  Stream<Map<String, dynamic>> get customerEvents => events;
}
