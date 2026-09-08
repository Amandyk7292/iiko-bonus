import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets(
    'checkout sits directly above navigation with an iPhone safe area',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      appLanguageNotifier.value = 'ru';
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final cart = CartProvider();
      await tester.runAsync(() async {
        await Future<void>.delayed(Duration.zero);
      });
      cart.addItem(
        productId: 'test',
        name: 'Кулич бездрожжевой 450гр',
        price: 1800,
        imageUrl: '',
      );
      final api = BulkaApiClient();
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: cart,
          child: MaterialApp(
            theme: buildBulkaTheme(),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                padding: const EdgeInsets.only(bottom: 34),
                viewPadding: const EdgeInsets.only(bottom: 34),
              ),
              child: child!,
            ),
            home: Scaffold(
              extendBody: true,
              body: OrdersScreen(api: api, customer: null),
              bottomNavigationBar: FloatingNavBar(
                selectedIndex: 2,
                onChanged: (_) {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final button = tester.getRect(
        find.widgetWithText(GradientButton, 'Оформить заказ'),
      );
      final nav = tester.getRect(find.byType(FloatingNavBar));
      expect(button.bottom, lessThanOrEqualTo(nav.top));
      expect(nav.top - button.bottom, lessThanOrEqualTo(32));
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      cart.dispose();
    },
  );
}
