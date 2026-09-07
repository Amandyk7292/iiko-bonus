part of '../main.dart';

/// A reversible 128-bit UUID encoding: short URLs never depend on menu order.
Uri productClientUri(String id) {
  final hex = id.replaceAll('-', '');
  if (RegExp(
    r'^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$',
  ).hasMatch(id)) {
    final bytes = [
      for (var offset = 0; offset < hex.length; offset += 2)
        int.parse(hex.substring(offset, offset + 2), radix: 16),
    ];
    return Uri(path: '/p/${base64Url.encode(bytes).replaceAll('=', '')}');
  }
  return Uri(pathSegments: ['', 'catalog', 'product', id]);
}

String? productIdFromClientUri(Uri uri) {
  final segments = uri.pathSegments.where((part) => part.isNotEmpty).toList();
  if (segments.length >= 3 &&
      segments[0] == 'catalog' &&
      segments[1] == 'product') {
    return segments[2];
  }
  if (segments.length != 2 ||
      segments[0] != 'p' ||
      !RegExp(r'^[A-Za-z0-9_-]{22}$').hasMatch(segments[1])) {
    return null;
  }
  try {
    final bytes = base64Url.decode('${segments[1]}==');
    if (bytes.length != 16) return null;
    final hex = bytes
        .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  } on FormatException {
    return null;
  }
}

String productPageTitle(String name) {
  final clean = name.replaceAll(RegExp(r'\s+'), ' ').trim();
  final short = clean.characters.length > 40
      ? '${clean.characters.take(39)}…'
      : clean;
  return short.isEmpty ? 'Bulka' : '$short · Bulka';
}
