import 'dart:convert';
import 'dart:typed_data';

const pickupCameraPageUrl = 'https://bulka.com.kz/pickup/camera-v1';

enum PickupCameraEventType { ready, busy, photo, error, cancel }

class PickupCameraEvent {
  const PickupCameraEvent(
    this.type, {
    this.facingMode,
    this.width,
    this.height,
    this.reason,
    this.code,
    this.bytes,
  });

  final PickupCameraEventType type;
  final String? facingMode;
  final int? width;
  final int? height;
  final String? reason;
  final String? code;
  final Uint8List? bytes;
}

/// Accepts one shutter result from this camera session and its verified lens.
/// Pixel mirroring belongs to the page's shared preview/capture transform.
class PickupCameraProtocol {
  PickupCameraProtocol(this.nonce) {
    if (!RegExp(r'^[a-f0-9]{32}$').hasMatch(nonce)) {
      throw ArgumentError.value(nonce, 'nonce', 'Invalid camera session');
    }
  }

  static const maxBytes = 5 * 1024 * 1024;
  static const maxPixels = 16000000;
  static const _maxMessageLength = ((maxBytes + 2) ~/ 3) * 4 + 1024;

  final String nonce;
  PickupCameraEvent? _ready;
  String _expectedFacingMode = 'user';
  String? _captureFacingMode;
  bool _completed = false;

  Uri get uri =>
      Uri.parse(pickupCameraPageUrl).replace(fragment: 'nonce=$nonce');
  PickupCameraEvent? get ready => _ready;
  bool get capturing => _captureFacingMode != null;
  bool get completed => _completed;

  bool trustsUrl(String? raw) {
    final candidate = raw == null ? null : Uri.tryParse(raw);
    return candidate != null &&
        candidate.scheme == 'https' &&
        candidate.host == 'bulka.com.kz' &&
        candidate.port == 443 &&
        candidate.userInfo.isEmpty &&
        candidate.path == '/pickup/camera-v1' &&
        !candidate.hasQuery &&
        candidate.fragment == 'nonce=$nonce';
  }

  void beginStart() {
    if (_completed) return;
    _ready = null;
    _captureFacingMode = null;
    _expectedFacingMode = 'user';
  }

  bool beginSwitch() {
    if (_completed || capturing || _ready == null) return false;
    _expectedFacingMode = _ready!.facingMode == 'user' ? 'environment' : 'user';
    _ready = null;
    return true;
  }

  bool beginCapture() {
    if (_completed || capturing || _ready == null) return false;
    _captureFacingMode = _ready!.facingMode;
    _ready = null;
    return true;
  }

  void close() {
    _completed = true;
    _ready = null;
    _captureFacingMode = null;
  }

  PickupCameraEvent? receive(String raw) {
    if (_completed || raw.length > _maxMessageLength) return null;
    Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } on FormatException {
      return null;
    }
    if (decoded is! Map<String, dynamic> ||
        decoded['v'] is! int ||
        decoded['v'] != 1 ||
        decoded['nonce'] != nonce) {
      return null;
    }
    switch (decoded['type']) {
      case 'ready':
        if (capturing) return null;
        final facingMode = _lens(decoded);
        if (facingMode != _expectedFacingMode) {
          throw const FormatException('Unexpected camera lens');
        }
        final (width, height) = _dimensions(decoded);
        return _ready = PickupCameraEvent(
          PickupCameraEventType.ready,
          facingMode: facingMode,
          width: width,
          height: height,
        );
      case 'busy':
        final reason = decoded['reason'];
        if (!const {'start', 'switch', 'capture'}.contains(reason)) return null;
        if (reason == 'capture' && !capturing) return null;
        if (reason != 'capture') {
          if (capturing) return null;
          _ready = null;
        }
        return PickupCameraEvent(
          PickupCameraEventType.busy,
          reason: reason as String,
        );
      case 'photo':
        if (!capturing) return null;
        final facingMode = _lens(decoded);
        if (facingMode != _captureFacingMode ||
            decoded['mimeType'] != 'image/jpeg') {
          throw const FormatException('Unexpected camera photo');
        }
        final (width, height) = _dimensions(decoded);
        final encoded = decoded['base64'];
        if (encoded is! String ||
            encoded.isEmpty ||
            encoded.length > ((maxBytes + 2) ~/ 3) * 4) {
          throw const FormatException('Invalid camera photo size');
        }
        final bytes = base64Decode(encoded);
        if (bytes.length < 5 ||
            bytes.length > maxBytes ||
            bytes[0] != 0xff ||
            bytes[1] != 0xd8 ||
            bytes[2] != 0xff ||
            bytes[bytes.length - 2] != 0xff ||
            bytes.last != 0xd9) {
          throw const FormatException('Invalid camera JPEG');
        }
        close();
        return PickupCameraEvent(
          PickupCameraEventType.photo,
          facingMode: facingMode,
          width: width,
          height: height,
          bytes: bytes.asUnmodifiableView(),
        );
      case 'error':
        final code = decoded['code'];
        if (!const {
          'permission',
          'unsupported',
          'unavailable',
          'lens',
          'capture',
        }.contains(code)) {
          return null;
        }
        _ready = null;
        _captureFacingMode = null;
        return PickupCameraEvent(
          PickupCameraEventType.error,
          code: code as String,
        );
      case 'cancel':
        close();
        return const PickupCameraEvent(PickupCameraEventType.cancel);
      default:
        return null;
    }
  }

  static String _lens(Map<String, dynamic> data) {
    final mode = data['facingMode'];
    if (mode != 'user' && mode != 'environment') {
      throw const FormatException('Unknown camera lens');
    }
    return mode as String;
  }

  static (int, int) _dimensions(Map<String, dynamic> data) {
    final width = data['width'];
    final height = data['height'];
    if (width is! int ||
        height is! int ||
        width <= 0 ||
        height <= 0 ||
        width > maxPixels ||
        height > maxPixels ||
        width * height > maxPixels) {
      throw const FormatException('Invalid camera dimensions');
    }
    return (width, height);
  }
}
