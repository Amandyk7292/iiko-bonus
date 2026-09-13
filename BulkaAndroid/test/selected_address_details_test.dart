import 'dart:convert';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('selected compact address reveals all delivery details', (
    tester,
  ) async {
    appLanguageNotifier.value = 'ru';
    const address = DeliveryAddress(
      id: 'long-address',
      title: 'Дом родителей с длинным названием',
      location: DeliveryLocation(
        city: 'Актау',
        address: '19-й микрорайон, очень длинный адрес возле набережной',
        latitude: 43.65,
        longitude: 51.16,
      ),
      house: '33/1',
      entrance: '3',
      floor: '14',
      apartment: '127',
      courierComment: 'Вход со двора, ориентир — синяя вывеска',
      isDefault: true,
    );
    SharedPreferences.setMockInitialValues({
      'delivery_addresses_guest': [jsonEncode(address.toJson())],
      'selected_delivery_address_id_guest': address.id,
    });

    await tester.pumpWidget(
      MaterialApp(
        theme: buildBulkaTheme(),
        home: const AddressSelectionScreen(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text(address.location.fullAddress), findsOneWidget);
    expect(find.textContaining('Подъезд 3'), findsOneWidget);
    expect(find.textContaining('Квартира 127'), findsOneWidget);
    expect(find.textContaining('синяя вывеска'), findsOneWidget);
    final selectedIndicator = tester.widget<AnimatedContainer>(
      find.byKey(const ValueKey('address-selected-indicator-long-address')),
    );
    final decoration = selectedIndicator.decoration! as BoxDecoration;
    expect(decoration.border, isNull);
    expect(tester.takeException(), isNull);
  });
}
