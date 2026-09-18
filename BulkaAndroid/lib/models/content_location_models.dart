part of '../main.dart';

class AppNotification {
  const AppNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.createdAt,
    required this.isRead,
    this.type = 'broadcast',
    this.payload = const {},
  });

  final String id;
  final String title;
  final String body;
  final String createdAt;
  final bool isRead;
  final String type;
  final Map<String, dynamic> payload;

  AppNotification copyWith({bool? isRead}) => AppNotification(
    id: id,
    title: title,
    body: body,
    createdAt: createdAt,
    isRead: isRead ?? this.isRead,
    type: type,
    payload: payload,
  );

  String titleFor(String language) {
    return _payloadTranslation('titles', language) ??
        _systemTranslation('title', language) ??
        title;
  }

  String bodyFor(String language) {
    return _payloadTranslation('bodies', language) ??
        _systemTranslation('body', language) ??
        body;
  }

  String? _payloadTranslation(String field, String language) {
    final normalizedLanguage = AppLang.supportedCodes.contains(language)
        ? language
        : 'ru';
    final i18n = _asMap(payload['i18n']);
    final values = _asMap(
      i18n[field] ??
          payload[field] ??
          payload[field == 'titles' ? 'titleTranslations' : 'bodyTranslations'],
    );
    final localized = _asString(
      values[normalizedLanguage] ?? values['ru'],
    ).trim();
    return localized.isEmpty ? null : localized;
  }

  String? _systemTranslation(String field, String language) {
    final messageKey = _systemMessageKey;
    if (messageKey == null) return null;
    final translationKey = 'notification_${messageKey}_$field';
    if (!_appTranslations.containsKey(translationKey)) return null;
    final arguments = <String, Object?>{};
    if (messageKey.startsWith('order_')) {
      final orderNumber = _orderNumber;
      if (field == 'body' && orderNumber.isEmpty) return null;
      arguments['number'] = orderNumber;
    }
    return localizedAppText(
      translationKey,
      language: language,
      arguments: arguments,
    );
  }

  String? get _systemMessageKey {
    final explicit = _asString(
      payload['messageKey'] ?? payload['notificationKey'],
    ).trim();
    const supported = {
      'bonus_awarded',
      'order_accepted',
      'order_preparing',
      'order_ready',
      'order_completed',
      'order_cancelled',
      'order_refunded',
    };
    if (supported.contains(explicit)) return explicit;

    final normalizedTitle = title.trim().toLowerCase();
    const legacyTitles = {
      'начислены бонусы': 'bonus_awarded',
      'бонустар қосылды': 'bonus_awarded',
      'bonuses earned': 'bonus_awarded',
      'заказ принят': 'order_accepted',
      'тапсырыс қабылданды': 'order_accepted',
      'order accepted': 'order_accepted',
      'заказ готовится': 'order_preparing',
      'тапсырыс дайындалып жатыр': 'order_preparing',
      'order is being prepared': 'order_preparing',
      'заказ готов': 'order_ready',
      'тапсырыс дайын': 'order_ready',
      'order is ready': 'order_ready',
      'заказ выдан': 'order_completed',
      'заказ завершён': 'order_completed',
      'тапсырыс табысталды': 'order_completed',
      'order collected': 'order_completed',
      'заказ отменён': 'order_cancelled',
      'тапсырыс тоқтатылды': 'order_cancelled',
      'order cancelled': 'order_cancelled',
      'заказ отменён, деньги возвращены': 'order_refunded',
      'тапсырыс тоқтатылды, ақша қайтарылды': 'order_refunded',
      'order cancelled and refunded': 'order_refunded',
      'заказ отменён, возврат отправлен': 'order_refunded',
      'тапсырыс тоқтатылды, қайтарым жіберілді': 'order_refunded',
      'order cancelled, refund submitted': 'order_refunded',
    };
    return legacyTitles[normalizedTitle];
  }

  bool get isPushOnlyOrderStatus => const {
    'order_accepted',
    'order_preparing',
    'order_ready',
    'order_completed',
    'order_cancelled',
    'order_refunded',
  }.contains(_systemMessageKey);

  String get _orderNumber {
    final fromPayload = _asString(
      payload['orderNumber'] ?? payload['order_number'],
    ).trim();
    if (fromPayload.isNotEmpty) return fromPayload;
    return RegExp(
          r'[#№]\s*([A-Za-zА-Яа-я0-9-]+)',
        ).firstMatch('$title $body')?.group(1) ??
        '';
  }

  factory AppNotification.fromJson(Map<String, dynamic> json) =>
      AppNotification(
        id: _asString(json['id']),
        title: _asString(json['title']),
        body: _asString(json['body']),
        type: _asString(json['type'], fallback: 'broadcast'),
        payload: _asMap(json['payload']),
        createdAt: _asString(json['created_at'] ?? json['createdAt']),
        isRead: json['is_read'] == true || json['isRead'] == true,
      );
}

