part of '../main.dart';

const Map<String, Map<String, String>> _accountTranslations = {
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
  'payment_methods_title': {
    'ru': 'Сохранённые карты',
    'kk': 'Сақталған карталар',
    'en': 'Saved cards',
  },
  'payment_methods_add': {
    'ru': 'Добавить карту',
    'kk': 'Карта қосу',
    'en': 'Add card',
  },
  'payment_methods_add_error': {
    'ru': 'Не удалось привязать карту.',
    'kk': 'Картаны байланыстыру мүмкін болмады.',
    'en': 'Could not link the card.',
  },
  'payment_methods_empty': {
    'ru': 'Сохранённых карт пока нет.',
    'kk': 'Сақталған карта жоқ.',
    'en': 'No saved cards yet.',
  },
  'payment_methods_loading': {
    'ru': 'Загружаем сохранённые карты…',
    'kk': 'Сақталған карталар жүктелуде…',
    'en': 'Loading saved cards…',
  },
  'payment_methods_default': {
    'ru': 'Основная',
    'kk': 'Негізгі',
    'en': 'Default',
  },
  'payment_methods_expiry': {'ru': 'до', 'kk': 'дейін', 'en': 'expires'},
  'payment_methods_make_default': {
    'ru': 'Сделать основной',
    'kk': 'Негізгі ету',
    'en': 'Make default',
  },
  'payment_methods_remove': {
    'ru': 'Удалить карту',
    'kk': 'Картаны жою',
    'en': 'Remove card',
  },
  'payment_methods_remove_title': {
    'ru': 'Удалить сохранённую карту?',
    'kk': 'Сақталған картаны жою керек пе?',
    'en': 'Remove saved card?',
  },
  'payment_methods_remove_message': {
    'ru': 'Для следующей оплаты реквизиты карты придётся ввести заново.',
    'kk': 'Келесі төлемде карта деректерін қайта енгізу қажет болады.',
    'en': 'You will need to enter the card details again next time.',
  },
  'payment_methods_load_error': {
    'ru': 'Не удалось загрузить сохранённые карты.',
    'kk': 'Сақталған карталарды жүктеу мүмкін болмады.',
    'en': 'Could not load saved cards.',
  },
  'payment_methods_update_error': {
    'ru': 'Не удалось выбрать основную карту.',
    'kk': 'Негізгі картаны таңдау мүмкін болмады.',
    'en': 'Could not select the default card.',
  },
  'payment_methods_remove_error': {
    'ru': 'Не удалось удалить карту.',
    'kk': 'Картаны жою мүмкін болмады.',
    'en': 'Could not remove the card.',
  },
  'card_setup_confirm': {
    'ru': 'Привязка карты',
    'kk': 'Картаны байланыстыру',
    'en': 'Link card',
  },
  'card_setup_hint': {
    'ru': 'Банк спишет 30 ₸ для проверки и сразу вернёт.',
    'kk': 'Банк тексеру үшін 30 ₸ алып, бірден қайтарады.',
    'en':
        'The bank will charge 30 ₸ for verification and refund it immediately.',
  },
  'card_setup_verifying': {
    'ru': 'Проверяем карту',
    'kk': 'Картаны тексеріп жатырмыз',
    'en': 'Verifying card',
  },
  'card_setup_verifying_hint': {
    'ru': 'Сохраняем карту и возвращаем 30 ₸.',
    'kk': 'Картаны сақтап, 30 ₸ қайтарып жатырмыз.',
    'en': 'Saving the card and refunding 30 ₸.',
  },
  'card_setup_success': {
    'ru': 'Карта сохранена',
    'kk': 'Карта сақталды',
    'en': 'Card saved',
  },
  'card_setup_success_hint': {
    'ru': 'Карта сохранена, возврат 30 ₸ отправлен.',
    'kk': 'Карта сақталды, 30 ₸ қайтарылды.',
    'en': 'Card saved and the 30 ₸ refund was sent.',
  },
  'card_setup_failed': {
    'ru': 'Карта не сохранена',
    'kk': 'Карта сақталмады',
    'en': 'Card not saved',
  },
  'card_setup_failed_hint': {
    'ru':
        'Карта не сохранена. Если списывались 30 ₸, банк вернёт их автоматически.',
    'kk':
        'Карта сақталмады. Егер 30 ₸ алынған болса, банк оны автоматты түрде қайтарады.',
    'en':
        'The card was not saved. If 30 ₸ was charged, the bank will refund it automatically.',
  },
  'card_setup_cancelled': {
    'ru': 'Добавление карты отменено.',
    'kk': 'Карта қосу тоқтатылды.',
    'en': 'Card linking was cancelled.',
  },
  'card_setup_token_missing': {
    'ru':
        '30 ₸ возвращены, но банк не передал токен карты. Повторите добавление карты.',
    'kk':
        '30 ₸ қайтарылды, бірақ банк карта токенін жібермеді. Картаны қайта қосыңыз.',
    'en':
        'The 30 ₸ was refunded, but the bank did not return a card token. Add the card again.',
  },
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
};
