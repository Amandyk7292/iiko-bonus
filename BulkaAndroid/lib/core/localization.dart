part of '../main.dart';

final ValueNotifier<String> appLanguageNotifier = ValueNotifier<String>('ru');

class AppLang {
  static const supportedCodes = {'ru', 'kk', 'en'};

  static String get current => appLanguageNotifier.value;

  static Locale get locale => Locale(current);

  static Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString('app_lang_code');
    final lang = supportedCodes.contains(saved) ? saved! : 'ru';
    appLanguageNotifier.value = lang;
  }

  static Future<void> setLanguage(String code) async {
    final next = supportedCodes.contains(code) ? code : 'ru';
    if (appLanguageNotifier.value != next) {
      appLanguageNotifier.value = next;
    }
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

extension AppLocalizationExt on String {
  String get tr {
    final lang = appLanguageNotifier.value;
    final map = _appTranslations[this];
    if (map == null) return this;
    return map[lang] ?? map['ru'] ?? this;
  }

  String trArgs(Map<String, Object?> arguments) {
    var value = tr;
    for (final entry in arguments.entries) {
      value = value.replaceAll('{${entry.key}}', '${entry.value ?? ''}');
    }
    return value;
  }
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

const Map<String, Map<String, String>> _appTranslations = {
  // Navigation
  'nav_home': {'ru': 'Главная', 'kk': 'Басты бет', 'en': 'Home'},
  'nav_catalog': {'ru': 'Каталог', 'kk': 'Мәзір', 'en': 'Menu'},
  'nav_cart': {'ru': 'Корзина', 'kk': 'Себет', 'en': 'Cart'},
  'nav_promos': {'ru': 'Акции', 'kk': 'Акциялар', 'en': 'Promos'},
  'nav_profile': {'ru': 'Профиль', 'kk': 'Профиль', 'en': 'Profile'},

  // Order types
  'order_pickup': {'ru': 'Самовывоз', 'kk': 'Алып кету', 'en': 'Pickup'},
  'order_delivery': {'ru': 'Доставка', 'kk': 'Жеткізу', 'en': 'Delivery'},
  'order_preorder': {'ru': 'Пред заказ', 'kk': 'Алдын ала', 'en': 'Preorder'},

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
  'profile_title': {'ru': 'Профиль', 'kk': 'Профиль', 'en': 'Profile'},
  'select_lang_title': {
    'ru': 'Выберите язык',
    'kk': 'Тілді таңдаңыз',
    'en': 'Select language',
  },
  'apply_btn': {'ru': 'Применить', 'kk': 'Қолдану', 'en': 'Apply'},
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
  'menu_info': {'ru': 'Информация', 'kk': 'Ақпарат', 'en': 'Information'},
  'menu_pin': {
    'ru': 'Создать PIN-код',
    'kk': 'PIN-код құру',
    'en': 'Create PIN code',
  },

  // Helpful feature states
  'catalog_sub': {
    'ru':
        'Ассортимент зависит от пекарни. Выберите локацию, чтобы уточнить наличие.',
    'kk':
        'Ассортимент наубайханаға байланысты. Қолжетімділікті нақтылау үшін орынды таңдаңыз.',
    'en':
        'The assortment depends on the bakery. Select a location to check availability.',
  },
  'promos_sub': {
    'ru': 'Актуальные акции и новости доступны на главной странице.',
    'kk': 'Өзекті акциялар мен жаңалықтар басты бетте қолжетімді.',
    'en': 'Current promotions and news are available on the home screen.',
  },
  'catalog_action': {
    'ru': 'Выбрать пекарню',
    'kk': 'Наубайхананы таңдау',
    'en': 'Select bakery',
  },
  'promos_action': {
    'ru': 'Открыть главную',
    'kk': 'Басты бетті ашу',
    'en': 'Open home',
  },
  'balance_prefix': {'ru': 'Баланс: ', 'kk': 'Теңгерім: ', 'en': 'Balance: '},
  'points_suffix': {'ru': ' баллов', 'kk': ' ұпай', 'en': ' points'},
  'cashback_gift_1': {'ru': 'Дарим ', 'kk': 'Әр сатылымнан ', 'en': 'Get '},
  'cashback_gift_2': {
    'ru': '% кешбэк после каждой покупки!',
    'kk': '% кэшбэк сыйлаймыз!',
    'en': '% cashback on every purchase!',
  },
  // Orders & Cart screen
  'balance_history_title': {
    'ru': 'История баланса',
    'kk': 'Баланс тарихы',
    'en': 'Balance history',
  },
  'cart_empty_title': {
    'ru': 'Ой!',
    'kk': 'Ой!',
    'en': 'Oops!',
  },
  'cart_empty_sub': {
    'ru': 'Ничего не найдено!',
    'kk': 'Ештеңе табылмады!',
    'en': 'Nothing found!',
  },
  'cart_action': {
    'ru': 'Перейти в меню',
    'kk': 'Мәзірге өту',
    'en': 'Go to menu',
  },
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
  'check_sum': {'ru': 'Сумма чека', 'kk': 'Чек сомасы', 'en': 'Bill amount'},
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
  'open_qr_btn': {'ru': 'Открыть', 'kk': 'Ашу', 'en': 'Open'},
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
  'my_qr': {'ru': 'МОЙ QR', 'kk': 'МЕНІҢ QR', 'en': 'MY QR'},
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
  'reg_title': {'ru': 'Авторизация', 'kk': 'Авторизация', 'en': 'Registration'},
  'reg_gender_label': {
    'ru': 'Выберите пол',
    'kk': 'Жынысты таңдаңыз',
    'en': 'Select gender',
  },
  'reg_male': {'ru': 'Мужчина', 'kk': 'Ер', 'en': 'Male'},
  'reg_female': {'ru': 'Женщина', 'kk': 'Әйел', 'en': 'Female'},
  'reg_name_hint': {'ru': 'Имя', 'kk': 'Аты', 'en': 'First name'},
  'reg_surname_hint': {'ru': 'Фамилия', 'kk': 'Тегі', 'en': 'Last name'},
  'reg_dob_hint': {
    'ru': 'Дата рождения',
    'kk': 'Туған күні',
    'en': 'Date of birth',
  },
  'reg_email_hint': {'ru': 'E-mail', 'kk': 'E-mail', 'en': 'E-mail'},
  'reg_terms_checkbox': {
    'ru': 'Ознакомился (-лась) и подтверждаю принятие условий',
    'kk': 'Шарттармен таныстым және қабылдаймын',
    'en': 'I have read and agree to the terms',
  },
  'reg_next_btn': {'ru': 'Далее', 'kk': 'Жалғастыру', 'en': 'Continue'},
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
  'code_for': {'ru': 'Код для ', 'kk': 'Код нөмірге: ', 'en': 'Code for '},
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
  'login_btn': {'ru': 'Войти', 'kk': 'Кіру', 'en': 'Sign in'},
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
  'open_whatsapp': {
    'ru': 'Открыть WhatsApp ещё раз',
    'kk': 'WhatsApp-ты қайта ашу',
    'en': 'Open WhatsApp again',
  },
  'news_title': {'ru': 'Новости', 'kk': 'Жаңалықтар', 'en': 'News'},
  'news_sub': {
    'ru': 'Свежие акции, сезонные вкусы и новости пекарни',
    'kk': 'Жаңа акциялар, маусымдық дәмдер мен наубайхана жаңалықтары',
    'en': 'Fresh promotions, seasonal tastes and bakery news',
  },
  'news_badge': {'ru': 'НОВОСТЬ', 'kk': 'ЖАҢАЛЫҚ', 'en': 'NEWS'},
  'collapse_tooltip': {'ru': 'Свернуть', 'kk': 'Жиыру', 'en': 'Collapse'},
  'expand_tooltip': {'ru': 'Развернуть', 'kk': 'Жаю', 'en': 'Expand'},
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
  'logout_confirm_cancel': {'ru': 'Отмена', 'kk': 'Болдырмау', 'en': 'Cancel'},
  'logout_confirm_yes': {'ru': 'Выйти', 'kk': 'Шығу', 'en': 'Log out'},

  // Common actions, semantics and errors
  'app_title': {
    'ru': 'Bulka пекарня',
    'kk': 'Bulka наубайханасы',
    'en': 'Bulka Bakery',
  },
  'back_tooltip': {'ru': 'Назад', 'kk': 'Артқа', 'en': 'Back'},
  'close_tooltip': {'ru': 'Закрыть', 'kk': 'Жабу', 'en': 'Close'},
  'language_tooltip': {
    'ru': 'Сменить язык',
    'kk': 'Тілді ауыстыру',
    'en': 'Change language',
  },
  'retry_btn': {'ru': 'Повторить', 'kk': 'Қайталау', 'en': 'Retry'},
  'refresh_btn': {'ru': 'Обновить', 'kk': 'Жаңарту', 'en': 'Refresh'},
  'continue_btn': {'ru': 'Продолжить', 'kk': 'Жалғастыру', 'en': 'Continue'},
  'confirm_btn': {'ru': 'Подтвердить', 'kk': 'Растау', 'en': 'Confirm'},
  'cancel_btn': {'ru': 'Отмена', 'kk': 'Болдырмау', 'en': 'Cancel'},
  'save_btn': {'ru': 'Сохранить', 'kk': 'Сақтау', 'en': 'Save'},
  'delete_btn': {'ru': 'Удалить', 'kk': 'Жою', 'en': 'Delete'},
  'search_hint': {'ru': 'Поиск', 'kk': 'Іздеу', 'en': 'Search'},
  'error_generic': {
    'ru': 'Не удалось выполнить действие. Повторите попытку.',
    'kk': 'Әрекетті орындау мүмкін болмады. Қайталап көріңіз.',
    'en': 'The action could not be completed. Please try again.',
  },
  'error_network': {
    'ru': 'Нет связи с сервером. Проверьте интернет и повторите.',
    'kk': 'Сервермен байланыс жоқ. Интернетті тексеріп, қайталаңыз.',
    'en': 'Cannot reach the server. Check your connection and retry.',
  },
  'error_load_cities': {
    'ru': 'Не удалось загрузить города.',
    'kk': 'Қалаларды жүктеу мүмкін болмады.',
    'en': 'Could not load cities.',
  },
  'error_send_code': {
    'ru': 'Не удалось отправить код. Повторите.',
    'kk': 'Кодты жіберу мүмкін болмады. Қайталаңыз.',
    'en': 'Could not send the code. Please retry.',
  },
  'error_invalid_code': {
    'ru': 'Код неверный или истёк. Запросите новый.',
    'kk': 'Код қате немесе мерзімі өткен. Жаңа код сұраңыз.',
    'en': 'The code is invalid or expired. Request a new one.',
  },
  'error_register': {
    'ru': 'Не удалось завершить регистрацию.',
    'kk': 'Тіркелуді аяқтау мүмкін болмады.',
    'en': 'Could not complete registration.',
  },
  'error_save': {
    'ru': 'Не удалось сохранить изменения.',
    'kk': 'Өзгерістерді сақтау мүмкін болмады.',
    'en': 'Could not save your changes.',
  },
  'error_delete_account': {
    'ru': 'Не удалось удалить аккаунт.',
    'kk': 'Аккаунтты жою мүмкін болмады.',
    'en': 'Could not delete the account.',
  },
  'error_session_missing': {
    'ru': 'Сервер не создал сессию. Войдите ещё раз.',
    'kk': 'Сервер сессия жасамады. Қайта кіріңіз.',
    'en': 'The server did not create a session. Sign in again.',
  },
  'error_registration_missing': {
    'ru': 'Сервер не создал регистрацию. Повторите.',
    'kk': 'Сервер тіркелуді жасамады. Қайталаңыз.',
    'en': 'The server did not start registration. Please retry.',
  },
  'error_open_whatsapp': {
    'ru': 'Не удалось открыть WhatsApp.',
    'kk': 'WhatsApp қолданбасын ашу мүмкін болмады.',
    'en': 'Could not open WhatsApp.',
  },
  'whatsapp_fallback_instruction': {
    'ru': 'Откройте WhatsApp и напишите в поддержку Bulka, чтобы получить код.',
    'kk': 'WhatsApp-ты ашып, код алу үшін Bulka қолдау қызметіне жазыңыз.',
    'en': 'Open WhatsApp and message Bulka support to receive the code.',
  },
  'whatsapp_phone_instruction': {
    'ru': 'Откройте WhatsApp и напишите на номер {phone}, чтобы получить код.',
    'kk': 'WhatsApp-ты ашып, код алу үшін {phone} нөміріне жазыңыз.',
    'en': 'Open WhatsApp and message {phone} to receive the code.',
  },
  'error_open_telegram': {
    'ru': 'Не удалось открыть Telegram.',
    'kk': 'Telegram қолданбасын ашу мүмін болмады.',
    'en': 'Could not open Telegram.',
  },
  'error_open_wallet': {
    'ru': 'Не удалось открыть Wallet.',
    'kk': 'Wallet қолданбасын ашу мүмкін болмады.',
    'en': 'Could not open Wallet.',
  },
  'wallet_unavailable': {
    'ru': 'Wallet временно недоступен.',
    'kk': 'Wallet уақытша қолжетімсіз.',
    'en': 'Wallet is temporarily unavailable.',
  },
  'registration_unavailable': {
    'ru': 'Регистрация недоступна. Обновите приложение.',
    'kk': 'Тіркелу қолжетімсіз. Қолданбаны жаңартыңыз.',
    'en': 'Registration is unavailable. Update the app.',
  },
  'required_field': {
    'ru': 'Заполните поле',
    'kk': 'Өрісті толтырыңыз',
    'en': 'Complete this field',
  },
  'invalid_email': {
    'ru': 'Проверьте адрес e-mail',
    'kk': 'E-mail мекенжайын тексеріңіз',
    'en': 'Check the email address',
  },

  // Addresses and locations
  'locations_title': {'ru': 'Локации', 'kk': 'Орындар', 'en': 'Locations'},
  'locations_tooltip': {
    'ru': 'Открыть локации',
    'kk': 'Орындарды ашу',
    'en': 'Open locations',
  },
  'notifications_tooltip': {
    'ru': 'Уведомления',
    'kk': 'Хабарламалар',
    'en': 'Notifications',
  },
  'notification_center_title': {
    'ru': 'Уведомления',
    'kk': 'Хабарламалар',
    'en': 'Notifications',
  },
  'notifications_empty': {
    'ru': 'Пока нет новых уведомлений',
    'kk': 'Жаңа хабарламалар әзірге жоқ',
    'en': 'No notifications yet',
  },
  'notifications_read_all': {
    'ru': 'Прочитать все',
    'kk': 'Барлығын оқу',
    'en': 'Mark all read',
  },
  'bakery_selected': {
    'ru': 'Выбрана локация: {name}',
    'kk': 'Таңдалған орын: {name}',
    'en': 'Selected location: {name}',
  },
  'select_address_title': {
    'ru': 'Выберите адрес',
    'kk': 'Мекенжайды таңдаңыз',
    'en': 'Select an address',
  },
  'no_addresses_sub': {
    'ru': 'Добавьте адрес для быстрого оформления доставки.',
    'kk': 'Жеткізуді жылдам рәсімдеу үшін мекенжай қосыңыз.',
    'en': 'Add an address for faster delivery checkout.',
  },
  'address_title_label': {
    'ru': 'Название адреса',
    'kk': 'Мекенжай атауы',
    'en': 'Address name',
  },
  'house_label': {'ru': 'Дом', 'kk': 'Үй', 'en': 'House'},
  'floor_label': {'ru': 'Этаж', 'kk': 'Қабат', 'en': 'Floor'},
  'apartment_label': {'ru': 'Квартира', 'kk': 'Пәтер', 'en': 'Apartment'},
  'courier_comment_label': {
    'ru': 'Комментарий для курьера',
    'kk': 'Курьерге пікір',
    'en': 'Courier note',
  },
  'input_hint': {'ru': 'Введите', 'kk': 'Енгізіңіз', 'en': 'Enter'},
  'map_select_point': {
    'ru': 'Выберите точку на карте',
    'kk': 'Картадан нүктені таңдаңыз',
    'en': 'Select a point on the map',
  },
  'map_resolving': {
    'ru': 'Определяем адрес…',
    'kk': 'Мекенжай анықталуда…',
    'en': 'Finding address…',
  },
  'map_selected_point': {
    'ru': 'Выбранная точка',
    'kk': 'Таңдалған нүкте',
    'en': 'Selected point',
  },
  'map_zoom_in': {'ru': 'Приблизить', 'kk': 'Үлкейту', 'en': 'Zoom in'},
  'map_zoom_out': {'ru': 'Отдалить', 'kk': 'Кішірейту', 'en': 'Zoom out'},
  'map_my_location': {
    'ru': 'Моё местоположение',
    'kk': 'Менің орным',
    'en': 'My location',
  },
  'map_you_are_here': {
    'ru': 'Вы здесь',
    'kk': 'Сіз осындасыз',
    'en': 'You are here',
  },
  'map_data_attribution': {'ru': 'Карта:', 'kk': 'Карта:', 'en': 'Map:'},
  'map_search_not_found': {
    'ru': 'Адрес не найден. Уточните запрос.',
    'kk': 'Мекенжай табылмады. Сұрауды нақтылаңыз.',
    'en': 'Address not found. Refine your search.',
  },
  'map_search_failed': {
    'ru': 'Поиск недоступен. Повторите.',
    'kk': 'Іздеу қолжетімсіз. Қайталаңыз.',
    'en': 'Search is unavailable. Please retry.',
  },
  'geo_disabled': {
    'ru': 'Геолокация выключена. На карте оставлен центр Актау.',
    'kk': 'Геолокация өшірілген. Картада Ақтау орталығы қалды.',
    'en': 'Location services are off. The map remains centered on Aktau.',
  },
  'geo_permission': {
    'ru': 'Разрешите доступ к геолокции в настройках.',
    'kk': 'Баптауларда геолокацияға рұқсат беріңіз.',
    'en': 'Allow location access in settings.',
  },
  'geo_timeout': {
    'ru': 'Координаты не получены. Выберите точку на карте.',
    'kk': 'Координаттар алынбады. Картадан нүктені таңдаңыз.',
    'en': 'Location timed out. Select a point on the map.',
  },
  'geo_failed': {
    'ru': 'Не удалось определить местоположение.',
    'kk': 'Орналасқан жерді анықтау мүмкін болмады.',
    'en': 'Could not determine your location.',
  },
  'all_locations': {
    'ru': 'Все локации',
    'kk': 'Барлық орындар',
    'en': 'All locations',
  },
  'view_on_map': {
    'ru': 'Посмотреть на карте',
    'kk': 'Картадан көру',
    'en': 'View on map',
  },
  'locations_empty': {
    'ru': 'В этом городе локации не найдены.',
    'kk': 'Бұл қалада орындар табылмады.',
    'en': 'No locations were found in this city.',
  },
  'locations_search_empty': {
    'ru': 'По запросу ничего не найдено.',
    'kk': 'Сұрау бойынша ештеңе табылмады.',
    'en': 'No locations match your search.',
  },
  'locations_error': {
    'ru': 'Не удалось загрузить локации.',
    'kk': 'Орындарды жүктеу мүмін болмады.',
    'en': 'Could not load locations.',
  },
  'city_aktau': {'ru': 'Актау', 'kk': 'Ақтау', 'en': 'Aktau'},

  // Profile, account and loyalty tiers
  'guest_name': {'ru': 'Гость', 'kk': 'Қонақ', 'en': 'Guest'},
  'profile_saved': {
    'ru': 'Профиль сохранён.',
    'kk': 'Профиль сақталды.',
    'en': 'Profile saved.',
  },
  'delete_account': {
    'ru': 'Удалить аккаунт',
    'kk': 'Аккаунтты жою',
    'en': 'Delete account',
  },
  'delete_account_title': {
    'ru': 'Удаление аккаунта',
    'kk': 'Аккаунтты жою',
    'en': 'Delete account',
  },
  'delete_account_message': {
    'ru': 'Вы уверены? Действие необратимо, а накопленные баллы будут удалены.',
    'kk':
        'Сенімдісіз бе? Бұл әрекетті қайтаруға болмайды, жиналған ұпайлар жойылады.',
    'en':
        'Are you sure? This cannot be undone and all accumulated points will be deleted.',
  },
  'personal_title': {
    'ru': 'Личные данные',
    'kk': 'Жеке деректер',
    'en': 'Personal data',
  },
  'city_label': {'ru': 'Город', 'kk': 'Қала', 'en': 'City'},
  'select_city': {
    'ru': 'Выберите город',
    'kk': 'Қаланы таңдаңыз',
    'en': 'Select a city',
  },
  'birthdate_label': {
    'ru': 'Дата рождения',
    'kk': 'Туған күні',
    'en': 'Date of birth',
  },
  'date_hint': {'ru': 'ДД.ММ.ГГГГ', 'kk': 'КК.АА.ЖЖЖЖ', 'en': 'DD.MM.YYYY'},
  'invalid_date': {
    'ru': 'Введите корректную дату.',
    'kk': 'Дұрыс күнді енгізіңіз.',
    'en': 'Enter a valid date.',
  },
  'gender_label': {
    'ru': 'Выберите пол',
    'kk': 'Жынысты таңдаңыз',
    'en': 'Select gender',
  },
  'gender_male': {'ru': 'Мужской', 'kk': 'Ер', 'en': 'Male'},
  'gender_female': {'ru': 'Женский', 'kk': 'Әйел', 'en': 'Female'},
  'name_label': {'ru': 'Имя', 'kk': 'Аты', 'en': 'First name'},
  'surname_label': {'ru': 'Фамилия', 'kk': 'Тегі', 'en': 'Last name'},
  'email_label': {'ru': 'E-mail', 'kk': 'E-mail', 'en': 'Email'},
  'email_verified': {'ru': 'Подтверждён', 'kk': 'Расталған', 'en': 'Verified'},
  'support_message': {
    'ru': 'Напишите нам в Telegram — мы поможем.',
    'kk': 'Telegram-да бізге жазыңыз — көмектесеміз.',
    'en': 'Message us on Telegram and we will help.',
  },
  'about_app_body': {
    'ru': 'Программа лояльности Bulka. Версия 1.0.0.',
    'kk': 'Bulka адалдық бағдарламасы. 1.0.0 нұсқасы.',
    'en': 'Bulka loyalty program. Version 1.0.0.',
  },
  'tier_status': {
    'ru': 'Статус: {name} ({percent}%)',
    'kk': 'Мәртебе: {name} ({percent}%)',
    'en': 'Status: {name} ({percent}%)',
  },
  'tier_level': {
    'ru': 'Уровень {level} из {total}',
    'kk': '{total} деңгейдің {level}-і',
    'en': 'Level {level} of {total}',
  },
  'tier_max': {
    'ru': 'У вас максимальный статус {name} и кэшбэк {percent}%.',
    'kk': 'Сізде ең жоғары {name} мәртебесі және {percent}% кэшбэк бар.',
    'en': 'You have the highest {name} status with {percent}% cashback.',
  },
  'tier_next': {
    'ru': 'До статуса {name} ({percent}%) осталось покупок на {remaining} ₸.',
    'kk':
        '{name} ({percent}%) мәртебесіне дейін {remaining} ₸ сомасында сатып алу қалды.',
    'en': 'Spend {remaining} ₸ more to reach {name} ({percent}%).',
  },
  'tier_current': {
    'ru': 'Ваш текущий кэшбэк — {percent}%.',
    'kk': 'Қазіргі кэшбэк — {percent}%.',
    'en': 'Your current cashback is {percent}%.',
  },
  'tier_base': {'ru': 'Базовый', 'kk': 'Негізгі', 'en': 'Base'},
  'tier_bronze': {'ru': 'Бронза', 'kk': 'Қола', 'en': 'Bronze'},
  'tier_silver': {'ru': 'Серебро', 'kk': 'Күміс', 'en': 'Silver'},
  'tier_gold': {'ru': 'Золото', 'kk': 'Алтын', 'en': 'Gold'},
  'tier_platinum': {'ru': 'Платина', 'kk': 'Платина', 'en': 'Platinum'},

  // Orders, stories and QR
  'orders_empty_action': {
    'ru': 'Перейти на главную',
    'kk': 'Басты бетке өту',
    'en': 'Go to home',
  },
  'order_details': {
    'ru': 'Детали заказа',
    'kk': 'Тапсырыс мәліметтері',
    'en': 'Order details',
  },
  'product_fallback': {'ru': 'Товар', 'kk': 'Өнім', 'en': 'Item'},
  'tx_manual_withdrawal': {
    'ru': 'Ручное списание',
    'kk': 'Қолмен есептен шығару',
    'en': 'Manual deduction',
  },
  'tx_expiration': {
    'ru': 'Сгорание бонусов',
    'kk': 'Бонустардың мерзімі өтті',
    'en': 'Points expired',
  },
  'tx_earning': {
    'ru': 'Начисление бонусов',
    'kk': 'Бонустар есептелді',
    'en': 'Points earned',
  },
  'tx_withdrawal': {
    'ru': 'Списание бонусов',
    'kk': 'Бонустар есептен шығарылды',
    'en': 'Points deducted',
  },
  'fresh_news_fallback': {
    'ru': 'Свежая новость',
    'kk': 'Жаңа жаңалық',
    'en': 'Latest news',
  },
  'story_offer_fallback': {
    'ru': 'Специальное предложение Bulka',
    'kk': 'Bulka арнайы ұсынысы',
    'en': 'A special offer from Bulka',
  },
  'story_gift': {'ru': 'Подарок', 'kk': 'Сыйлық', 'en': 'Gift'},
  'story_open': {
    'ru': 'Открыть историю: {title}',
    'kk': 'Сториді ашу: {title}',
    'en': 'Open story: {title}',
  },
  'qr_retry': {
    'ru': 'Повторить загрузку QR',
    'kk': 'QR жүктеуді қайталау',
    'en': 'Retry QR loading',
  },
};

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

String localizeErrorMessage(
  Object? error, {
  String fallbackKey = 'error_generic',
}) {
  final raw = error is ApiException ? error.message : (error?.toString() ?? '');
  final value = raw.toLowerCase();
  if (value.contains('city') || value.contains('город')) {
    return 'error_load_cities'.tr;
  }
  if (value.contains('send') && value.contains('code') ||
      value.contains('отправ') && value.contains('код')) {
    return 'error_send_code'.tr;
  }
  if (value.contains('invalid code') ||
      value.contains('wrong code') ||
      value.contains('неверн') && value.contains('код')) {
    return 'error_invalid_code'.tr;
  }
  if (value.contains('registr')) return 'error_register'.tr;
  if (value.contains('session') || value.contains('сесси')) {
    return 'error_session_missing'.tr;
  }
  if (value.contains('delet') || value.contains('удал')) {
    return 'error_delete_account'.tr;
  }
  if (value.contains('sav') || value.contains('сохран')) {
    return 'error_save'.tr;
  }
  if (value.contains('whatsapp')) return 'error_open_whatsapp'.tr;
  if (value.contains('telegram')) return 'error_open_telegram'.tr;
  if (value.contains('wallet')) return 'wallet_unavailable'.tr;
  if (value.contains('network') ||
      value.contains('socket') ||
      value.contains('timeout') ||
      value.contains('сет')) {
    return 'error_network'.tr;
  }
  return fallbackKey.tr;
}
