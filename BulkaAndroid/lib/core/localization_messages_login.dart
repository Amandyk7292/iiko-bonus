part of '../main.dart';

const Map<String, Map<String, String>> _loginTranslations = {
  // Login screen
  'login_brand_title': {
    'ru': 'Добро пожаловать',
    'kk': 'Қош келдіңіз',
    'en': 'Welcome',
  },
  'reg_title': {
    'ru': 'Завершение регистрации',
    'kk': 'Тіркелуді аяқтау',
    'en': 'Complete registration',
  },
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
  'reg_phone_label': {'ru': 'Телефон', 'kk': 'Телефон', 'en': 'Phone'},
  'reg_phone_helper': {
    'ru': 'Используется для входа и уведомлений по заказам.',
    'kk': 'Кіру және тапсырыс хабарламалары үшін қолданылады.',
    'en': 'Used for sign-in and order notifications.',
  },
  'reg_email_helper': {
    'ru': 'Необязательно. Пришлём чеки и новости.',
    'kk': 'Міндетті емес. Чектер мен жаңалықтарды жібереміз.',
    'en': 'Optional. We will send receipts and news.',
  },
  'reg_dob_helper': {
    'ru': 'Необязательно. Поможет персонализировать предложения.',
    'kk': 'Міндетті емес. Ұсыныстарды жекелеуге көмектеседі.',
    'en': 'Optional. Helps personalize offers.',
  },
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
  'splash_loading': {'ru': 'Загрузка…', 'kk': 'Жүктелуде…', 'en': 'Loading…'},
  'splash_loading_profile': {
    'ru': 'Загрузка профиля…',
    'kk': 'Профиль жүктелуде…',
    'en': 'Loading profile…',
  },
  'auth_login_badge': {'ru': 'Аккаунт', 'kk': 'Аккаунт', 'en': 'Account'},
  'auth_registration_badge': {
    'ru': 'Регистрация',
    'kk': 'Тіркелу',
    'en': 'Registration',
  },
  'auth_recovery_badge': {
    'ru': 'Восстановление',
    'kk': 'Қалпына келтіру',
    'en': 'Recovery',
  },
  'auth_login_title': {
    'ru': 'Вход в Bulka',
    'kk': 'Bulka-ға кіру',
    'en': 'Sign in to Bulka',
  },
  'auth_login_subtitle': {
    'ru': 'Введите номер телефона и пароль. Код подтверждения не нужен.',
    'kk': 'Телефон нөмірі мен құпиясөзді енгізіңіз. Растау коды қажет емес.',
    'en':
        'Enter your phone number and password. No confirmation code is needed.',
  },
  'auth_registration_title': {
    'ru': 'Создать аккаунт',
    'kk': 'Аккаунт ашу',
    'en': 'Create an account',
  },
  'auth_registration_subtitle': {
    'ru': 'Задайте пароль и один раз подтвердите номер через WhatsApp.',
    'kk': 'Құпиясөз орнатып, нөмірді WhatsApp арқылы бір рет растаңыз.',
    'en': 'Set a password and confirm your number once through WhatsApp.',
  },
  'auth_recovery_title': {
    'ru': 'Забыли пароль?',
    'kk': 'Құпиясөзді ұмыттыңыз ба?',
    'en': 'Forgot your password?',
  },
  'auth_recovery_subtitle': {
    'ru': 'Укажите номер аккаунта. Мы подтвердим его через WhatsApp.',
    'kk': 'Аккаунт нөмірін көрсетіңіз. Оны WhatsApp арқылы растаймыз.',
    'en':
        'Enter the account phone number. We will confirm it through WhatsApp.',
  },
  'auth_password_label': {'ru': 'Пароль', 'kk': 'Құпиясөз', 'en': 'Password'},
  'auth_password_confirm': {
    'ru': 'Повторите пароль',
    'kk': 'Құпиясөзді қайталаңыз',
    'en': 'Confirm password',
  },
  'auth_new_password': {
    'ru': 'Новый пароль',
    'kk': 'Жаңа құпиясөз',
    'en': 'New password',
  },
  'auth_password_rules': {
    'ru': 'Не менее 8 символов, минимум одна буква и одна цифра.',
    'kk': 'Кемінде 8 таңба, бір әріп және бір сан болуы керек.',
    'en': 'Use at least 8 characters with one letter and one digit.',
  },
  'auth_password_too_long': {
    'ru': 'Пароль слишком длинный. Используйте не более 72 байт.',
    'kk': 'Құпиясөз тым ұзын. 72 байттан асырмаңыз.',
    'en': 'The password is too long. Use no more than 72 bytes.',
  },
  'auth_passwords_mismatch': {
    'ru': 'Пароли не совпадают.',
    'kk': 'Құпиясөздер сәйкес емес.',
    'en': 'Passwords do not match.',
  },
  'auth_password_required': {
    'ru': 'Введите пароль.',
    'kk': 'Құпиясөзді енгізіңіз.',
    'en': 'Enter your password.',
  },
  'auth_login_button': {'ru': 'Войти', 'kk': 'Кіру', 'en': 'Sign in'},
  'auth_confirm_whatsapp': {
    'ru': 'Подтвердить номер',
    'kk': 'Нөмірді растау',
    'en': 'Confirm phone',
  },
  'auth_recovery_button': {
    'ru': 'Получить код',
    'kk': 'Код алу',
    'en': 'Get code',
  },
  'auth_forgot_password': {
    'ru': 'Забыли пароль?',
    'kk': 'Құпиясөзді ұмыттыңыз ба?',
    'en': 'Forgot password?',
  },
  'auth_or': {'ru': 'или', 'kk': 'немесе', 'en': 'or'},
  'auth_create_account': {
    'ru': 'Создать аккаунт',
    'kk': 'Аккаунт ашу',
    'en': 'Create account',
  },
  'auth_back_to_login': {
    'ru': 'Вернуться ко входу',
    'kk': 'Кіруге оралу',
    'en': 'Back to sign in',
  },
  'auth_show_password': {
    'ru': 'Показать пароль',
    'kk': 'Құпиясөзді көрсету',
    'en': 'Show password',
  },
  'auth_hide_password': {
    'ru': 'Скрыть пароль',
    'kk': 'Құпиясөзді жасыру',
    'en': 'Hide password',
  },
  'auth_registration_verify_badge': {
    'ru': 'Подтверждение номера',
    'kk': 'Нөмірді растау',
    'en': 'Phone confirmation',
  },
  'auth_recovery_verify_badge': {
    'ru': 'Новый пароль',
    'kk': 'Жаңа құпиясөз',
    'en': 'New password',
  },
  'auth_registration_verify_title': {
    'ru': 'Введите код из WhatsApp',
    'kk': 'WhatsApp кодын енгізіңіз',
    'en': 'Enter the WhatsApp code',
  },
  'auth_recovery_verify_title': {
    'ru': 'Подтвердите номер',
    'kk': 'Нөмірді растаңыз',
    'en': 'Confirm your number',
  },
  'auth_continue_registration': {
    'ru': 'Продолжить регистрацию',
    'kk': 'Тіркелуді жалғастыру',
    'en': 'Continue registration',
  },
  'auth_save_new_password': {
    'ru': 'Сохранить новый пароль',
    'kk': 'Жаңа құпиясөзді сақтау',
    'en': 'Save new password',
  },
  'auth_account_exists': {
    'ru': 'Аккаунт уже существует. Вернитесь ко входу или восстановите пароль.',
    'kk':
        'Аккаунт бұрыннан бар. Кіруге оралыңыз немесе құпиясөзді қалпына келтіріңіз.',
    'en': 'This account already exists. Sign in or recover the password.',
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
    'ru': 'Получить код',
    'kk': 'Код алу',
    'en': 'Get code',
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
};
