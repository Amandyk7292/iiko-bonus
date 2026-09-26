import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/core/cart_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _MotionApi extends BulkaApiClient {
  @override
  Stream<Map<String, dynamic>> get customerEvents => const Stream.empty();
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    appLanguageNotifier.value = 'ru';
  });

  testWidgets(
    'cart removal animates without delaying the model or leaving interactive ghosts',
    (tester) async {
      final cart = CartProvider();
      await cart.restored;
      cart.addItem(productId: 'one', name: 'Первый', price: 100, imageUrl: '');
      cart.addItem(productId: 'two', name: 'Второй', price: 200, imageUrl: '');
      final api = _MotionApi();
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: cart,
          child: MaterialApp(
            theme: buildBulkaTheme(),
            home: OrdersScreen(api: api, customer: null),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final key = cart.items.values.first.cartKey;
      cart.setQuantity(key, 0);
      await tester.pump();
      expect(cart.totalAmount, 200);
      expect(find.text('Первый'), findsOneWidget);
      expect(find.text('Первый').hitTestable(), findsNothing);
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('Первый'), findsOneWidget);
      await tester.pumpAndSettle();
      expect(find.text('Первый'), findsNothing);
      expect(find.text('Второй'), findsOneWidget);
      cart.addItem(productId: 'one', name: 'Первый', price: 100, imageUrl: '');
      await tester.pump();
      cart.setQuantity(cart.items.values.first.cartKey, 0);
      await tester.pumpAndSettle();
      expect(cart.totalAmount, 100);
      expect(find.text('Первый'), findsOneWidget);
      cart.clear();
      await tester.pumpAndSettle();
      expect(find.text('Первый'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await cart.persisted;
      cart.dispose();
      api.dispose();
    },
  );

  testWidgets('navigation highlight moves continuously for 420ms', (
    tester,
  ) async {
    final cart = CartProvider();
    await cart.restored;
    var selected = 0;
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: cart,
        child: MaterialApp(
          theme: buildBulkaTheme(),
          home: StatefulBuilder(
            builder: (context, update) => Scaffold(
              bottomNavigationBar: FloatingNavBar(
                selectedIndex: selected,
                onChanged: (value) => update(() => selected = value),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final marker = find.byKey(const ValueKey('nav-selection-indicator'));
    final before = tester.getTopLeft(marker).dx;
    await tester.tap(find.byKey(const ValueKey('nav-4')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 160));
    final middle = tester.getTopLeft(marker).dx;
    await tester.pumpAndSettle();
    final end = tester.getTopLeft(marker).dx;
    expect(middle, greaterThan(before));
    expect(middle, lessThan(end));
    expect(
      tester.widget<AnimatedPositioned>(marker).duration,
      const Duration(milliseconds: 420),
    );
    await tester.pumpWidget(const SizedBox.shrink());
    cart.dispose();
  });

  testWidgets(
    'invalid form highlights the field and produces one short haptic',
    (tester) async {
      final key = GlobalKey<FormState>();
      final cues = <MethodCall>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'HapticFeedback.vibrate') cues.add(call);
          return null;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          null,
        ),
      );
      await tester.pumpWidget(
        MaterialApp(
          theme: buildBulkaTheme(),
          home: Scaffold(
            body: Form(
              key: key,
              child: ListView(
                children: [
                  TextFormField(
                    validator: (value) =>
                        value?.isNotEmpty == true ? null : 'Заполните адрес',
                  ),
                  TextButton(
                    onPressed: () => validateBulkaForm(key),
                    child: const Text('Сохранить'),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Сохранить'));
      await tester.pumpAndSettle();
      expect(find.text('Заполните адрес'), findsOneWidget);
      expect(cues.length, 1);
      expect(cues.single.arguments, 'HapticFeedbackType.lightImpact');
    },
  );
}
