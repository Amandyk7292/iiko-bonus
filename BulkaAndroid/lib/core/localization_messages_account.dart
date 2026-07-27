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
