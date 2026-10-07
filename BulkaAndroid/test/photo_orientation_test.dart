import 'dart:typed_data';

import 'package:bulka_bonus/core/photo_orientation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;

const _block = 32;
const _colors = <String, List<int>>{
  'A': [255, 0, 0],
  'B': [0, 255, 0],
  'C': [0, 0, 255],
  'D': [255, 255, 0],
  'E': [255, 0, 255],
  'F': [0, 255, 255],
};

// Independent EXIF coordinate expectations for the asymmetric source ABC/DEF.
// Do not derive the oracle with the same image transforms as the preparation.
const _orientedLayouts = <int, List<String>>{
  1: ['ABC', 'DEF'],
  2: ['CBA', 'FED'],
  3: ['FED', 'CBA'],
  4: ['DEF', 'ABC'],
  5: ['AD', 'BE', 'CF'],
  6: ['DA', 'EB', 'FC'],
  7: ['FC', 'EB', 'DA'],
  8: ['CF', 'BE', 'AD'],
};

img.Image _asymmetric({List<String> layout = const ['ABC', 'DEF']}) {
  final source = img.Image(
    width: layout.first.length * _block,
    height: layout.length * _block,
  );
  for (var y = 0; y < source.height; y++) {
    for (var x = 0; x < source.width; x++) {
      final letter = layout[y ~/ _block][x ~/ _block];
      final color = _colors[letter]!;
      source.setPixelRgb(x, y, color[0], color[1], color[2]);
    }
  }
  return source;
}

Uint8List _orientedJpeg(
  int orientation, {
  bool privateMetadata = false,
  List<String> storedLayout = const ['ABC', 'DEF'],
}) {
  final exif = img.ExifData();
  exif.imageIfd.orientation = orientation;
  if (privateMetadata) {
    exif.imageIfd.imageDescription = 'synthetic-private-metadata';
    exif.exifIfd.userComment = 'synthetic-comment';
    exif.gpsIfd
      ..gpsLatitudeRef = 'N'
      ..gpsLatitude = 51.0
      ..gpsLongitudeRef = 'E'
      ..gpsLongitude = 71.0;
  }
  // Inject metadata after encoding, so the fixture really stores its layout with
  // an orientation tag. JPEG decoding may already bake that tag into pixels.
  return img.injectJpgExif(
    img.encodeJpg(_asymmetric(layout: storedLayout), quality: 100),
    exif,
  )!;
}

void _expectColor(img.Pixel pixel, List<int> color) {
  expect(pixel.r, closeTo(color[0], 20));
  expect(pixel.g, closeTo(color[1], 20));
  expect(pixel.b, closeTo(color[2], 20));
}

void _expectLayout(Uint8List bytes, List<String> layout) {
  final decoded = img.decodeJpg(bytes)!;
  expect(decoded.width, layout.first.length * _block);
  expect(decoded.height, layout.length * _block);
  for (var y = 0; y < layout.length; y++) {
    for (var x = 0; x < layout[y].length; x++) {
      _expectColor(
        decoded.getPixel(x * _block + _block ~/ 2, y * _block + _block ~/ 2),
        _colors[layout[y][x]]!,
      );
    }
  }
}

Uint8List _pngDimensions(int width, int height) {
  // A tiny PNG with a valid IHDR claiming large dimensions exercises the
  // pre-decode pixel guard without allocating a large image in the fixture.
  final bytes = Uint8List.fromList(
    img.encodePng(img.Image(width: 1, height: 1)),
  );
  final data = ByteData.sublistView(bytes);
  data.setUint32(16, width);
  data.setUint32(20, height);
  var crc = 0xffffffff;
  for (final byte in bytes.sublist(12, 29)) {
    crc ^= byte;
    for (var bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) == 1 ? 0xedb88320 : 0);
    }
  }
  data.setUint32(29, crc ^ 0xffffffff);
  return bytes;
}

