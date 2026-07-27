import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _EventStreamClient extends http.BaseClient {
  final List<StreamController<List<int>>> eventStreams = [];
  final List<String?> authorizationHeaders = [];

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request.url.path != '/api/customer/events') {
      return http.StreamedResponse(
        Stream.value(utf8.encode('{"success":true}')),
        200,
      );
    }
    authorizationHeaders.add(request.headers['Authorization']);
    final controller = StreamController<List<int>>();
    eventStreams.add(controller);
    return http.StreamedResponse(controller.stream, 200);
  }

  void sendEvent(int index, Map<String, dynamic> event) {
    eventStreams[index].add(utf8.encode('data: ${jsonEncode(event)}\n\n'));
  }

  @override
  void close() {
    for (final stream in eventStreams) {
      if (!stream.isClosed) unawaited(stream.close());
    }
  }
}

Future<void> _waitFor(bool Function() predicate) async {
  final deadline = DateTime.now().add(const Duration(seconds: 2));
  while (!predicate() && DateTime.now().isBefore(deadline)) {
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
  expect(predicate(), isTrue);
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    appLanguageNotifier.value = 'ru';
  });

  test(
    'SSE drops the previous account stream when the session changes',
    () async {
      final client = _EventStreamClient();
      final api = BulkaApiClient(client: client)
        ..setSession(
          accessToken: 'account-a-token',
          refreshToken: 'account-a-refresh',
          cacheScope: 'account-a',
        );
      final received = <Map<String, dynamic>>[];
      final subscription = api.customerEvents.listen(received.add);
      await _waitFor(() => client.eventStreams.length == 1);

      client.sendEvent(0, {'type': 'loyalty.balance.updated', 'account': 'a'});
      await _waitFor(() => received.length == 1);

      api.setSession();
      await _waitFor(() => !client.eventStreams[0].hasListener);
      api.setSession(
        accessToken: 'account-b-token',
        refreshToken: 'account-b-refresh',
        cacheScope: 'account-b',
      );
      await _waitFor(() => client.eventStreams.length == 2);

      client.sendEvent(0, {'type': 'loyalty.balance.updated', 'account': 'a'});
      client.sendEvent(1, {'type': 'loyalty.balance.updated', 'account': 'b'});
      await _waitFor(() => received.length == 2);

      expect(received.map((event) => event['account']), ['a', 'b']);
      expect(client.authorizationHeaders, [
        'Bearer account-a-token',
        'Bearer account-b-token',
      ]);
      await subscription.cancel();
      api.dispose();
    },
  );

  test('transient refresh failure keeps the authenticated session', () async {
    var calls = 0;
    final changes = <List<String?>>[];
    final api = BulkaApiClient(
      client: MockClient((request) async {
        calls++;
        if (request.url.path == '/api/auth/refresh') {
          throw http.ClientException('temporary network failure');
        }
        return http.Response('{"error":"expired"}', 401);
      }),
      onSessionChanged: (access, refresh) async {
        changes.add([access, refresh]);
      },
    )..setSession(accessToken: 'access-token', refreshToken: 'refresh-token');

    await expectLater(
      api.getCustomerLoyalty(),
      throwsA(
        isA<ApiException>().having(
          (error) => error.code,
          'code',
          'SESSION_REFRESH_UNAVAILABLE',
        ),
      ),
    );

    expect(calls, 2);
    expect(api.isAuthenticated, isTrue);
    expect(changes, isEmpty);
    api.dispose();
  });

  test('rejected refresh clears the invalid session', () async {
    final changes = <List<String?>>[];
    final api = BulkaApiClient(
      client: MockClient((request) async {
        if (request.url.path == '/api/auth/refresh') {
          return http.Response('{"error":"invalid refresh"}', 401);
        }
        return http.Response('{"error":"expired"}', 401);
      }),
      onSessionChanged: (access, refresh) async {
        changes.add([access, refresh]);
      },
    )..setSession(accessToken: 'access-token', refreshToken: 'refresh-token');

    await expectLater(api.getCustomerLoyalty(), throwsA(isA<ApiException>()));

    expect(api.isAuthenticated, isFalse);
    expect(changes, [
      [null, null],
    ]);
    api.dispose();
  });

  test('address cache is isolated by account scope', () async {
    const address = DeliveryAddress(
      id: 'address-a',
      title: 'Home',
      location: DeliveryLocation(
        city: 'Astana',
        address: 'Qabanbay Batyr Avenue',
        latitude: 51.128,
        longitude: 71.43,
      ),
      house: '46',
      courierComment: 'Call on arrival',
    );

    await const AddressRepository(cacheScope: 'account-a').saveAddress(address);

    expect(
      await const AddressRepository(cacheScope: 'account-a').loadAddresses(),
      hasLength(1),
    );
    expect(
      await const AddressRepository(cacheScope: 'account-b').loadAddresses(),
      isEmpty,
    );
  });

  test('logout cleanup removes scoped customer data only', () async {
    SharedPreferences.setMockInitialValues({
      'phone': '+77001234567',
      'customer': '{"id":"customer-a"}',
      'delivery_addresses_account-a': ['{"id":"address-a"}'],
      'checkout_phone_account-a': '+77001234567',
      'checkout_comment_account-a': 'Call on arrival',
      'selected_bakery_location': 'Bulka',
    });
    final prefs = await SharedPreferences.getInstance();

    await SessionStore.clearCustomerData(prefs);

    expect(prefs.getString('phone'), isNull);
    expect(prefs.getStringList('delivery_addresses_account-a'), isNull);
    expect(prefs.getString('checkout_phone_account-a'), isNull);
    expect(prefs.getString('checkout_comment_account-a'), isNull);
    expect(prefs.getString('selected_bakery_location'), 'Bulka');
  });

  test('Stories and News map backend kz content to app kk', () {
    final story = PromoStory.fromJson({
      'id': 1,
      'title': 'Русский заголовок',
      'coverUrl': 'ru-cover.webp',
      'contentUrl': 'ru-content.webp',
      'i18n': {
        'kz': {
          'title': 'Қазақша тақырып',
          'description': 'Қазақша сипаттама',
          'coverUrl': 'kk-cover.webp',
          'contentUrl': 'kk-content.webp',
        },
      },
    });
    final news = NewsItem.fromJson({
      'id': 2,
      'title': 'Русская новость',
      'imageUrl': 'ru-news.webp',
      'description': 'Русское описание',
      'i18n': {
        'kz': {
          'title': 'Қазақша жаңалық',
          'description': 'Қазақша мәтін',
          'imageUrl': 'kk-news.webp',
        },
      },
    });

    appLanguageNotifier.value = 'kk';
    expect(story.localizedTitle, 'Қазақша тақырып');
    expect(story.localizedDescription, 'Қазақша сипаттама');
    expect(story.localizedImageUrl, 'kk-cover.webp');
    expect(story.localizedContentUrl, 'kk-content.webp');
    expect(news.localizedTitle, 'Қазақша жаңалық');
    expect(news.localizedDescription, 'Қазақша мәтін');
    expect(news.localizedImageUrl, 'kk-news.webp');
  });

  test('iOS privacy manifest declares linked customer data', () {
    final manifest = File(
      'ios/Runner/PrivacyInfo.xcprivacy',
    ).readAsStringSync();
    for (final type in [
      'NSPrivacyCollectedDataTypeName',
      'NSPrivacyCollectedDataTypeEmailAddress',
      'NSPrivacyCollectedDataTypePhoneNumber',
      'NSPrivacyCollectedDataTypePhysicalAddress',
      'NSPrivacyCollectedDataTypePreciseLocation',
      'NSPrivacyCollectedDataTypePhotosorVideos',
      'NSPrivacyCollectedDataTypeCustomerSupport',
      'NSPrivacyCollectedDataTypeUserID',
      'NSPrivacyCollectedDataTypeDeviceID',
      'NSPrivacyCollectedDataTypePurchaseHistory',
      'NSPrivacyCollectedDataTypeProductInteraction',
    ]) {
      expect(manifest, contains('<string>$type</string>'));
    }
    expect(manifest, contains('<key>NSPrivacyTracking</key>\n\t<false/>'));
    expect(
      manifest,
      isNot(contains('NSPrivacyCollectedDataTypePurposeDeveloperAdvertising')),
    );
  });

  test('startup order art uses compact WebP assets', () {
    final source = File('lib/screens/home_screen.dart').readAsStringSync();
    for (final name in ['pickup', 'preorder', 'delivery']) {
      final asset = File('assets/order/$name.webp');
      expect(asset.existsSync(), isTrue);
      expect(asset.lengthSync(), lessThan(100 * 1024));
      expect(source, contains('assets/order/$name.webp'));
      expect(File('assets/order/$name.png').existsSync(), isFalse);
    }
  });
}
