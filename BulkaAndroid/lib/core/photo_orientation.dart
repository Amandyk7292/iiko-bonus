import 'dart:math' as math;
import 'dart:typed_data';

import 'package:image/image.dart' as img;

/// Prepares both choices once, before upload. Camera preference alone cannot
/// tell us whether a phone has already mirrored its saved selfie.
Map<String, Uint8List> preparePickupPhoto(Uint8List bytes) {
  try {
    return _preparePickupPhoto(bytes);
  } on FormatException {
    rethrow;
  } catch (_) {
    throw const FormatException('Unreadable photo');
  }
}

Map<String, Uint8List> _preparePickupPhoto(Uint8List bytes) {
  const maxBytes = 5 * 1024 * 1024;
  if (bytes.isEmpty || bytes.length > maxBytes) {
    throw const FormatException('Invalid photo size');
  }
  final decoder = img.findDecoderForData(bytes);
  if (decoder is! img.JpegDecoder &&
      decoder is! img.PngDecoder &&
      decoder is! img.WebPDecoder) {
    throw const FormatException('Unsupported photo format');
  }
  final info = decoder!.startDecode(bytes);
  // Still WebP has zero animation-frame records; multiple frames are rejected.
  if (info == null ||
      info.width <= 0 ||
      info.height <= 0 ||
      info.width * info.height > 16000000 ||
      info.numFrames > 1) {
    throw const FormatException('Invalid photo dimensions');
  }
  final decoded = decoder.decodeFrame(0);
  if (decoded == null) throw const FormatException('Unreadable photo');
  // JPEG decoding already bakes orientation. This is also safe for formats
  // whose decoder leaves the tag in place: bakeOrientation clears it once.
  final oriented = img.bakeOrientation(decoded);
  final scale = math.min(
    1.0,
    math.min(1200 / oriented.width, 1600 / oriented.height),
  );
  final resized = scale < 1
      ? img.copyResize(
          oriented,
          width: math.max(1, (oriented.width * scale).round()),
          height: math.max(1, (oriented.height * scale).round()),
          interpolation: img.Interpolation.average,
        )
      : oriented;
  // A fresh RGB image flattens transparency onto white and carries no EXIF/GPS.
  final canonical = img.Image(
    width: resized.width,
    height: resized.height,
    numChannels: 3,
  )..clear(img.ColorRgb8(255, 255, 255));
  img.compositeImage(canonical, resized);
  final original = img.encodeJpg(canonical, quality: 88).asUnmodifiableView();
  final mirrored = img
      .encodeJpg(img.flipHorizontal(img.Image.from(canonical)), quality: 88)
      .asUnmodifiableView();
  if (original.length > maxBytes || mirrored.length > maxBytes) {
    throw const FormatException('Prepared photo too large');
  }
  return Map.unmodifiable({'original': original, 'mirrored': mirrored});
}
