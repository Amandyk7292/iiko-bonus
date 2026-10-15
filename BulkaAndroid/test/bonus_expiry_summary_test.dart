import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Map<String, dynamic> summary({double? nextAmount}) => {
    'currentBalance': 700,
    'totalExpiring': 700,
    'nextExpiryAt': '2027-07-15T09:00:00Z',
    'nextExpiryAmount': nextAmount,
    'buckets': [
      {'expiresAt': '2027-07-15T09:00:00Z', 'amount': 300, 'daysRemaining': 7},
      {
        'expiresAt': '2027-07-15T14:00:00+05:00',
        'amount': 200,
        'daysRemaining': 7,
      },
      {'expiresAt': '2027-09-15T09:00:00Z', 'amount': 200, 'daysRemaining': 69},
    ],
  };

  test(
    'next expiry notice uses its own amount and preserves horizon totals',
    () {
      final result = BonusExpirySummary.fromJson(summary(nextAmount: 500));
      expect(result.amountAtNextExpiry, 500);
      expect(result.totalExpiring, 700);
      expect(result.currentBalance, 700);
    },
  );

  test(
    'older responses derive the nearest amount without expiring newer lots',
    () {
      final result = BonusExpirySummary.fromJson(summary());
      expect(result.amountAtNextExpiry, 500);
      expect(result.buckets.length, 3);
    },
  );

  test('explicit zero does not fall back to the whole wallet', () {
    expect(
      BonusExpirySummary.fromJson(summary(nextAmount: 0)).amountAtNextExpiry,
      0,
    );
  });
}
