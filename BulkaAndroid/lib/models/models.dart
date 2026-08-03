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
    this.refreshToken,
    this.refreshExpiresAt,
    this.registrationToken,
  });

  final bool success;
  final bool exists;
  final Customer? customer;
  final List<BonusTransaction> transactions;
  final String? error;
  final String? message;
  final String? accessToken;
  final String? refreshToken;
  final String? refreshExpiresAt;
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
      refreshToken: _nullableString(json['refreshToken']),
      refreshExpiresAt: _nullableString(json['refreshExpiresAt']),
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
    this.avatarKey,
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
  final String? avatarKey;
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
      avatarKey: _nullableString(json['avatar_key'] ?? json['avatarKey']),
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
    'avatar_key': avatarKey,
    'email_verified': emailVerified,
  };

  Customer copyWith({Tier? tier, String? avatarKey}) {
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
      avatarKey: avatarKey ?? this.avatarKey,
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

class BonusExpiryBucket {
  const BonusExpiryBucket({
    required this.expiresAt,
    required this.amount,
    required this.daysRemaining,
  });

  final DateTime expiresAt;
  final double amount;
  final int daysRemaining;

  factory BonusExpiryBucket.fromJson(Map<String, dynamic> json) {
    return BonusExpiryBucket(
      expiresAt:
          DateTime.tryParse(_asString(json['expiresAt'])) ?? DateTime.now(),
      amount: _asDouble(json['amount']),
      daysRemaining: _asInt(json['daysRemaining']),
    );
  }
}

class BonusExpirySummary {
  const BonusExpirySummary({
    required this.currentBalance,
    required this.totalExpiring,
    required this.buckets,
    this.nextExpiryAt,
  });

  final double currentBalance;
  final double totalExpiring;
  final DateTime? nextExpiryAt;
  final List<BonusExpiryBucket> buckets;

  factory BonusExpirySummary.fromJson(Map<String, dynamic> json) {
    return BonusExpirySummary(
      currentBalance: _asDouble(json['currentBalance']),
      totalExpiring: _asDouble(json['totalExpiring']),
      nextExpiryAt: DateTime.tryParse(_asString(json['nextExpiryAt'])),
      buckets: (json['buckets'] as List? ?? const [])
          .map((item) => BonusExpiryBucket.fromJson(_asMap(item)))
          .toList(growable: false),
    );
  }
}

class StockSubscription {
  const StockSubscription({
    required this.id,
    required this.productId,
    required this.branchId,
    required this.status,
    required this.createdAt,
    this.notifiedAt,
  });

  final String id;
  final String productId;
  final String branchId;
  final String status;
  final DateTime createdAt;
  final DateTime? notifiedAt;

  factory StockSubscription.fromJson(Map<String, dynamic> json) {
    return StockSubscription(
      id: _asString(json['id']),
      productId: _asString(json['productId']),
      branchId: _asString(json['branchId']),
      status: _asString(json['status'], fallback: 'active'),
      createdAt:
          DateTime.tryParse(_asString(json['createdAt'])) ?? DateTime.now(),
      notifiedAt: DateTime.tryParse(_asString(json['notifiedAt'])),
    );
  }
}

class OrderCourier {
  const OrderCourier({
    required this.id,
    required this.name,
    required this.phone,
    this.vehicle,
    this.latitude,
    this.longitude,
    this.locationUpdatedAt,
  });

  final String id;
  final String name;
  final String phone;
  final String? vehicle;
  final double? latitude;
  final double? longitude;
  final DateTime? locationUpdatedAt;

  factory OrderCourier.fromJson(Map<String, dynamic> json) => OrderCourier(
    id: _asString(json['id']),
    name: _asString(json['name']),
    phone: _asString(json['phone']),
    vehicle: _nullableString(json['vehicle']),
    latitude: _nullableDouble(json['latitude']),
    longitude: _nullableDouble(json['longitude']),
    locationUpdatedAt: DateTime.tryParse(_asString(json['locationUpdatedAt'])),
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'phone': phone,
    'vehicle': vehicle,
    'latitude': latitude,
    'longitude': longitude,
    'locationUpdatedAt': locationUpdatedAt?.toUtc().toIso8601String(),
  };
}

class NotificationPreferences {
  const NotificationPreferences({
    this.ordersEnabled = true,
    this.bonusEnabled = true,
    this.promosEnabled = true,
    this.supportEnabled = true,
    this.quietHoursEnabled = false,
    this.quietStart = '22:00',
    this.quietEnd = '08:00',
    this.timezone = 'Asia/Aqtau',
  });

  final bool ordersEnabled;
  final bool bonusEnabled;
  final bool promosEnabled;
  final bool supportEnabled;
  final bool quietHoursEnabled;
  final String quietStart;
  final String quietEnd;
  final String timezone;

  factory NotificationPreferences.fromJson(Map<String, dynamic> json) =>
      NotificationPreferences(
        ordersEnabled: json['ordersEnabled'] != false,
        bonusEnabled: json['bonusEnabled'] != false,
        promosEnabled: json['promosEnabled'] != false,
        supportEnabled: json['supportEnabled'] != false,
        quietHoursEnabled: json['quietHoursEnabled'] == true,
        quietStart: _asString(json['quietStart'], fallback: '22:00'),
        quietEnd: _asString(json['quietEnd'], fallback: '08:00'),
        timezone: _asString(json['timezone'], fallback: 'Asia/Aqtau'),
      );

  NotificationPreferences copyWith({
    bool? ordersEnabled,
    bool? bonusEnabled,
    bool? promosEnabled,
    bool? supportEnabled,
    bool? quietHoursEnabled,
    String? quietStart,
    String? quietEnd,
    String? timezone,
  }) => NotificationPreferences(
    ordersEnabled: ordersEnabled ?? this.ordersEnabled,
    bonusEnabled: bonusEnabled ?? this.bonusEnabled,
    promosEnabled: promosEnabled ?? this.promosEnabled,
    supportEnabled: supportEnabled ?? this.supportEnabled,
    quietHoursEnabled: quietHoursEnabled ?? this.quietHoursEnabled,
    quietStart: quietStart ?? this.quietStart,
    quietEnd: quietEnd ?? this.quietEnd,
    timezone: timezone ?? this.timezone,
  );

  Map<String, dynamic> toJson() => {
    'ordersEnabled': ordersEnabled,
    'bonusEnabled': bonusEnabled,
    'promosEnabled': promosEnabled,
    'supportEnabled': supportEnabled,
    'quietHoursEnabled': quietHoursEnabled,
    'quietStart': quietStart,
    'quietEnd': quietEnd,
    'timezone': timezone,
  };
}

class SupportAttachment {
  const SupportAttachment({required this.path, this.url});
  final String path;
  final String? url;

  factory SupportAttachment.fromJson(Map<String, dynamic> json) =>
      SupportAttachment(
        path: _asString(json['path']),
        url: _nullableString(json['url']),
      );
}

class SupportRequest {
  const SupportRequest({
    required this.id,
    required this.category,
    required this.message,
    required this.status,
    required this.refundRequested,
    required this.attachments,
    required this.createdAt,
    this.orderId,
    this.orderNumber,
    this.resolution,
  });

  final String id;
  final String? orderId;
  final int? orderNumber;
  final String category;
  final String message;
  final String status;
  final bool refundRequested;
  final List<SupportAttachment> attachments;
  final String? resolution;
  final DateTime createdAt;

  factory SupportRequest.fromJson(Map<String, dynamic> json) => SupportRequest(
    id: _asString(json['id']),
    orderId: _nullableString(json['orderId']),
    orderNumber: _nullableInt(json['orderNumber']),
    category: _asString(json['category'], fallback: 'other'),
    message: _asString(json['message']),
    status: _asString(json['status'], fallback: 'new'),
    refundRequested: json['refundRequested'] == true,
    attachments: (json['attachments'] as List? ?? const [])
        .map((item) => SupportAttachment.fromJson(_asMap(item)))
        .toList(),
    resolution: _nullableString(json['resolution']),
    createdAt:
        DateTime.tryParse(_asString(json['createdAt'])) ?? DateTime.now(),
  );
}

class SupportMessage {
  const SupportMessage({
    required this.id,
    required this.requestId,
    required this.senderType,
    required this.body,
    required this.attachments,
    required this.createdAt,
  });

  final String id;
  final String requestId;
  final String senderType;
  final String body;
  final List<SupportAttachment> attachments;
  final DateTime createdAt;

  bool get fromCustomer => senderType == 'customer';

  factory SupportMessage.fromJson(Map<String, dynamic> json) => SupportMessage(
    id: _asString(json['id']),
    requestId: _asString(json['requestId']),
    senderType: _asString(json['senderType'], fallback: 'system'),
    body: _asString(json['body']),
    attachments: (json['attachments'] as List? ?? const [])
        .map((item) => SupportAttachment.fromJson(_asMap(item)))
        .toList(),
    createdAt:
        DateTime.tryParse(_asString(json['createdAt'])) ?? DateTime.now(),
  );
}

class SupportThread {
  const SupportThread({required this.request, required this.messages});

  final SupportRequest request;
  final List<SupportMessage> messages;

  factory SupportThread.fromJson(Map<String, dynamic> json) {
    final request = _asMap(json['request']);
    final messages = json['messages'];
    if (request.isEmpty || messages is! List) {
      throw ApiException('error_network'.tr);
    }
    return SupportThread(
      request: SupportRequest.fromJson(request),
      messages: messages
          .map((item) => SupportMessage.fromJson(_asMap(item)))
          .toList(),
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
    this.details,
    this.duration = 15,
    this.promoType = 'promotion',
    this.startsAt,
    this.endsAt,
    this.remaining,
    this.qrValue,
    this.createdAt,
    this.localizedTitles = const {},
    this.localizedDescriptions = const {},
    this.localizedDetails = const {},
    this.localizedCoverUrls = const {},
    this.localizedContentUrls = const {},
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
  final String? details;
  final int duration;
  final String promoType;
  final String? startsAt;
  final String? endsAt;
  final int? remaining;
  final String? qrValue;
  final String? createdAt;
  final Map<String, String> localizedTitles;
  final Map<String, String> localizedDescriptions;
  final Map<String, String> localizedDetails;
  final Map<String, String> localizedCoverUrls;
  final Map<String, String> localizedContentUrls;

  String get localizedTitle => _localizedValue(title, localizedTitles);
  String? get localizedDescription {
    final value = _localizedValue(description ?? '', localizedDescriptions);
    return value.isEmpty ? null : value;
  }

  String? get localizedLongDescription {
    final value = _localizedValue(
      details ?? description ?? '',
      localizedDetails,
    );
    return value.isEmpty ? localizedDescription : value;
  }

  String get localizedImageUrl => _localizedValue(imageUrl, localizedCoverUrls);
  String get localizedContentUrl =>
      _localizedValue(contentUrl, localizedContentUrls);
  String get localizedGroupTitle =>
      _localizedValue(groupTitle, localizedTitles);
  String get localizedGroupCoverUrl =>
      _localizedValue(groupCoverUrl, localizedCoverUrls);

  factory PromoStory.fromJson(Map<String, dynamic> json) {
    final image = _asString(json['coverUrl'] ?? json['cover_url']);
    final id = _asInt(json['id']);
    final title = _asString(json['title']);
    final localizedTitles = _nestedLocalizedValues(json, 'title');
    final localizedDescriptions = _nestedLocalizedValues(json, 'description');
    final localizedDetails = _nestedLocalizedValues(json, 'details');
    final localizedCoverUrls = _nestedLocalizedValues(json, 'coverUrl');
    final localizedContentUrls = _nestedLocalizedValues(json, 'contentUrl');
    final rawType = _asString(
      json['promoType'] ?? json['promo_type'],
      fallback: 'promotion',
    ).trim();
    const supportedTypes = {'discount', 'promotion', 'subscription'};
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
      details: _nullableString(json['details']),
      duration: _asInt(json['duration'], fallback: 15),
      promoType: supportedTypes.contains(rawType) ? rawType : 'promotion',
      startsAt: _nullableString(json['startsAt'] ?? json['starts_at']),
      endsAt: _nullableString(json['endsAt'] ?? json['ends_at']),
      remaining: _nullableInt(json['remaining']),
      qrValue: _nullableString(json['qrValue'] ?? json['qr_value']),
      createdAt: _nullableString(json['createdAt'] ?? json['created_at']),
      localizedTitles: localizedTitles,
      localizedDescriptions: localizedDescriptions,
      localizedDetails: localizedDetails,
      localizedCoverUrls: localizedCoverUrls,
      localizedContentUrls: localizedContentUrls,
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
    'details': details,
    'duration': duration,
    'promoType': promoType,
    'startsAt': startsAt,
    'endsAt': endsAt,
    'remaining': remaining,
    'qrValue': qrValue,
    'createdAt': createdAt,
    'i18n': _localizedContentJson(
      titles: localizedTitles,
      descriptions: localizedDescriptions,
      details: localizedDetails,
      imageUrls: localizedCoverUrls,
      contentUrls: localizedContentUrls,
    ),
  };
}

class NewsItem {
  const NewsItem({
    required this.id,
    required this.title,
    required this.imageUrl,
    this.createdAt,
    this.description,
    this.localizedTitles = const {},
    this.localizedDescriptions = const {},
    this.localizedImageUrls = const {},
  });

  final int id;
  final String title;
  final String imageUrl;
  final String? createdAt;
  final String? description;
  final Map<String, String> localizedTitles;
  final Map<String, String> localizedDescriptions;
  final Map<String, String> localizedImageUrls;

  String get localizedTitle => _localizedValue(title, localizedTitles);
  String get localizedImageUrl => _localizedValue(imageUrl, localizedImageUrls);
  String? get localizedDescription {
    final value = _localizedValue(description ?? '', localizedDescriptions);
    return value.isEmpty ? null : value;
  }

  factory NewsItem.fromJson(Map<String, dynamic> json) {
    return NewsItem(
      id: _asInt(json['id']),
      title: _asString(json['title']),
      imageUrl: _asString(
        json['imageUrl'] ?? json['imageurl'] ?? json['image_url'],
      ),
      createdAt: _nullableString(json['created_at'] ?? json['createdAt']),
      description: _nullableString(json['description']),
      localizedTitles: _nestedLocalizedValues(json, 'title'),
      localizedDescriptions: _nestedLocalizedValues(json, 'description'),
      localizedImageUrls: _nestedLocalizedValues(json, 'imageUrl'),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'imageUrl': imageUrl,
    'createdAt': createdAt,
    'description': description,
    'i18n': _localizedContentJson(
      titles: localizedTitles,
      descriptions: localizedDescriptions,
      imageUrls: localizedImageUrls,
    ),
  };
}

class AppContactAction {
  const AppContactAction({
    required this.id,
    required this.type,
    required this.labels,
    required this.target,
    required this.iconKey,
  });

  final String id;
  final String type;
  final Map<String, String> labels;
  final String target;
  final String iconKey;

  factory AppContactAction.fromJson(Map<String, dynamic> json) {
    final rawLabels = _asMap(json['labels']);
    return AppContactAction(
      id: _asString(json['id']),
      type: _asString(json['type']),
      labels: {
        'ru': _asString(rawLabels['ru']),
        'kk': _asString(rawLabels['kk']),
        'en': _asString(rawLabels['en']),
      },
      target: _asString(json['target']),
      iconKey: _asString(json['iconKey'], fallback: 'link'),
    );
  }

  String labelFor(String language) {
    final localized = labels[language]?.trim() ?? '';
    if (localized.isNotEmpty) return localized;
    return labels['ru']?.trim() ?? '';
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'type': type,
    'labels': labels,
    'target': target,
    'iconKey': iconKey,
  };
}

class AppContactCard {
  const AppContactCard({
    required this.id,
    required this.displayMode,
    required this.titles,
    required this.iconKey,
    required this.actions,
  });

  final String id;
  final String displayMode;
  final Map<String, String> titles;
  final String iconKey;
  final List<AppContactAction> actions;

  bool get isCompact => displayMode == 'compact';

  factory AppContactCard.fromJson(Map<String, dynamic> json) {
    final rawTitles = _asMap(json['titles']);
    return AppContactCard(
      id: _asString(json['id']),
      displayMode: _asString(json['displayMode'], fallback: 'standard'),
      titles: {
        'ru': _asString(rawTitles['ru']),
        'kk': _asString(rawTitles['kk']),
        'en': _asString(rawTitles['en']),
      },
      iconKey: _asString(json['iconKey'], fallback: 'bulka'),
      actions: (json['actions'] as List? ?? const [])
          .map((item) => AppContactAction.fromJson(_asMap(item)))
          .where((action) => action.id.isNotEmpty)
          .toList(growable: false),
    );
  }

  String titleFor(String language) {
    final localized = titles[language]?.trim() ?? '';
    if (localized.isNotEmpty) return localized;
    return titles['ru']?.trim() ?? '';
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'displayMode': displayMode,
    'titles': titles,
    'iconKey': iconKey,
    'actions': actions.map((action) => action.toJson()).toList(),
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

  double? get deliveryOuterRadiusKm {
    if (deliveryZones.isNotEmpty) {
      return deliveryZones
          .map((zone) => zone.radiusKm)
          .reduce((first, second) => max(first, second));
    }
    return deliveryRadiusKm;
  }

  DeliveryZone? deliveryZoneForDistance(double distanceKm) {
    if (!distanceKm.isFinite || distanceKm < 0) return null;
    final ordered = [...deliveryZones]
      ..sort((first, second) => first.radiusKm.compareTo(second.radiusKm));
    for (final zone in ordered) {
      if (distanceKm <= zone.radiusKm) return zone;
    }
    return null;
  }

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
