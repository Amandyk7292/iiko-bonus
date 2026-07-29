part of '../main.dart';

const _contactCenterCacheKey = 'contact_center_cache_v1';

enum NotificationTargetKind {
  none,
  order,
  orders,
  cart,
  promos,
  support,
  notifications,
  external,
}

class NotificationTarget {
  const NotificationTarget(this.kind, {this.resourceId, this.uri});

  final NotificationTargetKind kind;
  final String? resourceId;
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
  return resolveNotificationPayload(
    notification.payload,
    fallbackType: notification.type,
  );
}

NotificationTarget resolveNotificationPayload(
  Map<String, dynamic> payload, {
  String fallbackType = '',
}) {
  final destination = _asString(
    payload['destination'] ?? payload['route'] ?? payload['screen'],
    fallback: fallbackType,
  ).toLowerCase();

  final supportId = _asString(
    payload['supportId'] ??
        payload['support_id'] ??
        payload['requestId'] ??
        payload['threadId'],
  ).trim();
  if (supportId.isNotEmpty || destination.contains('support')) {
    return NotificationTarget(
      NotificationTargetKind.support,
      resourceId: supportId.isEmpty ? null : supportId,
    );
  }
  final orderId = _asString(payload['orderId'] ?? payload['order_id']).trim();
  if (orderId.isNotEmpty) {
    return NotificationTarget(
      NotificationTargetKind.order,
      resourceId: orderId,
    );
  }
  if (destination.contains('order')) {
    return const NotificationTarget(NotificationTargetKind.orders);
  }
  if (destination.contains('cart') ||
      destination.contains('basket') ||
      fallbackType.toLowerCase().contains('abandoned_cart')) {
    return const NotificationTarget(NotificationTargetKind.cart);
  }
  if (payload['promotionId'] != null ||
      payload['promoId'] != null ||
      destination.contains('promo') ||
      destination.contains('story')) {
    return const NotificationTarget(NotificationTargetKind.promos);
  }
  final uri = _safeHttpsUri(
    _asString(payload['url'] ?? payload['externalUrl']),
  );
  if (uri != null) {
    return NotificationTarget(NotificationTargetKind.external, uri: uri);
  }
  if (destination.contains('notification') ||
      fallbackType.toLowerCase() == 'broadcast') {
    return const NotificationTarget(NotificationTargetKind.notifications);
  }
  return const NotificationTarget(NotificationTargetKind.none);
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
