import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_cache_manager/flutter_cache_manager.dart';
import 'package:http/http.dart' as http;
import 'package:mime/mime.dart';

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
  }) : _client = clientFactory == null ? http.Client() : clientFactory();

  static const _maxImageBytes = 12 * 1024 * 1024;
  final http.Client _client;
  final Duration proxyTimeout;
  final Duration originalTimeout;

  Future<FileServiceResponse> _download(
    Uri uri,
    Map<String, String>? headers,
    Duration timeout, {
    bool original = false,
  }) async {
    final abort = Completer<void>();
    try {
      return await _readImage(
        uri,
        headers,
        abort.future,
        original,
      ).timeout(timeout);
    } finally {
      abort.complete();
    }
  }

  Future<FileServiceResponse> _readImage(
    Uri uri,
    Map<String, String>? headers,
    Future<void> abort,
    bool original,
  ) async {
    final request = http.AbortableRequest('GET', uri, abortTrigger: abort);
    if (headers != null) request.headers.addAll(headers);
    final response = await _client.send(request);
    final responseHeaders = Map<String, String>.of(response.headers);
    if (original) responseHeaders.remove('etag');
    final bytes = BytesBuilder(copy: false);
    if (response.statusCode == 200) {
      if ((response.contentLength ?? 0) > _maxImageBytes) {
        throw const FormatException('Image exceeds download limit');
      }
      await for (final chunk in response.stream) {
        if (bytes.length + chunk.length > _maxImageBytes) {
          throw const FormatException('Image exceeds download limit');
        }
        bytes.add(chunk);
      }
    }
    final body = bytes.takeBytes();
    if (response.statusCode == 200) {
      final contentType = lookupMimeType('', headerBytes: body);
      if (contentType == null || !contentType.startsWith('image/')) {
        throw const FormatException('Response is not a supported image');
      }
      responseHeaders['content-type'] = contentType;
    }
    return HttpGetResponse(
      http.StreamedResponse(
        Stream.value(body),
        response.statusCode,
        headers: responseHeaders,
        contentLength: body.length,
      ),
    );
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
    return _download(original, null, originalTimeout, original: true);
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
