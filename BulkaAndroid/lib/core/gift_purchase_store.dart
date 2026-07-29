part of '../main.dart';

@immutable
class PendingGiftPurchase {
  const PendingGiftPurchase({
    required this.requestId,
    required this.amount,
    required this.recipientPhone,
    required this.paymentMethod,
    required this.createdAt,
    this.recipientName,
    this.message,
    this.purchaseId,
  });

  final String requestId;
  final int amount;
  final String recipientPhone;
  final String? recipientName;
  final String? message;
  final String paymentMethod;
  final DateTime createdAt;
  final String? purchaseId;

  bool matches({
    required int amount,
    required String recipientPhone,
    required String recipientName,
    required String message,
    required String paymentMethod,
  }) =>
      this.amount == amount &&
      this.recipientPhone == recipientPhone &&
      (this.recipientName ?? '') == recipientName.trim() &&
      (this.message ?? '') == message.trim() &&
      this.paymentMethod == paymentMethod;

  PendingGiftPurchase withPurchaseId(String value) => PendingGiftPurchase(
    requestId: requestId,
    amount: amount,
    recipientPhone: recipientPhone,
    recipientName: recipientName,
    message: message,
    paymentMethod: paymentMethod,
    createdAt: createdAt,
    purchaseId: value,
  );

  Map<String, dynamic> toJson() => {
    'requestId': requestId,
    'amount': amount,
    'recipientPhone': recipientPhone,
    if (recipientName?.isNotEmpty == true) 'recipientName': recipientName,
    if (message?.isNotEmpty == true) 'message': message,
    'paymentMethod': paymentMethod,
    'createdAt': createdAt.toUtc().toIso8601String(),
    if (purchaseId?.isNotEmpty == true) 'purchaseId': purchaseId,
  };

  static PendingGiftPurchase? fromJson(Map<String, dynamic> json) {
    final requestId = _asString(json['requestId']).trim();
    final amount = (json['amount'] as num?)?.round();
    final recipientPhone = _asString(json['recipientPhone']).trim();
    final paymentMethod = _asString(json['paymentMethod']).trim();
    final createdAt = DateTime.tryParse(_asString(json['createdAt']));
    if (requestId.isEmpty ||
        amount == null ||
        amount < 500 ||
        recipientPhone.isEmpty ||
        !const {'forte', 'kaspi'}.contains(paymentMethod) ||
        createdAt == null) {
      return null;
    }
    return PendingGiftPurchase(
      requestId: requestId,
      amount: amount,
      recipientPhone: recipientPhone,
      recipientName: _asString(json['recipientName']).trim().nullIfEmpty,
      message: _asString(json['message']).trim().nullIfEmpty,
      paymentMethod: paymentMethod,
      createdAt: createdAt,
      purchaseId: _asString(json['purchaseId']).trim().nullIfEmpty,
    );
  }
}

extension on String {
  String? get nullIfEmpty => isEmpty ? null : this;
}

abstract final class PendingGiftPurchaseStore {
  static const _prefix = 'pending_gift_purchase_v1_';

  static String key(BulkaApiClient api) => customerPreferenceKey(
    _prefix.substring(0, _prefix.length - 1),
    api.sessionCacheScope,
  );

  static Future<PendingGiftPurchase?> load(BulkaApiClient api) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(key(api));
    if (raw == null || raw.isEmpty) return null;
    try {
      final pending = PendingGiftPurchase.fromJson(_asMap(jsonDecode(raw)));
      if (pending == null ||
          DateTime.now().difference(pending.createdAt).abs() >
              const Duration(days: 7)) {
        await clear(api);
        return null;
      }
      return pending;
    } catch (_) {
      await clear(api);
      return null;
    }
  }

  static Future<void> save(
    BulkaApiClient api,
    PendingGiftPurchase purchase,
  ) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(key(api), jsonEncode(purchase.toJson()));
  }

  static Future<void> clear(BulkaApiClient api) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(key(api));
  }
}
