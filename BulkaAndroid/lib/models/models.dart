part of '../main.dart';

class OtpRequestResult {
  const OtpRequestResult({this.error, this.whatsappUrl, this.whatsappPhone});

  final String? error;
  final String? whatsappUrl;
  final String? whatsappPhone;

  bool get isSuccess => error == null;
}

class ProfileResponse {
  const ProfileResponse({
    required this.success,
    required this.exists,
    required this.customer,
    required this.transactions,
    this.error,
    this.message,
    this.accessToken,
    this.registrationToken,
  });

  final bool success;
  final bool exists;
  final Customer? customer;
  final List<BonusTransaction> transactions;
  final String? error;
  final String? message;
  final String? accessToken;
  final String? registrationToken;

  factory ProfileResponse.fromJson(Map<String, dynamic> json) {
    final transactions = json['transactions'];
    return ProfileResponse(
      success: json['success'] != false,
      exists: json['exists'] == true,
      customer: json['customer'] is Map
          ? Customer.fromJson(_asMap(json['customer']))
          : null,
      transactions: transactions is List
          ? transactions
                .map((item) => BonusTransaction.fromJson(_asMap(item)))
                .toList()
          : const [],
      error: _nullableString(json['error']),
      message: _nullableString(json['message']),
      accessToken: _nullableString(json['accessToken']),
      registrationToken: _nullableString(json['registrationToken']),
    );
  }
}

class Customer {
  const Customer({
    required this.id,
    required this.name,
    required this.phone,
    required this.balance,
    required this.totalSpent,
    required this.createdAt,
    required this.isVip,
    required this.cashbackPercent,
    required this.vipThreshold,
    required this.tier,
    this.lastName,
    this.gender,
    this.birthDate,
    this.email,
    this.region,
    this.emailVerified = false,
  });

  final String id;
  final String name;
  final String phone;
  final double balance;
  final double totalSpent;
  final String createdAt;
  final bool isVip;
  final int cashbackPercent;
  final int vipThreshold;
  final Tier? tier;
  final String? lastName;
  final String? gender;
  final String? birthDate;
  final String? email;
  final String? region;
  final bool emailVerified;

  factory Customer.fromJson(Map<String, dynamic> json) {
    final rawTier =
        json['tier'] ??
        json['loyaltyTier'] ??
        json['loyalty_tier'] ??
        json['loyalty'];
    var tierJson = _asMap(rawTier);
    if (tierJson.isEmpty && rawTier is String && rawTier.trim().isNotEmpty) {
      tierJson = {
        'name': rawTier,
        'percent': json['cashbackPercent'] ?? json['cashback_percent'],
        'progress': json['tierProgress'] ?? json['tier_progress'],
        'level': json['tierLevel'] ?? json['tier_level'],
        'nextTier': json['nextTier'] ?? json['next_tier'],
        'remaining': json['tierRemaining'] ?? json['tier_remaining'],
        'allTiers': json['allTiers'] ?? json['all_tiers'] ?? json['tiers'],
      };
    }
    final parsedTier = tierJson.isEmpty ? null : Tier.fromJson(tierJson);
    return Customer(
      id: _asString(json['id']),
      name: _asString(json['name']),
      phone: _asString(json['phone']),
      balance: _asDouble(json['balance']),
      totalSpent: _asDouble(
        json['total_spent'] ?? json['totalSpent'] ?? json['lifetimeSpent'],
      ),
      createdAt: _asString(json['created_at'] ?? json['createdAt']),
      isVip: json['isVip'] == true || json['is_vip'] == true,
      cashbackPercent: _asInt(
        json['cashbackPercent'] ??
            json['cashback_percent'] ??
            parsedTier?.percent,
      ),
      vipThreshold: _asInt(json['vipThreshold'] ?? json['vip_threshold']),
      tier: parsedTier,
      lastName: _nullableString(json['last_name'] ?? json['lastName']),
      gender: _nullableString(json['gender']),
      birthDate: _nullableString(json['birth_date'] ?? json['birthdate']),
      email: _nullableString(json['email']),
      region: _nullableString(json['region']),
      emailVerified:
          json['emailVerified'] == true || json['email_verified'] == true,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'phone': phone,
    'balance': balance,
    'total_spent': totalSpent,
    'created_at': createdAt,
    'isVip': isVip,
    'cashbackPercent': cashbackPercent,
    'vipThreshold': vipThreshold,
    'tier': tier?.toJson(),
    'last_name': lastName,
    'gender': gender,
    'birth_date': birthDate,
    'email': email,
    'region': region,
  };

  Customer copyWith({Tier? tier}) {
    return Customer(
      id: id,
      name: name,
      phone: phone,
      balance: balance,
      totalSpent: totalSpent,
      createdAt: createdAt,
      isVip: isVip,
      cashbackPercent: tier?.percent ?? cashbackPercent,
      vipThreshold: vipThreshold,
      tier: tier ?? this.tier,
      lastName: lastName,
      gender: gender,
      birthDate: birthDate,
      email: email,
      region: region,
      emailVerified: emailVerified,
    );
  }
}

class TierItem {
  const TierItem({
    required this.name,
    required this.percent,
    this.threshold = 0,
    this.localizedNames = const {},
  });
  final String name;
  final int percent;
  final double threshold;
  final Map<String, String> localizedNames;

