part of '../main.dart';

class DeliveryResolution {
  const DeliveryResolution({
    required this.id,
    required this.status,
    required this.reason,
    this.requestedAt,
    this.pickupTime,
    this.reviewedAt,
  });

  final String id;
  final String status;
  final String reason;
  final DateTime? requestedAt;
  final DateTime? pickupTime;
  final DateTime? reviewedAt;

  factory DeliveryResolution.fromJson(Map<String, dynamic> json) =>
      DeliveryResolution(
        id: _asString(json['id']),
        status: _asString(json['status']),
        reason: _asString(json['reason']),
        requestedAt: DateTime.tryParse(_asString(json['requestedAt'])),
        pickupTime: DateTime.tryParse(_asString(json['pickupTime'])),
        reviewedAt: DateTime.tryParse(_asString(json['reviewedAt'])),
      );

  Map<String, dynamic> toJson() => {
    'id': id,
    'status': status,
    'reason': reason,
    'requestedAt': requestedAt?.toUtc().toIso8601String(),
    'pickupTime': pickupTime?.toUtc().toIso8601String(),
    'reviewedAt': reviewedAt?.toUtc().toIso8601String(),
  };
}

class DeliveryResolutionOptions {
  const DeliveryResolutionOptions({
    required this.branchId,
    required this.branchName,
    required this.branchAddress,
    required this.slots,
    required this.timezoneOffsetMinutes,
    required this.serverTime,
    required this.expiresAt,
  });

  final String branchId;
  final String branchName;
  final String branchAddress;
  final List<FulfillmentSlot> slots;
  final int timezoneOffsetMinutes;
  final DateTime serverTime;
  final DateTime expiresAt;

  factory DeliveryResolutionOptions.fromJson(Map<String, dynamic> json) {
    final branch = _asMap(json['branch']);
    final serverTime = DateTime.parse(_asString(json['serverTime'])).toUtc();
    final expiresAt = DateTime.parse(_asString(json['expiresAt'])).toUtc();
    final offset = _asInt(json['timezoneOffsetMinutes'], fallback: 300);
    final slots =
        (json['slots'] as List? ?? const [])
            .map(
              (value) => FulfillmentSlot.fromJson(
                _asMap(value),
                timezoneOffsetMinutes: offset,
                serverTime: serverTime,
              ),
            )
            .where(
              (slot) =>
                  slot.remaining > 0 &&
                  !slot.startsAt.isBefore(serverTime) &&
                  !slot.startsAt.isAfter(expiresAt) &&
                  slot.endsAt.isAfter(slot.startsAt),
            )
            .toList()
          ..sort((a, b) => a.startsAt.compareTo(b.startsAt));
    return DeliveryResolutionOptions(
      branchId: _asString(branch['id']),
      branchName: _asString(branch['name']),
      branchAddress: _asString(branch['address']),
      slots: slots,
      timezoneOffsetMinutes: offset,
      serverTime: serverTime,
      expiresAt: expiresAt,
    );
  }
}

class DeliveryResolutionResponse {
  const DeliveryResolutionResponse({required this.order, this.options});
  final CustomerOrder order;
  final DeliveryResolutionOptions? options;
}

String customerOrderStatusLabel(CustomerOrder order) {
  switch (order.deliveryResolution?.status) {
    case 'pending':
      return 'delivery_choice_needed'.tr;
    case 'pickup_cancelling':
    case 'cancel_cancelling':
    case 'pickup_accepting':
      return 'delivery_choice_processing'.tr;
    case 'pickup_pending_approval':
      return 'delivery_choice_pending'.tr;
    case 'pickup_rejecting':
      return 'delivery_choice_rejected_refunding'.tr;
    case 'cancel_refunding':
      return 'delivery_choice_refunding'.tr;
    default:
      return 'order_status_${order.orderStatus}'.tr;
  }
}

String customerOrderCancellationReason(CustomerOrder order) {
  final reason = order.cancellationReason?.trim() ?? '';
  if (reason == 'Самовывоз взамен доставки отклонён точкой') {
    return 'delivery_choice_rejected_reason'.tr;
  }
  if (reason == 'Отменено клиентом: курьер не найден') {
    return 'delivery_choice_cancelled_reason'.tr;
  }
  return reason;
}
