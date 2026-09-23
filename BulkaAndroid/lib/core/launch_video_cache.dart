import 'dart:async';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

/// Downloaded media stays outside the bundled assets so existing iOS releases
/// can switch launch videos through a Dart-only OTA patch.
class LaunchVideoCache {
  LaunchVideoCache({
    Future<Directory> Function()? directory,
    http.Client Function()? client,
  }) : _directory = directory ?? getApplicationSupportDirectory,
       _client = client ?? http.Client.new;

  static const url = 'https://bulka.com.kz/assets/launch/launch-20260923.mp4';
  static const byteLength = 2030140;
  final Future<Directory> Function() _directory;
  final http.Client Function() _client;
  Future<File>? _pending;

  Future<File> load() =>
      _pending ??= _load().whenComplete(() => _pending = null);

  Future<File> _load() async {
    final directory = await _directory();
    final file = File('${directory.path}/bulka-launch-20260923.mp4');
    if (await file.exists() && await file.length() == byteLength) return file;
    final client = _client();
    try {
      final response = await client
          .get(Uri.parse(url))
          .timeout(const Duration(seconds: 20));
      final bytes = response.bodyBytes;
      if (response.statusCode != 200 ||
          bytes.length != byteLength ||
          String.fromCharCodes(bytes.sublist(4, 8)) != 'ftyp') {
        throw const FormatException('Invalid launch video');
      }
      await directory.create(recursive: true);
      final temporary = File('${file.path}.download');
      await temporary.writeAsBytes(bytes, flush: true);
      if (await file.exists()) await file.delete();
      return temporary.rename(file.path);
    } finally {
      client.close();
    }
  }
}

final launchVideoCache = LaunchVideoCache();
