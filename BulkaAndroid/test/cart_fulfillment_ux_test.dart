import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('cart explains the current mode and offers the previous one', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({
      'selected_bakery_location_pickup': 'ЖК Дукат',
    });
    appLanguageNotifier.value = 'ru';
    final api = BulkaApiClient();
    final cart = CartProvider();
    await cart.restored;
    cart.replaceWithItems([
      CartItem(
        id: 'bun',
        name: 'Булочка',
        price: 520,
        imageUrl: '',
        isStopListed: true,
      ),
    ]);
    String? returnedTo;
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: cart,
        child: MaterialApp(
          theme: buildBulkaTheme(),
          home: OrdersScreen(
            api: api,
            customer: null,
            orderType: 'pickup',
            returnOrderType: 'preorder',
            onReturnToOrderType: (type) async => returnedTo = type,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Самовывоз · ЖК Дукат'), findsOneWidget);
    expect(
      find.text('Войдите, чтобы увидеть бонусы за заказ.'),
      findsOneWidget,
    );
    expect(find.text('Вернуться: Предзаказ'), findsOneWidget);
    expect(find.textContaining('+ 0 бонусов'), findsNothing);
    await tester.tap(find.text('Вернуться: Предзаказ'));
    expect(returnedTo, 'preorder');

    await tester.pumpWidget(const SizedBox.shrink());
    await cart.persisted;
    cart.dispose();
    api.dispose();
  });
}
