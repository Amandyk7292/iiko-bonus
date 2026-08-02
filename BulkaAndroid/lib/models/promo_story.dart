part of '../main.dart';

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
