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
    'kk': 'Мәзір',
    'en': 'Menu',
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
  // Orders screen
  'orders_title': {
    'ru': 'Мои заказы',
    'kk': 'Менің тапсырыстарым',
    'en': 'My orders',
  },
  'orders_empty_title': {
    'ru': 'У вас пока нет заказов',
    'kk': 'Әзірге тапсырыстар жоқ',
    'en': 'No orders yet',
  },
  'orders_empty_sub': {
    'ru': 'История начислений появится после покупки.',
    'kk': 'Тапсырыс тарихы сатылымнан кейін пайда болады.',
    'en': 'Transaction history will appear after purchase.',
  },
  'check_sum': {
    'ru': 'Сумма чека',
    'kk': 'Чек сомасы',
    'en': 'Bill amount',
  },
  'tx_pay_bonus': {
    'ru': 'Оплата бонусами',
    'kk': 'Бонустармен төлеу',
    'en': 'Paid with bonuses',
  },
  'tx_cashback': {
    'ru': 'Начисление кэшбэка',
    'kk': 'Кэшбэк есептелді',
    'en': 'Cashback earned',
  },
  'tx_gift': {
    'ru': 'Подарок / Начисление',
    'kk': 'Сыйлық / Бонус қосылды',
    'en': 'Gift / Accrual',
  },
  'add_address': {
    'ru': 'Добавить адрес',
    'kk': 'Мекенжай қосу',
    'en': 'Add address',
  },
  'my_addresses': {
    'ru': 'Мои адреса',
    'kk': 'Менің мекенжайларым',
    'en': 'My addresses',
  },
  'no_addresses': {
    'ru': 'Адреса пока не добавлены',
    'kk': 'Мекенжайлар қосылмаған',
    'en': 'No addresses added yet',
  },
  // Home headers
  'home_select_order_type': {
    'ru': 'Выберите тип заказа',
    'kk': 'Тапсырыс түрін таңдаңыз',
    'en': 'Select order type',
  },
  'home_loyalty_header': {
    'ru': 'Накопительная',
    'kk': 'Жинақтау жүйесі',
    'en': 'Loyalty program',
  },
  // Loyalty panel & QR
  'show_qr_cashier': {
    'ru': 'Покажите QR-\nкод кассиру',
    'kk': 'QR-кодты\nкассирге көрсетіңіз',
    'en': 'Show QR code\nto cashier',
  },
  'open_qr_btn': {
    'ru': 'Открыть',
    'kk': 'Ашу',
    'en': 'Open',
  },
  'reward_6_desc': {
    'ru': '+1% кешбэк после 6 покупки в течение 30 дней.',
    'kk': '30 күн ішінде 6 сатып алудан кейін +1% кэшбэк.',
    'en': '+1% cashback after 6 purchases within 30 days.',
  },
  'reward_12_desc': {
    'ru': '+1% кешбэк после 12 покупки в течение 30 дней.',
    'kk': '30 күн ішінде 12 сатып алудан кейін +1% кэшбэк.',
    'en': '+1% cashback after 12 purchases within 30 days.',
  },
  'remaining_purchases': {
    'ru': 'Осталось покупок',
    'kk': 'Қалған сатып алулар',
    'en': 'Purchases remaining',
  },
  'balance_history_btn': {
    'ru': 'История баланса',
    'kk': 'Теңгерім тарихы',
    'en': 'Balance history',
  },
  'my_qr': {
    'ru': 'МОЙ QR',
    'kk': 'МЕНІҢ QR',
    'en': 'MY QR',
  },
  'qr_unavailable': {
    'ru': 'QR временно недоступен',
    'kk': 'QR уақытша қолжетімсіз',
    'en': 'QR temporarily unavailable',
  },
  'qr_update_in': {
    'ru': 'Динамический код обновится через',
    'kk': 'Динамикалық код жаңарады:',
    'en': 'Dynamic code updates in',
  },
  'add_apple_wallet': {
    'ru': 'Добавить в Apple Wallet',
    'kk': 'Apple Wallet-қа қосу',
    'en': 'Add to Apple Wallet',
  },
  'add_google_wallet': {
    'ru': 'Добавить в Google Wallet',
    'kk': 'Google Wallet-қа қосу',
    'en': 'Add to Google Wallet',
  },
  // Login screen
  'login_brand_title': {
    'ru': 'Регистрация/Вход',
    'kk': 'Тіркелу/Кіру',
    'en': 'Register/Login',
  },
  'reg_title': {
    'ru': 'Авторизация',
    'kk': 'Авторизация',
    'en': 'Registration',
  },
  'reg_gender_label': {
    'ru': 'Выберите пол',
    'kk': 'Жынысты таңдаңыз',
    'en': 'Select gender',
  },
  'reg_male': {
    'ru': 'Мужчина',
    'kk': 'Ер',
    'en': 'Male',
  },
  'reg_female': {
    'ru': 'Женщина',
    'kk': 'Әйел',
    'en': 'Female',
  },
  'reg_name_hint': {
    'ru': 'Имя',
    'kk': 'Аты',
    'en': 'First name',
  },
  'reg_surname_hint': {
    'ru': 'Фамилия',
    'kk': 'Тегі',
    'en': 'Last name',
  },
  'reg_dob_hint': {
    'ru': 'Дата рождения',
    'kk': 'Туған күні',
    'en': 'Date of birth',
  },
  'reg_email_hint': {
    'ru': 'E-mail',
    'kk': 'E-mail',
    'en': 'E-mail',
  },
  'reg_terms_checkbox': {
    'ru': 'Ознакомился (-лась) и подтверждаю принятие условий',
    'kk': 'Шарттармен таныстым және қабылдаймын',
    'en': 'I have read and agree to the terms',
  },
  'reg_next_btn': {
    'ru': 'Далее',
    'kk': 'Жалғастыру',
    'en': 'Continue',
  },
  'reg_err_name': {
    'ru': 'Пожалуйста, введите имя',
    'kk': 'Атыңызды енгізіңіз',
    'en': 'Please enter your name',
  },
  'reg_err_terms': {
    'ru': 'Необходимо принять условия',
    'kk': 'Шарттарды қабылдау қажет',
    'en': 'You must agree to the terms',
  },
  'splash_loading': {
    'ru': 'Загрузка...',
    'kk': 'Жүктелуде...',
    'en': 'Loading...',
  },
  'splash_loading_profile': {
    'ru': 'Загрузка профиля...',
    'kk': 'Профиль жүктелуде...',
    'en': 'Loading profile...',
  },
  'login_step_1': {
    'ru': 'Шаг 1 из 2',
    'kk': '1-қадам / 2',
    'en': 'Step 1 of 2',
  },
  'login_phone_title': {
    'ru': 'Вход по номеру',
    'kk': 'Нөмір бойынша кіру',
    'en': 'Sign in with phone',
  },
  'login_phone_sub': {
    'ru': 'Укажите номер, привязанный к карте гостя Bulka.',
    'kk': 'Bulka қонақ картасына тіркелген нөмірді көрсетіңіз.',
    'en': 'Enter the phone number linked to your Bulka guest card.',
  },
  'phone_label': {
    'ru': 'Номер телефона',
    'kk': 'Телефон нөмірі',
    'en': 'Phone number',
  },
  'open_telegram': {
    'ru': 'ОТКРЫТЬ TELEGRAM',
    'kk': 'TELEGRAM АШУ',
    'en': 'OPEN TELEGRAM',
  },
  'login_step_2': {
    'ru': 'Шаг 2 из 2',
    'kk': '2-қадам / 2',
    'en': 'Step 2 of 2',
  },
  'confirm_phone_title': {
    'ru': 'Подтвердите ваш номер',
    'kk': 'Нөміріңізді растаңыз',
    'en': 'Confirm your number',
  },
  'code_sent_whatsapp': {
    'ru': 'Код отправлен через WhatsApp.',
    'kk': 'Код WhatsApp арқылы жіберілді.',
    'en': 'Code sent via WhatsApp.',
  },
  'code_for': {
    'ru': 'Код для ',
    'kk': 'Код нөмірге: ',
    'en': 'Code for ',
  },
  'enter_4_digits': {
    'ru': 'Введите 4 цифры из сообщения',
    'kk': 'Хабарламадағы 4 санды енгізіңіз',
    'en': 'Enter 4 digits from the message',
  },
  'valid_few_mins': {
    'ru': 'Действует несколько минут',
    'kk': 'Бірнеше минут жарамды',
    'en': 'Valid for a few minutes',
  },
  'login_btn': {
    'ru': 'Войти',
    'kk': 'Кіру',
    'en': 'Sign in',
  },
  'change_phone_btn': {
    'ru': 'Изменить номер',
    'kk': 'Нөмірді өзгерту',
    'en': 'Change phone number',
  },
  'get_code_whatsapp': {
    'ru': 'Получить код в WhatsApp',
    'kk': 'WhatsApp арқылы код алу',
    'en': 'Get code via WhatsApp',
  },
  'news_title': {
    'ru': 'Новости',
    'kk': 'Жаңалықтар',
    'en': 'News',
  },
  'news_sub': {
    'ru': 'Свежие акции, сезонные вкусы и новости пекарни',
    'kk': 'Жаңа акциялар, маусымдық дәмдер мен наубайхана жаңалықтары',
    'en': 'Fresh promotions, seasonal tastes and bakery news',
  },
  'news_badge': {
    'ru': 'НОВОСТЬ',
    'kk': 'ЖАҢАЛЫҚ',
    'en': 'NEWS',
  },
  'collapse_tooltip': {
    'ru': 'Свернуть',
    'kk': 'Жиыру',
    'en': 'Collapse',
  },
  'expand_tooltip': {
    'ru': 'Развернуть',
    'kk': 'Жаю',
    'en': 'Expand',
  },
  'logout_confirm_title': {
    'ru': 'Выйти из аккаунта?',
    'kk': 'Аккаунттан шығу?',
    'en': 'Log out of account?',
  },
  'logout_confirm_msg': {
    'ru': 'Вы уверены, что хотите выйти из аккаунта Bulka пекарня?',
    'kk': 'Bulka пекарня аккаунтынан шыққыңыз келетініне сенімдісіз бе?',
    'en': 'Are you sure you want to log out of your Bulka account?',
  },
  'logout_confirm_cancel': {
    'ru': 'Отмена',
    'kk': 'Болдырмау',
    'en': 'Cancel',
  },
  'logout_confirm_yes': {
    'ru': 'Выйти',
    'kk': 'Шығу',
    'en': 'Log out',
  },
};

String localizeTransactionLabel(String label) {
  final l = label.toLowerCase();
  if (l.contains('оплата бонусами') || l.contains('списание')) {
    return 'tx_pay_bonus'.tr;
  }
  if (l.contains('начисление кэшбэка') || l.contains('кешбэк') || l.contains('кэшбэк')) {
    return 'tx_cashback'.tr;
  }
  if (l.contains('подарок') || l.contains('начисление')) {
    return 'tx_gift'.tr;
  }
  return label;
}
