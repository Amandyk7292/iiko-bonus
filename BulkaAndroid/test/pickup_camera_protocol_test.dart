import 'dart:convert';
import 'dart:typed_data';

import 'package:bulka_bonus/core/pickup_camera_protocol.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;

const _nonce = '0123456789abcdef0123456789abcdef';
const _otherNonce = 'fedcba9876543210fedcba9876543210';
final _jpeg = Uint8List.fromList(img.encodeJpg(img.Image(width: 2, height: 3)));

String _message(String type, [Map<String, Object?> fields = const {}]) =>
    jsonEncode(<String, Object?>{
      'v': 1,
      'nonce': _nonce,
      'type': type,
      ...fields,
    });

String _ready([String facingMode = 'user']) =>
    _message('ready', {'facingMode': facingMode, 'width': 2, 'height': 3});

String _photo({
  String facingMode = 'user',
  Map<String, Object?> fields = const {},
}) => _message('photo', {
  'facingMode': facingMode,
  'width': 2,
  'height': 3,
  'mimeType': 'image/jpeg',
  'base64': base64Encode(_jpeg),
  ...fields,
});

PickupCameraProtocol _capturing([String facingMode = 'user']) {
  final protocol = PickupCameraProtocol(_nonce);
  if (facingMode == 'environment') {
    protocol.receive(_ready());
    expect(protocol.beginSwitch(), isTrue);
  }
  protocol.receive(_ready(facingMode));
  expect(protocol.beginCapture(), isTrue);
  return protocol;
}