  String get localizedName =>
      localizedNames[AppLang.current] ?? localizeTierName(name);

  factory TierItem.fromJson(Map<String, dynamic> json) {
    final names = _localizedLabels(json, 'name');
    return TierItem(
      name: _localizedFallback(json['name'], names),
      percent: _asInt(
        json['percent'] ?? json['cashbackPercent'] ?? json['cashback_percent'],
      ),
      threshold: _asDouble(
        json['threshold'] ??
            json['minSpend'] ??
            json['min_spend'] ??
            json['minSpent'] ??
            json['min_spent'],
      ),
      localizedNames: names,
    );
  }

  Map<String, dynamic> toJson() => {
    'name': name,
    'percent': percent,
    'threshold': threshold,
    for (final entry in localizedNames.entries)
      'name_${entry.key}': entry.value,
  };
}

class Tier {
  const Tier({
    required this.name,
    required this.percent,
    required this.remaining,
    required this.progress,
    this.level = 1,
    this.allTiers = const [],
    this.nextTier,
    this.nextTh,
    this.nextPercent,
    this.localizedNames = const {},
    this.localizedNextTierNames = const {},
  });

  final String name;
  final int percent;
  final String? nextTier;
  final int? nextTh;
  final int? nextPercent;
  final double remaining;
  final double progress;
  final int level;
  final List<TierItem> allTiers;
  final Map<String, String> localizedNames;
  final Map<String, String> localizedNextTierNames;

  String get localizedName =>
      localizedNames[AppLang.current] ?? localizeTierName(name);

  String? get localizedNextTier {
    final translated = localizedNextTierNames[AppLang.current];
    if (translated != null && translated.trim().isNotEmpty) return translated;
    final value = nextTier?.trim();
    return value == null || value.isEmpty ? null : localizeTierName(value);
  }

  double get progressFraction {
    if (!progress.isFinite) return 0;
    return (progress > 1 ? progress / 100 : progress).clamp(0, 1);
  }

