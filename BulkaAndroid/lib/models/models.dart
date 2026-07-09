part of '../main.dart';

class ProfileResponse {
  const ProfileResponse({
    required this.success,
    required this.exists,
    required this.customer,
    required this.transactions,
    this.error,
    this.message,
  });

  final bool success;
  final bool exists;
  final Customer? customer;
  final List<BonusTransaction> transactions;
  final String? error;
  final String? message;

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
    return Customer(
      id: _asString(json['id']),
      name: _asString(json['name'], fallback: 'Гость'),
      phone: _asString(json['phone']),
      balance: _asDouble(json['balance']),
      totalSpent: _asDouble(json['total_spent'] ?? json['totalSpent']),
      createdAt: _asString(json['created_at'] ?? json['createdAt']),
      isVip: json['isVip'] == true || json['is_vip'] == true,
      cashbackPercent: _asInt(
        json['cashbackPercent'] ?? json['cashback_percent'],
      ),
      vipThreshold: _asInt(json['vipThreshold'] ?? json['vip_threshold']),
      tier: json['tier'] is Map ? Tier.fromJson(_asMap(json['tier'])) : null,
      lastName: _nullableString(json['last_name'] ?? json['lastName']),
      gender: _nullableString(json['gender']),
      birthDate: _nullableString(json['birth_date'] ?? json['birthdate']),
      email: _nullableString(json['email']),
      region: _nullableString(json['region']),
      emailVerified: json['emailVerified'] == true || json['email_verified'] == true,
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
}

class Tier {
  const Tier({
    required this.name,
    required this.percent,
    required this.remaining,
    required this.progress,
    this.nextTier,
    this.nextTh,
  });

  final String name;
  final int percent;
  final String? nextTier;
  final int? nextTh;
  final double remaining;
  final double progress;

  factory Tier.fromJson(Map<String, dynamic> json) {
    return Tier(
      name: _asString(json['name']),
      percent: _asInt(json['percent']),
      nextTier: _nullableString(json['nextTier'] ?? json['next_tier']),
      nextTh: _nullableInt(json['nextTh'] ?? json['next_th']),
      remaining: _asDouble(json['remaining']),
      progress: _asDouble(json['progress']),
    );
  }

  Map<String, dynamic> toJson() => {
    'name': name,
    'percent': percent,
    'nextTier': nextTier,
    'nextTh': nextTh,
    'remaining': remaining,
    'progress': progress,
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

  bool get isEarning =>
      type.toLowerCase().contains('deposit') || type.toLowerCase() == 'earning';

  String get label {
    switch (type) {
      case 'deposit':
        return 'Начисление кэшбэка';
      case 'manual_deposit':
        return 'Подарок / Начисление';
      case 'withdrawal':
        return 'Оплата бонусами';
      case 'manual_withdrawal':
        return 'Ручное списание';
      case 'expiration':
        return 'Сгорание бонусов';
      default:
        return isEarning ? 'Начисление бонусов' : 'Списание бонусов';
    }
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

  String get fullAddress => '$city, $address';
}

class DeliveryAddress {
  const DeliveryAddress({
    required this.id,
    required this.title,
    required this.location,
    required this.house,
    this.floor,
    this.apartment,
    this.courierComment,
  });

  final String id;
  final String title;
  final DeliveryLocation location;
  final String house;
  final String? floor;
  final String? apartment;
  final String? courierComment;

  String get displayAddress => location.fullAddress;

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'city': location.city,
    'address': location.address,
    'latitude': location.latitude,
    'longitude': location.longitude,
    'house': house,
    'floor': floor,
    'apartment': apartment,
    'courierComment': courierComment,
  };

  factory DeliveryAddress.fromJson(Map<String, dynamic> json) {
    return DeliveryAddress(
      id: _asString(json['id']),
      title: _asString(json['title']),
      location: DeliveryLocation(
        city: _asString(json['city'], fallback: 'Актау'),
        address: _asString(json['address']),
        latitude: _asDouble(json['latitude'], fallback: 43.6532),
        longitude: _asDouble(json['longitude'], fallback: 51.1975),
      ),
      house: _asString(json['house']),
      floor: _nullableString(json['floor']),
      apartment: _nullableString(json['apartment']),
      courierComment: _nullableString(json['courierComment']),
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

