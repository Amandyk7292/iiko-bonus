part of '../main.dart';

@immutable
class ProductStorageCondition {
  const ProductStorageCondition({
    required this.temperature,
    required this.durationValue,
    required this.durationUnit,
  });

  final String temperature;
  final int durationValue;
  final String durationUnit;
}

List<ProductStorageCondition> productStorageConditionsFromJson(dynamic value) {
  final source = value is List ? value : const [];
  return source
      .take(2)
      .map((raw) {
        final condition = _asMap(raw);
        final temperature = _asString(condition['temperature']).trim();
        final durationRaw =
            condition['durationValue'] ?? condition['duration_value'];
        final durationValue = durationRaw is num
            ? durationRaw.round()
            : int.tryParse('$durationRaw') ?? 0;
        final durationUnit = _asString(
          condition['durationUnit'] ?? condition['duration_unit'],
        ).trim();
        if (temperature.isEmpty ||
            durationValue <= 0 ||
            !const {'hours', 'days', 'months'}.contains(durationUnit)) {
          return null;
        }
        return ProductStorageCondition(
          temperature: temperature,
          durationValue: durationValue,
          durationUnit: durationUnit,
        );
      })
      .whereType<ProductStorageCondition>()
      .toList();
}

String productStorageDurationLabel(ProductStorageCondition condition) {
  final value = condition.durationValue;
  final language = appLanguageNotifier.value;
  final form = language == 'ru'
      ? (value % 10 == 1 && value % 100 != 11
            ? 'one'
            : value % 10 >= 2 &&
                  value % 10 <= 4 &&
                  (value % 100 < 12 || value % 100 > 14)
            ? 'few'
            : 'many')
      : language == 'en' && value == 1
      ? 'one'
      : 'many';
  return 'catalog_storage_${condition.durationUnit}_$form'.trArgs({
    'count': value,
  });
}

class CatalogProduct {
  const CatalogProduct({
    required this.id,
    required this.title,
    required this.price,
    required this.category,
    required this.imageUrl,
    required this.inStockCount,
    required this.preparationMinutes,
    this.description = '',
    this.isStopListed = false,
    this.catalogAvailable,
    this.ingredients = '',
    this.allergens = const [],
    this.dietaryTags = const [],
    this.badges = const [],
    this.searchKeywords = const [],
    this.weightGrams,
    this.caloriesKcal,
    this.proteinGrams,
    this.fatGrams,
    this.carbsGrams,
    this.storageConditions = const [],
    this.quantityStep = 1,
    this.unit = 'шт.',
  });

  final String id;
  final String title;
  final int price;
  final String category;
  final String imageUrl;
  final num? inStockCount;
  final num quantityStep;
  final String unit;
  num get increment => quantityStep < 1 ? max<num>(quantityStep, 0.5) : 1;
  final int preparationMinutes;
  final String description;
  final bool isStopListed;
  final bool? catalogAvailable;

  CatalogProduct withStock({
    required num? quantity,
    required bool available,
    required num step,
    required String stockUnit,
  }) => CatalogProduct(
    id: id,
    title: title,
    price: price,
    category: category,
    imageUrl: imageUrl,
    inStockCount: quantity,
    quantityStep: step,
    unit: stockUnit,
    preparationMinutes: preparationMinutes,
    description: description,
    // Old cached menus lack the global flag. Refresh counts but keep any
    // existing stop until a full menu confirms that it can be cleared.
    isStopListed: !(catalogAvailable ?? !isStopListed) || !available,
    catalogAvailable: catalogAvailable,
    ingredients: ingredients,
    allergens: allergens,
    dietaryTags: dietaryTags,
    badges: badges,
    searchKeywords: searchKeywords,
    weightGrams: weightGrams,
    caloriesKcal: caloriesKcal,
    proteinGrams: proteinGrams,
    fatGrams: fatGrams,
    carbsGrams: carbsGrams,
    storageConditions: storageConditions,
  );
  final String ingredients;
  final List<String> allergens;
  final List<String> dietaryTags;
  final List<Map<String, dynamic>> badges;
  final List<String> searchKeywords;
  final int? weightGrams;
  final double? caloriesKcal;
  final double? proteinGrams;
  final double? fatGrams;
  final double? carbsGrams;
  final List<ProductStorageCondition> storageConditions;

  bool get hasNutrition =>
      caloriesKcal != null ||
      proteinGrams != null ||
      fatGrams != null ||
      carbsGrams != null;

  bool get hasAllergens => allergens.isNotEmpty;

  bool get hasProductDetails =>
      description.trim().isNotEmpty ||
      hasNutrition ||
      hasAllergens ||
      storageConditions.isNotEmpty ||
      dietaryTags.isNotEmpty;
}

Uri catalogProductShareUri(CatalogProduct product) =>
    Uri.parse('https://bulka.com.kz').resolveUri(productClientUri(product.id));

String catalogProductShareText(CatalogProduct product) =>
    catalogProductShareUri(product).toString();