  factory Tier.fromJson(Map<String, dynamic> json) {
    final currentTier = _asMap(json['currentTier'] ?? json['current_tier']);
    final source = currentTier.isEmpty ? json : {...json, ...currentTier};
    final rawList =
        json['allTiers'] ??
        json['all_tiers'] ??
        json['tiers'] ??
        json['levels'];
    final list = rawList is List
        ? rawList
              .map(
                (e) => e is Map
                    ? TierItem.fromJson(_asMap(e))
                    : const TierItem(name: '', percent: 0),
              )
              .where((e) => e.name.isNotEmpty)
              .toList()
        : const <TierItem>[];
    final names = _localizedLabels(source, 'name');
    final rawNext =
        source['nextTierInfo'] ??
        source['next_tier_info'] ??
        source['nextTier'] ??
        source['next_tier'];
    final nextJson = _asMap(rawNext);
    final nextNames = nextJson.isNotEmpty
        ? _localizedLabels(nextJson, 'name')
        : _localizedLabels(source, 'nextTier', snakeName: 'next_tier');
    final rawProgress = source['progress'];
    final progressJson = _asMap(rawProgress);

    return Tier(
      name: _localizedFallback(source['name'], names),
      percent: _asInt(
        source['percent'] ??
            source['cashbackPercent'] ??
            source['cashback_percent'],
      ),
      nextTier: nextJson.isNotEmpty
          ? _localizedFallback(nextJson['name'], nextNames)
          : _nullableString(rawNext),
      nextTh: _nullableInt(
        source['nextTh'] ?? source['next_th'] ?? source['nextThreshold'],
      ),
      nextPercent: nextJson.isEmpty
          ? null
          : _nullableInt(
              nextJson['percent'] ??
                  nextJson['cashbackPercent'] ??
                  nextJson['cashback_percent'],
            ),
      remaining: _asDouble(
        source['remaining'] ??
            source['amountToNext'] ??
            source['amount_to_next'] ??
            source['spendRemaining'],
      ),
      progress: _asDouble(
        progressJson['percent'] ??
            progressJson['value'] ??
            rawProgress ??
            source['progressPercent'] ??
            source['progress_percent'],
      ),
      level: _asInt(
        source['level'] ?? source['currentLevel'] ?? source['current_level'],
        fallback: 1,
      ),
      allTiers: list,
      localizedNames: names,
      localizedNextTierNames: nextNames,
    );
  }

  Map<String, dynamic> toJson() => {
    'name': name,
    'percent': percent,
    'nextTier': nextTier,
    'nextTh': nextTh,
    'nextPercent': nextPercent,
    'remaining': remaining,
    'progress': progress,
    'level': level,
    'allTiers': allTiers.map((e) => e.toJson()).toList(),
    for (final entry in localizedNames.entries)
      'name_${entry.key}': entry.value,
    for (final entry in localizedNextTierNames.entries)
      'next_tier_${entry.key}': entry.value,
  };
}

class BonusTransaction {
  const BonusTransaction({
    required this.id,
    required this.customerId,
    required this.type,
    required this.amount,
    required this.timestamp,
    this.orderId,
    this.orderTotal,
    this.items,
  });

  final String id;
  final String customerId;
  final String? orderId;
  final String type;
  final double amount;
  final double? orderTotal;
  final String timestamp;
  final List<dynamic>? items;

  bool get isEarning => const {
    'deposit',
    'manual_deposit',
    'earning',
  }.contains(type.toLowerCase());

  String get label {
    return localizeTransactionType(type, isEarning: isEarning);
  }

  factory BonusTransaction.fromJson(Map<String, dynamic> json) {
    return BonusTransaction(
      id: _asString(json['id']),
      customerId: _asString(json['customer_id'] ?? json['customerId']),
      orderId: _nullableString(json['order_id'] ?? json['orderId']),
      type: _asString(json['type']),
      amount: _asDouble(json['amount']),
      orderTotal: _nullableDouble(json['order_total'] ?? json['orderTotal']),
      timestamp: _asString(json['timestamp']),
      items: json['items'] != null ? List<dynamic>.from(json['items']) : null,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'customer_id': customerId,
    'order_id': orderId,
    'type': type,
    'amount': amount,
    'order_total': orderTotal,
    'timestamp': timestamp,
    'items': items,
  };
}

class CustomerOrder {
  const CustomerOrder({
    required this.id,
    required this.number,
    required this.paymentStatus,
    required this.orderStatus,
    required this.amount,
    required this.subtotal,
    required this.discount,
    required this.branch,
    required this.items,
    required this.earnedBonus,
    required this.createdAt,
    this.pickupTime,
    this.comment,
    this.cancellationReason,
    this.refundStatus,
    this.refundAmount,
    this.refundedAt,
  });

  final String id;
  final int number;
  final String paymentStatus;
  final String orderStatus;
  final int amount;
  final int subtotal;
  final int discount;
  final String branch;
  final List<Map<String, dynamic>> items;
  final int earnedBonus;
  final DateTime createdAt;
  final DateTime? pickupTime;
  final String? comment;
  final String? cancellationReason;
  final String? refundStatus;
  final int? refundAmount;
  final DateTime? refundedAt;

