part of '../main.dart';

final ValueNotifier<String> appLanguageNotifier = ValueNotifier<String>('ru');

class AppLang {
  static String get current => appLanguageNotifier.value;

  static Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    final lang = prefs.getString('app_lang_code') ?? 'ru';
    appLanguageNotifier.value = lang;
  }

  static Future<void> setLanguage(String code) async {
    appLanguageNotifier.value = code;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('app_lang_code', code);
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
}

extension AppLocalizationExt on String {
  String get tr {
    final lang = appLanguageNotifier.value;
    final map = _appTranslations[this];
    if (map == null) return this;
    return map[lang] ?? map['ru'] ?? this;
  }
}

const Map<String, Map<String, String>> _appTranslations = {
  // Navigation
  'nav_home': {
    'ru': 'Главная',
    'kk': 'Басты бет',
    'en': 'Home',
  },
  'nav_catalog': {
    'ru': 'Каталог',
    'kk': 'Каталог',
    'en': 'Catalog',
  },
  'nav_cart': {
    'ru': 'Корзина',
    'kk': 'Себет',
    'en': 'Cart',
  },
  'nav_promos': {
    'ru': 'Акции',
    'kk': 'Акциялар',
    'en': 'Promos',
  },
  'nav_profile': {
    'ru': 'Профиль',
    'kk': 'Профиль',
    'en': 'Profile',
  },

  // Order types
  'order_pickup': {
    'ru': 'Самовывоз',
    'kk': 'Алып кету',
    'en': 'Pickup',
  },
  'order_delivery': {
    'ru': 'Доставка',
    'kk': 'Жеткізу',
    'en': 'Delivery',
  },
  'order_preorder': {
    'ru': 'Пред заказ',
    'kk': 'Алдын ала',
    'en': 'Preorder',
  },

  // Home screen sections
  'home_interesting': {
    'ru': 'Тут много интересного',
    'kk': 'Мұнда көп қызық бар',
    'en': 'Lots of interesting things here',
  },
  'cashback_title': {
    'ru': 'Ваш кэшбэк',
    'kk': 'Сіздің кэшбэгіңіз',
    'en': 'Your cashback',
  },

  // Profile screen
  'profile_title': {
    'ru': 'Профиль',
    'kk': 'Профиль',
    'en': 'Profile',
  },
  'select_lang_title': {
    'ru': 'Выберите язык',
    'kk': 'Тілді таңдаңыз',
    'en': 'Select language',
  },
  'apply_btn': {
    'ru': 'Применить',
    'kk': 'Қолдану',
    'en': 'Apply',
  },
  'menu_orders': {
    'ru': 'Мои заказы',
    'kk': 'Менің тапсырыстарым',
    'en': 'My orders',
  },
  'menu_personal': {
    'ru': 'Личные данные',
    'kk': 'Жеке деректер',
    'en': 'Personal data',
  },
  'menu_addresses': {
    'ru': 'Мои адреса',
    'kk': 'Менің мекенжайларым',
    'en': 'My addresses',
  },
  'menu_contact': {
    'ru': 'Связаться с нами',
    'kk': 'Бізбен байланысу',
    'en': 'Contact us',
  },
  'menu_info': {
    'ru': 'Информация',
    'kk': 'Ақпарат',
    'en': 'Information',
  },
  'menu_pin': {
    'ru': 'Создать PIN-код',
    'kk': 'PIN-код құру',
    'en': 'Create PIN code',
  },

  // Subtitles / Coming soon
  'catalog_sub': {
    'ru': 'Скоро здесь появятся любимые булочки, десерты и напитки.',
    'kk': 'Жақында мұнда сүйікті тоқаштар, десерттер мен сусындар пайда болады.',
    'en': 'Favorite pastries, desserts, and drinks will appear here soon.',
  },
  'promos_sub': {
    'ru': 'Персональные предложения и сезонные акции будут здесь.',
    'kk': 'Жеке ұсыныстар мен маусымдық акциялар осында болады.',
    'en': 'Personal offers and seasonal promotions will be here.',
  },
  'balance_prefix': {
    'ru': 'Баланс: ',
    'kk': 'Теңгерім: ',
    'en': 'Balance: ',
  },
  'points_suffix': {
    'ru': ' баллов',
    'kk': ' ұпай',
    'en': ' points',
  },
  'cashback_gift_1': {
    'ru': 'Дарим ',
    'kk': 'Әр сатылымнан ',
    'en': 'Get ',
  },
  'cashback_gift_2': {
    'ru': '% кешбэк после каждой покупки!',
    'kk': '% кэшбэк сыйлаймыз!',
    'en': '% cashback on every purchase!',
  },
};
