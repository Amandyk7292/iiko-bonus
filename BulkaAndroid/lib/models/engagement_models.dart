part of '../main.dart';

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
