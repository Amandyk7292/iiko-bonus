part of '../main.dart';

const Map<String, Map<String, String>> _featureStateTranslations = {
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
  'catalog_pickup_menu': {
    'ru': 'Меню для самовывоза',
    'kk': 'Алып кету мәзірі',
    'en': 'Pickup menu',
  },
  'catalog_delivery_menu': {
    'ru': 'Меню для доставки',
    'kk': 'Жеткізу мәзірі',
    'en': 'Delivery menu',
  },
  'catalog_preorder_menu': {
    'ru': 'Меню для предзаказа',
    'kk': 'Алдын ала тапсырыс мәзірі',
    'en': 'Preorder menu',
  },
  'catalog_delivery_address_label': {
    'ru': 'Адрес',
    'kk': 'Мекенжай',
    'en': 'Address',
  },
  'catalog_bakery_label': {'ru': 'Пекарня', 'kk': 'Наубайхана', 'en': 'Bakery'},
  'catalog_search': {
    'ru': 'Поиск по меню',
    'kk': 'Мәзірден іздеу',
    'en': 'Search menu',
  },
  'catalog_clear_search': {
    'ru': 'Очистить поиск',
    'kk': 'Іздеуді тазарту',
    'en': 'Clear search',
  },
  'catalog_filter': {'ru': 'Фильтры', 'kk': 'Сүзгілер', 'en': 'Filters'},
  'catalog_suggestions': {
    'ru': 'Варианты поиска',
    'kk': 'Іздеу нұсқалары',
    'en': 'Search suggestions',
  },
  'catalog_all_categories': {
    'ru': 'Все категории',
    'kk': 'Барлық санаттар',
    'en': 'All categories',
  },
  'catalog_search_results': {
    'ru': 'Результаты поиска',
    'kk': 'Іздеу нәтижелері',
    'en': 'Search results',
  },
  'catalog_products': {'ru': 'товаров', 'kk': 'тауар', 'en': 'items'},
  'catalog_in_stock': {
    'ru': 'В наличии',
    'kk': 'Қоймада бар',
    'en': 'In stock',
  },
  'catalog_stock_count': {
    'ru': 'В наличии: {count}',
    'kk': 'Қолда бар: {count}',
    'en': 'In stock: {count}',
  },
  'catalog_offline_cache': {
    'ru': 'Показано сохранённое меню. Проверьте интернет.',
    'kk': 'Сақталған мәзір көрсетілді. Интернетті тексеріңіз.',
    'en': 'Showing saved menu. Check your connection.',
  },
  'catalog_stop_list': {
    'ru': 'Нет в наличии',
    'kk': 'Қоймада жоқ',
    'en': 'Unavailable',
  },
  'catalog_add_to_cart': {
    'ru': 'В корзину',
    'kk': 'Себетке',
    'en': 'Add to cart',
  },
  'catalog_loading': {
    'ru': 'Загружаем категории и товары',
    'kk': 'Санаттар мен тауарлар жүктелуде',
    'en': 'Loading categories and products',
  },
  'catalog_view_all': {'ru': 'Все', 'kk': 'Барлығы', 'en': 'View all'},
  'catalog_select_order_type_first': {
    'ru': 'Сначала выберите, пожалуйста, тип заказа',
    'kk': 'Алдымен тапсырыс түрін таңдаңыз',
    'en': 'Please select an order type first',
  },
  'catalog_select_order_type_ok': {'ru': 'ОК', 'kk': 'ОК', 'en': 'OK'},
  'catalog_load_failed': {
    'ru': 'Не удалось загрузить меню',
    'kk': 'Мәзірді жүктеу мүмкін болмады',
    'en': 'Could not load the menu',
  },
  'catalog_retry': {'ru': 'Повторить', 'kk': 'Қайталау', 'en': 'Retry'},
  'catalog_empty': {
    'ru': 'По вашему запросу ничего не найдено',
    'kk': 'Сұрауыңыз бойынша ештеңе табылмады',
    'en': 'Nothing matches your search',
  },
  'catalog_empty_hint': {
    'ru': 'Попробуйте изменить запрос, категорию или выбранные фильтры.',
    'kk': 'Сұрауды, санатты немесе таңдалған сүзгілерді өзгертіп көріңіз.',
    'en': 'Try changing the search, category, or selected filters.',
  },
  'catalog_favorites_empty': {
    'ru': 'В избранном пока ничего нет',
    'kk': 'Таңдаулылар әзірге бос',
    'en': 'No favorites yet',
  },
  'catalog_favorites_empty_hint': {
    'ru': 'Нажмите на сердце у товара, чтобы сохранить его здесь.',
    'kk': 'Тауарды осында сақтау үшін жүрек белгісін басыңыз.',
    'en': 'Tap the heart on a product to save it here.',
  },
  'catalog_browse_menu': {
    'ru': 'Перейти в каталог',
    'kk': 'Мәзірге өту',
    'en': 'Browse menu',
  },
  'catalog_filter_expand': {
    'ru': 'Развернуть раздел',
    'kk': 'Бөлімді ашу',
    'en': 'Expand section',
  },
  'catalog_filter_collapse': {
    'ru': 'Свернуть раздел',
    'kk': 'Бөлімді жабу',
    'en': 'Collapse section',
  },
  'catalog_reset_filters': {
    'ru': 'Сбросить фильтры',
    'kk': 'Сүзгілерді тазарту',
    'en': 'Reset filters',
  },
  'catalog_sort_title': {'ru': 'Сортировка', 'kk': 'Сұрыптау', 'en': 'Sort by'},
  'catalog_sort_default': {
    'ru': 'По умолчанию',
    'kk': 'Әдепкі бойынша',
    'en': 'Default',
  },
  'catalog_sort_price_low': {
    'ru': 'Сначала дешевле',
    'kk': 'Алдымен арзанырақ',
    'en': 'Lowest price first',
  },
  'catalog_sort_price_high': {
    'ru': 'Сначала дороже',
    'kk': 'Алдымен қымбатырақ',
    'en': 'Highest price first',
  },
  'catalog_only_available': {
    'ru': 'Только в наличии',
    'kk': 'Тек қолжетімді',
    'en': 'Available only',
  },
  'catalog_availability': {
    'ru': 'Наличие',
    'kk': 'Қолжетімділік',
    'en': 'Availability',
  },
  'catalog_dietary_filters': {
    'ru': 'Особенности питания',
    'kk': 'Тамақтану ерекшеліктері',
    'en': 'Dietary preferences',
  },
  'catalog_exclude_allergens': {
    'ru': 'Исключить аллергены',
    'kk': 'Аллергендерді алып тастау',
    'en': 'Exclude allergens',
  },
  'catalog_product_facts': {
    'ru': 'Сведения о товаре',
    'kk': 'Тауар туралы мәлімет',
    'en': 'Product information',
  },
  'catalog_weight': {'ru': 'Вес', 'kk': 'Салмақ', 'en': 'Weight'},
  'catalog_ingredients': {'ru': 'Состав', 'kk': 'Құрамы', 'en': 'Ingredients'},
  'catalog_allergens': {
    'ru': 'Аллергены',
    'kk': 'Аллергендер',
    'en': 'Allergens',
  },
  'catalog_allergens_value': {
    'ru': 'Аллергены: {value}',
    'kk': 'Аллергендер: {value}',
    'en': 'Allergens: {value}',
  },
  'catalog_weight_short': {
    'ru': '{weight} г',
    'kk': '{weight} г',
    'en': '{weight} g',
  },
  'catalog_weight_value': {
    'ru': 'Вес {weight} г',
    'kk': 'Салмағы {weight} г',
    'en': 'Weight {weight} g',
  },
  'catalog_nutrition': {
    'ru': 'КБЖУ',
    'kk': 'Тағамдық құндылық',
    'en': 'Nutrition',
  },
  'catalog_nutrition_whole_product': {
    'ru': 'Пищевая ценность на 100 г',
    'kk': '100 г тағамдық құндылығы',
    'en': 'Nutrition per 100 g',
  },
  'catalog_calories': {'ru': 'Ккал', 'kk': 'Ккал', 'en': 'Calories'},
  'catalog_protein': {'ru': 'Белки', 'kk': 'Ақуыз', 'en': 'Protein'},
  'catalog_fat': {'ru': 'Жиры', 'kk': 'Май', 'en': 'Fat'},
  'catalog_carbs': {'ru': 'Углеводы', 'kk': 'Көмірсу', 'en': 'Carbs'},
  'catalog_kcal': {'ru': 'ккал', 'kk': 'ккал', 'en': 'kcal'},
  'catalog_grams': {'ru': 'г', 'kk': 'г', 'en': 'g'},
  'catalog_quantity_value': {
    'ru': 'Количество: {count}',
    'kk': 'Саны: {count}',
    'en': 'Quantity: {count}',
  },
  'catalog_decrease_quantity': {
    'ru': 'Уменьшить количество',
    'kk': 'Санын азайту',
    'en': 'Decrease quantity',
  },
  'catalog_increase_quantity': {
    'ru': 'Увеличить количество',
    'kk': 'Санын арттыру',
    'en': 'Increase quantity',
  },
  'catalog_added_to_cart': {
    'ru': 'Товар добавлен в корзину',
    'kk': 'Тауар себетке қосылды',
    'en': 'Product added to cart',
  },
  'catalog_share_product': {
    'ru': 'Поделиться товаром',
    'kk': 'Тауармен бөлісу',
    'en': 'Share product',
  },
  'catalog_product_link_copied': {
    'ru': 'Ссылка на товар скопирована',
    'kk': 'Тауар сілтемесі көшірілді',
    'en': 'Product link copied',
  },
  'catalog_about_product': {
    'ru': 'О продукте',
    'kk': 'Өнім туралы',
    'en': 'About the product',
  },
  'catalog_product_info_pending': {
    'ru': 'Информация скоро появится',
    'kk': 'Ақпарат жақында қосылады',
    'en': 'Information will be added soon',
  },
  'catalog_product_information': {
    'ru': 'Информация о продукте',
    'kk': 'Өнім туралы ақпарат',
    'en': 'Product information',
  },
  'catalog_view_ingredients': {
    'ru': 'Посмотреть состав',
    'kk': 'Құрамын көру',
    'en': 'View ingredients',
  },
  'catalog_storage_conditions': {
    'ru': 'Срок и условия хранения',
    'kk': 'Сақтау мерзімі мен шарттары',
    'en': 'Storage life and conditions',
  },
  'catalog_storage_at_temperature': {
    'ru': 'При температуре',
    'kk': 'Температурада',
    'en': 'At temperature',
  },
  'catalog_storage_hours_one': {
    'ru': '{count} час',
    'kk': '{count} сағат',
    'en': '{count} hour',
  },
  'catalog_storage_hours_few': {
    'ru': '{count} часа',
    'kk': '{count} сағат',
    'en': '{count} hours',
  },
  'catalog_storage_hours_many': {
    'ru': '{count} часов',
    'kk': '{count} сағат',
    'en': '{count} hours',
  },
  'catalog_storage_days_one': {
    'ru': '{count} день',
    'kk': '{count} күн',
    'en': '{count} day',
  },
  'catalog_storage_days_few': {
    'ru': '{count} дня',
    'kk': '{count} күн',
    'en': '{count} days',
  },
  'catalog_storage_days_many': {
    'ru': '{count} дней',
    'kk': '{count} күн',
    'en': '{count} days',
  },
  'catalog_storage_months_one': {
    'ru': '{count} месяц',
    'kk': '{count} ай',
    'en': '{count} month',
  },
  'catalog_storage_months_few': {
    'ru': '{count} месяца',
    'kk': '{count} ай',
    'en': '{count} months',
  },
  'catalog_storage_months_many': {
    'ru': '{count} месяцев',
    'kk': '{count} ай',
    'en': '{count} months',
  },
  'catalog_certificates': {
    'ru': 'Сертификаты',
    'kk': 'Сертификаттар',
    'en': 'Certificates',
  },
  'catalog_apply': {'ru': 'Применить', 'kk': 'Қолдану', 'en': 'Apply'},
  'catalog_reset': {'ru': 'Сбросить', 'kk': 'Қалпына келтіру', 'en': 'Reset'},
  'promos_action': {
    'ru': 'Открыть главную',
    'kk': 'Басты бетті ашу',
    'en': 'Open home',
  },
  'promos_empty': {
    'ru': 'Активных акций пока нет',
    'kk': 'Белсенді акциялар әзірге жоқ',
    'en': 'There are no active promotions yet',
  },
  'promos_load_failed': {
    'ru': 'Не удалось загрузить акции',
    'kk': 'Акцияларды жүктеу мүмкін болмады',
    'en': 'Could not load promotions',
  },
  'balance_prefix': {'ru': 'Баланс: ', 'kk': 'Теңгерім: ', 'en': 'Balance: '},
  'points_suffix': {'ru': ' баллов', 'kk': ' ұпай', 'en': ' points'},
  'cashback_gift_1': {'ru': 'Дарим ', 'kk': 'Әр сатылымнан ', 'en': 'Get '},
  'cashback_gift_2': {
    'ru': '% кешбэк после каждой покупки!',
    'kk': '% кэшбэк сыйлаймыз!',
    'en': '% cashback on every purchase!',
  },
};
