part of '../main.dart';

const _contactCenterCacheKey = 'contact_center_cache_v1';

enum NotificationTargetKind { none, orders, promos, support, external }

class NotificationTarget {
  const NotificationTarget(this.kind, {this.uri});

  final NotificationTargetKind kind;
  final Uri? uri;
}

Uri? _safeHttpsUri(String raw) {
  final target = raw.trim();
  final uri = Uri.tryParse(target);
  if (uri == null ||
      uri.scheme != 'https' ||
      uri.host.isEmpty ||
      uri.userInfo.isNotEmpty ||
      RegExp(r'[\u0000-\u001f\u007f]').hasMatch(target)) {
    return null;
  }
  return uri;
}

NotificationTarget resolveNotificationTarget(AppNotification notification) {
  final payload = notification.payload;
  final destination = _asString(
    payload['destination'] ?? payload['route'] ?? payload['screen'],
    fallback: notification.type,
  ).toLowerCase();

  if (payload['orderId'] != null || destination.contains('order')) {
    return const NotificationTarget(NotificationTargetKind.orders);
  }
  if (payload['promotionId'] != null ||
      payload['promoId'] != null ||
      destination.contains('promo') ||
      destination.contains('story')) {
    return const NotificationTarget(NotificationTargetKind.promos);
  }
  if (payload['supportId'] != null || destination.contains('support')) {
    return const NotificationTarget(NotificationTargetKind.support);
  }

  final uri = _safeHttpsUri(
    _asString(payload['url'] ?? payload['externalUrl']),
  );
  return uri == null
      ? const NotificationTarget(NotificationTargetKind.none)
      : NotificationTarget(NotificationTargetKind.external, uri: uri);
}

Uri? contactActionUri(AppContactAction action) {
  final target = action.target.trim();
  if (target.isEmpty) return null;

  if (action.type == 'phone') {
    final normalized = target.replaceAll(RegExp(r'[\s()\-]'), '');
    if (!RegExp(r'^\+[0-9]{10,15}$').hasMatch(normalized)) return null;
    return Uri(scheme: 'tel', path: normalized);
  }

  if (action.type == 'email') {
    if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(target)) {
      return null;
    }
    return Uri(scheme: 'mailto', path: target);
  }

  return _safeHttpsUri(target);
}

class ContactCenterRepository {
  ContactCenterRepository({required this.api, SharedPreferences? preferences})
    : _preferences = preferences;

  final BulkaApiClient api;
  SharedPreferences? _preferences;

  Future<SharedPreferences> _prefs() async {
    return _preferences ??= await SharedPreferences.getInstance();
  }

  Future<List<AppContactCard>> readCache() async {
    final raw = (await _prefs()).getString(_contactCenterCacheKey);
    if (raw == null || raw.isEmpty) return const [];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const [];
      return decoded
          .map((item) => AppContactCard.fromJson(_asMap(item)))
          .where((card) => card.id.isNotEmpty)
          .toList(growable: false);
    } catch (_) {
      return const [];
    }
  }

  Future<List<AppContactCard>> load() async {
    try {
      final cards = await api.getContactCards();
      await (await _prefs()).setString(
        _contactCenterCacheKey,
        jsonEncode(cards.map((card) => card.toJson()).toList()),
      );
      return cards;
    } catch (_) {
      final cached = await readCache();
      if (cached.isNotEmpty) return cached;
      rethrow;
    }
  }
}
