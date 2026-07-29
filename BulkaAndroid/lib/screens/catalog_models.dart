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
    this.ingredients = '',
    this.allergens = const [],
    this.dietaryTags = const [],
    this.searchKeywords = const [],
    this.weightGrams,
    this.caloriesKcal,
    this.proteinGrams,
    this.fatGrams,
    this.carbsGrams,
    this.storageConditions = const [],
  });

  final String id;
  final String title;
  final int price;
  final String category;
  final String imageUrl;
  final int? inStockCount;
  final int preparationMinutes;
  final String description;
  final bool isStopListed;
  final String ingredients;
  final List<String> allergens;
  final List<String> dietaryTags;
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

  bool get hasComposition =>
      ingredients.trim().isNotEmpty || allergens.isNotEmpty;

  bool get hasProductDetails =>
      description.trim().isNotEmpty ||
      hasNutrition ||
      hasComposition ||
      storageConditions.isNotEmpty ||
      dietaryTags.isNotEmpty;
}

Uri catalogProductShareUri(CatalogProduct product) => Uri(
  scheme: 'https',
  host: 'bulka.com.kz',
  pathSegments: ['catalog', 'product', product.id],
  queryParameters: {'category': product.category},
);
