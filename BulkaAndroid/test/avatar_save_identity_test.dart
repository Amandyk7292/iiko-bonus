import 'package:bulka_bonus/main.dart';
import 'package:flutter_test/flutter_test.dart';

const _customerA = Customer(
  id: 'customer-a',
  name: 'A',
  phone: '77010000001',
  balance: 0,
  totalSpent: 0,
  createdAt: '2026-08-08T00:00:00Z',
  isVip: false,
  cashbackPercent: 0,
  vipThreshold: 0,
  tier: null,
);

const _customerB = Customer(
  id: 'customer-b',
  name: 'B',
  phone: '77010000002',
  balance: 0,
  totalSpent: 0,
  createdAt: '2026-08-08T00:00:00Z',
  isVip: false,
  cashbackPercent: 0,
  vipThreshold: 0,
  tier: null,
);

void main() {
  test('avatar save result is accepted only for the originating customer', () {
    expect(
      matchesCurrentAvatarSave(
        currentCustomer: _customerA,
        savedPhone: _customerA.phone,
        apiSessionPhone: _customerA.phone,
        customerId: _customerA.id,
        phone: _customerA.phone,
      ),
      isTrue,
    );

    expect(
      matchesCurrentAvatarSave(
        currentCustomer: _customerB,
        savedPhone: _customerB.phone,
        apiSessionPhone: _customerB.phone,
        customerId: _customerA.id,
        phone: _customerA.phone,
      ),
      isFalse,
      reason: 'a late response from customer A must not mutate customer B',
    );
  });

  test('avatar save result is rejected after logout or session switch', () {
    expect(
      matchesCurrentAvatarSave(
        currentCustomer: _customerA,
        savedPhone: _customerA.phone,
        apiSessionPhone: null,
        customerId: _customerA.id,
        phone: _customerA.phone,
      ),
      isFalse,
    );
    expect(
      matchesCurrentAvatarSave(
        currentCustomer: _customerA,
        savedPhone: _customerA.phone,
        apiSessionPhone: _customerB.phone,
        customerId: _customerA.id,
        phone: _customerA.phone,
      ),
      isFalse,
    );
  });
}
