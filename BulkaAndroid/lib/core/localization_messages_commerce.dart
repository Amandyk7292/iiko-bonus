part of '../main.dart';

const Map<String, Map<String, String>> _commerceTranslations = {
  'catalog_options_load_error': {
    'ru':
        'Не удалось загрузить варианты товара. Повторите попытку перед добавлением в корзину.',
    'kk':
        'Тауар нұсқаларын жүктеу мүмкін болмады. Себетке қоспас бұрын қайталап көріңіз.',
    'en':
        'Product options could not be loaded. Please retry before adding to your cart.',
  },
  'catalog_link_branch_unavailable': {
    'ru': 'Пекарня из ссылки недоступна для выбранного типа заказа.',
    'kk': 'Сілтемедегі наубайхана таңдалған тапсырыс түрі үшін қолжетімсіз.',
    'en': 'The linked bakery is unavailable for the selected order type.',
  },
  'catalog_link_branch_title': {
    'ru': 'Перейти в пекарню «{branch}»?',
    'kk': '«{branch}» наубайханасына ауысу керек пе?',
    'en': 'Switch to {branch}?',
  },
  'catalog_link_branch_cart': {
    'ru':
        'Товары останутся в корзине. Цены и наличие будут проверены для этой пекарни.',
    'kk':
        'Тауарлар себетте қалады. Бағалар мен қолжетімділік осы наубайхана үшін тексеріледі.',
    'en':
        'Your cart items will remain. Prices and availability will be checked for this bakery.',
  },
  'catalog_link_branch_confirm': {
    'ru': 'Перейти',
    'kk': 'Ауысу',
    'en': 'Switch bakery',
  },
  'product_bought_together': {
    'ru': 'С этим часто покупают',
    'kk': 'Осымен бірге жиі сатып алады',
    'en': 'Frequently bought together',
  },
  // Orders & Cart screen
  'balance_history_title': {
    'ru': 'История баланса',
    'kk': 'Баланс тарихы',
    'en': 'Balance history',
  },
  'balance_history_empty': {
    'ru': 'Пока нет операций',
    'kk': 'Әзірге операциялар жоқ',
    'en': 'No transactions yet',
  },
  'balance_purchase_credit': {
    'ru': 'Вам начислено за покупку',
    'kk': 'Сатып алу үшін бонус есептелді',
    'en': 'Bonuses credited for your purchase',
  },
  'balance_purchase_credit_number': {
    'ru': 'Вам начислено за покупку №{number}',
    'kk': '№{number} сатып алу үшін бонус есептелді',
    'en': 'Bonuses credited for purchase #{number}',
  },
  'cart_empty_title': {
    'ru': 'Корзина пока пуста',
    'kk': 'Себет әзірге бос',
    'en': 'Your cart is empty',
  },
  'cart_empty_sub': {
    'ru': 'Добавьте что-нибудь вкусное из каталога.',
    'kk': 'Мәзірден дәмді тағам таңдаңыз.',
    'en': 'Choose something delicious from the catalog.',
  },
  'cart_popular_title': {
    'ru': 'Популярное',
    'kk': 'Танымал өнімдер',
    'en': 'Popular',
  },
  'cart_popular_open': {
    'ru': 'Открыть в каталоге',
    'kk': 'Мәзірден ашу',
    'en': 'Open in catalog',
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
  'cart_guest_bonus_hint': {
    'ru': 'Войдите, чтобы увидеть бонусы за заказ.',
    'kk': 'Тапсырыс бонустарын көру үшін кіріңіз.',
    'en': 'Sign in to see the bonuses for this order.',
  },
  'cart_delivery_fee_hint': {
    'ru': 'Стоимость доставки рассчитаем после выбора адреса.',
    'kk': 'Жеткізу құны мекенжай таңдалғаннан кейін есептеледі.',
    'en': 'Delivery cost is calculated after you choose an address.',
  },
  'cart_change_mode_title': {
    'ru': 'Изменить тип заказа?',
    'kk': 'Тапсырыс түрін өзгертесіз бе?',
    'en': 'Change order type?',
  },
  'cart_change_mode_body': {
    'ru':
        'Некоторые товары в корзине могут быть недоступны в новом типе заказа. Корзина сохранится.',
    'kk':
        'Себеттегі кейбір тауарлар жаңа тапсырыс түрінде қолжетімсіз болуы мүмкін. Себет сақталады.',
    'en':
        'Some cart items may be unavailable for the new order type. Your cart will stay intact.',
  },
  'cart_change_mode_action': {
    'ru': 'Продолжить',
    'kk': 'Жалғастыру',
    'en': 'Continue',
  },
  'cart_total': {'ru': 'Итоговая цена:', 'kk': 'Жалпы баға:', 'en': 'Total:'},
  'cart_points': {'ru': 'бонусов', 'kk': 'бонус', 'en': 'bonuses'},
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
  'cart_unavailable_return_hint': {
    'ru':
        'Эти товары недоступны для выбранного типа заказа. Вернитесь к прежнему режиму или удалите их.',
    'kk':
        'Бұл тауарлар таңдалған тапсырыс түрінде қолжетімсіз. Алдыңғы түріне оралыңыз немесе оларды өшіріңіз.',
    'en':
        'These items are unavailable for this order type. Return to the previous type or remove them.',
  },
  'cart_return_to_mode': {
    'ru': 'Вернуться: {type}',
    'kk': 'Қайту: {type}',
    'en': 'Return to {type}',
  },
  'cart_choose_order_type': {
    'ru': 'Выбрать другой тип заказа',
    'kk': 'Басқа тапсырыс түрін таңдау',
    'en': 'Choose another order type',
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
  'catalog_choose_weight': {
    'ru': 'Выберите вес',
    'kk': 'Салмағын таңдаңыз',
    'en': 'Choose weight',
  },
  'catalog_choose_weight_hint': {
    'ru': 'Укажите, сколько добавить в корзину',
    'kk': 'Себетке қанша қосу керегін көрсетіңіз',
    'en': 'Select how much to add to the cart',
  },
  'catalog_add_weight_to_cart': {
    'ru': 'Добавить в корзину',
    'kk': 'Себетке қосу',
    'en': 'Add to cart',
  },
  'catalog_weight_grams': {
    'ru': '{weight} г',
    'kk': '{weight} г',
    'en': '{weight} g',
  },
  'catalog_weight_kilograms': {
    'ru': '{weight} кг',
    'kk': '{weight} кг',
    'en': '{weight} kg',
  },
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
  'checkout_step_address': {'ru': 'Адрес', 'kk': 'Мекенжай', 'en': 'Address'},
  'checkout_step_time': {'ru': 'Время', 'kk': 'Уақыт', 'en': 'Time'},
  'checkout_step_payment': {'ru': 'Оплата', 'kk': 'Төлем', 'en': 'Payment'},
  'checkout_summary_title': {
    'ru': 'Состав заказа',
    'kk': 'Тапсырыс құрамы',
    'en': 'Order summary',
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
    'ru': 'В данный момент доставка временно недоступна. Выберите самовывоз.',
    'kk': 'Қазір жеткізу уақытша қолжетімсіз. Өзіңіз алып кетуді таңдаңыз.',
    'en': 'Delivery is temporarily unavailable. Please choose pickup.',
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
  'checkout_preorder_pickup_only': {
    'ru': 'Самовывоз из выбранного филиала',
    'kk': 'Таңдалған филиалдан алып кету',
    'en': 'Pickup at the selected branch',
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
  'checkout_use_bonuses': {
    'ru': 'Списать бонусы',
    'kk': 'Бонустарды пайдалану',
    'en': 'Use bonuses',
  },
  'checkout_bonus_changed': {
    'ru': 'Баланс бонусов изменился. Обновите расчёт заказа.',
    'kk': 'Бонус теңгерімі өзгерді. Тапсырыс есебін жаңартыңыз.',
    'en': 'Your bonus balance changed. Refresh the order total.',
  },
  'checkout_bonus_balance': {
    'ru': 'Доступно: {amount} бонусов',
    'kk': 'Қолжетімді: {amount} бонус',
    'en': 'Available: {amount} bonuses',
  },
  'checkout_bonus_limit': {
    'ru':
        'До 50% стоимости товаров после скидок. Доставка оплачивается картой.',
    'kk':
        'Жеңілдіктерден кейінгі тауар құнының 50%-на дейін. Жеткізу картамен төленеді.',
    'en': 'Up to 50% of goods after discounts. Delivery is paid by card.',
  },
  'checkout_bonus_after_quote': {
    'ru': 'Выберите время, чтобы рассчитать доступные бонусы.',
    'kk': 'Қолжетімді бонустарды есептеу үшін уақытты таңдаңыз.',
    'en': 'Select a time to calculate available bonuses.',
  },
  'checkout_bonus_spent': {
    'ru': 'Списано бонусами',
    'kk': 'Бонустармен төленді',
    'en': 'Paid with bonuses',
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
  'checkout_delivery_free': {'ru': 'Бесплатно', 'kk': 'Тегін', 'en': 'Free'},
  'checkout_free_delivery_threshold': {
    'ru': 'Бесплатная доставка от 10 000 ₸',
    'kk': '10 000 ₸ бастап жеткізу тегін',
    'en': 'Free delivery on orders of 10,000 ₸ or more',
  },
  'checkout_quote_changed': {
    'ru': 'Расчёт обновляется. Проверьте сумму и подтвердите оплату ещё раз.',
    'kk': 'Сома қайта есептелуде. Соманы тексеріп, төлемді қайта растаңыз.',
    'en': 'Refreshing your total. Check the amount and confirm payment again.',
  },
  'checkout_delivery_estimate_unavailable': {
    'ru': 'Не удалось рассчитать доставку. Попробуйте ещё раз.',
    'kk': 'Жеткізу құнын есептеу мүмкін болмады. Қайталап көріңіз.',
    'en': 'Unable to calculate delivery. Please try again.',
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
  'checkout_time_closed': {
    'ru':
        'На сегодня филиал уже закрылся. Выберите другую точку или оформите предзаказ.',
    'kk':
        'Бүгін филиал жабылды. Басқа филиалды таңдаңыз немесе алдын ала тапсырыс беріңіз.',
    'en':
        'This branch has closed for today. Choose another location or place a preorder.',
  },
  'checkout_time_closing_soon': {
    'ru':
        'До закрытия осталось слишком мало времени для нового заказа. Выберите другую точку или предзаказ.',
    'kk':
        'Жабылуға дейін жаңа тапсырысқа уақыт жеткіліксіз. Басқа филиалды немесе алдын ала тапсырысты таңдаңыз.',
    'en':
        'There is not enough time before closing for a new order. Choose another location or a preorder.',
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
  'checkout_delivery_minimum': {
    'ru': 'Минимальная сумма заказа для доставки — {amount} ₸.',
    'kk': 'Жеткізуге арналған тапсырыстың ең төменгі сомасы — {amount} ₸.',
    'en': 'The minimum order for delivery is {amount} ₸.',
  },
  'checkout_retry_quote': {
    'ru': 'Повторить расчёт',
    'kk': 'Қайта есептеу',
    'en': 'Recalculate',
  },
  'checkout_forte_unavailable': {
    'ru': 'Оплата картой ForteBank временно недоступна.',
    'kk': 'ForteBank картасымен төлем уақытша қолжетімсіз.',
    'en': 'ForteBank card payment is temporarily unavailable.',
  },
  'checkout_online_ordering_disabled_title': {
    'ru': 'Онлайн-заказы временно отключены',
    'kk': 'Онлайн тапсырыстар уақытша өшірулі',
    'en': 'Online ordering is temporarily disabled',
  },
  'checkout_online_ordering_disabled': {
    'ru':
        'Каталог и корзина доступны, но оформить и оплатить заказ сейчас нельзя.',
    'kk':
        'Каталог пен себет қолжетімді, бірақ қазір тапсырысты рәсімдеу және төлеу мүмкін емес.',
    'en':
        'The catalog and cart remain available, but checkout and payment are currently disabled.',
  },
  'checkout_online_ordering_disabled_button': {
    'ru': 'Онлайн-заказы отключены',
    'kk': 'Онлайн тапсырыстар өшірулі',
    'en': 'Online ordering disabled',
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
    'ru': 'Заказ сохранён и появился в разделе «Мои покупки».',
    'kk': 'Тапсырыс сақталды және «Менің сатып алуларым» бөлімінде көрінеді.',
    'en': 'Your order was saved and is now visible in My purchases.',
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
  'forte_payment_session_closed': {
    'ru':
        'Предыдущая оплата завершена без списания или возвращена. Нажмите «Оформить заказ», чтобы начать новую оплату.',
    'kk':
        'Алдыңғы төлем есептен шығарылмай аяқталды немесе қайтарылды. Жаңа төлем үшін «Тапсырысты рәсімдеу» түймесін басыңыз.',
    'en':
        'The previous payment ended without a charge or was refunded. Place the order again to start a new payment.',
  },
  'forte_payment_pending_hint': {
    'ru':
        'Не начинайте новую оплату. Сначала проверьте эту операцию или откройте «Мои покупки».',
    'kk':
        'Жаңа төлемді бастамаңыз. Алдымен осы операцияны тексеріңіз немесе «Менің сатып алуларым» бөлімін ашыңыз.',
    'en':
        'Do not start another payment. Check this operation first or open My purchases.',
  },
  'forte_payment_check_status': {
    'ru': 'Проверить статус',
    'kk': 'Күйін тексеру',
    'en': 'Check status',
  },
  'forte_payment_my_orders': {
    'ru': 'Мои покупки',
    'kk': 'Менің сатып алуларым',
    'en': 'My purchases',
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
  'orders_title': {
    'ru': 'Мои покупки',
    'kk': 'Менің сатып алуларым',
    'en': 'My purchases',
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
  'payment_refunded_hint': {
    'ru': 'Оплата возвращена. Вы можете оформить новый заказ.',
    'kk': 'Төлем қайтарылды. Жаңа тапсырыс рәсімдеуге болады.',
    'en': 'Payment was refunded. You can place a new order.',
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
  'orders_original_payment_refund_notice': {
    'ru': 'Возврат выполнен через исходный способ оплаты.',
    'kk': 'Қайтарым бастапқы төлем тәсілі арқылы орындалды.',
    'en': 'The refund was completed through the original payment method.',
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
    'ru': 'Ожидает курьера',
    'kk': 'Курьер күтуде',
    'en': 'Awaiting a courier',
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