void main() {
  group('pickup camera trusted page', () {
    test('page URI binds the lower-case hexadecimal nonce in its fragment', () {
      final protocol = PickupCameraProtocol(_nonce);
      expect(pickupCameraPageUrl, 'https://bulka.com.kz/pickup/camera-v1');
      expect(protocol.uri.toString(), '$pickupCameraPageUrl#nonce=$_nonce');
      expect(protocol.trustsUrl(protocol.uri.toString()), isTrue);
      expect(
        protocol.trustsUrl(
          'https://bulka.com.kz:443/pickup/camera-v1#nonce=$_nonce',
        ),
        isTrue,
      );
    });

    test('rejects nonce values that cannot bind one protocol instance', () {
      for (final nonce in <String>[
        '',
        _nonce.substring(1),
        '${_nonce}0',
        _nonce.toUpperCase(),
        '${_nonce.substring(0, 31)}g',
        '${_nonce.substring(0, 31)}-',
      ]) {
        expect(() => PickupCameraProtocol(nonce), throwsArgumentError);
      }
    });

    test('rejects pages outside the exact origin, path, and nonce', () {
      final protocol = PickupCameraProtocol(_nonce);
      for (final url in <String?>[
        null,
        '',
        '/pickup/camera-v1#nonce=$_nonce',
        'http://bulka.com.kz/pickup/camera-v1#nonce=$_nonce',
        'https://bulka.com.kz.evil.example/pickup/camera-v1#nonce=$_nonce',
        'https://camera.bulka.com.kz/pickup/camera-v1#nonce=$_nonce',
        'https://evil.example/pickup/camera-v1#nonce=$_nonce',
        'https://bulka.com.kz:8443/pickup/camera-v1#nonce=$_nonce',
        'https://user@bulka.com.kz/pickup/camera-v1#nonce=$_nonce',
        'https://user:password@bulka.com.kz/pickup/camera-v1#nonce=$_nonce',
        '$pickupCameraPageUrl/extra#nonce=$_nonce',
        '$pickupCameraPageUrl/#nonce=$_nonce',
        '$pickupCameraPageUrl?mode=camera#nonce=$_nonce',
        '$pickupCameraPageUrl?#nonce=$_nonce',
        pickupCameraPageUrl,
        '$pickupCameraPageUrl#nonce=$_otherNonce',
        '$pickupCameraPageUrl#nonce=$_nonce&mode=camera',
        '$pickupCameraPageUrl#$_nonce',
      ]) {
        expect(protocol.trustsUrl(url), isFalse, reason: '$url');
      }
    });
  });

  group('pickup camera capture sequence', () {
    test('capture waits for readiness and retains its final front lens', () {
      final protocol = PickupCameraProtocol(_nonce);
      expect(protocol.ready, isNull);
      expect(protocol.capturing, isFalse);
      expect(protocol.completed, isFalse);
      expect(protocol.beginCapture(), isFalse);

      final ready = protocol.receive(_ready())!;
      expect(ready.type, PickupCameraEventType.ready);
      expect(ready.facingMode, 'user');
      expect(ready.width, 2);
      expect(ready.height, 3);
      expect(protocol.ready, same(ready));
      expect(protocol.beginCapture(), isTrue);
      expect(protocol.capturing, isTrue);
      expect(protocol.beginCapture(), isFalse);
      expect(protocol.beginSwitch(), isFalse);

      final busy = protocol.receive(_message('busy', {'reason': 'capture'}))!;
      expect(busy.type, PickupCameraEventType.busy);
      expect(busy.reason, 'capture');
      expect(protocol.ready, isNull);
      expect(protocol.capturing, isTrue);

      final photo = protocol.receive(_photo())!;
      expect(photo.type, PickupCameraEventType.photo);
      expect(photo.facingMode, 'user');
      expect(photo.width, 2);
      expect(photo.height, 3);
      expect(photo.bytes, orderedEquals(_jpeg));
      expect(protocol.ready, isNull);
      expect(protocol.capturing, isFalse);
      expect(protocol.completed, isTrue);
      expect(protocol.beginCapture(), isFalse);
      expect(protocol.beginSwitch(), isFalse);
    });

    test('switching requires new rear readiness before a rear capture', () {
      final protocol = PickupCameraProtocol(_nonce);
      protocol.receive(_ready());
      expect(protocol.beginSwitch(), isTrue);
      expect(protocol.ready, isNull);
      expect(protocol.beginCapture(), isFalse);
      final busy = protocol.receive(_message('busy', {'reason': 'switch'}))!;
      expect(busy.reason, 'switch');

      final ready = protocol.receive(_ready('environment'))!;
      expect(ready.facingMode, 'environment');
      expect(protocol.beginCapture(), isTrue);
      final photo = protocol.receive(_photo(facingMode: 'environment'))!;
      expect(photo.facingMode, 'environment');
      expect(photo.bytes, orderedEquals(_jpeg));
      expect(protocol.completed, isTrue);
    });

    test('switching back requires a confirmed front lens', () {
      final protocol = PickupCameraProtocol(_nonce);
      protocol.receive(_ready());
      expect(protocol.beginSwitch(), isTrue);
      protocol.receive(_ready('environment'));
      expect(protocol.beginSwitch(), isTrue);
      expect(protocol.ready, isNull);
      expect(protocol.beginCapture(), isFalse);
      protocol.receive(_ready());
      expect(protocol.beginCapture(), isTrue);
      expect(protocol.receive(_photo())!.facingMode, 'user');
    });

    test('readiness must confirm the expected lens before capture', () {
      final protocol = PickupCameraProtocol(_nonce);
      expect(
        () => protocol.receive(_ready('environment')),
        throwsFormatException,
      );
      expect(protocol.beginCapture(), isFalse);
      protocol.receive(_ready());
      expect(protocol.beginSwitch(), isTrue);
      expect(() => protocol.receive(_ready()), throwsFormatException);
      expect(protocol.beginCapture(), isFalse);
      protocol.receive(_ready('environment'));
      expect(protocol.beginCapture(), isTrue);
    });

    test('starting again resets the expected lens to front', () {
      final protocol = PickupCameraProtocol(_nonce);
      protocol.receive(_ready());
      expect(protocol.beginSwitch(), isTrue);
      protocol.receive(_ready('environment'));
      protocol.beginStart();
      expect(protocol.ready, isNull);
      expect(protocol.capturing, isFalse);
      expect(protocol.beginCapture(), isFalse);
      protocol.receive(_ready());
      expect(protocol.beginCapture(), isTrue);
      expect(protocol.receive(_photo())!.facingMode, 'user');
    });

    test('ignores delayed readiness during an in-flight capture', () {
      final protocol = _capturing();
      expect(protocol.receive(_ready('environment')), isNull);
      expect(protocol.receive(_message('busy', {'reason': 'start'})), isNull);
      expect(protocol.receive(_message('busy', {'reason': 'switch'})), isNull);
      expect(protocol.capturing, isTrue);
      expect(protocol.receive(_photo())!.facingMode, 'user');
    });

    test('ignores unsolicited photos without consuming the session', () {
      final protocol = PickupCameraProtocol(_nonce);
      expect(protocol.receive(_photo()), isNull);
      protocol.receive(_ready());
      expect(protocol.receive(_photo()), isNull);
      expect(protocol.ready, isNotNull);
      expect(protocol.completed, isFalse);
      expect(protocol.beginCapture(), isTrue);
      expect(protocol.receive(_photo())!.type, PickupCameraEventType.photo);
    });

    test('rejects a photo whose lens differs from the accepted capture', () {
      for (final lens in ['user', 'environment']) {
        final protocol = _capturing(lens);
        final otherLens = lens == 'user' ? 'environment' : 'user';
        expect(
          () => protocol.receive(_photo(facingMode: otherLens)),
          throwsFormatException,
        );
        expect(protocol.completed, isFalse);
      }
    });

    test('completion and close ignore every subsequent camera message', () {
      for (final finishWithPhoto in [false, true]) {
        final protocol = _capturing();
        if (finishWithPhoto) {
          protocol.receive(_photo());
        } else {
          protocol.close();
        }
        expect(protocol.completed, isTrue);
        expect(protocol.capturing, isFalse);
        expect(protocol.ready, isNull);
        for (final message in [
          _ready(),
          _message('busy', {'reason': 'start'}),
          _photo(),
          _message('error', {'code': 'capture'}),
          _message('cancel'),
        ]) {
          expect(protocol.receive(message), isNull);
        }
        expect(protocol.beginCapture(), isFalse);
        expect(protocol.beginSwitch(), isFalse);
        protocol.beginStart();
        expect(protocol.completed, isTrue);
        expect(protocol.receive(_ready()), isNull);
      }
    });

    test('photo bytes cannot be changed by their consumer', () {
      final protocol = _capturing();
      final photo = protocol.receive(_photo())!;
      final bytes = photo.bytes!;
      expect(() => bytes[0] = 0, throwsUnsupportedError);
      expect(bytes, orderedEquals(_jpeg));
    });
  });

  group('pickup camera message validation', () {
    test('ignores unrelated nonce, version, and message types', () {
      final protocol = PickupCameraProtocol(_nonce);
      for (final fields in <Map<String, Object?>>[
        {'nonce': _otherNonce},
        {'nonce': null},
        {'v': 0},
        {'v': 2},
        {'v': '1'},
        {'v': 1.0},
        {'v': null},
        {'type': 'not-a-camera-event'},
        {'type': null},
      ]) {
        expect(
          protocol.receive(
            _message('ready', {
              'facingMode': 'user',
              'width': 2,
              'height': 3,
              ...fields,
            }),
          ),
          isNull,
        );
        expect(protocol.ready, isNull);
        expect(protocol.completed, isFalse);
      }
      expect(protocol.receive(_ready())!.type, PickupCameraEventType.ready);
    });

    test('ignores malformed or unrelated JSON without changing state', () {
      final protocol = _capturing();
      for (final raw in ['{not-json', 'null', '[]', '42', '{}']) {
        expect(protocol.receive(raw), isNull);
        expect(protocol.capturing, isTrue);
        expect(protocol.completed, isFalse);
      }
      expect(protocol.receive(_photo())!.type, PickupCameraEventType.photo);
    });

    test(
      'ignores messages above the transport cap without consuming capture',
      () {
        final protocol = _capturing();
        final raw = _photo(
          fields: {'base64': 'A' * (((5 * 1024 * 1024 + 2) ~/ 3) * 4 + 1025)},
        );
        expect(protocol.receive(raw), isNull);
        expect(protocol.capturing, isTrue);
        expect(protocol.completed, isFalse);
        expect(protocol.receive(_photo())!.type, PickupCameraEventType.photo);
      },
    );

    test('rejects malformed readiness from the trusted protocol envelope', () {
      for (final fields in <Map<String, Object?>>[
        {'facingMode': 'unknown'},
        {'facingMode': null},
        {'width': 0},
        {'height': -1},
        {'width': '2'},
        {'height': 3.5},
        {'width': 4001, 'height': 4000},
      ]) {
        final protocol = PickupCameraProtocol(_nonce);
        expect(
          () => protocol.receive(
            _message('ready', {
              'facingMode': 'user',
              'width': 2,
              'height': 3,
              ...fields,
            }),
          ),
          throwsFormatException,
        );
        expect(protocol.ready, isNull);
        expect(protocol.completed, isFalse);
      }
    });

    test('rejects malformed, oversized, or non-JPEG photo payloads', () {
      final tooLarge = Uint8List(5 * 1024 * 1024 + 1)
        ..[0] = 0xff
        ..[1] = 0xd8
        ..[2] = 0xff;
      tooLarge[tooLarge.length - 2] = 0xff;
      tooLarge[tooLarge.length - 1] = 0xd9;
      for (final fields in <Map<String, Object?>>[
        {'width': 0},
        {'height': -1},
        {'width': '2'},
        {'height': 3.5},
        {'width': 4001, 'height': 4000},
        {'facingMode': 'unknown'},
        {'mimeType': null},
        {'mimeType': 'image/png'},
        {'mimeType': 'IMAGE/JPEG'},
        {'base64': null},
        {'base64': 42},
        {'base64': ''},
        {'base64': '%%%not-base64%%%'},
        {
          'base64': base64Encode([1, 2, 3, 4]),
        },
        {'base64': base64Encode(img.encodePng(img.Image(width: 2, height: 3)))},
        {'base64': base64Encode(_jpeg.sublist(0, _jpeg.length - 2))},
        {'base64': base64Encode(tooLarge)},
      ]) {
        final protocol = _capturing();
        expect(
          () => protocol.receive(_photo(fields: fields)),
          throwsFormatException,
        );
        expect(protocol.completed, isFalse);
      }
    });

    test('accepts the inclusive byte and reported-pixel limits', () {
      // The protocol checks the JPEG envelope; full decoding belongs to photo
      // preparation. This fixture makes no claim about a physical camera.
      final bytes = Uint8List(5 * 1024 * 1024)
        ..[0] = 0xff
        ..[1] = 0xd8
        ..[2] = 0xff;
      bytes[bytes.length - 2] = 0xff;
      bytes[bytes.length - 1] = 0xd9;
      final protocol = _capturing();
      final photo = protocol.receive(
        _photo(
          fields: {
            'width': 4000,
            'height': 4000,
            'base64': base64Encode(bytes),
          },
        ),
      )!;
      expect(photo.bytes, hasLength(5 * 1024 * 1024));
      expect(photo.width! * photo.height!, 16000000);
      expect(protocol.completed, isTrue);
    });

    test('only documented busy reasons are accepted', () {
      for (final reason in ['start', 'switch', 'capture']) {
        final protocol = reason == 'capture'
            ? _capturing()
            : PickupCameraProtocol(_nonce);
        final event = protocol.receive(_message('busy', {'reason': reason}))!;
        expect(event.type, PickupCameraEventType.busy);
        expect(event.reason, reason);
        expect(protocol.completed, isFalse);
      }
      final protocol = _capturing();
      for (final reason in <Object?>['unknown', '', null, 42]) {
        expect(protocol.receive(_message('busy', {'reason': reason})), isNull);
        expect(protocol.capturing, isTrue);
        expect(protocol.completed, isFalse);
      }
      expect(protocol.receive(_photo())!.type, PickupCameraEventType.photo);
    });

    test('documented errors clear capture and permit a fresh retry', () {
      for (final code in [
        'permission',
        'unsupported',
        'unavailable',
        'lens',
        'capture',
      ]) {
        final protocol = _capturing();
        final event = protocol.receive(_message('error', {'code': code}))!;
        expect(event.type, PickupCameraEventType.error);
        expect(event.code, code);
        expect(protocol.ready, isNull);
        expect(protocol.capturing, isFalse);
        expect(protocol.completed, isFalse);
        expect(protocol.beginCapture(), isFalse);
        protocol.receive(_ready());
        expect(protocol.beginCapture(), isTrue);
        expect(protocol.receive(_photo())!.type, PickupCameraEventType.photo);
      }
    });

    test('ignores unknown error codes without clearing an active capture', () {
      final protocol = _capturing();
      for (final code in <Object?>['unknown', '', null, 42]) {
        expect(protocol.receive(_message('error', {'code': code})), isNull);
        expect(protocol.capturing, isTrue);
        expect(protocol.completed, isFalse);
      }
      expect(protocol.receive(_photo())!.type, PickupCameraEventType.photo);
    });

    test('cancel is terminal even while capture is in flight', () {
      final protocol = _capturing();
      final event = protocol.receive(_message('cancel'))!;
      expect(event.type, PickupCameraEventType.cancel);
      expect(protocol.completed, isTrue);
      expect(protocol.capturing, isFalse);
      expect(protocol.ready, isNull);
      expect(protocol.receive(_photo()), isNull);
      expect(protocol.receive(_ready()), isNull);
      expect(protocol.beginCapture(), isFalse);
    });
  });
}
