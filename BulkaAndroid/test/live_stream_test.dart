import 'dart:async';
import 'dart:convert';
import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

class StreamClient extends http.BaseClient {
  final requests = <http.BaseRequest>[];
  final streams = <StreamController<List<int>>>[];
  final cancelled = <int>[];
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    requests.add(request);
    final index = streams.length;
    final stream = StreamController<List<int>>(onCancel: () => cancelled.add(index));
    streams.add(stream);
    return http.StreamedResponse(stream.stream, 200);
  }
  void event(int index, String type) => streams[index].add(utf8.encode('data: ${jsonEncode({'type': type})}\n\n'));
}

void main() {
  test('guest stream reconnects and switches identity without retaining the previous subscription', () async {
    final transport = StreamClient();
    final api = BulkaApiClient(client: transport);
    final events = <Map<String, dynamic>>[];
    final listener = api.customerEvents.listen(events.add);
    await Future<void>.delayed(const Duration(milliseconds: 10));
    expect(transport.requests.single.url.path, '/api/public/events');
    transport.event(0, 'connected');
    await transport.streams[0].close();
    await Future<void>.delayed(const Duration(milliseconds: 3100));
    expect(transport.requests.length, 2);
    expect(transport.requests.last.url.path, '/api/public/events');
    api.setSession(accessToken: 'test-alice', cacheScope: 'alice');
    await Future<void>.delayed(const Duration(milliseconds: 10));
    expect(transport.requests.last.url.path, '/api/customer/events');
    expect(transport.requests.last.headers['Authorization'], 'Bearer test-alice');
    expect(transport.cancelled, contains(1));
    api.setSession();
    await Future<void>.delayed(const Duration(milliseconds: 10));
    expect(transport.requests.last.url.path, '/api/public/events');
    expect(transport.requests.last.headers['Authorization'], isNull);
    expect(transport.cancelled, contains(2));
    await listener.cancel();
    api.dispose();
    await Future<void>.delayed(const Duration(milliseconds: 10));
    expect(transport.cancelled, contains(3));
    expect(events.single['type'], 'connected');
  });
}
