part of '../main.dart';

const _catalogAllCategoryKey = '__all_categories__';

@visibleForTesting
bool catalogProductOptionsRequireDetails(Map<String, dynamic> options) {
  final configuration = _asMap(options['configuration']);
  final groups = options['modifierGroups'] as List? ?? const [];
  return (configuration['enabled'] == true &&
          _asString(configuration['productKind']) != 'standard') ||
      groups.isNotEmpty;
}

String? _catalogCategoryFallbackAsset(String category) {
  final normalized = normalizeCatalogSearch(category);
  if (normalized.contains('блин') ||
      normalized.contains('бауыр') ||
      normalized.contains('құймақ') ||
      normalized.contains('pancake') ||
      normalized.contains('baursak')) {
    return 'assets/categories/category_pancakes_baursak.webp';
  }
  if (normalized.contains('печень') || normalized.contains('cookie')) {
    return 'assets/categories/category_cookies.webp';
  }
  if (normalized.contains('торт') ||
      normalized.contains('cake') ||
      normalized.contains('десерт') ||
      normalized.contains('dessert') ||
      normalized.contains('кондитер') ||
      normalized.contains('кулич')) {
    return 'assets/categories/category_cake.webp';
  }
  if (normalized.contains('хлеб') ||
      normalized.contains('нан') ||
      normalized.contains('булоч') ||
      normalized.contains('тоқаш') ||
      normalized.contains('круас') ||
      normalized.contains('выпеч') ||
      normalized.contains('bread') ||
      normalized.contains('bun') ||
      normalized.contains('pastry') ||
      normalized.contains('bakery')) {
    return 'assets/order/pickup_banner.jpg';
  }
  return null;
}

String _catalogDisplayName(dynamic value) {
  final text = value.toString().trim().replaceAll(RegExp(r'\s+'), ' ');
  if (text.isEmpty || text == text.toLowerCase()) return text;
  final letters = RegExp(
    r'[A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]',
  ).allMatches(text).length;
  if (letters < 4 || text != text.toUpperCase()) return text;

  final lower = text.toLowerCase();
  final firstLetter = RegExp(
    r'[A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]',
  ).firstMatch(lower);
  if (firstLetter == null) return lower;
  final index = firstLetter.start;
  return lower.replaceRange(index, index + 1, lower[index].toUpperCase());
}

String _catalogFactCode(String value) =>
    value.trim().toLowerCase().replaceAll(RegExp(r'[\s-]+'), '_');

String? _allergenIconName(String value) => switch (_catalogFactCode(value)) {
  'gluten' || 'глютен' => 'gluten',
  'milk' || 'молоко' || 'сүт' => 'milk',
  'egg' || 'eggs' || 'яйцо' || 'яйца' || 'жұмыртқа' => 'egg',
  'nuts' || 'tree_nuts' || 'орехи' || 'жаңғақтар' => 'nuts',
  'peanut' || 'peanuts' || 'арахис' || 'жержаңғақ' => 'peanut',
  'sesame' || 'кунжут' || 'күнжіт' => 'sesame',
  'soy' || 'соя' => 'soy',
  _ => null,
};

String? _productMarkIconName(String value) => switch (_catalogFactCode(value)) {
  'halal' || 'халяль' => 'halal',
  'eac' => 'eac',
  'iso' => 'iso',
  'traces_nuts_sesame' ||
  'может_содержать_следы_орехов_и_кунжута' ||
  'возможны_следы_орехов_и_кунжута' => 'traces-nuts-sesame',
  'not_for_under_3' || 'не_рекомендуется_детям_до_3_лет' => 'under-3',
  'vegetarian' || 'вегетарианское' => 'vegetarian',
  'vegan' || 'веганское' => 'vegan',
  'sugar_free' || 'без_сахара' => 'sugar-free',
  'lactose_free' || 'без_лактозы' => 'lactose-free',
  _ => null,
};

bool _isDietaryFilterTag(String value) => !{
  'eac',
  'iso',
  'traces_nuts_sesame',
  'может_содержать_следы_орехов_и_кунжута',
  'возможны_следы_орехов_и_кунжута',
  'not_for_under_3',
  'не_рекомендуется_детям_до_3_лет',
}.contains(_catalogFactCode(value));

List<CatalogProduct> catalogProductsWithStopListLast(
  Iterable<CatalogProduct> products,
) => [
  ...products.where((product) => !product.isStopListed),
  ...products.where((product) => product.isStopListed),
];

const _catalogAlphabet = <String, int>{
  'а': 10,
  'ә': 11,
  'б': 12,
  'в': 13,
  'г': 14,
  'ғ': 15,
  'д': 16,
  'е': 17,
  'ё': 18,
  'ж': 19,
  'з': 20,
  'и': 21,
  'й': 22,
  'к': 23,
  'қ': 24,
  'л': 25,
  'м': 26,
  'н': 27,
  'ң': 28,
  'о': 29,
  'ө': 30,
  'п': 31,
  'р': 32,
  'с': 33,
  'т': 34,
  'у': 35,
  'ұ': 36,
  'ү': 37,
  'ф': 38,
  'х': 39,
  'һ': 40,
  'ц': 41,
  'ч': 42,
  'ш': 43,
  'щ': 44,
  'ъ': 45,
  'ы': 46,
  'і': 47,
  'ь': 48,
  'э': 49,
  'ю': 50,
  'я': 51,
};

int _catalogSortRuneWeight(int rune) {
  final character = String.fromCharCode(rune).toLowerCase();
  final alphabetWeight = _catalogAlphabet[character];
  if (alphabetWeight != null) return alphabetWeight;
  if (rune >= 48 && rune <= 57) return rune - 48;
  if (rune >= 65 && rune <= 90) return 100 + rune - 65;
  if (rune >= 97 && rune <= 122) return 100 + rune - 97;
  return 1000 + rune;
}

int catalogAlphabeticalCompare(String left, String right) {
  final leftRunes = left.trim().toLowerCase().runes.toList(growable: false);
  final rightRunes = right.trim().toLowerCase().runes.toList(growable: false);
  final sharedLength = min(leftRunes.length, rightRunes.length);
  for (var index = 0; index < sharedLength; index++) {
    final comparison = _catalogSortRuneWeight(
      leftRunes[index],
    ).compareTo(_catalogSortRuneWeight(rightRunes[index]));
    if (comparison != 0) return comparison;
  }
  return leftRunes.length.compareTo(rightRunes.length);
}

List<CatalogProduct> catalogProductsAlphabetically(
  Iterable<CatalogProduct> products,
) => products.toList()
  ..sort((left, right) => catalogAlphabeticalCompare(left.title, right.title));

enum _CatalogSort { menu, priceLow, priceHigh }

@immutable
class _CatalogFilterResult {
  const _CatalogFilterResult({
    required this.sort,
    required this.onlyAvailable,
    this.dietaryTags = const {},
    this.excludedAllergens = const {},
  });

  final _CatalogSort sort;
  final bool onlyAvailable;
  final Set<String> dietaryTags;
  final Set<String> excludedAllergens;

  bool get isActive =>
      sort != _CatalogSort.menu ||
      onlyAvailable ||
      dietaryTags.isNotEmpty ||
      excludedAllergens.isNotEmpty;
}
