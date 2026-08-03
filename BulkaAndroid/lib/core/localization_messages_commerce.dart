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
  'cart_quantity_limit_reached': {
    'ru': 'Максимум {count} шт.',
    'kk': 'Ең көбі {count} дана',
    'en': 'Maximum {count} items',
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
  'checkout_substitution_title': {
    'ru': 'Если товара не будет',
    'kk': 'Тауар болмаса',
    'en': 'If an item is unavailable',
  },
  'checkout_substitution_hint': {
    'ru': 'Выберите, как поступить с отсутствующей позицией.',
    'kk': 'Жоқ позициямен не істеу керегін таңдаңыз.',
    'en': 'Choose what should happen to an unavailable item.',
  },
  'checkout_substitution_remove_refund': {
    'ru': 'Убрать позицию и вернуть деньги',
    'kk': 'Позицияны алып тастап, ақшаны қайтару',
    'en': 'Remove it and refund the amount',
  },
  'checkout_substitution_remove_refund_hint': {
    'ru': 'Вернём стоимость этой позиции тем же способом оплаты.',
    'kk': 'Осы позицияның құнын бастапқы төлем тәсілімен қайтарамыз.',
    'en': 'We will refund that item to the original payment method.',
  },
  'checkout_substitution_call_customer': {
    'ru': 'Позвонить мне',
    'kk': 'Маған қоңырау шалу',
    'en': 'Call me',
  },
  'checkout_substitution_call_customer_hint': {
    'ru': 'Сотрудник уточнит решение по телефону.',
    'kk': 'Қызметкер шешімді телефон арқылы нақтылайды.',
    'en': 'A team member will confirm the choice by phone.',
  },
  'checkout_substitution_replace_approval': {
    'ru': 'Заменить после согласования',
    'kk': 'Келісілгеннен кейін ауыстыру',
    'en': 'Replace it after approval',
  },
  'checkout_substitution_replace_approval_hint': {
    'ru': 'Ничего не заменяем без вашего подтверждения.',
    'kk': 'Сіздің растауыңызсыз ештеңе ауыстырылмайды.',
    'en': 'Nothing will be replaced without your approval.',
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
  'checkout_time_expired': {
    'ru': 'Это время уже недоступно. Выберите новый интервал.',
    'kk': 'Бұл уақыт енді қолжетімсіз. Жаңа аралықты таңдаңыз.',
    'en': 'This time is no longer available. Select a new time slot.',
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
  'checkout_card_payment_title': {
    'ru': 'Оплатить картой',
    'kk': 'Картамен төлеу',
    'en': 'Pay by card',
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
  'payment_cancelled_title': {
    'ru': 'Оплата отменена',
    'kk': 'Төлемнен бас тартылды',
    'en': 'Payment cancelled',
  },
  'payment_cancelled_explanation': {
    'ru':
        'Деньги не списаны. Отменённая попытка не стала заказом. Ниже показаны ваши предыдущие заказы.',
    'kk':
        'Ақша алынбады. Бас тартылған төлем әрекеті тапсырысқа айналмады. Төменде бұрынғы тапсырыстарыңыз көрсетілген.',
    'en':
        'No money was charged. The cancelled payment attempt did not become an order. Your previous orders are shown below.',
  },
  'payment_cancelled_dismiss': {
    'ru': 'Скрыть сообщение',
    'kk': 'Хабарламаны жасыру',
    'en': 'Dismiss message',
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
  'forte_payment_open_external': {
    'ru': 'Открыть в системном браузере',
    'kk': 'Жүйелік браузерде ашу',
    'en': 'Open in system browser',
  },
  'forte_secure_page': {
    'ru': 'Защищённая страница банка',
    'kk': 'Банктің қорғалған беті',
    'en': 'Secure bank page',
  },
  'forte_payment_loading': {
    'ru': 'Загружается защищённая страница оплаты',
    'kk': 'Қорғалған төлем беті жүктелуде',
    'en': 'Loading the secure payment page',
  },
  'forte_payment_verifying_title': {
    'ru': 'Проверяем оплату',
    'kk': 'Төлемді тексеріп жатырмыз',
    'en': 'Checking payment',
  },
  'forte_payment_verifying_hint': {
    'ru':
        'Страница банка закрыта. Подождите несколько секунд — мы подтверждаем результат оплаты.',
    'kk':
        'Банк беті жабылды. Бірнеше секунд күтіңіз — төлем нәтижесін растап жатырмыз.',
    'en':
        'The bank page is closed. Please wait a few seconds while we confirm the payment result.',
  },
  'forte_payment_pending_title': {
    'ru': 'Результат ещё уточняется',
    'kk': 'Нәтиже әлі тексеріліп жатыр',
    'en': 'The result is still being checked',
  },
  'forte_payment_pending_hint': {
    'ru':
        'Не начинайте новую оплату. Сначала проверьте эту операцию или откройте «Мои заказы».',
    'kk':
        'Жаңа төлемді бастамаңыз. Алдымен осы операцияны тексеріңіз немесе «Менің тапсырыстарым» бөлімін ашыңыз.',
    'en':
        'Do not start another payment. Check this operation first or open My orders.',
  },
  'forte_payment_check_status': {
    'ru': 'Проверить статус',
    'kk': 'Күйін тексеру',
    'en': 'Check status',
  },
  'forte_payment_my_orders': {
    'ru': 'Мои заказы',
    'kk': 'Менің тапсырыстарым',
    'en': 'My orders',
  },
  'forte_payment_close_confirm_title': {
    'ru': 'Закрыть страницу оплаты?',
    'kk': 'Төлем бетін жабу керек пе?',
    'en': 'Close the payment page?',
  },
  'forte_payment_close_confirm_hint': {
    'ru':
        'Банк ещё может подтвердить операцию. Мы сохраним её и не создадим повторную оплату.',
    'kk':
        'Банк операцияны әлі растауы мүмкін. Біз оны сақтап, қайталама төлем жасамаймыз.',
    'en':
        'The bank may still confirm this operation. We will keep it and prevent a duplicate payment.',
  },
  'forte_payment_embed_failed': {
    'ru':
        'Не удалось показать оплату внутри приложения. Повторите попытку или откройте системный браузер.',
    'kk':
        'Төлемді қолданба ішінде көрсету мүмкін болмады. Қайталап көріңіз немесе жүйелік браузерді ашыңыз.',
    'en':
        'Could not show payment inside the app. Try again or open the system browser.',
  },
  'forte_external_app_failed': {
    'ru': 'Не удалось открыть приложение для оплаты.',
    'kk': 'Төлем қолданбасын ашу мүмкін болмады.',
    'en': 'Could not open the payment app.',
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
  'orders_payment_status_format': {
    'ru': 'Оплата: {status}',
    'kk': 'Төлем: {status}',
    'en': 'Payment: {status}',
  },
  'orders_fulfillment_status_format': {
    'ru': 'Заказ: {status}',
    'kk': 'Тапсырыс: {status}',
    'en': 'Order: {status}',
  },
  'payment_status_pending': {
    'ru': 'Ожидается',
    'kk': 'Күтілуде',
    'en': 'Pending',
  },
  'payment_status_paid': {'ru': 'Оплачено', 'kk': 'Төленді', 'en': 'Paid'},
  'payment_status_refunded': {
    'ru': 'Возвращено',
    'kk': 'Қайтарылды',
    'en': 'Refunded',
  },
  'payment_status_failed': {
    'ru': 'Не оплачено',
    'kk': 'Төленбеді',
    'en': 'Not paid',
  },
  'payment_status_expired': {
    'ru': 'Отменено',
    'kk': 'Бас тартылды',
    'en': 'Cancelled',
  },
  'orders_branch': {'ru': 'Филиал', 'kk': 'Филиал', 'en': 'Location'},
  'orders_pickup': {'ru': 'Самовывоз', 'kk': 'Алып кету', 'en': 'Pickup'},
  'orders_bonus': {
    'ru': 'Начислим бонусов',
    'kk': 'Қосылатын бонус',
    'en': 'Bonus earned',
  },
  'orders_total': {'ru': 'Итоговая цена', 'kk': 'Жалпы баға', 'en': 'Total'},
  'orders_refund': {'ru': 'Возвращено', 'kk': 'Қайтарылды', 'en': 'Refunded'},
  'orders_card_refund_notice': {
    'ru': 'Возврат отправлен на карту. Срок зачисления зависит от банка.',
    'kk': 'Қайтарым картаға жіберілді. Түсу мерзімі банкке байланысты.',
    'en': 'The refund was sent to the card. Posting time depends on the bank.',
  },
  'orders_kaspi_refund_notice': {
    'ru': 'Возврат выполнен через Kaspi Pay.',
    'kk': 'Қайтарым Kaspi Pay арқылы орындалды.',
    'en': 'The refund was completed through Kaspi Pay.',
  },
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
