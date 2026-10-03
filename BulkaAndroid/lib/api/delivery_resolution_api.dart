part of '../main.dart';

extension DeliveryResolutionApi on BulkaApiClient {
  Future<DeliveryResolutionResponse> getDeliveryResolution(
    String orderId,
  ) async {
    final json = await _get(
      '/api/customer/orders/${Uri.encodeComponent(orderId)}/delivery-resolution',
    );
    final order = _asMap(json['order']);
    if (json['success'] != true || order.isEmpty) {
      throw ApiException(
        _messageFrom(json, 'delivery_choice_load_error'.tr),
        code: _nullableString(json['code']),
      );
    }
    final options = _asMap(json['options']);
    return DeliveryResolutionResponse(
      order: CustomerOrder.fromJson(order),
      options: options.isEmpty
          ? null
          : DeliveryResolutionOptions.fromJson(options),
    );
  }

  Future<CustomerOrder> resolveDelivery(
    String orderId, {
    required String action,
    DateTime? pickupTime,
  }) async {
    final json = await _post(
      '/api/customer/orders/${Uri.encodeComponent(orderId)}/delivery-resolution',
      {
        'action': action,
        if (pickupTime != null)
          'pickupTime': pickupTime.toUtc().toIso8601String(),
      },
    );
    final order = _asMap(json['order']);
    if (json['success'] != true || order.isEmpty) {
      throw ApiException(
        _messageFrom(json, 'delivery_choice_error'.tr),
        code: _nullableString(json['code']),
      );
    }
    return CustomerOrder.fromJson(order);
  }
}
