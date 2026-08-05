import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('catalog suggestions use product-specific vector icons', () {
    final icons = [
      catalogSuggestionIcon('Булгурская вес'),
      catalogSuggestionIcon('Сосиски мини вес'),
      catalogSuggestionIcon('Хворост Bulka вес'),
    ];

    expect(icons, [
      Icons.rice_bowl_rounded,
      Icons.fastfood_rounded,
      Icons.bakery_dining_rounded,
    ]);
    expect(icons.toSet(), hasLength(3));
  });

  test('weighted and unknown products keep meaningful fallbacks', () {
    expect(catalogSuggestionIcon('Конфеты вес'), Icons.scale_rounded);
    expect(
      catalogSuggestionIcon('Фирменная позиция'),
      Icons.restaurant_menu_rounded,
    );
  });
}
