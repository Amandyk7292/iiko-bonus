part of '../main.dart';

class BonusExpiryBucket {
  const BonusExpiryBucket({
    required this.expiresAt,
    required this.amount,
    required this.daysRemaining,
  });
  final DateTime expiresAt;
  final double amount;
  final int daysRemaining;
  factory BonusExpiryBucket.fromJson(Map<String, dynamic> json) =>
      BonusExpiryBucket(
        expiresAt:
            DateTime.tryParse(_asString(json['expiresAt'])) ?? DateTime.now(),
        amount: _asDouble(json['amount']),
        daysRemaining: _asInt(json['daysRemaining']),
      );
}

class BonusExpirySummary {
  const BonusExpirySummary({
    required this.currentBalance,
    required this.totalExpiring,
    required this.buckets,
    this.nextExpiryAt,
    this.nextExpiryAmount,
  });
  final double currentBalance;
  final double totalExpiring;
  final DateTime? nextExpiryAt;
  final double? nextExpiryAmount;
  final List<BonusExpiryBucket> buckets;
  double get amountAtNextExpiry {
    final explicitAmount = nextExpiryAmount;
    if (explicitAmount != null) return explicitAmount;
    final next = nextExpiryAt;
    if (next == null) return 0;
    if (buckets.isEmpty) return totalExpiring;
    return buckets
        .where((bucket) => bucket.expiresAt.isAtSameMomentAs(next))
        .fold(0.0, (sum, bucket) => sum + bucket.amount);
  }

  factory BonusExpirySummary.fromJson(Map<String, dynamic> json) =>
      BonusExpirySummary(
        currentBalance: _asDouble(json['currentBalance']),
        totalExpiring: _asDouble(json['totalExpiring']),
        nextExpiryAt: DateTime.tryParse(_asString(json['nextExpiryAt'])),
        nextExpiryAmount: json['nextExpiryAmount'] is num
            ? (json['nextExpiryAmount'] as num).toDouble()
            : null,
        buckets: (json['buckets'] as List? ?? const [])
            .map((item) => BonusExpiryBucket.fromJson(_asMap(item)))
            .toList(growable: false),
      );
}