  factory CustomerOrder.fromJson(Map<String, dynamic> json) {
    final rawItems = json['items'];
    return CustomerOrder(
      id: _asString(json['id']),
      number: _asInt(json['number']),
      paymentStatus: _asString(json['paymentStatus']),
      orderStatus: _asString(json['orderStatus']),
      amount: _asDouble(json['amount']).round(),
      subtotal: _asDouble(json['subtotal']).round(),
      discount: _asDouble(json['discount']).round(),
      branch: _asString(json['branch']),
      items: rawItems is List
          ? rawItems.map((item) => _asMap(item)).toList()
          : const [],
      earnedBonus: _asDouble(json['earnedBonus']).round(),
      createdAt:
          DateTime.tryParse(_asString(json['createdAt'])) ?? DateTime.now(),
      pickupTime: DateTime.tryParse(_asString(json['pickupTime'])),
      comment: _nullableString(json['comment']),
      cancellationReason: _nullableString(json['cancellationReason']),
      refundStatus: _nullableString(json['refundStatus']),
      refundAmount: _nullableInt(json['refundAmount']),
      refundedAt: DateTime.tryParse(_asString(json['refundedAt'])),
    );
  }
}

class PromoStory {
  const PromoStory({
    required this.id,
    required this.title,
    required this.imageUrl,
    required this.contentUrl,
    required this.groupId,
    required this.groupTitle,
    required this.groupCoverUrl,
    this.sortOrder = 0,
    this.description,
    this.duration = 15,
  });

  final int id;
  final String title;
  final String imageUrl;
  final String contentUrl;
  final String groupId;
  final String groupTitle;
  final String groupCoverUrl;
  final int sortOrder;
  final String? description;
  final int duration;

  factory PromoStory.fromJson(Map<String, dynamic> json) {
    final image = _asString(json['coverUrl'] ?? json['cover_url']);
    final id = _asInt(json['id']);
    final title = _asString(json['title']);
    return PromoStory(
      id: id,
      title: title,
      imageUrl: image,
      contentUrl: _asString(
        json['contentUrl'] ?? json['content_url'],
        fallback: image,
      ),
      groupId: _asString(
        json['groupId'] ?? json['group_id'] ?? json['groupid'],
        fallback: id.toString(),
      ),
      groupTitle: _asString(
        json['groupTitle'] ?? json['group_title'] ?? json['grouptitle'],
        fallback: title,
      ),
      groupCoverUrl: _asString(
        json['groupCoverUrl'] ??
            json['group_coverurl'] ??
            json['group_cover_url'],
        fallback: image,
      ),
      sortOrder: _asInt(json['sortOrder'] ?? json['sort_order']),
      description: _nullableString(json['description']),
      duration: _asInt(json['duration'], fallback: 15),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'coverUrl': imageUrl,
    'contentUrl': contentUrl,
    'groupId': groupId,
    'groupTitle': groupTitle,
    'groupCoverUrl': groupCoverUrl,
    'sortOrder': sortOrder,
    'description': description,
    'duration': duration,
  };
}

class NewsItem {
  const NewsItem({
    required this.id,
    required this.title,
    required this.imageUrl,
    this.createdAt,
    this.description,
  });

  final int id;
  final String title;
  final String imageUrl;
  final String? createdAt;
  final String? description;

  factory NewsItem.fromJson(Map<String, dynamic> json) {
    return NewsItem(
      id: _asInt(json['id']),
      title: _asString(json['title']),
      imageUrl: _asString(
        json['imageUrl'] ?? json['imageurl'] ?? json['image_url'],
      ),
      createdAt: _nullableString(json['created_at'] ?? json['createdAt']),
      description: _nullableString(json['description']),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'imageUrl': imageUrl,
    'createdAt': createdAt,
    'description': description,
  };
}

class AppNotification {
  const AppNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.createdAt,
    required this.isRead,
    this.type = 'broadcast',
  });

  final String id;
  final String title;
  final String body;
  final String createdAt;
  final bool isRead;
  final String type;

