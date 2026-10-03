import 'dart:typed_data';

import 'package:image/image.dart' as img;
import 'package:zxing2/qrcode.dart';

/// Decodes locally; the captured image is never sent to Bulka or another API.
String? decodeCashierInviteQr(Uint8List bytes) {
  if (bytes.isEmpty || bytes.length > 12 * 1024 * 1024) return null;
  try {
    final img.Decoder decoder;
    if (bytes.length > 3 && bytes[0] == 0xff && bytes[1] == 0xd8) {
      decoder = img.JpegDecoder();
    } else if (bytes.length > 8 &&
        bytes[0] == 0x89 &&
        bytes[1] == 0x50 &&
        bytes[2] == 0x4e &&
        bytes[3] == 0x47) {
      decoder = img.PngDecoder();
    } else {
      return null;
    }
    final info = decoder.startDecode(bytes);
    if (info == null || info.width * info.height > 16000000) return null;
    final image = decoder.decodeFrame(0);
    if (image == null) return null;
    final oriented = img.bakeOrientation(image);
    final resized = oriented.width > 1600 || oriented.height > 1600
        ? img.copyResize(
            oriented,
            width: oriented.width >= oriented.height ? 1600 : null,
            height: oriented.height > oriented.width ? 1600 : null,
          )
        : oriented;
    final pixels = resized
        .convert(numChannels: 4)
        .getBytes(order: img.ChannelOrder.abgr)
        .buffer
        .asInt32List();
    final source = RGBLuminanceSource(resized.width, resized.height, pixels);
    return QRCodeReader().decode(BinaryBitmap(HybridBinarizer(source))).text;
  } catch (_) {
    return null;
  }
}
