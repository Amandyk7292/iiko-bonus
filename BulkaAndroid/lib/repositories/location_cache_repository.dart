part of '../main.dart';

class CachedLocations {
  const CachedLocations({
    required this.locations,
    required this.fromCache,
    this.cachedAt,
  });
  final List<BakeryLocation> locations;
  final bool fromCache;
  final DateTime? cachedAt;
}

class LocationCacheRepository {
  LocationCacheRepository({required this.api});
  static const _key = 'fulfillment_locations_cache_v1';
  static const _maximumAge = Duration(days: 7);
  final BulkaApiClient api;

  Future<CachedLocations> load() async {
    try {
      final locations = await api.getFulfillmentLocations();
      final now = DateTime.now();
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _key,
        jsonEncode({
          'cachedAt': now.toUtc().toIso8601String(),
          'locations': locations.map((item) => item.toJson()).toList(),
        }),
      );
      return CachedLocations(
        locations: locations,
        fromCache: false,
        cachedAt: now,
      );
    } catch (_) {
      final cached = await _readCache();
      if (cached != null) return cached;
      rethrow;
    }
  }

  Future<CachedLocations?> _readCache() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null || raw.isEmpty) return null;
    try {
      final value = _asMap(jsonDecode(raw));
      final cachedAt = DateTime.tryParse(
        _asString(value['cachedAt']),
      )?.toLocal();
      if (cachedAt == null ||
          DateTime.now().difference(cachedAt).abs() > _maximumAge) {
        await prefs.remove(_key);
        return null;
      }
      final locations = (value['locations'] as List? ?? const [])
          .whereType<Map>()
          .map(
            (item) => BakeryLocation.fromJson(Map<String, dynamic>.from(item)),
          )
          .where((item) => item.id.isNotEmpty && item.displayLabel.isNotEmpty)
          .toList(growable: false);
      if (locations.isEmpty) return null;
      return CachedLocations(
        locations: locations,
        fromCache: true,
        cachedAt: cachedAt,
      );
    } catch (_) {
      await prefs.remove(_key);
      return null;
    }
  }
}

class LocationCacheNotice extends StatelessWidget {
  const LocationCacheNotice({
    required this.cachedAt,
    required this.onRetry,
    super.key,
  });
  final DateTime? cachedAt;
  final Future<void> Function() onRetry;
  @override
  Widget build(BuildContext context) => Material(
    color: const Color(0xFFFFF4D7),
    child: InkWell(
      onTap: () => onRetry(),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Row(
          children: [
            const Icon(Icons.cloud_off_outlined, size: 19),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'locations_cached_notice'.trArgs({
                  'time': cachedAt == null
                      ? '—'
                      : formatUiDateTime(context, cachedAt!),
                }),
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            Text(
              'retry_btn'.tr,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ],
        ),
      ),
    ),
  );
}