class DeliveryLocation {
  const DeliveryLocation({
    required this.city,
    required this.address,
    required this.latitude,
    required this.longitude,
  });

  final String city;
  final String address;
  final double latitude;
  final double longitude;

  String get localizedCity {
    final normalized = city.trim().toLowerCase();
    if ({
      'astana',
      'астана',
      'nur-sultan',
      'нур-султан',
      'нұр-сұлтан',
    }.contains(normalized)) {
      return 'city_astana'.tr;
    }
    return city;
  }

  String get fullAddress => '$localizedCity, $address';
}

class DeliveryAddress {
  const DeliveryAddress({
    required this.id,
    required this.title,
    required this.location,
    required this.house,
    this.entrance,
    this.floor,
    this.apartment,
    this.courierComment,
    this.isDefault = false,
  });

  final String id;
  final String title;
  final DeliveryLocation location;
  final String house;
  final String? entrance;
  final String? floor;
  final String? apartment;
  final String? courierComment;
  final bool isDefault;

  String get streetAddress {
    final parts = <String>[location.address];
    if (house.trim().isNotEmpty) parts.add(house.trim());
    return parts.where((part) => part.trim().isNotEmpty).join(', ');
  }

  String get displayAddress {
    final parts = <String>[location.fullAddress];
    if (house.trim().isNotEmpty) parts.add(house.trim());
    return parts.join(', ');
  }

  bool get hasValidCoordinates =>
      location.latitude >= -90 &&
      location.latitude <= 90 &&
      location.longitude >= -180 &&
      location.longitude <= 180 &&
      !(location.latitude == 0 && location.longitude == 0);

  Map<String, dynamic> toOrderPayload() => {
    'label': title,
    // Keep the geocoded street and customer-entered house in separate
    // fields. Combining them made the house impossible to restore for edit.
    'address': location.address,
    'city': location.city,
    'latitude': location.latitude,
    'longitude': location.longitude,
    'house': house,
    'entrance': entrance,
    'floor': floor,
    'apartment': apartment,
    'comment': courierComment,
  };

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'label': title,
    'city': location.city,
    'address': location.address,
    'latitude': location.latitude,
    'longitude': location.longitude,
    'house': house,
    'entrance': entrance,
    'floor': floor,
    'apartment': apartment,
    'courierComment': courierComment,
    'comment': courierComment,
    'isDefault': isDefault,
  };

  factory DeliveryAddress.fromJson(Map<String, dynamic> json) {
    return DeliveryAddress(
      id: _asString(json['id']),
      title: _asString(json['title'] ?? json['label']),
      location: DeliveryLocation(
        city: _asString(json['city']),
        address: _asString(json['address']),
        latitude: _asDouble(json['latitude']),
        longitude: _asDouble(json['longitude']),
      ),
      house: _asString(json['house']),
      entrance: _nullableString(json['entrance']),
      floor: _nullableString(json['floor']),
      apartment: _nullableString(json['apartment']),
      courierComment: _nullableString(
        json['courierComment'] ?? json['comment'],
      ),
      isDefault: json['isDefault'] == true || json['is_default'] == true,
    );
  }
}

class City {
  final String id;
  final String name;
  final List<Point> points;

  const City({required this.id, required this.name, this.points = const []});

  factory City.fromJson(Map<String, dynamic> json) {
    final pointsList = json['points'] as List?;
    return City(
      id: _asString(json['id']),
      name: _asString(json['name']),
      points: pointsList != null
          ? pointsList.map((p) => Point.fromJson(_asMap(p))).toList()
          : [],
    );
  }
}

class Point {
  final String id;
  final String name;
  final String address;

  const Point({required this.id, required this.name, required this.address});

  factory Point.fromJson(Map<String, dynamic> json) {
    return Point(
      id: _asString(json['id']),
      name: _asString(json['name']),
      address: _asString(json['address']),
    );
  }
}

class BakeryLocation {
  const BakeryLocation({
    required this.id,
    required this.name,
    required this.address,
    required this.city,
    this.phone = '',
    this.twoGisId = '',
    this.latitude,
    this.longitude,
    this.hours = const {},
    this.active = true,
    this.pickupEnabled = true,
    this.preorderEnabled = true,
    this.deliveryEnabled = false,
  });

  final String id;
  final String name;
  final String address;
  final String city;
  final String phone;
  final String twoGisId;
  final double? latitude;
  final double? longitude;
  final Map<String, dynamic> hours;
  final bool active;
  final bool pickupEnabled;
  final bool preorderEnabled;
  final bool deliveryEnabled;

  String get displayLabel =>
      [name.trim(), address.trim()].where((part) => part.isNotEmpty).join(', ');