  factory AppNotification.fromJson(Map<String, dynamic> json) =>
      AppNotification(
        id: _asString(json['id']),
        title: _asString(json['title']),
        body: _asString(json['body']),
        type: _asString(json['type'], fallback: 'broadcast'),
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
    if ({'aktau', 'актау', 'ақтау'}.contains(normalized)) {
      return 'city_aktau'.tr;
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
    'address': streetAddress,
    'city': location.city,
    'latitude': location.latitude,
    'longitude': location.longitude,
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

class DeliveryZone {
  const DeliveryZone({
    required this.id,
    required this.radiusKm,
    required this.fee,
    required this.minOrder,
    required this.color,
  });

  final String id;
  final double radiusKm;
  final int fee;
  final int minOrder;
  final String color;

  factory DeliveryZone.fromJson(Map<String, dynamic> json, int index) =>
      DeliveryZone(
        id: _asString(json['id'], fallback: 'zone-${index + 1}'),
        radiusKm: _asDouble(json['radiusKm'] ?? json['radius_km']),
        fee: _asInt(json['fee']),
        minOrder: _asInt(json['minOrder'] ?? json['min_order']),
        color: _asString(
          json['color'],
          fallback: const [
            '#66BB6A',
            '#29B6F6',
            '#FFD54F',
            '#EC407A',
            '#7E57C2',
          ][index % 5],
        ),
      );
}

class BakeryLocation {
  const BakeryLocation({
    required this.id,
    required this.name,
    required this.address,
    required this.city,
    this.latitude,
    this.longitude,
    this.hours = const {},
    this.active = true,
    this.pickupEnabled = true,
    this.preorderEnabled = true,
    this.deliveryEnabled = false,
    this.deliveryRadiusKm,
    this.deliveryFee,
    this.deliveryMinOrder,
    this.deliveryZones = const [],
  });

  final String id;
  final String name;
  final String address;
  final String city;
  final double? latitude;
  final double? longitude;
  final Map<String, dynamic> hours;
  final bool active;
  final bool pickupEnabled;
  final bool preorderEnabled;
  final bool deliveryEnabled;
  final double? deliveryRadiusKm;
  final int? deliveryFee;
  final int? deliveryMinOrder;
  final List<DeliveryZone> deliveryZones;

  String get displayLabel =>
      [name.trim(), address.trim()].where((part) => part.isNotEmpty).join(', ');

  bool supports(String orderType) => switch (orderType) {
    'preorder' => preorderEnabled,
    'delivery' => deliveryEnabled,
    _ => pickupEnabled,
  };

  factory BakeryLocation.fromJson(Map<String, dynamic> json) {
    final rawZones = json['deliveryZones'] ?? json['delivery_zones'];
    final zones = rawZones is List
        ? rawZones.indexed
              .map((entry) => DeliveryZone.fromJson(_asMap(entry.$2), entry.$1))
              .where((zone) => zone.radiusKm > 0)
              .toList()
        : <DeliveryZone>[];
    final legacyRadius = _nullableDouble(
      json['deliveryRadiusKm'] ?? json['delivery_radius_km'],
    );
    final legacyFee = _nullableInt(json['deliveryFee'] ?? json['delivery_fee']);
    final legacyMinimum = _nullableInt(
      json['deliveryMinOrder'] ?? json['delivery_min_order'],
    );
    return BakeryLocation(
      id: _asString(json['id']),
      name: _asString(json['name']),
      address: _asString(json['address']),
      city: _asString(json['city']),
      latitude: _nullableDouble(json['latitude']),
      longitude: _nullableDouble(json['longitude']),
      hours: _asMap(json['hours']),
      active: json['active'] != false,
      pickupEnabled: json['pickupEnabled'] != false,
      preorderEnabled: json['preorderEnabled'] != false,
      deliveryEnabled: json['deliveryEnabled'] == true,
      deliveryRadiusKm: legacyRadius,
      deliveryFee: legacyFee,
      deliveryMinOrder: legacyMinimum,
      deliveryZones: zones.isNotEmpty
          ? zones
          : legacyRadius != null &&
                legacyRadius > 0 &&
                legacyFee != null &&
                legacyMinimum != null
          ? [
              DeliveryZone(
                id: 'zone-1',
                radiusKm: legacyRadius,
                fee: legacyFee,
                minOrder: legacyMinimum,
                color: '#66BB6A',
              ),
            ]
          : const [],
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

String _localizedFallback(Object? raw, Map<String, String> names) {
  if (raw is String && raw.trim().isNotEmpty) return raw.trim();
  return names['ru'] ?? names['kk'] ?? names['en'] ?? '';
}
