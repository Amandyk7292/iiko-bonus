import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:bulka_bonus/core/admin_file_share_bridge.dart';

void main() {
  String request({
    String nonce = 'trusted',
    String name = 'report.xlsx',
    String? content,
  }) => jsonEncode({
    'version': 1,
    'nonce': nonce,
    'requestId': 'request_1234',
    'name': name,
    'base64': content ?? base64Encode([80, 75, 3, 4]),
  });
  test('preserves report bytes and chooses the spreadsheet MIME type', () {
    final file = AdminSharedFile.parse(request(), 'trusted')!;
    expect(file.name, 'report.xlsx');
    expect(file.bytes, [80, 75, 3, 4]);
    expect(file.mimeType, contains('spreadsheetml'));
  });
  test(
    'rejects foreign pages, paths, invalid data and executable filenames',
    () {
      for (final raw in [
        request(nonce: 'wrong'),
        request(name: '../report.xlsx'),
        request(name: r'C:\report.xlsx'),
        request(name: 'app.exe'),
        request(content: 'broken!'),
        request(content: ''),
      ]) {
        expect(AdminSharedFile.parse(raw, 'trusted'), isNull);
      }
    },
  );
  test('rejects messages above the transfer limit before decoding', () {
    expect(
      AdminSharedFile.parse(
        'x' * (adminFileShareMaxBytes * 4 ~/ 3 + 4097),
        'trusted',
      ),
      isNull,
    );
  });
}
