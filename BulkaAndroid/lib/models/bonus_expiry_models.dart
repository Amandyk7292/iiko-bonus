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
  });
  final double currentBalance;
  final double totalExpiring;
  final DateTime? nextExpiryAt;
  final List<BonusExpiryBucket> buckets;
  factory BonusExpirySummary.fromJson(Map<String, dynamic> json) =>
      BonusExpirySummary(
        currentBalance: _asDouble(json['currentBalance']),
        totalExpiring: _asDouble(json['totalExpiring']),
        nextExpiryAt: DateTime.tryParse(_asString(json['nextExpiryAt'])),
        buckets: (json['buckets'] as List? ?? const [])
            .map((item) => BonusExpiryBucket.fromJson(_asMap(item)))
            .toList(growable: false),
      );
}
