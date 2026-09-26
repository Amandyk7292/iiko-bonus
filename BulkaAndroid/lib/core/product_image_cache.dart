import 'dart:async';

import 'package:flutter_cache_manager/flutter_cache_manager.dart';
import 'package:http/http.dart' as http;

import 'api_origin.dart';

/// A single disk cache for visible photos and catalog prefetches.
final productImageCache = CacheManager(
  Config(
    'bulkaProductImagesV1',
    stalePeriod: const Duration(days: 30),
    maxNrOfCacheObjects: 600,
    fileService: ProductImageFileService(),
  ),
);

class ProductImageFileService extends FileService {
  ProductImageFileService({
    http.Client Function()? clientFactory,
    this.proxyTimeout = const Duration(seconds: 5),
    this.originalTimeout = const Duration(seconds: 15),
  }) : _clientFactory = clientFactory ?? http.Client.new;

  final http.Client Function() _clientFactory;
  final Duration proxyTimeout;
  final Duration originalTimeout;

  Future<FileServiceResponse> _download(
    Uri uri,
    Map<String, String>? headers,
    Duration timeout,
  ) async {
    final client = _clientFactory();
    try {
      // Bound the entire download, including a stalled response body. Close the
      // client on timeout so the failed proxy cannot occupy a connection.
      final response = await client.get(uri, headers: headers).timeout(timeout);
      return HttpGetResponse(
        http.StreamedResponse(
          Stream.value(response.bodyBytes),
          response.statusCode,
          headers: response.headers,
          contentLength: response.bodyBytes.length,
        ),
      );
    } finally {
      client.close();
    }
  }

  @override
  Future<FileServiceResponse> get(
    String url, {
    Map<String, String>? headers,
  }) async {
    final uri = Uri.parse(url);
    final original = originalProductImageUri(uri);
    if (original == null) return _download(uri, headers, originalTimeout);
    try {
      final response = await _download(uri, headers, proxyTimeout);
      if (response.statusCode == 200 || response.statusCode == 304) {
        return response;
      }
    } catch (_) {
      // The original lives on an independent host.
    }
    // Cache the fallback under the requested rendition's key. Otherwise every
    // subsequent opening retries the broken proxy before showing a cached file.
    // Proxy ETags/authorization must never be forwarded to the storage host.
    return _download(original, null, originalTimeout);
  }
}

Uri? originalProductImageUri(Uri uri) {
  final origin = Uri.parse(bulkaApiBaseUrl);
  if (uri.origin != origin.origin || uri.path != '/api/public/image') {
    return null;
  }
  final path = uri.queryParameters['path'] ?? '';
  if (!path.startsWith('menu_images/') && !path.startsWith('stories/')) {
    return null;
  }
  return Uri.https(
    'owofrgapcxsmzkdsefai.supabase.co',
    '/storage/v1/object/public/$path',
  );
}
