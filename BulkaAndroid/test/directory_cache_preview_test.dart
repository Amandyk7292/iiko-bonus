import 'dart:async';
import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
// Exercise read/write failures at the actual preferences boundary.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences_platform_interface/shared_preferences_platform_interface.dart';

const _cachedBranch = BakeryLocation(
  id: 'cached',
  name: 'Сохранённая пекарня',
  address: 'Старый адрес',
  city: 'Актау',
);
const _freshBranch = BakeryLocation(
  id: 'fresh',
  name: 'Новая пекарня',
  address: 'Новый адрес',
  city: 'Актау',
);

class _PendingLocationsApi extends BulkaApiClient {
  final pending = Completer<List<BakeryLocation>>();
  var reads = 0;
  @override
  Stream<Map<String, dynamic>> get customerEvents => const Stream.empty();
  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() {
    reads++;
    return pending.future;
  }
}

class _UnavailablePreferences extends InMemorySharedPreferencesStore {
  _UnavailablePreferences() : super.empty();
  @override
  Future<Map<String, Object>> getAll() async =>
      throw StateError('fixture unavailable');
}

class _BrokenCachePreferences extends InMemorySharedPreferencesStore {
  _BrokenCachePreferences()
    : super.withData({'flutter.fulfillment_locations_cache_v1': '{bad'});
  @override
  Future<bool> remove(String key) async => throw StateError('fixture removal');
  @override
  Future<bool> setValue(String type, String key, Object value) async =>
      throw StateError('fixture write');
}

void _seedCache({Duration age = Duration.zero}) {
  appLanguageNotifier.value = 'ru';
  SharedPreferences.setMockInitialValues({
    'directory_city': 'Актау',
    'fulfillment_locations_cache_v1': jsonEncode({
      'cachedAt': DateTime.now().subtract(age).toUtc().toIso8601String(),
      'locations': [_cachedBranch.toJson()],
    }),
  });
}

Future<void> _frames(WidgetTester tester) async {
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 20));
  }
}

void main() {
  test(
    'optional preview exception cannot prevent fresh revalidation',
    () async {
      _seedCache();
      final api = _PendingLocationsApi();
      addTearDown(api.dispose);
      final pending = LocationCacheRepository(
        api: api,
      ).load(onCached: (_) => throw StateError('fixture preview'));
      await Future<void>.delayed(Duration.zero);
      expect(api.reads, 1);
      api.pending.complete(const [_freshBranch]);
      expect((await pending).locations.single.id, 'fresh');
    },
  );

  testWidgets('mistyped saved city does not block cached or fresh directory', (
    tester,
  ) async {
    _seedCache();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt('directory_city', 1);
    final api = _PendingLocationsApi();
    addTearDown(api.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: LocationDirectoryScreen(api: api)),
      ),
    );
    await _frames(tester);
    expect(find.text('Сохранённая пекарня'), findsOneWidget);
    expect(api.reads, 1);
    api.pending.complete(const [_freshBranch]);
    await _frames(tester);
    expect(find.text('Новая пекарня'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  test(
    'damaged cache cleanup and storage write failures cannot hide fresh data',
    () async {
      SharedPreferences.setMockInitialValues({});
      final original = SharedPreferencesStorePlatform.instance;
      SharedPreferencesStorePlatform.instance = _BrokenCachePreferences();
      addTearDown(() => SharedPreferencesStorePlatform.instance = original);
      final api = _PendingLocationsApi();
      addTearDown(api.dispose);
      final pending = LocationCacheRepository(
        api: api,
      ).load(onCached: (_) => fail('Damaged cache was shown'));
      await Future<void>.delayed(Duration.zero);
      expect(api.reads, 1);
      api.pending.complete(const [_freshBranch]);
      final result = await pending;
      expect(result.fromCache, isFalse);
      expect(result.locations.single.id, 'fresh');
    },
  );
  testWidgets(
    'unavailable local preferences do not prevent a fresh directory',
    (tester) async {
      _seedCache();
      final original = SharedPreferencesStorePlatform.instance;
      SharedPreferencesStorePlatform.instance = _UnavailablePreferences();
      addTearDown(() => SharedPreferencesStorePlatform.instance = original);
      final api = _PendingLocationsApi();
      addTearDown(api.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: LocationDirectoryScreen(api: api)),
        ),
      );
      await _frames(tester);
      expect(api.reads, 1);
      api.pending.complete(const [_freshBranch]);
      await _frames(tester);
      expect(find.text('Новая пекарня'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  test(
    'malformed cache cannot prevent a fresh request or successful result',
    () async {
      SharedPreferences.setMockInitialValues({
        'fulfillment_locations_cache_v1': '{bad',
      });
      final api = _PendingLocationsApi();
      addTearDown(api.dispose);
      var previews = 0;
      final pending = LocationCacheRepository(
        api: api,
      ).load(onCached: (_) => previews++);
      await Future<void>.delayed(Duration.zero);
      expect(api.reads, 1);
      api.pending.complete(const [_freshBranch]);
      final result = await pending;
      expect(previews, 0);
      expect(result.fromCache, isFalse);
      expect(result.locations.single.id, 'fresh');
    },
  );
  testWidgets(
    'directory shows valid cache while its fresh request is pending',
    (tester) async {
      _seedCache();
      final api = _PendingLocationsApi();
      addTearDown(api.dispose);
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: Scaffold(body: LocationDirectoryScreen(api: api)),
        ),
      );
      await _frames(tester);
      expect(find.text('Сохранённая пекарня'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
      expect(find.byType(LocationCacheNotice), findsNothing);
      final searchY = tester.getTopLeft(find.byType(TextField)).dy;
      final mapRect = tester.getRect(
        find.byKey(const ValueKey('directory-map-ru')),
      );
      expect(api.reads, 1);
      await tester.enterText(find.byType(TextField), 'пекарня');
      api.pending.complete(const [_freshBranch]);
      await _frames(tester);
      expect(find.text('Сохранённая пекарня'), findsNothing);
      expect(find.text('Новая пекарня'), findsOneWidget);
      expect(tester.getTopLeft(find.byType(TextField)).dy, searchY);
      expect(
        tester.getRect(find.byKey(const ValueKey('directory-map-ru'))),
        mapRect,
      );
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'пекарня',
      );
      expect(api.reads, 1);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('expired directory cache is not presented as current content', (
    tester,
  ) async {
    _seedCache(age: const Duration(days: 8));
    final api = _PendingLocationsApi();
    addTearDown(api.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: LocationDirectoryScreen(api: api)),
      ),
    );
    await _frames(tester);
    expect(find.text('Сохранённая пекарня'), findsNothing);
    expect(api.reads, 1);
    api.pending.complete(const [_freshBranch]);
    await _frames(tester);
    expect(find.text('Новая пекарня'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
    'failed revalidation retains cached directory and permits search',
    (tester) async {
      _seedCache();
      final api = _PendingLocationsApi();
      addTearDown(api.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: LocationDirectoryScreen(api: api)),
        ),
      );
      await _frames(tester);
      api.pending.completeError(ApiException('fixture offline'));
      await _frames(tester);
      expect(find.text('Сохранённая пекарня'), findsOneWidget);
      expect(find.byType(LocationCacheNotice), findsOneWidget);
      await tester.enterText(find.byType(TextField), 'несуществующее');
      await _frames(tester);
      expect(find.text('Сохранённая пекарня'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
