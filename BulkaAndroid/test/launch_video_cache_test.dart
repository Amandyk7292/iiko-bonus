import 'dart:io';
import 'dart:typed_data';
import 'package:bulka_bonus/core/launch_video_cache.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('downloads once and reuses the video offline', () async {
    final directory = await Directory.systemTemp.createTemp(
      'bulka-launch-test',
    );
    addTearDown(() => directory.delete(recursive: true));
    var requests = 0;
    final bytes = Uint8List(LaunchVideoCache.byteLength);
    bytes.setRange(4, 8, 'ftyp'.codeUnits);
    final cache = LaunchVideoCache(
      directory: () async => directory,
      client: () => MockClient((request) async {
        requests++;
        expect(request.url.toString(), LaunchVideoCache.url);
        return http.Response.bytes(bytes, 200);
      }),
    );
    final downloaded = await cache.load();
    expect(await downloaded.length(), LaunchVideoCache.byteLength);
    expect((await cache.load()).path, downloaded.path);
    expect(requests, 1);
  });

  test('does not cache an error page as video', () async {
    final directory = await Directory.systemTemp.createTemp(
      'bulka-launch-test',
    );
    addTearDown(() => directory.delete(recursive: true));
    final cache = LaunchVideoCache(
      directory: () async => directory,
      client: () => MockClient((_) async => http.Response('unavailable', 503)),
    );
    await expectLater(cache.load(), throwsFormatException);
    expect(await directory.list().toList(), isEmpty);
  });
}
