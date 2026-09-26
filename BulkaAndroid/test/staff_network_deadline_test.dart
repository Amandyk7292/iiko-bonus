import 'dart:async';
import 'dart:typed_data';
import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

class _StalledClient extends http.BaseClient {
  final headers = Completer<http.StreamedResponse>();
  final body = StreamController<List<int>>();
  int calls = 0;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    calls++;
    return headers.future;
  }

  void receiveHeaders() =>
      headers.complete(http.StreamedResponse(body.stream, 200));
}

void main() {
  for (final operation in ['request', 'uploadImage', 'sendVoice']) {
    for (final phase in ['headers', 'body']) {
      testWidgets('$operation bounds the whole exchange when $phase stall', (
        tester,
      ) async {
        final client = _StalledClient();
        final api = StaffApiClient(client: client);
        final errors = <Object>[];
        final pending = switch (operation) {
          'uploadImage' => api.uploadImage(
            '/menu/upload-image',
            Uint8List.fromList([1]),
            'fixture.png',
          ),
          'sendVoice' => api.sendVoice(
            '11111111-1111-4111-8111-111111111111',
            Uint8List.fromList([1]),
            1,
            'fixture',
          ),
          _ => api.request(
            '/customers/bonus',
            method: 'POST',
            body: {'operationId': 'fixture'},
          ),
        };
        unawaited(
          pending.then<void>(
            (_) => fail('The stalled exchange succeeded'),
            onError: (Object error) => errors.add(error),
          ),
        );
        await tester.pump();
        await tester.pump(const Duration(seconds: 110));
        if (phase == 'body') {
          client.receiveHeaders();
          await tester.pump();
        }
        await tester.pump(const Duration(seconds: 9));
        expect(errors, isEmpty);
        await tester.pump(const Duration(seconds: 2));
        expect(errors, hasLength(1));
        expect(
          errors.single,
          operation == 'request'
              ? isA<StaffApiException>().having(
                  (e) => e.code,
                  'code',
                  'TIMEOUT',
                )
              : isA<TimeoutException>(),
        );
        expect(
          client.calls,
          1,
          reason: 'A timeout must not automatically resend a mutation',
        );
        if (!client.headers.isCompleted) client.receiveHeaders();
        client.body.add([123, 125]);
        unawaited(client.body.close());
        await tester.pump();
        api.close();
      });
    }
  }
}
