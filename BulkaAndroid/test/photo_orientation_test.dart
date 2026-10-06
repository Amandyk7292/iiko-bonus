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

img.Image _asymmetric() {
  final source = img.Image(width: 3 * _block, height: 2 * _block);
  for (var y = 0; y < source.height; y++) {
    for (var x = 0; x < source.width; x++) {
      final letter = 'ABCDEF'[(y ~/ _block) * 3 + x ~/ _block];
      final color = _colors[letter]!;
      source.setPixelRgb(x, y, color[0], color[1], color[2]);
    }
  }
  return source;
}

Uint8List _orientedJpeg(int orientation, {bool privateMetadata = false}) {
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
  // Inject metadata after encoding, so the fixture really stores ABC/DEF with
  // an orientation tag. JPEG decoding may already bake that tag into pixels.
  return img.injectJpgExif(img.encodeJpg(_asymmetric(), quality: 100), exif)!;
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

List<String> _horizontalInverse(List<String> layout) =>
    layout.map((row) => row.split('').reversed.join()).toList();

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
      test('EXIF ${entry.key} is applied once before either choice', () {
        final source = _orientedJpeg(entry.key);
        expect(img.decodeJpgExif(source)!.imageIfd.orientation, entry.key);

        final choices = preparePickupPhoto(source);
        _expectLayout(choices['original']!, entry.value);
        _expectLayout(choices['mirrored']!, _horizontalInverse(entry.value));
        for (final bytes in choices.values) {
          expect(img.decodeJpg(bytes)!.exif.isEmpty, isTrue);
        }
      });
    }

    test('removes EXIF and GPS without changing the oriented pixels', () {
      final source = _orientedJpeg(6, privateMetadata: true);
      final metadata = img.decodeJpgExif(source)!;
      expect(metadata.imageIfd.imageDescription, isNotNull);
      expect(metadata.gpsIfd.gpsLatitudeRef, 'N');

      final choices = preparePickupPhoto(source);
      for (final bytes in choices.values) {
        final exif = img.decodeJpgExif(bytes);
        expect(exif == null || exif.isEmpty, isTrue);
        expect(img.decodeJpg(bytes)!.exif.isEmpty, isTrue);
      }
      _expectLayout(choices['original']!, _orientedLayouts[6]!);
    });

    test('choices are immutable, reversible and leave source bytes intact', () {
      final source = _orientedJpeg(7);
      final before = Uint8List.fromList(source);
      final choices = preparePickupPhoto(source);
      final original = choices['original']!;
      final mirrored = choices['mirrored']!;
      final originalSnapshot = Uint8List.fromList(original);
      final mirroredSnapshot = Uint8List.fromList(mirrored);

      expect(() => choices['original'] = source, throwsUnsupportedError);
      expect(() => choices.clear(), throwsUnsupportedError);
      expect(() => original[0] = 0, throwsUnsupportedError);
      expect(
        () => ByteData.view(mirrored.buffer).setUint8(0, 0),
        throwsUnsupportedError,
      );
      for (var turn = 0; turn < 20; turn++) {
        final selected = choices[turn.isEven ? 'original' : 'mirrored']!;
        expect(identical(selected, turn.isEven ? original : mirrored), isTrue);
      }
      expect(source, orderedEquals(before));
      expect(original, orderedEquals(originalSnapshot));
      expect(mirrored, orderedEquals(mirroredSnapshot));
      _expectLayout(original, _orientedLayouts[7]!);
      _expectLayout(mirrored, _horizontalInverse(_orientedLayouts[7]!));
    });

    for (final format in ['PNG', 'WebP']) {
      test('accepts $format and prepares both choices as JPEG', () {
        final source = format == 'PNG'
            ? img.encodePng(_asymmetric())
            : img.encodeWebP(_asymmetric());
        final choices = preparePickupPhoto(source);
        for (final bytes in choices.values) {
          expect(img.findDecoderForData(bytes), isA<img.JpegDecoder>());
        }
        _expectLayout(choices['original']!, _orientedLayouts[1]!);
        _expectLayout(choices['mirrored']!, _orientedLayouts[2]!);
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
      final choices = preparePickupPhoto(img.encodePng(source));
      final original = img.decodeJpg(choices['original']!)!;
      _expectColor(original.getPixel(16, 16), [255, 255, 255]);
      _expectColor(original.getPixel(48, 16), [255, 127, 127]);
      _expectColor(original.getPixel(80, 16), [255, 0, 0]);
      final mirrored = img.decodeJpg(choices['mirrored']!)!;
      _expectColor(mirrored.getPixel(16, 16), [255, 0, 0]);
      _expectColor(mirrored.getPixel(80, 16), [255, 255, 255]);
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
          final choices = preparePickupPhoto(img.encodePng(source));
          for (final bytes in choices.values) {
            final decoded = img.decodeJpg(bytes)!;
            expect(decoded.width, dimensions[2]);
            expect(decoded.height, dimensions[3]);
            expect(bytes.length, lessThanOrEqualTo(5 * 1024 * 1024));
          }
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
