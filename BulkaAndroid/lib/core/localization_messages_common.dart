part of '../main.dart';

const Map<String, Map<String, String>> _commonTranslations = {
  // Common actions, semantics and errors
  'app_title': {
    'ru': 'Bulka — семейная пекарня',
    'kk': 'Bulka — отбасылық наубайхана',
    'en': 'Bulka — family bakery',
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
  'edit_btn': {'ru': 'Изменить', 'kk': 'Өзгерту', 'en': 'Edit'},
  'close_btn': {'ru': 'Закрыть', 'kk': 'Жабу', 'en': 'Close'},
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
  'error_login': {
    'ru':
        'Неверный номер или пароль. Для старого аккаунта восстановите пароль.',
    'kk':
        'Нөмір немесе құпиясөз қате. Ескі аккаунт үшін құпиясөзді қалпына келтіріңіз.',
    'en':
        'Incorrect phone or password. Recover the password for an existing account.',
  },
  'error_password_reset': {
    'ru': 'Не удалось сохранить новый пароль.',
    'kk': 'Жаңа құпиясөзді сақтау мүмкін болмады.',
    'en': 'Could not save the new password.',
  },
  'auth_account_not_found': {
    'ru': 'Аккаунт с таким номером не найден. Создайте новый аккаунт.',
    'kk': 'Бұл нөмірмен аккаунт табылмады. Жаңа аккаунт ашыңыз.',
    'en': 'No account was found for this number. Create a new account.',
  },
  'auth_password_setup_required': {
    'ru':
        'Для существующего аккаунта нажмите «Забыли пароль?» и задайте пароль.',
    'kk':
        'Бар аккаунт үшін «Құпиясөзді ұмыттыңыз ба?» түймесін басып, құпиясөз орнатыңыз.',
    'en':
        'For an existing account, select “Forgot password?” and set a password.',
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
  'support_code': {
    'ru': 'Код для поддержки: {code}',
    'kk': 'Қолдау қызметіне арналған код: {code}',
    'en': 'Support code: {code}',
  },
  'copy_support_code': {'ru': 'Копировать', 'kk': 'Көшіру', 'en': 'Copy'},
  'support_code_copied': {
    'ru': 'Код скопирован',
    'kk': 'Код көшірілді',
    'en': 'Code copied',
  },
};
