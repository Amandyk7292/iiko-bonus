part of '../main.dart';

class OrderSubstitution {
  const OrderSubstitution({
    required this.id,
    required this.productName,
    required this.quantity,
    required this.action,
    required this.status,
    this.replacementProductName,
    this.note,
    this.error,
  });

  final String id;
  final String productName;
  final int quantity;
  final String action;
  final String status;
  final String? replacementProductName;
  final String? note;
  final String? error;

  factory OrderSubstitution.fromJson(Map<String, dynamic> json) =>
      OrderSubstitution(
        id: _asString(json['id']),
        productName: _asString(json['productName']),
        quantity: _asInt(json['quantity'], fallback: 1),
        action: _asString(json['action']),
        status: _asString(json['status']),
        replacementProductName: _nullableString(json['replacementProductName']),
        note: _nullableString(json['note']),
        error: _nullableString(json['error']),
      );

  Map<String, dynamic> toJson() => {
    'id': id,
    'productName': productName,
    'quantity': quantity,
    'action': action,
    'status': status,
    'replacementProductName': replacementProductName,
    'note': note,
    'error': error,
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
    required this.fulfillmentType,
    required this.deliveryStatus,
    this.paymentProvider = 'kaspi',
    this.pickupTime,
    this.comment,
    this.substitutionPreference = 'call_customer',
    this.substitutions = const [],
    this.cancellationReason,
    this.refundStatus,
    this.refundAmount,
    this.refundedAt,
    this.estimatedDeliveryAt,
    this.promisedReadyAt,
    this.etaMinAt,
    this.etaMaxAt,
    this.etaConfidence,
    this.etaUpdatedAt,
    this.routeDistanceKm,
    this.preparationMinutes,
    this.trackingCode,
    this.trackingUrl,
    this.deliveryProvider,
    this.providerDeliveryStatus,
    this.providerDeliveryPrice,
    this.deliveryPin,
    this.customerArrivedAt,
    this.courier,
    this.receiptUrl,
  });

  final String id;
  final int number;
  final String paymentStatus;
  final String paymentProvider;
  final String orderStatus;
  final int amount;
  final int subtotal;
  final int discount;
  final String branch;
  final List<Map<String, dynamic>> items;
  final int earnedBonus;
  final DateTime createdAt;
  final String fulfillmentType;
  final String deliveryStatus;
  final DateTime? pickupTime;
  final String? comment;
  final String substitutionPreference;
  final List<OrderSubstitution> substitutions;
  final String? cancellationReason;
  final String? refundStatus;
  final int? refundAmount;
  final DateTime? refundedAt;
  final DateTime? estimatedDeliveryAt;
  final DateTime? promisedReadyAt;
  final DateTime? etaMinAt;
  final DateTime? etaMaxAt;
  final String? etaConfidence;
  final DateTime? etaUpdatedAt;
  final double? routeDistanceKm;
  final int? preparationMinutes;
  final String? trackingCode;
  final String? trackingUrl;
  final String? deliveryProvider;
  final String? providerDeliveryStatus;
  final int? providerDeliveryPrice;
  final String? deliveryPin;
  final DateTime? customerArrivedAt;
  final OrderCourier? courier;
  final String? receiptUrl;

  factory CustomerOrder.fromJson(Map<String, dynamic> json) {
    final rawItems = json['items'];
    return CustomerOrder(
      id: _asString(json['id']),
      number: _asInt(json['number']),
      paymentStatus: _asString(json['paymentStatus']),
      paymentProvider: _asString(json['paymentProvider'], fallback: 'kaspi'),
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
      fulfillmentType: _asString(
        json['fulfillmentType'] ?? json['orderType'],
        fallback: 'pickup',
      ),
      deliveryStatus: _asString(json['deliveryStatus'], fallback: 'unassigned'),
      pickupTime: DateTime.tryParse(_asString(json['pickupTime'])),
      comment: _nullableString(json['comment']),
      substitutionPreference: _asString(
        json['substitutionPreference'],
        fallback: 'call_customer',
      ),
      substitutions: (json['substitutions'] as List? ?? const [])
          .map((item) => OrderSubstitution.fromJson(_asMap(item)))
          .where((item) => item.id.isNotEmpty)
          .toList(),
      cancellationReason: _nullableString(json['cancellationReason']),
      refundStatus: _nullableString(json['refundStatus']),
      refundAmount: _nullableInt(json['refundAmount']),
      refundedAt: DateTime.tryParse(_asString(json['refundedAt'])),
      estimatedDeliveryAt: DateTime.tryParse(
        _asString(json['estimatedDeliveryAt']),
      ),
      promisedReadyAt: DateTime.tryParse(_asString(json['promisedReadyAt'])),
      etaMinAt: DateTime.tryParse(_asString(json['etaMinAt'])),
      etaMaxAt: DateTime.tryParse(_asString(json['etaMaxAt'])),
      etaConfidence: _nullableString(json['etaConfidence']),
      etaUpdatedAt: DateTime.tryParse(_asString(json['etaUpdatedAt'])),
      routeDistanceKm: json['routeDistanceKm'] == null
          ? null
          : _asDouble(json['routeDistanceKm']),
      preparationMinutes: _nullableInt(json['preparationMinutes']),
      trackingCode: _nullableString(json['trackingCode']),
      trackingUrl: _nullableString(json['trackingUrl']),
      deliveryProvider: _nullableString(json['deliveryProvider']),
      providerDeliveryStatus: _nullableString(json['providerDeliveryStatus']),
      providerDeliveryPrice: _nullableInt(json['providerDeliveryPrice']),
      deliveryPin: _nullableString(json['deliveryPin']),
      customerArrivedAt: DateTime.tryParse(
        _asString(json['customerArrivedAt']),
      ),
      receiptUrl: _nullableString(json['receiptUrl']),
      courier: _asMap(json['courier']).isEmpty
          ? null
          : OrderCourier.fromJson(_asMap(json['courier'])),
    );
  }

  DateTime? get eta => fulfillmentType == 'delivery'
      ? estimatedDeliveryAt ?? promisedReadyAt
      : promisedReadyAt ?? pickupTime;

  bool get isClosed =>
      orderStatus == 'completed' ||
      orderStatus == 'cancelled' ||
      deliveryStatus == 'delivered';

  bool get canCancel =>
      paymentStatus == 'paid' &&
      orderStatus == 'new' &&
      (refundStatus == null || refundStatus!.isEmpty);

  Map<String, dynamic> toJson() => {
    'id': id,
    'number': number,
    'paymentStatus': paymentStatus,
    'paymentProvider': paymentProvider,
    'orderStatus': orderStatus,
    'amount': amount,
    'subtotal': subtotal,
    'discount': discount,
    'branch': branch,
    'items': items,
    'earnedBonus': earnedBonus,
    'createdAt': createdAt.toUtc().toIso8601String(),
    'fulfillmentType': fulfillmentType,
    'deliveryStatus': deliveryStatus,
    'pickupTime': pickupTime?.toUtc().toIso8601String(),
    'comment': comment,
    'substitutionPreference': substitutionPreference,
    'substitutions': substitutions.map((item) => item.toJson()).toList(),
    'cancellationReason': cancellationReason,
    'refundStatus': refundStatus,
    'refundAmount': refundAmount,
    'refundedAt': refundedAt?.toUtc().toIso8601String(),
    'estimatedDeliveryAt': estimatedDeliveryAt?.toUtc().toIso8601String(),
    'promisedReadyAt': promisedReadyAt?.toUtc().toIso8601String(),
    'etaMinAt': etaMinAt?.toUtc().toIso8601String(),
    'etaMaxAt': etaMaxAt?.toUtc().toIso8601String(),
    'etaConfidence': etaConfidence,
    'etaUpdatedAt': etaUpdatedAt?.toUtc().toIso8601String(),
    'routeDistanceKm': routeDistanceKm,
    'preparationMinutes': preparationMinutes,
    'trackingCode': trackingCode,
    'trackingUrl': trackingUrl,
    'deliveryProvider': deliveryProvider,
    'providerDeliveryStatus': providerDeliveryStatus,
    'providerDeliveryPrice': providerDeliveryPrice,
    'deliveryPin': deliveryPin,
    'customerArrivedAt': customerArrivedAt?.toUtc().toIso8601String(),
    'receiptUrl': receiptUrl,
    'courier': courier?.toJson(),
  };
}