  bool supports(String orderType) => switch (orderType) {
    'preorder' => preorderEnabled,
    'delivery' => deliveryEnabled,
    _ => pickupEnabled,
  };

  factory BakeryLocation.fromJson(Map<String, dynamic> json) {
    return BakeryLocation(
      id: _asString(json['id']),
      name: _asString(json['name']),
      address: _asString(json['address']),
      city: _asString(json['city']),
      phone: _asString(json['phone']),
      twoGisId: _asString(json['twoGisId'] ?? json['two_gis_id']),
      latitude: _nullableDouble(json['latitude']),
      longitude: _nullableDouble(json['longitude']),
      hours: _asMap(json['hours']),
      active: json['active'] != false,
      pickupEnabled: json['pickupEnabled'] != false,
      preorderEnabled: json['preorderEnabled'] != false,
      deliveryEnabled: json['deliveryEnabled'] == true,
    );
  }
}

Map<String, String> _localizedLabels(
  Map<String, dynamic> json,
  String camelName, {
  String? snakeName,
}) {
  final snake = snakeName ?? camelName;
  final result = <String, String>{};

  void add(String code, Object? value) {
    final text = value is String ? value.trim() : '';
    if (text.isNotEmpty) result[code] = text;
  }

  void addMap(Object? raw) {
    final map = _asMap(raw);
    for (final code in AppLang.supportedCodes) {
      add(code, map[code]);
    }
  }

  addMap(json[camelName]);
  addMap(json[snake]);
  addMap(json['localized_$snake']);
  addMap(json['${camelName}Localized']);
  addMap(json['${camelName}Translations']);
  if (camelName == 'name') addMap(json['names']);

  for (final code in AppLang.supportedCodes) {
    add(code, json['${camelName}_$code']);
    add(code, json['${snake}_$code']);
    final suffix = code[0].toUpperCase() + code.substring(1);
    add(code, json['$camelName$suffix']);
  }

  final translations = _asMap(json['translations']);
  for (final code in AppLang.supportedCodes) {
    final localized = translations[code];
    if (localized is Map) {
      final map = _asMap(localized);
      add(code, map[camelName] ?? map[snake]);
    } else if (camelName == 'name') {
      add(code, localized);
    }
  }
  return Map<String, String>.unmodifiable(result);
}

Map<String, String> _nestedLocalizedValues(
  Map<String, dynamic> json,
  String field,
) {
  final result = Map<String, String>.from(_localizedLabels(json, field));
  final i18n = _asMap(json['i18n']);
  for (final code in AppLang.supportedCodes) {
    final backendCode = code == 'kk' ? 'kz' : code;
    final localized = _asMap(i18n[backendCode]);
    final value = _asString(
      localized[field] ?? (field == 'imageUrl' ? localized['imageurl'] : null),
    ).trim();
    if (value.isNotEmpty) result[code] = value;
  }
  final kazakh = _asString(json['${field}_kz'] ?? json['${field}Kz']).trim();
  if (kazakh.isNotEmpty) result['kk'] = kazakh;
  return Map<String, String>.unmodifiable(result);
}

String _localizedValue(String fallback, Map<String, String> values) {
  final current = values[AppLang.current]?.trim() ?? '';
  if (current.isNotEmpty) return current;
  final russian = values['ru']?.trim() ?? '';
  if (russian.isNotEmpty) return russian;
  if (fallback.trim().isNotEmpty) return fallback.trim();
  for (final code in const ['kk', 'en']) {
    final value = values[code]?.trim() ?? '';
    if (value.isNotEmpty) return value;
  }
  return '';
}

Map<String, dynamic> _localizedContentJson({
  required Map<String, String> titles,
  required Map<String, String> descriptions,
  required Map<String, String> imageUrls,
  Map<String, String> details = const {},
  Map<String, String> contentUrls = const {},
}) {
  final result = <String, dynamic>{};
  for (final code in AppLang.supportedCodes) {
    final values = <String, String>{
      if (titles[code]?.isNotEmpty == true) 'title': titles[code]!,
      if (descriptions[code]?.isNotEmpty == true)
        'description': descriptions[code]!,
      if (details[code]?.isNotEmpty == true) 'details': details[code]!,
      if (imageUrls[code]?.isNotEmpty == true) 'imageUrl': imageUrls[code]!,
      if (contentUrls[code]?.isNotEmpty == true)
        'contentUrl': contentUrls[code]!,
    };
    if (values.isNotEmpty) result[code == 'kk' ? 'kz' : code] = values;
  }
  return result;
}

String _localizedFallback(Object? raw, Map<String, String> names) {
  if (raw is String && raw.trim().isNotEmpty) return raw.trim();
  return names['ru'] ?? names['kk'] ?? names['en'] ?? '';
}
