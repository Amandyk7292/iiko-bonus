part of '../main.dart';

class PaymentReceipt {
  PaymentReceipt.fromJson(Map<String, dynamic> json)
    : documentNumber = _asString(json['documentNumber']),
      orderNumber = _asInt(json['orderNumber']),
      transactionAt = _asString(json['transactionAt']),
      amount = _asDouble(json['amount']),
      discount = _asDouble(json['discount']),
      bonusSpent = _asDouble(json['bonusSpent']),
      deliveryFee = _asDouble(json['deliveryFee']),
      hasDelivery =
          json['hasDelivery'] == true || _asDouble(json['deliveryFee']) > 0,
      currency = _asString(json['currency'], fallback: 'KZT'),
      paymentMethod = _asString(json['paymentMethod']),
      isRefund = json['operation'] == 'refund',
      cardLastFour =
          RegExp(r'^\d{4}$').hasMatch(_asString(json['cardLastFour']))
          ? _asString(json['cardLastFour'])
          : null,
      items = (json['items'] as List? ?? const []).map(_asMap).toList();

  final String documentNumber, transactionAt, currency, paymentMethod;
  final int orderNumber;
  final double amount, discount, deliveryFee, bonusSpent;
  final bool isRefund;
  final bool hasDelivery;
  final String? cardLastFour;
  final List<Map<String, dynamic>> items;

  double get goodsSubtotal =>
      max(0, amount - deliveryFee + discount + bonusSpent);

  String get paymentLabel => cardLastFour == null
      ? (paymentMethod == 'card' ? 'receipt_paid_card'.tr : 'receipt_paid'.tr)
      : 'receipt_paid_card_last_four'.trArgs({'lastFour': cardLastFour});

  String money(num value) =>
      '${formatMoney(value.toDouble())} ${currency == 'KZT' ? '₸' : currency}';
}

String localizedOrderItemName(Map<String, dynamic> item) {
  final names = _asMap(item['name_translations'] ?? item['nameTranslations']);
  final localized = _asString(names[AppLang.current]).trim();
  return localized.isNotEmpty
      ? localized
      : localizeCatalogName(
          _asString(item['name'], fallback: 'product_fallback'.tr),
        );
}
