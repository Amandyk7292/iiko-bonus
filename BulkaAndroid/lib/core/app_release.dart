part of '../main.dart';

const bool _previewRequiredAppUpdate = bool.fromEnvironment(
  'BULKA_UPDATE_PREVIEW',
);

@immutable
class AppReleasePolicy {
  const AppReleasePolicy({
    required this.platform,
    required this.latestVersion,
    required this.minimumVersion,
    required this.storeUri,
  });

  final String platform;
  final String latestVersion;
  final String minimumVersion;
  final Uri? storeUri;

  factory AppReleasePolicy.fromJson(Map<String, dynamic> json) {
    final rawStoreUrl = _asString(json['storeUrl'] ?? json['store_url']).trim();
    final parsedStoreUri = Uri.tryParse(rawStoreUrl);
    return AppReleasePolicy(
      platform: _asString(json['platform']).toLowerCase(),
      latestVersion: _asString(
        json['latestVersion'] ?? json['latest_version'],
        fallback: '1.0.0',
      ),
      minimumVersion: _asString(
        json['minimumVersion'] ?? json['minimum_version'],
        fallback: '1.0.0',
      ),
      storeUri:
          parsedStoreUri != null &&
              parsedStoreUri.scheme == 'https' &&
              parsedStoreUri.host.isNotEmpty
          ? parsedStoreUri
          : null,
    );
  }
}

@immutable
class RequiredAppUpdate {
  const RequiredAppUpdate({
    required this.currentVersion,
    required this.targetVersion,
    required this.storeUri,
  });

  final String currentVersion;
  final String targetVersion;
  final Uri storeUri;
}

List<int> _comparableVersionParts(String version) {
  final core = version.trim().split(RegExp(r'[-+]')).first;
  return core
      .split('.')
      .take(4)
      .map((part) => int.tryParse(part) ?? 0)
      .toList(growable: false);
}

@visibleForTesting
int compareAppVersions(String left, String right) {
  final leftParts = _comparableVersionParts(left);
  final rightParts = _comparableVersionParts(right);
  final length = max(leftParts.length, rightParts.length);
  for (var index = 0; index < length; index += 1) {
    final leftValue = index < leftParts.length ? leftParts[index] : 0;
    final rightValue = index < rightParts.length ? rightParts[index] : 0;
    if (leftValue != rightValue) return leftValue.compareTo(rightValue);
  }
  return 0;
}

@visibleForTesting
RequiredAppUpdate? requiredAppUpdateForPolicy({
  required String currentVersion,
  required AppReleasePolicy policy,
}) {
  final storeUri = policy.storeUri;
  if (storeUri == null ||
      compareAppVersions(currentVersion, policy.minimumVersion) >= 0) {
    return null;
  }
  final targetVersion =
      compareAppVersions(policy.latestVersion, policy.minimumVersion) >= 0
      ? policy.latestVersion
      : policy.minimumVersion;
  return RequiredAppUpdate(
    currentVersion: currentVersion,
    targetVersion: targetVersion,
    storeUri: storeUri,
  );
}

String? _nativeStorePlatform() {
  if (kIsWeb) return null;
  return switch (defaultTargetPlatform) {
    TargetPlatform.android => 'android',
    TargetPlatform.iOS => 'ios',
    _ => null,
  };
}

Future<RequiredAppUpdate?> resolveRequiredAppUpdate(BulkaApiClient api) async {
  final platform = _nativeStorePlatform();
  if (platform == null) return null;
  if (_previewRequiredAppUpdate) {
    return RequiredAppUpdate(
      currentVersion: '1.0.0',
      targetVersion: '1.1.0',
      storeUri: platform == 'ios'
          ? Uri.parse('https://apps.apple.com/')
          : Uri.parse(
              'https://play.google.com/store/apps/details?id=com.bulka.bonus',
            ),
    );
  }
  try {
    final results = await Future.wait<Object>([
      PackageInfo.fromPlatform(),
      api.getAppReleasePolicy(platform),
    ]).timeout(const Duration(seconds: 4));
    return requiredAppUpdateForPolicy(
      currentVersion: (results[0] as PackageInfo).version,
      policy: results[1] as AppReleasePolicy,
    );
  } catch (_) {
    // A release-policy outage must never lock customers out of a healthy app.
    return null;
  }
}
