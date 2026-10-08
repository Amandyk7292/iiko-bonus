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
  final name = localized.isNotEmpty
      ? localized
      : localizeCatalogName(
          _asString(item['name'], fallback: 'product_fallback'.tr),
        );
  final summaries = _asMap(item['optionSummaries']);
  final details = _asString(
    summaries[AppLang.current] ?? item['optionSummary'],
  );
  return details.isEmpty ? name : '$name\n$details';
}

double orderItemQuantity(Map<String, dynamic> item) {
  final quantity = _asDouble(item['quantity'], fallback: 1);
  return quantity.isFinite && quantity > 0 ? quantity : 1;
}

String orderItemQuantityLabel(Map<String, dynamic> item) {
  final quantity = productQuantityText(orderItemQuantity(item));
  final unit = _asString(item['unit']).trim();
  return unit.isEmpty ||
          RegExp(r'^(?:шт\.?|pcs)$', caseSensitive: false).hasMatch(unit)
      ? quantity
      : '$quantity $unit';
}

double orderItemUnitPrice(Map<String, dynamic> item) =>
    _asDouble(item['unitPrice'] ?? item['price']);

num orderItemLineTotal(Map<String, dynamic> item) {
  final saved = _nullableDouble(item['lineTotal']);
  if (saved != null && saved.isFinite) return saved;
  // Legacy orders lack a saved total. Use the same per-line rounding as cart
  // and checkout; order-level discounts are displayed separately.
  return (orderItemUnitPrice(item) * orderItemQuantity(item)).round();
}

List<List<String>> paymentReceiptItemRows(PaymentReceipt receipt) => receipt
    .items
    .map(
      (item) => [
        localizedOrderItemName(item),
        orderItemQuantityLabel(item),
        receipt.money(orderItemUnitPrice(item)),
        receipt.money(orderItemLineTotal(item)),
      ],
    )
    .toList();
