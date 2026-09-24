part of '../main.dart';

const Map<String, Map<String, String>> _navigationAndProfileTranslations = {
  // Navigation
  'nav_home': {'ru': 'Главная', 'kk': 'Басты бет', 'en': 'Home'},
  'nav_catalog': {'ru': 'Каталог', 'kk': 'Мәзір', 'en': 'Menu'},
  'nav_cart': {'ru': 'Корзина', 'kk': 'Себет', 'en': 'Cart'},
  'nav_promos': {'ru': 'Акции', 'kk': 'Акциялар', 'en': 'Promos'},
  'nav_profile': {'ru': 'Профиль', 'kk': 'Профиль', 'en': 'Profile'},

  // Order types
  'order_pickup': {'ru': 'Самовывоз', 'kk': 'Алып кету', 'en': 'Pickup'},
  'order_delivery': {'ru': 'Доставка', 'kk': 'Жеткізу', 'en': 'Delivery'},
  'order_preorder': {
    'ru': 'Предзаказ',
    'kk': 'Алдын ала тапсырыс',
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
  'profile_title': {'ru': 'Профиль', 'kk': 'Профиль', 'en': 'Profile'},
  'challenges_title': {
    'ru': 'Челленджи',
    'kk': 'Челлендждер',
    'en': 'Challenges',
  },
  'challenges_heading': {
    'ru': 'Двигайтесь каждый день',
    'kk': 'Күн сайын қозғалыңыз',
    'en': 'Move every day',
  },
  'challenges_description': {
    'ru':
        'Выполняйте цели и следите за прогрессом из данных здоровья устройства.',
    'kk':
        'Мақсаттарды орындап, құрылғыдағы денсаулық деректері бойынша ілгерілеуді бақылаңыз.',
    'en': 'Complete goals and track progress from your device health data.',
  },
  'challenge_steps_title': {
    'ru': '10 000 шагов',
    'kk': '10 000 қадам',
    'en': '10,000 steps',
  },
  'challenge_steps_daily': {
    'ru': 'Каждый день',
    'kk': 'Күн сайын',
    'en': 'Every day',
  },
  'challenge_completed': {
    'ru': 'Челлендж выполнен!',
    'kk': 'Челлендж орындалды!',
    'en': 'Challenge completed!',
  },
  'challenge_steps_left': {
    'ru': 'Осталось: {count} шагов',
    'kk': 'Қалды: {count} қадам',
    'en': '{count} steps left',
  },
  'challenge_checked_at': {
    'ru': 'Обновлено в {time}',
    'kk': '{time} жаңартылды',
    'en': 'Updated at {time}',
  },
  'challenge_sources': {
    'ru': 'Источники: {sources}',
    'kk': 'Дереккөздер: {sources}',
    'en': 'Sources: {sources}',
  },
  'challenge_manual_excluded': {
    'ru':
        'Вручную добавленные и неопределённые записи не засчитываются. На iPhone используются только шаги датчика, на Android — подтверждённые записи Health Connect.',
    'kk':
        'Қолмен қосылған және анықталмаған жазбалар есептелмейді. iPhone-да тек құрылғы датчигі, Android-та Health Connect растаған қадамдар саналады.',
    'en':
        'Manual and unknown entries are excluded. iPhone uses sensor-only steps; Android uses verified Health Connect records.',
  },
  'challenge_connect_health': {
    'ru': 'Подключить шаги',
    'kk': 'Қадамдарды қосу',
    'en': 'Connect steps',
  },
  'challenge_health_denied': {
    'ru': 'Нет доступа к шагам. Разрешите чтение шагов в настройках здоровья.',
    'kk':
        'Қадамдарға қолжетімділік жоқ. Денсаулық баптауларында оқуға рұқсат беріңіз.',
    'en': 'Step access is denied. Allow step reading in health settings.',
  },
  'challenge_health_unavailable': {
    'ru': 'Датчик шагов или Health Connect недоступен на этом устройстве.',
    'kk': 'Бұл құрылғыда қадам датчигі немесе Health Connect қолжетімсіз.',
    'en': 'Step sensing or Health Connect is unavailable on this device.',
  },
  'select_lang_title': {
    'ru': 'Выберите язык',
    'kk': 'Тілді таңдаңыз',
    'en': 'Select language',
  },
  'apply_btn': {'ru': 'Применить', 'kk': 'Қолдану', 'en': 'Apply'},
  'menu_orders': {
    'ru': 'Мои покупки',
    'kk': 'Менің сатып алуларым',
    'en': 'My purchases',
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
  'menu_contact': {'ru': 'Поддержка', 'kk': 'Қолдау', 'en': 'Support'},
  'menu_info': {'ru': 'Информация', 'kk': 'Ақпарат', 'en': 'Information'},
  'legal_documents_title': {
    'ru': 'Документы и условия',
    'kk': 'Құжаттар мен шарттар',
    'en': 'Documents and terms',
  },
  'legal_open_error': {
    'ru': 'Не удалось открыть документ. Попробуйте ещё раз.',
    'kk': 'Құжатты ашу мүмкін болмады. Қайталап көріңіз.',
    'en': 'Could not open the document. Please try again.',
  },
  'legal_privacy': {
    'ru': 'Политика конфиденциальности',
    'kk': 'Құпиялылық саясаты',
    'en': 'Privacy policy',
  },
  'legal_public_offer': {
    'ru': 'Публичная оферта',
    'kk': 'Жария оферта',
    'en': 'Public offer',
  },
  'legal_terms': {
    'ru': 'Условия использования',
    'kk': 'Пайдалану шарттары',
    'en': 'Terms of use',
  },
  'legal_payment_refund': {
    'ru': 'Условия оплаты и возврата',
    'kk': 'Төлем және қайтару шарттары',
    'en': 'Payment and refund terms',
  },
  'legal_delivery_terms': {
    'ru': 'Условия доставки',
    'kk': 'Жеткізу шарттары',
    'en': 'Delivery terms',
  },
  'legal_company_details': {
    'ru': 'Реквизиты компании',
    'kk': 'Компания деректемелері',
    'en': 'Company details',
  },
  'checkout_slots_left': {
    'ru': 'Свободных мест: {{count}}',
    'kk': 'Бос орындар: {{count}}',
    'en': 'Spaces left: {{count}}',
  },
  'menu_pin': {
    'ru': 'Создать PIN-код',
    'kk': 'PIN-код құру',
    'en': 'Create PIN code',
  },
};
