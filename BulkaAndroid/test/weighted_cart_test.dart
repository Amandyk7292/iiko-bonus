import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:bulka_bonus/core/cart_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'weighted cart keeps kilograms and rounds only the line price',
    () async {
      SharedPreferences.setMockInitialValues({});
      final cart = CartProvider();
      await cart.restored;
      cart.addItem(
        productId: 'weight',
        name: 'Бауырсак',
        price: 1490,
        imageUrl: '',
        quantityStep: 0.001,
        unit: 'кг',
      );
      cart.setQuantity('weight', 0.375);
      final item = cart.items.values.single;
      expect(item.quantity, 0.375);
      expect(item.total, 559);
      expect(item.quantityLabel, '0.375 кг');
      final restored = CartItem.fromJson(item.toJson());
      expect(restored.quantity, 0.375);
      expect(restored.quantityStep, 0.001);
      expect(restored.unit, 'кг');
      expect(productQuantityText(10), '10');
      expect(productQuantityText(0.100), '0.1');
      cart.dispose();
    },
  );
}
