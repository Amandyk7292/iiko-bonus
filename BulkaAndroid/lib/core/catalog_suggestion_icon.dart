part of '../main.dart';

@visibleForTesting
IconData catalogSuggestionIcon(String rawTitle) {
  final title = normalizeCatalogSearch(rawTitle);

  bool hasAny(Iterable<String> keywords) =>
      keywords.any((keyword) => title.contains(keyword));

  if (hasAny(const ['булгур', 'греч', 'рис', 'каша', 'круп'])) {
    return Icons.rice_bowl_rounded;
  }
  if (hasAny(const ['сосиск', 'колбас', 'хот дог', 'хотдог'])) {
    return Icons.fastfood_rounded;
  }
  if (hasAny(const ['пицц'])) return Icons.local_pizza_rounded;
  if (hasAny(const ['кофе', 'капуч', 'латте', 'чай', 'напит', 'какао'])) {
    return Icons.local_cafe_rounded;
  }
  if (hasAny(const ['суп', 'солянк', 'борщ'])) {
    return Icons.soup_kitchen_rounded;
  }
  if (hasAny(const ['рыб', 'лосос', 'семг', 'тунец'])) {
    return Icons.set_meal_rounded;
  }
  if (hasAny(const ['мяс', 'куриц', 'котлет', 'говяд', 'шашлык'])) {
    return Icons.dinner_dining_rounded;
  }
  if (hasAny(const ['яич', 'яйц', 'омлет'])) return Icons.egg_alt_rounded;
  if (hasAny(const ['салат', 'овощ', 'зелень'])) return Icons.eco_rounded;
  if (hasAny(const ['торт', 'пирог', 'чизкейк', 'десерт'])) {
    return Icons.cake_rounded;
  }
  if (hasAny(const ['печень', 'куки'])) return Icons.cookie_rounded;
  if (hasAny(const [
    'булоч',
    'круас',
    'хворост',
    'бауыр',
    'багет',
    'хлеб',
    'слойк',
    'рогалик',
    'синнаб',
  ])) {
    return Icons.bakery_dining_rounded;
  }
  if (title.contains('вес')) return Icons.scale_rounded;
  return Icons.restaurant_menu_rounded;
}