void main() {
  group('pickup photo orientation', () {
    for (final entry in _orientedLayouts.entries) {
      test('EXIF ${entry.key} is applied once to the canonical JPEG', () {
        final source = _orientedJpeg(entry.key);
        expect(img.decodeJpgExif(source)!.imageIfd.orientation, entry.key);

        final prepared = preparePickupPhoto(source);
        _expectLayout(prepared, entry.value);
        expect(img.decodeJpg(prepared)!.exif.isEmpty, isTrue);
      });
    }

    test('EXIF 2 corrects a mirrored stored raster without an extra flip', () {
      // Raw CBA/FED pixels plus horizontal EXIF reflection display ABC/DEF.
      // Both the fixture and expected layout are independent of image flips.
      final source = _orientedJpeg(2, storedLayout: ['CBA', 'FED']);
      expect(img.decodeJpgExif(source)!.imageIfd.orientation, 2);

      final prepared = preparePickupPhoto(source);
      _expectLayout(prepared, ['ABC', 'DEF']);
      expect(img.decodeJpg(prepared)!.exif.isEmpty, isTrue);
    });

    test('EXIF 1 keeps normal stored pixels without an app-side mirror', () {
      final source = _orientedJpeg(1);
      final prepared = preparePickupPhoto(source);
      _expectLayout(prepared, ['ABC', 'DEF']);
      expect(img.decodeJpg(prepared)!.exif.isEmpty, isTrue);
    });

    test('removes EXIF and GPS without changing the oriented pixels', () {
      final source = _orientedJpeg(6, privateMetadata: true);
      final metadata = img.decodeJpgExif(source)!;
      expect(metadata.imageIfd.imageDescription, isNotNull);
      expect(metadata.gpsIfd.gpsLatitudeRef, 'N');

      final prepared = preparePickupPhoto(source);
      final exif = img.decodeJpgExif(prepared);
      expect(exif == null || exif.isEmpty, isTrue);
      expect(img.decodeJpg(prepared)!.exif.isEmpty, isTrue);
      _expectLayout(prepared, _orientedLayouts[6]!);
    });

    test(
      'canonical bytes and buffer are immutable and leave source intact',
      () {
        final source = _orientedJpeg(7);
        final before = Uint8List.fromList(source);
        final prepared = preparePickupPhoto(source);
        final preparedSnapshot = Uint8List.fromList(prepared);

        expect(prepared, isA<Uint8List>());
        expect(() => prepared[0] = 0, throwsUnsupportedError);
        expect(
          () => ByteData.view(prepared.buffer).setUint8(0, 0),
          throwsUnsupportedError,
        );
        expect(source, orderedEquals(before));
        expect(prepared, orderedEquals(preparedSnapshot));
        _expectLayout(prepared, _orientedLayouts[7]!);
      },
    );

    for (final format in ['PNG', 'WebP']) {
      test('accepts $format and prepares a canonical JPEG', () {
        final source = format == 'PNG'
            ? img.encodePng(_asymmetric())
            : img.encodeWebP(_asymmetric());
        final prepared = preparePickupPhoto(source);
        expect(img.findDecoderForData(prepared), isA<img.JpegDecoder>());
        _expectLayout(prepared, _orientedLayouts[1]!);
      });
    }

    test('flattens transparent and translucent PNG pixels onto white', () {
      final source = img.Image(width: 96, height: 32, numChannels: 4);
      for (var y = 0; y < source.height; y++) {
        for (var x = 0; x < source.width; x++) {
          source.setPixelRgba(
            x,
            y,
            255,
            0,
            0,
            x < 32
                ? 0
                : x < 64
                ? 128
                : 255,
          );
        }
      }
      final prepared = img.decodeJpg(
        preparePickupPhoto(img.encodePng(source)),
      )!;
      _expectColor(prepared.getPixel(16, 16), [255, 255, 255]);
      _expectColor(prepared.getPixel(48, 16), [255, 127, 127]);
      _expectColor(prepared.getPixel(80, 16), [255, 0, 0]);
    });

    for (final dimensions in [
      [1280, 640, 1200, 600],
      [1000, 2000, 800, 1600],
      [16, 24, 16, 24],
    ]) {
      test(
        'fits ${dimensions[0]}x${dimensions[1]} without distortion/upscale',
        () {
          final source = img.Image(width: dimensions[0], height: dimensions[1]);
          source.clear(img.ColorRgb8(10, 100, 200));
          final prepared = preparePickupPhoto(img.encodePng(source));
          final decoded = img.decodeJpg(prepared)!;
          expect(decoded.width, dimensions[2]);
          expect(decoded.height, dimensions[3]);
          expect(prepared.length, lessThanOrEqualTo(5 * 1024 * 1024));
        },
      );
    }

    test('rejects empty, excessive and unrecognized input', () {
      for (final input in [
        Uint8List(0),
        Uint8List(5 * 1024 * 1024 + 1),
        Uint8List.fromList([1, 2, 3, 4]),
        img.encodeGif(_asymmetric()),
      ]) {
        expect(() => preparePickupPhoto(input), throwsFormatException);
      }
    });

    test('rejects oversized dimensions before decompressing pixels', () {
      final source = _pngDimensions(4001, 4000);
      final info = img.PngDecoder().startDecode(source)!;
      expect(info.width * info.height, greaterThan(16000000));
      expect(() => preparePickupPhoto(source), throwsFormatException);
    });

    test('rejects animated PNG instead of choosing a hidden frame', () {
      final source = _asymmetric();
      source.addFrame(img.Image.from(source));
      final bytes = img.encodePng(source);
      expect(img.PngDecoder().startDecode(bytes)!.numFrames, 2);
      expect(() => preparePickupPhoto(bytes), throwsFormatException);
    });
  });
}
