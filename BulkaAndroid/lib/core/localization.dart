part of '../main.dart';

final ValueNotifier<String> appLanguageNotifier = ValueNotifier<String>('ru');

class AppLang {
  static const supportedCodes = {'ru', 'kk', 'en'};

  static String get current => appLanguageNotifier.value;

  static Locale get locale => Locale(current);

  static Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString('app_lang_code');
    final deviceCode = ui.PlatformDispatcher.instance.locale.languageCode;
    final lang = supportedCodes.contains(saved)
        ? saved!
        : supportedCodes.contains(deviceCode)
        ? deviceCode
        : 'ru';
    appLanguageNotifier.value = lang;
    updateDocumentLanguage(lang);
  }

  static Future<void> setLanguage(String code) async {
    final next = supportedCodes.contains(code) ? code : 'ru';
    if (appLanguageNotifier.value != next) {
      appLanguageNotifier.value = next;
    }
    updateDocumentLanguage(next);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('app_lang_code', next);
  }

  static String codeFromName(String name) {
    switch (name) {
      case 'Қазақша':
        return 'kk';
      case 'English':
        return 'en';
      default:
        return 'ru';
    }
  }

  static String nameFromCode(String code) {
    switch (code) {
      case 'kk':
        return 'Қазақша';
      case 'en':
        return 'English';
      default:
        return 'Русский';
    }
  }

  static String shortLabel(String code) {
    switch (code) {
      case 'kk':
        return 'Kz';
      case 'en':
        return 'En';
      default:
        return 'Ru';
    }
  }

  static String languageName(String code) {
    switch (code) {
      case 'kk':
        return 'Қазақша';
      case 'en':
        return 'English';
      default:
        return 'Русский';
    }
  }
}

Uri bulkaLegalPageUri(String slug, {String? language}) {
  final requestedLanguage = language ?? AppLang.current;
  final languageCode = AppLang.supportedCodes.contains(requestedLanguage)
      ? requestedLanguage
      : 'ru';
  final normalizedSlug = slug.replaceAll(RegExp(r'^/+|/+$'), '');
  final localizedPath = languageCode == 'ru'
      ? '/$normalizedSlug'
      : '/$languageCode/$normalizedSlug';
  return Uri.https('bulka.com.kz', localizedPath);
}

extension AppLocalizationExt on String {
  String get tr => localizedAppText(this);

  String trArgs(Map<String, Object?> arguments) {
    return localizedAppText(this, arguments: arguments);
  }
}

String localizedAppText(
  String key, {
  String? language,
  Map<String, Object?> arguments = const {},
}) {
  final lang = AppLang.supportedCodes.contains(language)
      ? language!
      : appLanguageNotifier.value;
  final map = _appTranslations[key];
  var value = map?[lang] ?? map?['ru'] ?? key;
  for (final entry in arguments.entries) {
    value = value.replaceAll('{${entry.key}}', '${entry.value ?? ''}');
  }
  return value;
}

@visibleForTesting
List<String> translationValidationErrors() {
  final errors = <String>[];
  for (final entry in _appTranslations.entries) {
    for (final code in AppLang.supportedCodes) {
      if ((entry.value[code] ?? '').trim().isEmpty) {
        errors.add('${entry.key}:$code');
      }
    }
  }
  return errors;
}

@visibleForTesting
bool hasAppTranslationKey(String key) => _appTranslations.containsKey(key);

const Map<String, Map<String, String>> _appTranslations = {
  ..._navigationAndProfileTranslations,
  ..._featureStateTranslations,
  ..._commerceTranslations,
  ..._homeAndLoyaltyTranslations,
  ..._loginTranslations,
  ..._commonTranslations,
  ..._locationTranslations,
  ..._accountTranslations,
  ..._orderAndPaymentTranslations,
};

String localizeCatalogOptionLabel(String value) {
  final raw = value.trim();
  if (raw.isEmpty) return raw;
  final normalized = raw.toLowerCase().replaceAll(RegExp(r'\s+'), ' ');
  const keys = <String, String>{
    'размер': 'catalog_option_size',
    'өлшем': 'catalog_option_size',
    'size': 'catalog_option_size',
    'добавки': 'catalog_option_addons',
    'қоспалар': 'catalog_option_addons',
    'add-ons': 'catalog_option_addons',
    'упаковка': 'catalog_option_packaging',
    'қаптама': 'catalog_option_packaging',
    'packaging': 'catalog_option_packaging',
    'маленький': 'catalog_option_small',
    'кішкентай': 'catalog_option_small',
    'small': 'catalog_option_small',
    'средний': 'catalog_option_medium',
    'орташа': 'catalog_option_medium',
    'medium': 'catalog_option_medium',
    'большой': 'catalog_option_large',
    'үлкен': 'catalog_option_large',
    'large': 'catalog_option_large',
    'стандарт': 'catalog_option_standard',
    'стандартный': 'catalog_option_standard',
    'стандартты': 'catalog_option_standard',
    'standard': 'catalog_option_standard',
    'без добавок': 'catalog_option_no_addons',
    'қоспасыз': 'catalog_option_no_addons',
    'no add-ons': 'catalog_option_no_addons',
    'ванильная': 'catalog_option_vanilla',
    'ванильный': 'catalog_option_vanilla',
    'ванильді': 'catalog_option_vanilla',
    'vanilla': 'catalog_option_vanilla',
    'шоколадная': 'catalog_option_chocolate',
    'шоколадный': 'catalog_option_chocolate',
    'шоколадты': 'catalog_option_chocolate',
    'chocolate': 'catalog_option_chocolate',
    'красный бархат': 'catalog_option_red_velvet',
    'қызыл барқыт': 'catalog_option_red_velvet',
    'red velvet': 'catalog_option_red_velvet',
    'фотопечать': 'catalog_option_photo_print',
    'фотобаспа': 'catalog_option_photo_print',
    'photo print': 'catalog_option_photo_print',
    'ягоды': 'catalog_option_berries',
    'жидектер': 'catalog_option_berries',
    'berries': 'catalog_option_berries',
  };
  final key = keys[normalized];
  return key == null ? raw : key.tr;
}

