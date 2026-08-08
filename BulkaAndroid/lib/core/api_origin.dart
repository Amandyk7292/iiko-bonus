import 'package:flutter/foundation.dart';

const bulkaProductionOrigin = 'https://bulka.com.kz';

const _configuredBulkaApiBaseUrl = String.fromEnvironment(
  'BULKA_API_BASE_URL',
  defaultValue: '',
);

@visibleForTesting
String resolveBulkaApiBaseUrl({
  required String configuredBaseUrl,
  required bool isWeb,
  required Uri browserUri,
}) {
  final configured = configuredBaseUrl.trim();
  if (configured.isNotEmpty) return configured;
  if (isWeb &&
      (browserUri.scheme == 'http' || browserUri.scheme == 'https') &&
      browserUri.host.isNotEmpty) {
    return browserUri.origin;
  }
  return bulkaProductionOrigin;
}

String get bulkaApiBaseUrl => resolveBulkaApiBaseUrl(
  configuredBaseUrl: _configuredBulkaApiBaseUrl,
  isWeb: kIsWeb,
  browserUri: Uri.base,
);
