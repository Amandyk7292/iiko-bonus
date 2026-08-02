part of '../main.dart';

const Map<String, Map<String, String>> _locationTranslations = {
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
    'ru': 'Центр уведомлений',
    'kk': 'Хабарламалар орталығы',
    'en': 'Notification center',
  },
  'notification_tab': {
    'ru': 'Уведомления',
    'kk': 'Хабарламалар',
    'en': 'Notifications',
  },
  'contacts_tab': {'ru': 'Контакты', 'kk': 'Байланыстар', 'en': 'Contacts'},
  'notifications_empty': {
    'ru': 'Пока нет новых уведомлений',
    'kk': 'Жаңа хабарламалар әзірге жоқ',
    'en': 'No notifications yet',
  },
  'notifications_empty_body': {
    'ru': 'Здесь появятся новости о заказах, бонусах и акциях.',
    'kk':
        'Мұнда тапсырыстар, бонустар және акциялар туралы жаңалықтар пайда болады.',
    'en': 'Order, bonus, and promotion updates will appear here.',
  },
  'notifications_guest_title': {
    'ru': 'Войдите, чтобы увидеть уведомления',
    'kk': 'Хабарламаларды көру үшін кіріңіз',
    'en': 'Sign in to see notifications',
  },
  'notifications_guest_body': {
    'ru':
        'Контакты доступны без входа. Уведомления о заказах и бонусах защищены вашим аккаунтом.',
    'kk':
        'Байланыстарға кірусіз қол жеткізуге болады. Тапсырыс пен бонус хабарламалары аккаунтыңызбен қорғалған.',
    'en':
        'Contacts are available without signing in. Order and bonus notifications are protected by your account.',
  },
  'notification_open_hint': {
    'ru': 'Открыть уведомление',
    'kk': 'Хабарламаны ашу',
    'en': 'Open notification',
  },
  'contacts_additional': {
    'ru': 'Дополнительно',
    'kk': 'Қосымша',
    'en': 'More ways to reach us',
  },
  'contacts_empty': {
    'ru': 'Контакты скоро появятся',
    'kk': 'Байланыстар жақында пайда болады',
    'en': 'Contacts are coming soon',
  },
  'contacts_empty_body': {
    'ru':
        'Команда Bulka ещё настраивает способы связи. Потяните вниз, чтобы обновить.',
    'kk':
        'Bulka командасы байланыс тәсілдерін баптап жатыр. Жаңарту үшін төмен тартыңыз.',
    'en': 'The Bulka team is setting up contact options. Pull down to refresh.',
  },
  'contact_open_error': {
    'ru': 'Не удалось открыть этот способ связи',
    'kk': 'Бұл байланыс тәсілін ашу мүмкін болмады',
    'en': 'Could not open this contact option',
  },
  'common_retry': {'ru': 'Повторить', 'kk': 'Қайталау', 'en': 'Try again'},
  'notifications_read_all': {
    'ru': 'Прочитать все',
    'kk': 'Барлығын оқу',
    'en': 'Mark all read',
  },
  'notifications_mark_read': {
    'ru': 'Дважды нажмите, чтобы отметить прочитанным',
    'kk': 'Оқылды деп белгілеу үшін екі рет түртіңіз',
    'en': 'Double tap to mark as read',
  },
  'notification_bonus_awarded_title': {
    'ru': 'Начислены бонусы',
    'kk': 'Бонустар қосылды',
    'en': 'Bonuses earned',
  },
  'notification_bonus_awarded_body': {
    'ru': 'Баланс Bulka пополнен',
    'kk': 'Bulka балансы толықтырылды',
    'en': 'Your Bulka balance was updated',
  },
  'notification_order_accepted_title': {
    'ru': 'Заказ принят',
    'kk': 'Тапсырыс қабылданды',
    'en': 'Order accepted',
  },
  'notification_order_accepted_body': {
    'ru': 'Заказ №{number} принят в работу.',
    'kk': '№{number} тапсырыс жұмысқа қабылданды.',
    'en': 'Order #{number} has been accepted.',
  },
  'notification_order_preparing_title': {
    'ru': 'Заказ готовится',
    'kk': 'Тапсырыс дайындалып жатыр',
    'en': 'Order is being prepared',
  },
  'notification_order_preparing_body': {
    'ru': 'Мы готовим заказ №{number}.',
    'kk': '№{number} тапсырысты дайындап жатырмыз.',
    'en': 'We are preparing order #{number}.',
  },
  'notification_order_ready_title': {
    'ru': 'Заказ готов',
    'kk': 'Тапсырыс дайын',
    'en': 'Order is ready',
  },
  'notification_order_ready_body': {
    'ru': 'Заказ №{number} готов к выдаче.',
    'kk': '№{number} тапсырыс алып кетуге дайын.',
    'en': 'Order #{number} is ready for pickup.',
  },
  'notification_order_completed_title': {
    'ru': 'Заказ выдан',
    'kk': 'Тапсырыс табысталды',
    'en': 'Order collected',
  },
  'notification_order_completed_body': {
    'ru': 'Заказ №{number} завершён. Спасибо!',
    'kk': '№{number} тапсырыс аяқталды. Рақмет!',
    'en': 'Order #{number} is complete. Thank you!',
  },
  'notification_order_cancelled_title': {
    'ru': 'Заказ отменён',
    'kk': 'Тапсырыс тоқтатылды',
    'en': 'Order cancelled',
  },
  'notification_order_cancelled_body': {
    'ru': 'Заказ №{number} отменён.',
    'kk': '№{number} тапсырыс тоқтатылды.',
    'en': 'Order #{number} was cancelled.',
  },
  'notification_order_refunded_title': {
    'ru': 'Заказ отменён, деньги возвращены',
    'kk': 'Тапсырыс тоқтатылды, ақша қайтарылды',
    'en': 'Order cancelled and refunded',
  },
  'notification_order_refunded_body': {
    'ru': 'Возврат по заказу №{number} оформлен.',
    'kk': '№{number} тапсырыс бойынша ақша қайтару рәсімделді.',
    'en': 'The refund for order #{number} has been processed.',
  },
  'bakery_selected': {
    'ru': 'Выбрана локация: {name}',
    'kk': 'Таңдалған орын: {name}',
    'en': 'Selected location: {name}',
  },
  'delivery_address_selected': {
    'ru': 'Выбран адрес доставки: {address}',
    'kk': 'Жеткізу мекенжайы таңдалды: {address}',
    'en': 'Delivery address selected: {address}',
  },
  'select_address_title': {
    'ru': 'Выберите адрес',
    'kk': 'Мекенжайды таңдаңыз',
    'en': 'Select an address',
  },
  'delivery_address_title': {
    'ru': 'Адрес доставки',
    'kk': 'Жеткізу мекенжайы',
    'en': 'Delivery address',
  },
  'selected_delivery_address': {
    'ru': 'Выбранный адрес',
    'kk': 'Таңдалған мекенжай',
    'en': 'Selected address',
  },
  'save_address_btn': {
    'ru': 'Сохранить адрес',
    'kk': 'Мекенжайды сақтау',
    'en': 'Save address',
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
  'address_actions': {
    'ru': 'Действия с адресом',
    'kk': 'Мекенжай әрекеттері',
    'en': 'Address actions',
  },
  'delete_address_title': {
    'ru': 'Удалить адрес?',
    'kk': 'Мекенжай жойылсын ба?',
    'en': 'Delete address?',
  },
  'delete_address_body': {
    'ru': 'Адрес «{address}» будет удалён.',
    'kk': '«{address}» мекенжайы жойылады.',
    'en': 'The address “{address}” will be deleted.',
  },
  'house_label': {'ru': 'Дом', 'kk': 'Үй', 'en': 'House'},
  'entrance_label': {'ru': 'Подъезд', 'kk': 'Кіреберіс', 'en': 'Entrance'},
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
  'map_delivery_select_point': {
    'ru': 'Укажите адрес — сразу проверим доставку',
    'kk': 'Мекенжайды көрсетіңіз — жеткізуді бірден тексереміз',
    'en': 'Choose an address to check delivery',
  },
  'map_delivery_checking': {
    'ru': 'Проверяем зону доставки…',
    'kk': 'Жеткізу аймағын тексеріп жатырмыз…',
    'en': 'Checking the delivery area…',
  },
  'map_delivery_check_failed': {
    'ru': 'Не удалось проверить зону доставки',
    'kk': 'Жеткізу аймағын тексеру мүмкін болмады',
    'en': 'Could not check the delivery area',
  },
  'map_delivery_outside_zone': {
    'ru': 'Сюда пока не доставляем',
    'kk': 'Бұл мекенжайға әзірге жеткізбейміз',
    'en': 'Delivery is not available here yet',
  },
  'map_delivery_outside_hint': {
    'ru': 'Выберите адрес внутри цветной зоны на карте.',
    'kk': 'Картадағы түсті аймақтың ішінен мекенжай таңдаңыз.',
    'en': 'Choose an address inside a colored area on the map.',
  },
  'map_delivery_available': {
    'ru': 'Доставка из «{branch}» доступна',
    'kk': '«{branch}» нүктесінен жеткізу қолжетімді',
    'en': 'Delivery from “{branch}” is available',
  },
  'map_delivery_tariff': {
    'ru': 'Стоимость {fee} ₸ · расстояние {distance} км',
    'kk': 'Құны {fee} ₸ · қашықтық {distance} км',
    'en': 'Fee {fee} ₸ · distance {distance} km',
  },
  'map_delivery_unavailable_short': {
    'ru': 'Вне зоны доставки',
    'kk': 'Жеткізу аймағынан тыс',
    'en': 'Outside delivery area',
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
    'ru': 'Геолокация выключена. На карте оставлен центр Астаны.',
    'kk': 'Геолокация өшірілген. Картада Астана орталығы қалды.',
    'en': 'Location services are off. The map remains centered on Astana.',
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
  'geo_accuracy': {
    'ru': 'Точность геолокации: ±{meters} м',
    'kk': 'Геолокация дәлдігі: ±{meters} м',
    'en': 'Location accuracy: ±{meters} m',
  },
  'geo_low_accuracy': {
    'ru':
        'Геолокация получена с точностью ±{meters} м. Уточните точку вручную.',
    'kk': 'Геолокация дәлдігі ±{meters} м. Нүктені картадан нақтылаңыз.',
    'en': 'Location accuracy is ±{meters} m. Refine the point on the map.',
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
  'locations_other_city': {
    'ru': 'Другой город',
    'kk': 'Басқа қала',
    'en': 'Other city',
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
  'city_astana': {'ru': 'Астана', 'kk': 'Астана', 'en': 'Astana'},
};