String localizeAllergenLabel(String value) {
  final raw = value.trim();
  final normalized = raw.toLowerCase().replaceAll(RegExp(r'[\s-]+'), '_');
  const keys = <String, String>{
    'gluten': 'allergen_gluten',
    'глютен': 'allergen_gluten',
    'milk': 'allergen_milk',
    'молоко': 'allergen_milk',
    'сүт': 'allergen_milk',
    'egg': 'allergen_egg',
    'eggs': 'allergen_egg',
    'яйцо': 'allergen_egg',
    'яйца': 'allergen_egg',
    'жұмыртқа': 'allergen_egg',
    'nuts': 'allergen_nuts',
    'tree_nuts': 'allergen_nuts',
    'орехи': 'allergen_nuts',
    'жаңғақтар': 'allergen_nuts',
    'peanut': 'allergen_peanut',
    'peanuts': 'allergen_peanut',
    'арахис': 'allergen_peanut',
    'жержаңғақ': 'allergen_peanut',
    'sesame': 'allergen_sesame',
    'кунжут': 'allergen_sesame',
    'күнжіт': 'allergen_sesame',
    'soy': 'allergen_soy',
    'соя': 'allergen_soy',
  };
  final key = keys[normalized];
  return key == null ? raw : key.tr;
}

String localizeProductMarkLabel(String value) {
  final raw = value.trim();
  final normalized = raw.toLowerCase().replaceAll(RegExp(r'[\s-]+'), '_');
  const keys = <String, String>{
    'halal': 'product_mark_halal',
    'халяль': 'product_mark_halal',
    'eac': 'product_mark_eac',
    'iso': 'product_mark_iso',
    'traces_nuts_sesame': 'product_mark_traces_nuts_sesame',
    'может_содержать_следы_орехов_и_кунжута': 'product_mark_traces_nuts_sesame',
    'возможны_следы_орехов_и_кунжута': 'product_mark_traces_nuts_sesame',
    'not_for_under_3': 'product_mark_not_for_under_3',
    'не_рекомендуется_детям_до_3_лет': 'product_mark_not_for_under_3',
    'vegetarian': 'product_mark_vegetarian',
    'вегетарианское': 'product_mark_vegetarian',
    'vegan': 'product_mark_vegan',
    'веганское': 'product_mark_vegan',
    'sugar_free': 'product_mark_sugar_free',
    'без_сахара': 'product_mark_sugar_free',
    'lactose_free': 'product_mark_lactose_free',
    'без_лактозы': 'product_mark_lactose_free',
  };
  final key = keys[normalized];
  return key == null ? raw : key.tr;
}

String localizeTransactionLabel(String label) {
  final l = label.toLowerCase();
  if (l.contains('оплата бонусами') || l.contains('списание')) {
    return 'tx_pay_bonus'.tr;
  }
  if (l.contains('начисление кэшбэка') ||
      l.contains('кешбэк') ||
      l.contains('кэшбэк')) {
    return 'tx_cashback'.tr;
  }
  if (l.contains('подарок') || l.contains('начисление')) {
    return 'tx_gift'.tr;
  }
  return label;
}

String localizeTransactionType(String type, {required bool isEarning}) {
  switch (type.toLowerCase()) {
    case 'deposit':
      return 'tx_cashback'.tr;
    case 'manual_deposit':
      return 'tx_gift'.tr;
    case 'withdrawal':
      return 'tx_pay_bonus'.tr;
    case 'manual_withdrawal':
      return 'tx_manual_withdrawal'.tr;
    case 'expiration':
      return 'tx_expiration'.tr;
    case 'refund_reversal':
      return 'tx_refund_reversal'.tr;
    case 'cancelled_deposit':
      return 'tx_cancelled_deposit'.tr;
    default:
      return isEarning ? 'tx_earning'.tr : 'tx_withdrawal'.tr;
  }
}

String localizeTierName(String? name) {
  final value = (name ?? '').trim();
  final normalized = value.toLowerCase();
  if ({'бронза', 'қола', 'bronze'}.contains(normalized)) {
    return 'tier_bronze'.tr;
  }
  if ({'серебро', 'күміс', 'silver'}.contains(normalized)) {
    return 'tier_silver'.tr;
  }
  if ({'золото', 'алтын', 'gold'}.contains(normalized)) {
    return 'tier_gold'.tr;
  }
  if ({'платина', 'platinum'}.contains(normalized)) {
    return 'tier_platinum'.tr;
  }
  return value.isEmpty ? 'tier_base'.tr : value;
}

bool isGuestName(String name) {
  final normalized = name.trim().toLowerCase();
  return normalized.isEmpty || {'гость', 'қонақ', 'guest'}.contains(normalized);
}
