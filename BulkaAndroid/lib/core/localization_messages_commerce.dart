part of '../main.dart';

const Map<String, Map<String, String>> _commerceTranslations = {
  // Orders & Cart screen
  'balance_history_title': {
    'ru': 'История баланса',
    'kk': 'Баланс тарихы',
    'en': 'Balance history',
  },
  'cart_empty_title': {'ru': 'Ой!', 'kk': 'Ой!', 'en': 'Oops!'},
  'cart_empty_sub': {
    'ru': 'Ничего не найдено!',
    'kk': 'Ештеңе табылмады!',
    'en': 'Nothing found!',
  },
  'cart_action': {
    'ru': 'Перейти в каталог',
    'kk': 'Каталогқа өту',
    'en': 'Go to catalog',
  },
  'cart_checkout': {
    'ru': 'Оформить заказ',
    'kk': 'Тапсырыс беру',
    'en': 'Checkout',
  },
  'cart_reward': {
    'ru': 'Вернём бонусами',
    'kk': 'Бонуспен қайтарамыз',
    'en': 'Bonus earned',
  },
  'cart_total': {'ru': 'Итоговая цена:', 'kk': 'Жалпы баға:', 'en': 'Total:'},
  'cart_points': {'ru': 'баллов', 'kk': 'балл', 'en': 'points'},
  'cart_contains': {'ru': 'В корзине', 'kk': 'Себетте', 'en': 'In cart'},
  'cart_units': {'ru': 'шт', 'kk': 'дана', 'en': 'pcs'},
  'cart_unavailable': {
    'ru': 'Нет в наличии',
    'kk': 'Қолда жоқ',
    'en': 'Unavailable',
  },
  'cart_unavailable_hint': {
    'ru': 'Удалите недоступные товары, чтобы оформить заказ.',
    'kk': 'Тапсырыс беру үшін қолда жоқ тауарларды өшіріңіз.',
    'en': 'Remove unavailable items to continue checkout.',
  },
  'cart_clear_title': {
    'ru': 'Очистить корзину?',
    'kk': 'Себетті тазалау керек пе?',
    'en': 'Clear cart?',
  },
  'cart_clear_body': {
    'ru': 'Все добавленные товары будут удалены.',
    'kk': 'Барлық қосылған тауар жойылады.',
    'en': 'All added products will be removed.',
  },
  'cart_clear': {'ru': 'Очистить', 'kk': 'Тазалау', 'en': 'Clear'},
  'cart_decrease': {
    'ru': 'Уменьшить количество',
    'kk': 'Санын азайту',
    'en': 'Decrease quantity',
  },
  'cart_increase': {
    'ru': 'Увеличить количество',
    'kk': 'Санын көбейту',
    'en': 'Increase quantity',
  },
  'cart_quantity': {'ru': 'Количество', 'kk': 'Саны', 'en': 'Quantity'},
  'checkout_title': {
    'ru': 'Оформление заказа',
    'kk': 'Тапсырысты рәсімдеу',
    'en': 'Checkout',
  },
  'checkout_pickup': {'ru': 'Самовывоз', 'kk': 'Алып кету', 'en': 'Pickup'},
  'checkout_order_type': {
    'ru': 'Способ получения заказа',
    'kk': 'Тапсырысты алу тәсілі',
    'en': 'Order fulfilment method',
  },
  'checkout_branch': {'ru': 'Филиал', 'kk': 'Филиал', 'en': 'Location'},
  'checkout_select_branch': {
    'ru': 'Выберите филиал',
    'kk': 'Филиалды таңдаңыз',
    'en': 'Select a location',
  },
  'checkout_branch_required': {
    'ru': 'Выберите филиал.',
    'kk': 'Филиалды таңдаңыз.',
    'en': 'Select a location.',
  },
  'checkout_delivery_address': {
    'ru': 'Адрес доставки',
    'kk': 'Жеткізу мекенжайы',
    'en': 'Delivery address',
  },
  'checkout_select_delivery_address': {
    'ru': 'Выберите адрес доставки',
    'kk': 'Жеткізу мекенжайын таңдаңыз',
    'en': 'Select a delivery address',
  },
  'checkout_delivery_address_required': {
    'ru': 'Выберите точный адрес доставки на карте.',
    'kk': 'Картадан нақты жеткізу мекенжайын таңдаңыз.',
    'en': 'Select an exact delivery address on the map.',
  },
  'checkout_delivery_unavailable': {
    'ru':
        'Доставка пока недоступна для выбранных точек. Вернитесь на главную и выберите самовывоз или предзаказ.',
    'kk':
        'Таңдалған орындар үшін жеткізу әзірге қолжетімсіз. Басты бетке оралып, алып кетуді немесе алдын ала тапсырысты таңдаңыз.',
    'en':
        'Delivery is not available for the configured locations yet. Return to Home and choose pickup or preorder.',
  },
  'checkout_additional_phone': {
    'ru': 'Дополнительный номер',
    'kk': 'Қосымша нөмір',
    'en': 'Additional phone',
  },
  'checkout_promo': {'ru': 'Промокод', 'kk': 'Промокод', 'en': 'Promo code'},
  'checkout_enter_code': {
    'ru': 'Введите код',
    'kk': 'Кодты енгізіңіз',
    'en': 'Enter code',
  },
  'checkout_apply': {'ru': 'Применить', 'kk': 'Қолдану', 'en': 'Apply'},
  'checkout_select_pickup_time': {
    'ru': 'Выберите время самовывоза',
    'kk': 'Алып кету уақытын таңдаңыз',
    'en': 'Select pickup time',
  },
  'checkout_select_delivery_time': {
    'ru': 'Выберите время доставки',
    'kk': 'Жеткізу уақытын таңдаңыз',
    'en': 'Select delivery time',
  },
  'checkout_select_preorder_time': {
    'ru': 'Выберите время предзаказа',
    'kk': 'Алдын ала тапсырыс уақытын таңдаңыз',
    'en': 'Select preorder time',
  },
  'checkout_select_time': {
    'ru': 'Выберите время',
    'kk': 'Уақытты таңдаңыз',
    'en': 'Select time',
  },
  'checkout_select_time_today': {
    'ru': 'Выберите время на сегодня',
    'kk': 'Бүгінгі уақытты таңдаңыз',
    'en': 'Select a time for today',
  },
  'checkout_preorder_method': {
    'ru': 'Как получить предзаказ',
    'kk': 'Алдын ала тапсырысты алу тәсілі',
    'en': 'How to receive the preorder',
  },
  'checkout_choose_date': {
    'ru': 'Выберите число',
    'kk': 'Күнді таңдаңыз',
    'en': 'Select a date',
  },
  'checkout_choose_time': {
    'ru': 'Выберите время',
    'kk': 'Уақытты таңдаңыз',
    'en': 'Select a time',
  },
  'checkout_catalog_locked': {
    'ru': 'Ассортимент выбран для этого типа заказа',
    'kk': 'Ассортимент осы тапсырыс түріне таңдалды',
    'en': 'The assortment matches this order type',
  },
  'checkout_payment_method': {
    'ru': 'Выберите способ оплаты',
    'kk': 'Төлем әдісін таңдаңыз',
    'en': 'Select payment method',
  },
  'checkout_comment': {'ru': 'Комментарий', 'kk': 'Пікір', 'en': 'Comment'},
  'checkout_comment_hint': {
    'ru': 'Оставьте свой комментарий',
    'kk': 'Пікіріңізді жазыңыз',
    'en': 'Add a comment',
  },
  'checkout_subtotal': {
    'ru': 'Сумма заказа',
    'kk': 'Тапсырыс сомасы',
    'en': 'Subtotal',
  },
  'checkout_discount': {
    'ru': 'Скидка по промокоду',
    'kk': 'Промокод жеңілдігі',
    'en': 'Promo discount',
  },
  'checkout_delivery_fee': {
    'ru': 'Стоимость доставки',
    'kk': 'Жеткізу құны',
    'en': 'Delivery fee',
  },
  'checkout_total': {'ru': 'Итоговая цена', 'kk': 'Жалпы баға', 'en': 'Total'},
  'checkout_time_required': {
    'ru': 'Выберите время получения заказа.',
    'kk': 'Тапсырысты алу уақытын таңдаңыз.',
    'en': 'Select an order time.',
  },
  'checkout_no_time_slots': {
    'ru': 'Для выбранной точки нет доступного времени. Выберите другую точку.',
    'kk': 'Таңдалған орын үшін бос уақыт жоқ. Басқа орынды таңдаңыз.',
    'en':
        'No time slots are available for this location. Choose another location.',
  },
  'checkout_delivery_outside_zone': {
    'ru': 'Этот адрес находится вне зоны доставки доступных точек.',
    'kk': 'Бұл мекенжай қолжетімді орындардың жеткізу аймағынан тыс.',
    'en': 'This address is outside the delivery area of available locations.',
  },
  'checkout_phone_invalid': {
    'ru': 'Проверьте дополнительный номер телефона.',
    'kk': 'Қосымша телефон нөмірін тексеріңіз.',
    'en': 'Check the additional phone number.',
  },
  'checkout_promo_applied': {
    'ru': 'Промокод применён',
    'kk': 'Промокод қолданылды',
    'en': 'Promo code applied',
  },
  'checkout_price_checked': {
    'ru': 'Цена проверена',
    'kk': 'Баға тексерілді',
    'en': 'Price checked',
  },
  'checkout_kaspi_unavailable': {
    'ru': 'Kaspi Pay временно недоступен. Попробуйте немного позже.',
    'kk': 'Kaspi Pay уақытша қолжетімсіз. Сәл кейінірек қайталап көріңіз.',
    'en': 'Kaspi Pay is temporarily unavailable. Please try again later.',
  },
  'checkout_forte_unavailable': {
    'ru': 'Оплата картой ForteBank временно недоступна.',
    'kk': 'ForteBank картасымен төлем уақытша қолжетімсіз.',
    'en': 'ForteBank card payment is temporarily unavailable.',
  },
  'checkout_kaspi_card_hint': {
    'ru': 'Счёт в Kaspi.kz',
    'kk': 'Kaspi.kz шоты',
    'en': 'Kaspi.kz invoice',
  },
  'checkout_forte_card_hint': {
    'ru': 'Visa, Mastercard',
    'kk': 'Visa, Mastercard',
    'en': 'Visa, Mastercard',
  },
  'payment_method_unavailable': {
    'ru': 'Сейчас недоступно',
    'kk': 'Қазір қолжетімсіз',
    'en': 'Currently unavailable',
  },
  'checkout_today': {'ru': 'Сегодня', 'kk': 'Бүгін', 'en': 'Today'},
  'checkout_tomorrow': {'ru': 'Завтра', 'kk': 'Ертең', 'en': 'Tomorrow'},
  'payment_title': {
    'ru': 'Оплата Kaspi',
    'kk': 'Kaspi төлемі',
    'en': 'Kaspi payment',
  },
  'forte_payment_title': {
    'ru': 'Оплата картой',
    'kk': 'Картамен төлеу',
    'en': 'Card payment',
  },
  'payment_received': {
    'ru': 'Оплата получена',
    'kk': 'Төлем алынды',
    'en': 'Payment received',
  },
  'payment_confirm': {
    'ru': 'Подтвердите оплату',
    'kk': 'Төлемді растаңыз',
    'en': 'Confirm payment',
  },
  'payment_failed': {
    'ru': 'Оплата не завершена',
    'kk': 'Төлем аяқталмады',
    'en': 'Payment not completed',
  },
  'payment_fulfilled': {
    'ru': 'Заказ принят.',
    'kk': 'Тапсырыс қабылданды.',
    'en': 'Order accepted.',
  },
  'payment_saved': {
    'ru': 'Заказ сохранён и появился в разделе «Мои заказы».',
    'kk': 'Тапсырыс сақталды және «Менің тапсырыстарым» бөлімінде көрінеді.',
    'en': 'Your order was saved and is now visible in My orders.',
  },
  'payment_waiting_restaurant': {
    'ru': 'Деньги получены. Заказ ожидает подтверждения рестораном.',
    'kk': 'Төлем алынды. Тапсырыс мейрамхана растауын күтуде.',
    'en': 'Payment received. The order is awaiting restaurant confirmation.',
  },
  'payment_not_charged': {
    'ru': 'Счёт отменён или истёк. Деньги не списаны.',
    'kk': 'Шот жойылды немесе мерзімі өтті. Ақша алынбады.',
    'en': 'The invoice was canceled or expired. No money was charged.',
  },
  'payment_open_kaspi_hint': {
    'ru': 'Откройте Kaspi.kz и подтвердите выставленный счёт.',
    'kk': 'Kaspi.kz қолданбасын ашып, шотты растаңыз.',
    'en': 'Open Kaspi.kz and confirm the invoice.',
  },
  'payment_open_kaspi': {
    'ru': 'Открыть Kaspi',
    'kk': 'Kaspi ашу',
    'en': 'Open Kaspi',
  },
  'forte_payment_hint': {
    'ru':
        'Завершите оплату на защищённой странице ForteBank. Статус обновится автоматически.',
    'kk':
        'ForteBank қорғалған бетінде төлемді аяқтаңыз. Күй автоматты түрде жаңартылады.',
    'en':
        'Complete payment on the secure ForteBank page. The status will update automatically.',
  },
  'forte_payment_open': {
    'ru': 'Открыть страницу оплаты',
    'kk': 'Төлем бетін ашу',
    'en': 'Open payment page',
  },
  'forte_checkout_invalid': {
    'ru': 'ForteBank вернул некорректную ссылку оплаты.',
    'kk': 'ForteBank қате төлем сілтемесін қайтарды.',
    'en': 'ForteBank returned an invalid payment link.',
  },
  'forte_payment_open_failed': {
    'ru': 'Не удалось открыть страницу ForteBank. Попробуйте ещё раз.',
    'kk': 'ForteBank бетін ашу мүмкін болмады. Қайталап көріңіз.',
    'en': 'Could not open the ForteBank page. Please try again.',
  },
  'payment_done': {'ru': 'Готово', 'kk': 'Дайын', 'en': 'Done'},
  'payment_back_cart': {
    'ru': 'Вернуться в корзину',
    'kk': 'Себетке оралу',
    'en': 'Back to cart',
  },
  'payment_timeout': {
    'ru': 'Время ожидания истекло. Проверьте заказ позже или повторите оплату.',
    'kk':
        'Күту уақыты аяқталды. Тапсырысты кейін тексеріңіз немесе төлемді қайталаңыз.',
    'en': 'Payment timed out. Check the order later or try again.',
  },
  'payment_open_failed': {
    'ru': 'Не удалось открыть Kaspi. Откройте приложение вручную.',
    'kk': 'Kaspi ашылмады. Қолданбаны қолмен ашыңыз.',
    'en': 'Could not open Kaspi. Open the app manually.',
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
    'ru': 'Оплаченные заказы появятся здесь.',
    'kk': 'Төленген тапсырыстар осында көрінеді.',
    'en': 'Paid orders will appear here.',
  },
  'orders_active': {'ru': 'Активные', 'kk': 'Белсенді', 'en': 'Active'},
  'orders_completed': {
    'ru': 'Завершённые',
    'kk': 'Аяқталған',
    'en': 'Completed',
  },
  'orders_number': {'ru': 'Заказ №', 'kk': 'Тапсырыс №', 'en': 'Order #'},
  'orders_branch': {'ru': 'Филиал', 'kk': 'Филиал', 'en': 'Location'},
  'orders_pickup': {'ru': 'Самовывоз', 'kk': 'Алып кету', 'en': 'Pickup'},
  'orders_bonus': {
    'ru': 'Начислим бонусов',
    'kk': 'Қосылатын бонус',
    'en': 'Bonus earned',
  },
  'orders_total': {'ru': 'Итоговая цена', 'kk': 'Жалпы баға', 'en': 'Total'},
  'orders_refund': {'ru': 'Возвращено', 'kk': 'Қайтарылды', 'en': 'Refunded'},
  'orders_cancel_reason': {
    'ru': 'Причина отмены',
    'kk': 'Бас тарту себебі',
    'en': 'Cancellation reason',
  },
  'orders_load_error': {
    'ru': 'Не удалось загрузить заказы.',
    'kk': 'Тапсырыстар жүктелмеді.',
    'en': 'Could not load orders.',
  },
  'orders_retry': {'ru': 'Повторить', 'kk': 'Қайталау', 'en': 'Retry'},
  'orders_delivery_status': {
    'ru': 'Статус доставки',
    'kk': 'Жеткізу мәртебесі',
    'en': 'Delivery status',
  },
  'orders_courier': {'ru': 'Курьер', 'kk': 'Курьер', 'en': 'Courier'},
  'orders_courier_map': {
    'ru': 'Показать курьера на карте',
    'kk': 'Курьерді картадан көрсету',
    'en': 'Show courier on map',
  },
  'orders_track_yandex': {
    'ru': 'Отследить курьера',
    'kk': 'Курьерді бақылау',
    'en': 'Track courier',
  },
  'orders_eta': {
    'ru': 'Ожидаемая доставка',
    'kk': 'Күтілетін жеткізу',
    'en': 'Estimated delivery',
  },
  'orders_tracking': {
    'ru': 'Код отслеживания',
    'kk': 'Бақылау коды',
    'en': 'Tracking code',
  },
  'orders_delivery_pin': {
    'ru': 'Код передачи заказа',
    'kk': 'Тапсырысты беру коды',
    'en': 'Handover code',
  },
  'orders_delivery_pin_hint': {
    'ru': 'Назовите курьеру только при получении',
    'kk': 'Курьерге тек тапсырысты алған кезде айтыңыз',
    'en': 'Share it only after receiving the order',
  },
  'delivery_status_unassigned': {
    'ru': 'Ищем курьера',
    'kk': 'Курьер ізделуде',
    'en': 'Finding a courier',
  },
  'delivery_status_assigned': {
    'ru': 'Курьер назначен',
    'kk': 'Курьер тағайындалды',
    'en': 'Courier assigned',
  },
  'delivery_status_picked_up': {
    'ru': 'Заказ у курьера',
    'kk': 'Тапсырыс курьерде',
    'en': 'Picked up',
  },
  'delivery_status_en_route': {
    'ru': 'Курьер в пути',
    'kk': 'Курьер жолда',
    'en': 'Courier en route',
  },
  'delivery_status_delivered': {
    'ru': 'Заказ доставлен',
    'kk': 'Тапсырыс жеткізілді',
    'en': 'Delivered',
  },
  'order_status_new': {'ru': 'Новый', 'kk': 'Жаңа', 'en': 'New'},
  'order_status_accepted': {
    'ru': 'Принят',
    'kk': 'Қабылданды',
    'en': 'Accepted',
  },
  'order_status_preparing': {
    'ru': 'Готовится',
    'kk': 'Дайындалуда',
    'en': 'Preparing',
  },
  'order_status_ready': {'ru': 'Готов', 'kk': 'Дайын', 'en': 'Ready'},
  'order_status_completed': {
    'ru': 'Завершён',
    'kk': 'Аяқталды',
    'en': 'Completed',
  },
  'order_status_cancelled': {
    'ru': 'Отменён',
    'kk': 'Бас тартылды',
    'en': 'Cancelled',
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
};
