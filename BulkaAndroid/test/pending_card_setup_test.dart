import 'dart:convert';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _SetupApi extends BulkaApiClient {
  int starts = 0;
  int resumes = 0;
  String status = 'pending';
  bool offline = false;
  @override
  Future<Map<String, dynamic>> createForteCardSetup() async {
    starts++;
    return {'operationId': 'setup-one', 'paymentStatus': status};
  }

  @override
  Future<Map<String, dynamic>> resumeForteCardSetup(String id) async {
    resumes++;
    if (offline) throw ApiException('offline');
    return {'operationId': id, 'paymentStatus': status};
  }
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    appLanguageNotifier.value = 'ru';
  });
  test(
    'retry resumes the saved card operation without starting another hold',
    () async {
      final api = _SetupApi();
      await PendingCardSetupStore.createOrResume(api);
      await PendingCardSetupStore.createOrResume(api);
      expect(api.starts, 1);
      expect(api.resumes, 1);
      api.offline = true;
      await expectLater(
        PendingCardSetupStore.createOrResume(api),
        throwsA(isA<ApiException>()),
      );
      expect(await PendingCardSetupStore.load(api), 'setup-one');
      api.offline = false;
      api.status = 'paid';
      await PendingCardSetupStore.createOrResume(api);
      expect(await PendingCardSetupStore.load(api), isNull);
      api.dispose();
    },
  );
  test(
    'HTML gateway failures preserve a typed error and do not prove a missing payment',
    () async {
      final api = BulkaApiClient(
        client: MockClient(
          (_) async => http.Response('<html>Not found</html>', 404),
        ),
      );
      await expectLater(
        api.checkForteCheckoutStatus('test-id'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.code, 'code', 'INVALID_API_RESPONSE')
              .having((e) => e.statusCode, 'status', 404),
        ),
      );
      api.dispose();
    },
  );
  testWidgets(
    'hosted checkout explains payment without forcing an unavailable card setup',
    (tester) async {
      final api = BulkaApiClient(
        client: MockClient(
          (request) async => http.Response(
            jsonEncode(
              request.url.path.endsWith('/availability')
                  ? {
                      'success': true,
                      'available': true,
                      'integration': 'hosted_page',
                      'cardSetup': false,
                    }
                  : {'success': true, 'methods': []},
            ),
            200,
          ),
        ),
      );
      final available = await api.isFortePaymentAvailable();
      expect(available, true);
      expect(api.forteCardSetupAvailable, false);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: buildCheckoutSavedCardsPanelForTest(
              api: api,
              available: available,
              selectedMethodId: null,
              onDefaultResolved: (_) {},
              onSelect: (_) {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('checkout-hosted-payment')),
        findsOneWidget,
      );
      expect(find.text('Добавить карту'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      api.dispose();
    },
  );
}
