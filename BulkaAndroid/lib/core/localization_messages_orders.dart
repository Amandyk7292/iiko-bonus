part of '../main.dart';

const Map<String, Map<String, String>> _orderAndPaymentTranslations = {
  // Orders, stories and QR
  'orders_empty_action': {
    'ru': 'Перейти на главную',
    'kk': 'Басты бетке өту',
    'en': 'Go to home',
  },
  'order_details': {
    'ru': 'Детали заказа',
    'kk': 'Тапсырыс мәліметтері',
    'en': 'Order details',
  },
  'product_fallback': {'ru': 'Товар', 'kk': 'Өнім', 'en': 'Item'},
  'tx_manual_withdrawal': {
    'ru': 'Ручное списание',
    'kk': 'Қолмен есептен шығару',
    'en': 'Manual deduction',
  },
  'tx_expiration': {
    'ru': 'Сгорание бонусов',
    'kk': 'Бонустардың мерзімі өтті',
    'en': 'Points expired',
  },
  'tx_refund_reversal': {
    'ru': 'Сторнирование после возврата',
    'kk': 'Қайтарымнан кейінгі түзету',
    'en': 'Reversed after refund',
  },
  'tx_cancelled_deposit': {
    'ru': 'Начисление отменено',
    'kk': 'Есептеу тоқтатылды',
    'en': 'Credit cancelled',
  },
  'tx_earning': {
    'ru': 'Начисление бонусов',
    'kk': 'Бонустар есептелді',
    'en': 'Points earned',
  },
  'tx_withdrawal': {
    'ru': 'Списание бонусов',
    'kk': 'Бонустар есептен шығарылды',
    'en': 'Points deducted',
  },
  'fresh_news_fallback': {
    'ru': 'Свежая новость',
    'kk': 'Жаңа жаңалық',
    'en': 'Latest news',
  },
  'story_offer_fallback': {
    'ru': 'Специальное предложение Bulka',
    'kk': 'Bulka арнайы ұсынысы',
    'en': 'A special offer from Bulka',
  },
  'story_gift': {'ru': 'Подарок', 'kk': 'Сыйлық', 'en': 'Gift'},
  'story_loading': {
    'ru': 'Загружаем историю',
    'kk': 'Стори жүктелуде',
    'en': 'Loading story',
  },
  'story_open': {
    'ru': 'Открыть историю: {title}',
    'kk': 'Сториді ашу: {title}',
    'en': 'Open story: {title}',
  },
  'story_previous': {
    'ru': 'Предыдущая история',
    'kk': 'Алдыңғы оқиға',
    'en': 'Previous story',
  },
  'story_next': {
    'ru': 'Следующая история',
    'kk': 'Келесі оқиға',
    'en': 'Next story',
  },
  'guest_profile_title': {'ru': 'Профиль', 'kk': 'Профиль', 'en': 'Profile'},
  'guest_profile_heading': {
    'ru': 'Войдите в Bulka',
    'kk': 'Bulka-ға кіріңіз',
    'en': 'Sign in to Bulka',
  },
  'guest_profile_body': {
    'ru':
        'Копите бонусы, сохраняйте адреса и следите за заказами. Каталог и корзина доступны без входа.',
    'kk':
        'Бонустар жинаңыз, мекенжайларды сақтаңыз және тапсырыстарды қадағалаңыз. Каталог пен себетке кірусіз қол жеткізуге болады.',
    'en':
        'Earn points, save addresses, and track orders. The catalog and cart are available without signing in.',
  },
  'guest_sign_in': {
    'ru': 'Войти по номеру телефона',
    'kk': 'Телефон нөмірімен кіру',
    'en': 'Sign in with phone',
  },
  'guest_loyalty_heading': {
    'ru': 'Бонусы и Wallet',
    'kk': 'Бонустар және Wallet',
    'en': 'Points and Wallet',
  },
  'guest_loyalty_body': {
    'ru':
        'Войдите только когда захотите открыть QR, добавить карту в Wallet или оформить заказ.',
    'kk':
        'QR ашу, Wallet-қа карта қосу немесе тапсырыс рәсімдеу қажет болғанда ғана кіріңіз.',
    'en':
        'Sign in only when you want to open your QR, add the card to Wallet, or place an order.',
  },
  'orders_i_arrived': {
    'ru': 'Я приехал',
    'kk': 'Мен келдім',
    'en': 'I have arrived',
  },
  'orders_i_arrived_hint': {
    'ru': 'Сообщить пекарне, что вы ожидаете выдачу заказа',
    'kk': 'Наубайханаға тапсырысты күтіп тұрғаныңызды хабарлау',
    'en': 'Tell the bakery that you are waiting to collect the order',
  },
  'orders_arrival_confirm_title': {
    'ru': 'Вы уже у пекарни?',
    'kk': 'Сіз наубайханаға келдіңіз бе?',
    'en': 'Are you at the bakery?',
  },
  'orders_arrival_confirm_body': {
    'ru': 'Мы сообщим сотрудникам, что вы приехали за заказом №{number}.',
    'kk': 'Қызметкерлерге №{number} тапсырысын алуға келгеніңізді хабарлаймыз.',
    'en':
        'We will tell the team that you have arrived to collect order #{number}.',
  },
  'orders_arrival_send': {
    'ru': 'Сообщить',
    'kk': 'Хабарлау',
    'en': 'Notify team',
  },
  'orders_arrival_sent': {
    'ru': 'Сотрудники уже знают, что вы приехали',
    'kk': 'Қызметкерлер сіздің келгеніңізді біледі',
    'en': 'The team knows you have arrived',
  },
  'orders_arrival_error': {
    'ru':
        'Не удалось сообщить о прибытии. Обновите заказ и попробуйте ещё раз.',
    'kk':
        'Келгеніңізді хабарлау мүмкін болмады. Тапсырысты жаңартып, қайталап көріңіз.',
    'en': 'Could not report your arrival. Refresh the order and try again.',
  },
  'order_cancel_action': {
    'ru': 'Отменить заказ',
    'kk': 'Тапсырыстан бас тарту',
    'en': 'Cancel order',
  },
  'order_cancel_title': {
    'ru': 'Отменить заказ?',
    'kk': 'Тапсырыстан бас тартасыз ба?',
    'en': 'Cancel this order?',
  },
  'order_cancel_body': {
    'ru':
        'Заказ ещё не принят в работу. Мы отменим его, освободим товары и автоматически отправим возврат исходным способом оплаты. Срок зачисления зависит от банка.',
    'kk':
        'Тапсырыс әлі жұмысқа қабылданбады. Біз оны тоқтатып, тауар қорын босатамыз және ақшаны бастапқы төлем тәсілімен автоматты түрде қайтарамыз. Түсу мерзімі банкке байланысты.',
    'en':
        'The order has not been accepted yet. We will cancel it, release the items, and automatically refund the original payment method. Posting time depends on the bank.',
  },
  'order_cancel_confirm': {
    'ru': 'Отменить и вернуть деньги',
    'kk': 'Тоқтатып, ақшаны қайтару',
    'en': 'Cancel and refund',
  },
  'order_cancel_success': {
    'ru': 'Заказ отменён. Возврат отправлен исходным способом оплаты.',
    'kk': 'Тапсырыс тоқтатылды. Қайтарым бастапқы төлем тәсілімен жіберілді.',
    'en':
        'Order cancelled. The refund was sent to the original payment method.',
  },
  'order_cancel_error': {
    'ru': 'Не удалось отменить заказ. Обновите его и попробуйте ещё раз.',
    'kk': 'Тапсырысты тоқтату мүмкін болмады. Оны жаңартып, қайталап көріңіз.',
    'en': 'Could not cancel the order. Refresh it and try again.',
  },
  'substitution_approval_title': {
    'ru': 'Подтвердите замену',
    'kk': 'Ауыстыруды растаңыз',
    'en': 'Approve replacement',
  },
  'substitution_offer_body': {
    'ru': 'Предлагаем заменить «{from}» на «{to}». Цена заказа не изменится.',
    'kk':
        '«{from}» тауарын «{to}» тауарына ауыстыруды ұсынамыз. Тапсырыс бағасы өзгермейді.',
    'en':
        'We suggest replacing “{from}” with “{to}”. The order price will not change.',
  },
  'substitution_item_body': {
    'ru': 'Обрабатываем «{item}», количество: {quantity}.',
    'kk': '«{item}» өңделуде, саны: {quantity}.',
    'en': 'Processing “{item}”, quantity: {quantity}.',
  },
  'substitution_approve': {
    'ru': 'Согласен',
    'kk': 'Келісемін',
    'en': 'Approve',
  },
  'substitution_reject': {
    'ru': 'Не заменять',
    'kk': 'Ауыстырмау',
    'en': 'Do not replace',
  },
  'substitution_reject_title': {
    'ru': 'Отказаться от замены?',
    'kk': 'Ауыстырудан бас тартасыз ба?',
    'en': 'Reject replacement?',
  },
  'substitution_reject_body': {
    'ru': 'Сотрудник увидит отказ и свяжется с вами для другого решения.',
    'kk': 'Қызметкер бас тартуды көріп, басқа шешім үшін сізбен хабарласады.',
    'en':
        'The team will see your response and contact you about another option.',
  },
  'substitution_approved_title': {
    'ru': 'Замена согласована',
    'kk': 'Ауыстыру келісілді',
    'en': 'Replacement approved',
  },
  'substitution_rejected_title': {
    'ru': 'Вы отказались от замены',
    'kk': 'Сіз ауыстырудан бас тарттыңыз',
    'en': 'Replacement rejected',
  },
  'substitution_processing_title': {
    'ru': 'Решаем вопрос с товаром',
    'kk': 'Тауар мәселесін шешудеміз',
    'en': 'Resolving item issue',
  },
  'substitution_approved_message': {
    'ru': 'Спасибо, замена подтверждена.',
    'kk': 'Рақмет, ауыстыру расталды.',
    'en': 'Thank you. Replacement approved.',
  },
  'substitution_rejected_message': {
    'ru': 'Отказ отправлен сотруднику.',
    'kk': 'Бас тарту қызметкерге жіберілді.',
    'en': 'Your response was sent to the team.',
  },
  'substitution_response_error': {
    'ru': 'Не удалось отправить ответ. Обновите заказ и попробуйте снова.',
    'kk': 'Жауапты жіберу мүмкін болмады. Тапсырысты жаңартып, қайталаңыз.',
    'en': 'Could not send your response. Refresh the order and try again.',
  },
  'refund_stage_processing': {
    'ru': 'Оформляем возврат',
    'kk': 'Қайтарымды рәсімдеп жатырмыз',
    'en': 'Preparing refund',
  },
  'refund_stage_processing_hint': {
    'ru': 'Запрос передан платёжной системе.',
    'kk': 'Сұрау төлем жүйесіне жіберілді.',
    'en': 'The request has been sent to the payment provider.',
  },
  'refund_stage_checking': {
    'ru': 'Проверяем с банком',
    'kk': 'Банкпен тексеріп жатырмыз',
    'en': 'Checking with the bank',
  },
  'refund_stage_checking_hint': {
    'ru':
        'Ответ банка задерживается. Повторно деньги не списываем и проверяем операцию.',
    'kk':
        'Банктің жауабы кешігуде. Ақша қайта алынбайды, операцияны тексеріп жатырмыз.',
    'en':
        'The bank response is delayed. We are checking the operation without charging again.',
  },
  'refund_stage_sent': {
    'ru': 'Отправлен на карту',
    'kk': 'Картаға жіберілді',
    'en': 'Sent to the card',
  },
  'refund_stage_attention': {
    'ru': 'Нужна проверка возврата',
    'kk': 'Қайтарымды тексеру қажет',
    'en': 'Refund needs review',
  },
  'refund_stage_attention_hint': {
    'ru':
        'Мы не получили подтверждение возврата. Напишите в поддержку — заказ и номер операции уже сохранены.',
    'kk':
        'Қайтарым расталмады. Қолдауға жазыңыз — тапсырыс пен операция нөмірі сақталған.',
    'en':
        'We did not receive refund confirmation. Contact support; the order and operation number are saved.',
  },
  'order_details_title': {
    'ru': 'Заказ №{number}',
    'kk': '№{number} тапсырыс',
    'en': 'Order #{number}',
  },
  'pickup_handoff_title': {
    'ru': 'Код выдачи заказа',
    'kk': 'Тапсырысты беру коды',
    'en': 'Pickup handoff code',
  },
  'pickup_handoff_hint': {
    'ru': 'Покажите QR-код сотруднику или назовите код',
    'kk': 'Қызметкерге QR-кодты көрсетіңіз немесе кодты айтыңыз',
    'en': 'Show the QR code to staff or tell them the code',
  },
  'pickup_handoff_pin': {
    'ru': 'Код: {pin}',
    'kk': 'Код: {pin}',
    'en': 'Code: {pin}',
  },
  'pickup_handoff_expires': {
    'ru': 'Действует до {time}',
    'kk': '{time} дейін жарамды',
    'en': 'Valid until {time}',
  },
  'pickup_handoff_used': {
    'ru': 'Заказ уже выдан',
    'kk': 'Тапсырыс берілді',
    'en': 'Order already handed over',
  },
  'pickup_handoff_expired': {
    'ru': 'Код устарел. Обновите заказ',
    'kk': 'Кодтың мерзімі аяқталды. Тапсырысты жаңартыңыз',
    'en': 'The code expired. Refresh the order',
  },
  'pickup_handoff_load_error': {
    'ru': 'Не удалось загрузить код выдачи',
    'kk': 'Беру кодын жүктеу мүмкін болмады',
    'en': 'Could not load the handoff code',
  },
  'order_open_details': {
    'ru': 'Следить за заказом',
    'kk': 'Тапсырысты бақылау',
    'en': 'Track order',
  },
  'order_current_status': {
    'ru': 'Текущий статус',
    'kk': 'Ағымдағы күй',
    'en': 'Current status',
  },
  'order_eta_calculating': {
    'ru': 'Рассчитываем точное время',
    'kk': 'Нақты уақытты есептеп жатырмыз',
    'en': 'Calculating an exact time',
  },
  'order_eta_minutes': {
    'ru': 'Примерно {minutes} мин',
    'kk': 'Шамамен {minutes} мин',
    'en': 'About {minutes} min',
  },
  'order_eta_range_minutes': {
    'ru': 'Примерно {min}–{max} мин',
    'kk': 'Шамамен {min}–{max} мин',
    'en': 'About {min}–{max} min',
  },
  'order_eta_window': {
    'ru': 'Ожидаем с {min} до {max}',
    'kk': '{min}–{max} аралығында күтеміз',
    'en': 'Expected between {min} and {max}',
  },
  'checkout_eta_window': {
    'ru': 'Ожидаем {date}, {min}–{max}',
    'kk': '{date}, {min}–{max} аралығында күтеміз',
    'en': 'Expected {date}, {min}–{max}',
  },
  'order_eta_confidence_high': {
    'ru': 'Высокая точность прогноза',
    'kk': 'Болжам дәлдігі жоғары',
    'en': 'High forecast confidence',
  },
  'order_eta_confidence_medium': {
    'ru': 'Средняя точность прогноза',
    'kk': 'Болжам дәлдігі орташа',
    'en': 'Medium forecast confidence',
  },
  'order_eta_confidence_low': {
    'ru': 'Время ещё уточняется',
    'kk': 'Уақыт әлі нақтылануда',
    'en': 'Timing is still being refined',
  },
  'order_eta_hours_minutes': {
    'ru': 'Примерно {hours} ч {minutes} мин',
    'kk': 'Шамамен {hours} сағ {minutes} мин',
    'en': 'About {hours} h {minutes} min',
  },
  'order_eta_ready': {
    'ru': 'Заказ уже готов',
    'kk': 'Тапсырыс дайын',
    'en': 'Your order is ready',
  },
  'order_eta_clarifying': {
    'ru': 'Уточняем время у команды',
    'kk': 'Уақытты командадан нақтылап жатырмыз',
    'en': 'Confirming the time with the team',
  },
  'order_timeline_title': {
    'ru': 'Путь заказа',
    'kk': 'Тапсырыс жолы',
    'en': 'Order timeline',
  },
  'order_timeline_new': {
    'ru': 'Заказ получен',
    'kk': 'Тапсырыс алынды',
    'en': 'Order received',
  },
  'order_timeline_accepted': {
    'ru': 'Заказ подтверждён',
    'kk': 'Тапсырыс расталды',
    'en': 'Order confirmed',
  },
  'order_timeline_preparing': {
    'ru': 'Готовим заказ',
    'kk': 'Тапсырыс дайындалып жатыр',
    'en': 'Preparing your order',
  },
  'order_timeline_ready': {
    'ru': 'Готов к выдаче',
    'kk': 'Беруге дайын',
    'en': 'Ready for pickup',
  },
  'order_timeline_en_route': {
    'ru': 'Курьер в пути',
    'kk': 'Курьер жолда',
    'en': 'Courier is on the way',
  },
  'order_timeline_completed': {
    'ru': 'Заказ завершён',
    'kk': 'Тапсырыс аяқталды',
    'en': 'Order completed',
  },
  'order_timeline_current': {'ru': 'Сейчас', 'kk': 'Қазір', 'en': 'Current'},
  'order_timeline_done': {
    'ru': 'Выполнено',
    'kk': 'Орындалды',
    'en': 'Completed',
  },
  'order_timeline_waiting': {
    'ru': 'Ожидается',
    'kk': 'Күтілуде',
    'en': 'Waiting',
  },
  'order_courier_live': {
    'ru': 'Курьер на карте',
    'kk': 'Курьер картада',
    'en': 'Courier on the map',
  },
  'order_call_courier': {
    'ru': 'Позвонить',
    'kk': 'Қоңырау шалу',
    'en': 'Call courier',
  },
  'order_call_unavailable': {
    'ru': 'Не удалось открыть приложение для звонка',
    'kk': 'Қоңырау қолданбасын ашу мүмкін болмады',
    'en': 'Could not open the phone app',
  },
  'order_location_updated': {
    'ru': 'Геопозиция обновлена: {time}',
    'kk': 'Геопозиция жаңартылды: {time}',
    'en': 'Location updated: {time}',
  },
  'order_items_title': {
    'ru': 'Состав заказа',
    'kk': 'Тапсырыс құрамы',
    'en': 'Order items',
  },
  'order_support': {
    'ru': 'Помощь по заказу',
    'kk': 'Тапсырыс бойынша көмек',
    'en': 'Get help with this order',
  },
  'order_receipt': {
    'ru': 'Открыть торговый чек',
    'kk': 'Сауда чегін ашу',
    'en': 'Open merchant receipt',
  },
  'order_receipt_open_error': {
    'ru': 'Не удалось открыть торговый чек',
    'kk': 'Сауда чегін ашу мүмкін болмады',
    'en': 'Could not open the merchant receipt',
  },
  'order_repeat': {'ru': 'Повторить', 'kk': 'Қайталау', 'en': 'Reorder'},
  'order_repeat_cart_title': {
    'ru': 'В корзине уже есть товары',
    'kk': 'Себетте тауарлар бар',
    'en': 'Your cart already has items',
  },
  'order_repeat_cart_message': {
    'ru': 'Заменить корзину прошлым заказом или добавить товары к текущим?',
    'kk':
        'Себетті алдыңғы тапсырыспен ауыстыру немесе тауарларды қазіргілерге қосу керек пе?',
    'en':
        'Replace the cart with the previous order or add its items to the current cart?',
  },
  'order_repeat_replace': {'ru': 'Заменить', 'kk': 'Ауыстыру', 'en': 'Replace'},
  'order_repeat_merge': {'ru': 'Объединить', 'kk': 'Біріктіру', 'en': 'Merge'},
  'order_repeat_empty': {
    'ru': 'В этом заказе нет доступных для повтора товаров.',
    'kk': 'Бұл тапсырыста қайталауға болатын тауарлар жоқ.',
    'en': 'This order has no items available to reorder.',
  },
  'order_review': {'ru': 'Оценить', 'kk': 'Бағалау', 'en': 'Review'},
  'orders_refresh': {
    'ru': 'Обновить заказ',
    'kk': 'Тапсырысты жаңарту',
    'en': 'Refresh order',
  },
  'support_title': {'ru': 'Поддержка', 'kk': 'Қолдау', 'en': 'Support'},
  'support_new_request': {
    'ru': 'Новое обращение',
    'kk': 'Жаңа өтініш',
    'en': 'New request',
  },
  'support_category': {'ru': 'Тема', 'kk': 'Тақырып', 'en': 'Topic'},
  'support_category_order_issue': {
    'ru': 'Проблема с заказом',
    'kk': 'Тапсырыс мәселесі',
    'en': 'Order issue',
  },
  'support_category_product_quality': {
    'ru': 'Качество продукта',
    'kk': 'Өнім сапасы',
    'en': 'Product quality',
  },
  'support_category_delivery': {
    'ru': 'Доставка',
    'kk': 'Жеткізу',
    'en': 'Delivery',
  },
  'support_category_refund': {
    'ru': 'Запрос возврата',
    'kk': 'Қайтару сұрауы',
    'en': 'Refund request',
  },
  'support_category_other': {'ru': 'Другое', 'kk': 'Басқа', 'en': 'Other'},
  'support_message_label': {
    'ru': 'Опишите ситуацию',
    'kk': 'Жағдайды сипаттаңыз',
    'en': 'Describe what happened',
  },
  'support_message_hint': {
    'ru': 'Что произошло и какой результат вы ожидаете?',
    'kk': 'Не болды және қандай нәтиже күтесіз?',
    'en': 'What happened and what outcome do you expect?',
  },
  'support_message_required': {
    'ru': 'Добавьте описание длиной не менее 5 символов',
    'kk': 'Кемінде 5 таңбадан тұратын сипаттама қосыңыз',
    'en': 'Add a description of at least 5 characters',
  },
  'support_refund_request': {
    'ru': 'Нужен возврат средств',
    'kk': 'Қаражатты қайтару қажет',
    'en': 'I need a refund',
  },
  'support_refund_disclaimer': {
    'ru':
        'Команда проверит заказ. Отправка обращения не выполняет возврат автоматически.',
    'kk':
        'Команда тапсырысты тексереді. Өтініш жіберу ақшаны автоматты түрде қайтармайды.',
    'en':
        'The team will review the order. Submitting does not issue an automatic refund.',
  },
  'support_add_photo': {
    'ru': 'Добавить фото ({count}/3)',
    'kk': 'Фото қосу ({count}/3)',
    'en': 'Add photo ({count}/3)',
  },
  'support_send': {
    'ru': 'Отправить обращение',
    'kk': 'Өтінішті жіберу',
    'en': 'Send request',
  },
  'support_sending': {
    'ru': 'Отправляем…',
    'kk': 'Жіберілуде…',
    'en': 'Sending…',
  },
  'support_sent': {
    'ru': 'Обращение отправлено. Ответ появится здесь.',
    'kk': 'Өтініш жіберілді. Жауап осы жерде пайда болады.',
    'en': 'Request sent. The reply will appear here.',
  },
  'support_history': {
    'ru': 'Мои обращения',
    'kk': 'Менің өтініштерім',
    'en': 'My requests',
  },
  'support_history_empty': {
    'ru': 'Обращений пока нет',
    'kk': 'Әзірге өтініш жоқ',
    'en': 'No requests yet',
  },
  'support_status_new': {
    'ru': 'Получено',
    'kk': 'Қабылданды',
    'en': 'Received',
  },
  'support_status_in_review': {
    'ru': 'Проверяем',
    'kk': 'Тексерілуде',
    'en': 'In review',
  },
  'support_status_resolved': {
    'ru': 'Решено',
    'kk': 'Шешілді',
    'en': 'Resolved',
  },
  'support_status_rejected': {'ru': 'Закрыто', 'kk': 'Жабылды', 'en': 'Closed'},
  'support_photos_count': {
    'ru': 'Прикреплено фото: {count}',
    'kk': 'Тіркелген фото: {count}',
    'en': 'Attached photos: {count}',
  },
  'support_team_reply': {
    'ru': 'Ответ команды',
    'kk': 'Команда жауабы',
    'en': 'Team reply',
  },
  'support_open_conversation': {
    'ru': 'Открыть переписку',
    'kk': 'Хат алмасуды ашу',
    'en': 'Open conversation',
  },
  'support_conversation': {
    'ru': 'Переписка с поддержкой',
    'kk': 'Қолдаумен хат алмасу',
    'en': 'Support conversation',
  },
  'support_reply_hint': {
    'ru': 'Напишите ответ',
    'kk': 'Жауап жазыңыз',
    'en': 'Write a reply',
  },
  'support_reply_required': {
    'ru': 'Введите сообщение',
    'kk': 'Хабарлама енгізіңіз',
    'en': 'Enter a message',
  },
  'support_message_customer': {'ru': 'Вы', 'kk': 'Сіз', 'en': 'You'},
  'support_message_team': {
    'ru': 'Команда Bulka',
    'kk': 'Bulka командасы',
    'en': 'Bulka team',
  },
  'notifications_settings_title': {
    'ru': 'Настройки уведомлений',
    'kk': 'Хабарландыру параметрлері',
    'en': 'Notification settings',
  },
  'notifications_categories': {
    'ru': 'Что присылать',
    'kk': 'Не жіберу керек',
    'en': 'What to send',
  },
  'notifications_orders': {'ru': 'Заказы', 'kk': 'Тапсырыстар', 'en': 'Orders'},
  'notifications_orders_hint': {
    'ru': 'Статус, готовность и доставка',
    'kk': 'Күйі, дайындығы және жеткізу',
    'en': 'Status, readiness and delivery',
  },
  'notifications_bonus': {'ru': 'Бонусы', 'kk': 'Бонустар', 'en': 'Bonuses'},
  'notifications_bonus_hint': {
    'ru': 'Начисления, списания и срок действия',
    'kk': 'Есептеу, пайдалану және мерзімі',
    'en': 'Earnings, spending and expiry',
  },
  'notifications_promos': {
    'ru': 'Акции и новости',
    'kk': 'Акциялар мен жаңалықтар',
    'en': 'Promotions and news',
  },
  'notifications_promos_hint': {
    'ru': 'Персональные предложения Bulka',
    'kk': 'Bulka жеке ұсыныстары',
    'en': 'Personalized Bulka offers',
  },
  'notifications_support': {'ru': 'Поддержка', 'kk': 'Қолдау', 'en': 'Support'},
  'notifications_support_hint': {
    'ru': 'Ответы по вашим обращениям',
    'kk': 'Өтініштеріңізге жауаптар',
    'en': 'Replies to your support requests',
  },
  'notifications_quiet_hours': {
    'ru': 'Тихие часы',
    'kk': 'Тыныш уақыт',
    'en': 'Quiet hours',
  },
  'notifications_quiet_enable': {
    'ru': 'Не беспокоить ночью',
    'kk': 'Түнде мазаламау',
    'en': 'Do not disturb at night',
  },
  'notifications_quiet_hint': {
    'ru': 'Бонусы и акции не будут приходить в этот период',
    'kk': 'Бұл уақытта бонустар мен акциялар келмейді',
    'en': 'Bonus and promo alerts are muted during this period',
  },
  'notifications_quiet_start': {
    'ru': 'Начало',
    'kk': 'Басталуы',
    'en': 'Start',
  },
  'notifications_quiet_end': {'ru': 'Конец', 'kk': 'Аяқталуы', 'en': 'End'},
  'notifications_transactional_note': {
    'ru':
        'Критические статусы активного заказа и ответы поддержки не блокируются тихими часами.',
    'kk':
        'Белсенді тапсырыстың маңызды күйлері мен қолдау жауаптары тыныш уақытта да келеді.',
    'en':
        'Critical active-order updates and support replies are not blocked by quiet hours.',
  },
  'notifications_settings_saved': {
    'ru': 'Настройки сохранены',
    'kk': 'Параметрлер сақталды',
    'en': 'Settings saved',
  },
  'notifications_unsaved_title': {
    'ru': 'Не сохранять изменения?',
    'kk': 'Өзгерістер сақталмасын ба?',
    'en': 'Discard changes?',
  },
  'notifications_unsaved_body': {
    'ru': 'Новые настройки уведомлений будут потеряны.',
    'kk': 'Жаңа хабарландыру параметрлері жоғалады.',
    'en': 'Your new notification settings will be lost.',
  },
  'notifications_discard': {
    'ru': 'Не сохранять',
    'kk': 'Сақтамау',
    'en': 'Discard',
  },
  'catalog_for_you': {'ru': 'Для вас', 'kk': 'Сіз үшін', 'en': 'For you'},
  'catalog_recent': {
    'ru': 'Недавно смотрели',
    'kk': 'Жақында қаралған',
    'en': 'Recently viewed',
  },
  'catalog_favorites': {
    'ru': 'Избранное',
    'kk': 'Таңдаулылар',
    'en': 'Favorites',
  },
  'catalog_add_favorite': {
    'ru': 'Добавить в избранное',
    'kk': 'Таңдаулыларға қосу',
    'en': 'Add to favorites',
  },
  'catalog_remove_favorite': {
    'ru': 'Удалить из избранного',
    'kk': 'Таңдаулылардан өшіру',
    'en': 'Remove from favorites',
  },
  'catalog_prep_short': {
    'ru': '~{minutes} мин',
    'kk': '~{minutes} мин',
    'en': '~{minutes} min',
  },
  'catalog_prep_time': {
    'ru': 'Готовим около {minutes} мин',
    'kk': 'Шамамен {minutes} мин дайындалады',
    'en': 'About {minutes} min to prepare',
  },
  'catalog_offline_cache_now': {
    'ru': 'Офлайн-меню обновлено недавно',
    'kk': 'Офлайн мәзір жақында жаңартылды',
    'en': 'Offline menu updated recently',
  },
  'catalog_offline_cache_minutes': {
    'ru': 'Офлайн-меню, данные {minutes} мин назад',
    'kk': 'Офлайн мәзір, деректер {minutes} мин бұрынғы',
    'en': 'Offline menu, data from {minutes} min ago',
  },
  'catalog_offline_cache_hours': {
    'ru': 'Офлайн-меню, данные {hours} ч назад',
    'kk': 'Офлайн мәзір, деректер {hours} сағ бұрынғы',
    'en': 'Offline menu, data from {hours} h ago',
  },
  'orders_offline_cache': {
    'ru': 'Нет соединения. Показана последняя сохранённая версия заказов.',
    'kk': 'Байланыс жоқ. Тапсырыстардың соңғы сақталған нұсқасы көрсетілді.',
    'en': 'You are offline. Showing the latest saved order data.',
  },
  'qr_retry': {
    'ru': 'Повторить загрузку QR',
    'kk': 'QR жүктеуді қайталау',
    'en': 'Retry QR loading',
  },
  'catalog_upload_login_required': {
    'ru': 'Войдите в профиль для загрузки примера',
    'kk': 'Үлгіні жүктеу үшін профильге кіріңіз',
    'en': 'Sign in to upload a reference image',
  },
  'catalog_select_option': {
    'ru': 'Выберите: {option}',
    'kk': 'Таңдаңыз: {option}',
    'en': 'Select: {option}',
  },
  'catalog_builder_filling': {
    'ru': 'Начинка',
    'kk': 'Салмасы',
    'en': 'Filling',
  },
  'catalog_builder_design': {
    'ru': 'Оформление',
    'kk': 'Безендіру',
    'en': 'Design',
  },
  'catalog_inscription': {
    'ru': 'Надпись на изделии',
    'kk': 'Өнімге жазу',
    'en': 'Inscription on the product',
  },
  'catalog_inscription_hint': {
    'ru': 'Например: С днём рождения!',
    'kk': 'Мысалы: Туған күніңмен!',
    'en': 'For example: Happy birthday!',
  },
  'catalog_candles': {'ru': 'Свечи', 'kk': 'Шамдар', 'en': 'Candles'},
  'catalog_uploading': {
    'ru': 'Загрузка…',
    'kk': 'Жүктелуде…',
    'en': 'Uploading…',
  },
  'catalog_upload_reference': {
    'ru': 'Загрузить пример оформления',
    'kk': 'Безендіру үлгісін жүктеу',
    'en': 'Upload a design reference',
  },
  'catalog_reference_uploaded': {
    'ru': 'Пример загружен',
    'kk': 'Үлгі жүктелді',
    'en': 'Reference uploaded',
  },
  'catalog_other_category': {'ru': 'Другое', 'kk': 'Басқа', 'en': 'Other'},
  'catalog_option_size': {'ru': 'Размер', 'kk': 'Өлшем', 'en': 'Size'},
  'catalog_option_addons': {'ru': 'Добавки', 'kk': 'Қоспалар', 'en': 'Add-ons'},
  'catalog_option_packaging': {
    'ru': 'Упаковка',
    'kk': 'Қаптама',
    'en': 'Packaging',
  },
  'catalog_option_small': {'ru': 'Маленький', 'kk': 'Кішкентай', 'en': 'Small'},
  'catalog_option_medium': {'ru': 'Средний', 'kk': 'Орташа', 'en': 'Medium'},
  'catalog_option_large': {'ru': 'Большой', 'kk': 'Үлкен', 'en': 'Large'},
  'catalog_option_standard': {
    'ru': 'Стандартный',
    'kk': 'Стандартты',
    'en': 'Standard',
  },
  'catalog_option_no_addons': {
    'ru': 'Без добавок',
    'kk': 'Қоспасыз',
    'en': 'No add-ons',
  },
  'catalog_option_vanilla': {
    'ru': 'Ванильная',
    'kk': 'Ванильді',
    'en': 'Vanilla',
  },
  'catalog_option_chocolate': {
    'ru': 'Шоколадная',
    'kk': 'Шоколадты',
    'en': 'Chocolate',
  },
  'catalog_option_red_velvet': {
    'ru': 'Красный бархат',
    'kk': 'Қызыл барқыт',
    'en': 'Red velvet',
  },
  'catalog_option_photo_print': {
    'ru': 'Фотопечать',
    'kk': 'Фотобаспа',
    'en': 'Photo print',
  },
  'catalog_option_berries': {'ru': 'Ягоды', 'kk': 'Жидектер', 'en': 'Berries'},
  'allergen_gluten': {'ru': 'Глютен', 'kk': 'Глютен', 'en': 'Gluten'},
  'allergen_milk': {'ru': 'Молоко', 'kk': 'Сүт', 'en': 'Milk'},
  'allergen_egg': {'ru': 'Яйца', 'kk': 'Жұмыртқа', 'en': 'Eggs'},
  'allergen_nuts': {'ru': 'Орехи', 'kk': 'Жаңғақтар', 'en': 'Tree nuts'},
  'allergen_peanut': {'ru': 'Арахис', 'kk': 'Жержаңғақ', 'en': 'Peanuts'},
  'allergen_sesame': {'ru': 'Кунжут', 'kk': 'Күнжіт', 'en': 'Sesame'},
  'allergen_soy': {'ru': 'Соя', 'kk': 'Соя', 'en': 'Soy'},
  'product_mark_halal': {'ru': 'Halal', 'kk': 'Halal', 'en': 'Halal'},
  'product_mark_eac': {'ru': 'EAC', 'kk': 'EAC', 'en': 'EAC'},
  'product_mark_iso': {'ru': 'ISO', 'kk': 'ISO', 'en': 'ISO'},
  'product_mark_traces_nuts_sesame': {
    'ru': 'Возможны следы орехов и кунжута',
    'kk': 'Жаңғақ пен күнжіт іздері болуы мүмкін',
    'en': 'May contain traces of nuts and sesame',
  },
  'product_mark_not_for_under_3': {
    'ru': 'Не рекомендуется детям до 3 лет',
    'kk': '3 жасқа дейінгі балаларға ұсынылмайды',
    'en': 'Not recommended for children under 3',
  },
  'product_mark_vegetarian': {
    'ru': 'Вегетарианское',
    'kk': 'Вегетариандық',
    'en': 'Vegetarian',
  },
  'product_mark_vegan': {'ru': 'Веганское', 'kk': 'Вегандық', 'en': 'Vegan'},
  'product_mark_sugar_free': {
    'ru': 'Без сахара',
    'kk': 'Қантсыз',
    'en': 'Sugar free',
  },
  'product_mark_lactose_free': {
    'ru': 'Без лактозы',
    'kk': 'Лактозасыз',
    'en': 'Lactose free',
  },
  'order_added_to_cart': {
    'ru': 'Заказ добавлен в корзину',
    'kk': 'Тапсырыс себетке қосылды',
    'en': 'Order added to cart',
  },
  'review_order_number': {
    'ru': 'Заказ №{number}',
    'kk': '№{number} тапсырыс',
    'en': 'Order #{number}',
  },
  'review_how_was_it': {
    'ru': 'Как всё прошло?',
    'kk': 'Бәрі қалай өтті?',
    'en': 'How did it go?',
  },
  'review_rating_value': {
    'ru': '{value} из 5',
    'kk': '5-тен {value}',
    'en': '{value} out of 5',
  },
  'review_product_optional': {
    'ru': 'Жалоба на товар (необязательно)',
    'kk': 'Өнімге шағым (міндетті емес)',
    'en': 'Product complaint (optional)',
  },
  'review_no_complaint': {
    'ru': 'Нет жалобы',
    'kk': 'Шағым жоқ',
    'en': 'No complaint',
  },
  'review_comment': {'ru': 'Комментарий', 'kk': 'Пікір', 'en': 'Comment'},
  'review_later': {'ru': 'Позже', 'kk': 'Кейін', 'en': 'Later'},
  'review_send': {'ru': 'Отправить', 'kk': 'Жіберу', 'en': 'Send'},
  'review_product_complaint': {
    'ru': 'Жалоба на товар',
    'kk': 'Өнімге шағым',
    'en': 'Product complaint',
  },
  'review_thanks': {
    'ru': 'Спасибо за отзыв',
    'kk': 'Пікіріңізге рақмет',
    'en': 'Thanks for your feedback',
  },
  'rewards_title': {
    'ru': 'Подарки и приглашения',
    'kk': 'Сыйлықтар мен шақырулар',
    'en': 'Gifts and referrals',
  },
  'rewards_invite_friend': {
    'ru': 'Пригласите друга',
    'kk': 'Досыңызды шақырыңыз',
    'en': 'Invite a friend',
  },
  'rewards_invite_description': {
    'ru':
        'Друг получит бонус после регистрации, а вы — после его первого оплаченного заказа.',
    'kk':
        'Досыңыз тіркелгеннен кейін бонус алады, ал сіз оның алғашқы төленген тапсырысынан кейін бонус аласыз.',
    'en':
        'Your friend gets a bonus after signing up, and you get one after their first paid order.',
  },
  'rewards_code_copied': {
    'ru': 'Код скопирован',
    'kk': 'Код көшірілді',
    'en': 'Code copied',
  },
  'rewards_copy': {'ru': 'Скопировать', 'kk': 'Көшіру', 'en': 'Copy'},
  'rewards_have_friend_code': {
    'ru': 'У меня есть код друга',
    'kk': 'Менде досымның коды бар',
    'en': 'I have a friend’s code',
  },
  'rewards_friend_code_description': {
    'ru': 'Применить можно до первого оплаченного заказа.',
    'kk': 'Алғашқы төленген тапсырысқа дейін қолдануға болады.',
    'en': 'You can apply it before your first paid order.',
  },
  'rewards_gift_certificate': {
    'ru': 'Подарочный сертификат',
    'kk': 'Сыйлық сертификаты',
    'en': 'Gift certificate',
  },
  'rewards_gift_description': {
    'ru': 'Введите код — номинал сразу появится на бонусном балансе.',
    'kk': 'Кодты енгізіңіз — номинал бірден бонус балансына түседі.',
    'en':
        'Enter the code and its value will be credited to your bonus balance.',
  },
  'gift_purchase_title': {
    'ru': 'Подарить сертификат',
    'kk': 'Сертификат сыйлау',
    'en': 'Send a gift certificate',
  },
  'gift_purchase_description': {
    'ru': 'Выберите сумму и отправьте подарок по номеру телефона.',
    'kk': 'Соманы таңдап, сыйлықты телефон нөміріне жіберіңіз.',
    'en': 'Choose an amount and send the gift to a phone number.',
  },
  'gift_purchase_action': {
    'ru': 'Выбрать подарок',
    'kk': 'Сыйлықты таңдау',
    'en': 'Choose a gift',
  },
  'gift_amount_label': {
    'ru': 'Сумма сертификата',
    'kk': 'Сертификат сомасы',
    'en': 'Certificate amount',
  },
  'gift_custom_amount': {
    'ru': 'Другая сумма',
    'kk': 'Басқа сома',
    'en': 'Other amount',
  },
  'gift_recipient_phone': {
    'ru': 'Телефон получателя',
    'kk': 'Алушының телефоны',
    'en': 'Recipient phone',
  },
  'gift_recipient_name': {
    'ru': 'Имя получателя (необязательно)',
    'kk': 'Алушының аты (міндетті емес)',
    'en': 'Recipient name (optional)',
  },
  'gift_message': {
    'ru': 'Пожелание (необязательно)',
    'kk': 'Тілек (міндетті емес)',
    'en': 'Message (optional)',
  },
  'gift_payment_method': {
    'ru': 'Способ оплаты',
    'kk': 'Төлем тәсілі',
    'en': 'Payment method',
  },
  'gift_pay_and_send': {
    'ru': 'Оплатить и отправить',
    'kk': 'Төлеу және жіберу',
    'en': 'Pay and send',
  },
  'gift_phone_error': {
    'ru': 'Введите корректный номер телефона',
    'kk': 'Дұрыс телефон нөмірін енгізіңіз',
    'en': 'Enter a valid phone number',
  },
  'gift_amount_error': {
    'ru': 'Минимальная сумма — 500 ₸',
    'kk': 'Ең төменгі сома — 500 ₸',
    'en': 'The minimum amount is 500 ₸',
  },
  'gift_purchase_error': {
    'ru': 'Не удалось оформить сертификат',
    'kk': 'Сертификатты рәсімдеу мүмкін болмады',
    'en': 'Could not create the certificate',
  },
  'gift_purchase_success': {
    'ru': 'Сертификат оплачен и будет отправлен получателю',
    'kk': 'Сертификат төленді және алушыға жіберіледі',
    'en': 'The certificate is paid and will be sent to the recipient',
  },
  'gift_purchase_success_registered': {
    'ru': 'Сертификат уже появился у получателя в приложении Bulka',
    'kk': 'Сертификат алушының Bulka қолданбасында пайда болды',
    'en': 'The certificate is now available in the recipient’s Bulka app',
  },
  'gift_purchase_success_share': {
    'ru': 'Получатель ещё не зарегистрирован. Отправьте ему код сертификата',
    'kk': 'Алушы әлі тіркелмеген. Оған сертификат кодын жіберіңіз',
    'en': 'The recipient is not registered yet. Send them the certificate code',
  },
  'gift_purchase_code_preparing': {
    'ru': 'Оплата подтверждена. Сертификат появится здесь после проверки банка',
    'kk': 'Төлем расталды. Банк тексергеннен кейін сертификат осында шығады',
    'en':
        'Payment is confirmed. The certificate will appear here after bank verification',
  },
  'gift_purchase_pending': {
    'ru': 'Оплата не завершена. Сертификат пока не отправлен',
    'kk': 'Төлем аяқталмады. Сертификат әлі жіберілген жоқ',
    'en': 'Payment is incomplete. The certificate has not been sent',
  },
  'gift_code_ready': {
    'ru': 'Сертификат готов',
    'kk': 'Сертификат дайын',
    'en': 'Certificate ready',
  },
  'gift_code_hint': {
    'ru': 'Получатель сможет активировать этот код в разделе подарков.',
    'kk': 'Алушы бұл кодты сыйлықтар бөлімінде белсендіре алады.',
    'en': 'The recipient can redeem this code in the gifts section.',
  },
  'gift_code_hint_registered': {
    'ru':
        'Сертификат уже доступен получателю в Bulka. Код можно отправить дополнительно.',
    'kk':
        'Сертификат алушыға Bulka-да қолжетімді. Кодты қосымша жіберуге болады.',
    'en':
        'The certificate is already available to the recipient in Bulka. You can also share the code.',
  },
  'gift_code_hint_unregistered': {
    'ru':
        'Получатель ещё не зарегистрирован в Bulka. Скопируйте код или отправьте его в WhatsApp.',
    'kk':
        'Алушы Bulka-да әлі тіркелмеген. Кодты көшіріңіз немесе WhatsApp арқылы жіберіңіз.',
    'en':
        'The recipient is not registered with Bulka yet. Copy the code or send it via WhatsApp.',
  },
  'gift_copy_code': {
    'ru': 'Скопировать код',
    'kk': 'Кодты көшіру',
    'en': 'Copy code',
  },
  'gift_send_whatsapp': {
    'ru': 'Отправить в WhatsApp',
    'kk': 'WhatsApp арқылы жіберу',
    'en': 'Send via WhatsApp',
  },
  'gift_code_copied': {
    'ru': 'Код сертификата скопирован',
    'kk': 'Сертификат коды көшірілді',
    'en': 'Certificate code copied',
  },
  'gift_share_message': {
    'ru': 'Вам подарочный сертификат Bulka на {amount} ₸. Код: {code}',
    'kk': 'Сізге {amount} ₸ сомасына Bulka сыйлық сертификаты. Код: {code}',
    'en': 'You have a Bulka gift certificate for {amount} ₸. Code: {code}',
  },
  'gift_pending_title': {
    'ru': 'Незавершённый подарок',
    'kk': 'Аяқталмаған сыйлық',
    'en': 'Unfinished gift',
  },
  'gift_pending_description': {
    'ru':
        'Сертификат на {amount} ₸ для {phone}. Продолжить без повторного списания.',
    'kk':
        '{phone} үшін {amount} ₸ сертификат. Қайта ақша ұстамай жалғастырыңыз.',
    'en':
        'A {amount} ₸ certificate for {phone}. Continue without creating a duplicate charge.',
  },
  'gift_pending_continue': {
    'ru': 'Продолжить оплату',
    'kk': 'Төлемді жалғастыру',
    'en': 'Continue payment',
  },
  'gift_received_title': {
    'ru': 'Полученные сертификаты',
    'kk': 'Алынған сертификаттар',
    'en': 'Received certificates',
  },
  'gift_received_description': {
    'ru': 'Подарки, отправленные на ваш номер телефона.',
    'kk': 'Телефон нөміріңізге жіберілген сыйлықтар.',
    'en': 'Gifts sent to your phone number.',
  },
  'gift_received_from': {
    'ru': 'Подарок от {name}',
    'kk': '{name} сыйлығы',
    'en': 'Gift from {name}',
  },
  'gift_received_from_bulka': {
    'ru': 'Подарок Bulka',
    'kk': 'Bulka сыйлығы',
    'en': 'Bulka gift',
  },
  'gift_received_redeem': {
    'ru': 'Зачислить на бонусный баланс',
    'kk': 'Бонустық балансқа аудару',
    'en': 'Add to bonus balance',
  },
  'gift_history_title': {
    'ru': 'Мои подарки',
    'kk': 'Менің сыйлықтарым',
    'en': 'My gifts',
  },
  'gift_history_description': {
    'ru': 'Статус купленных сертификатов и повторная отправка кода.',
    'kk': 'Сатып алынған сертификаттардың күйі және кодты қайта жіберу.',
    'en': 'Status of purchased certificates and code sharing.',
  },
  'gift_status_active': {'ru': 'Оплачен', 'kk': 'Төленді', 'en': 'Paid'},
  'gift_status_pending': {
    'ru': 'Ожидает оплаты',
    'kk': 'Төлем күтілуде',
    'en': 'Awaiting payment',
  },
  'gift_status_failed': {
    'ru': 'Оплата не прошла',
    'kk': 'Төлем өтпеді',
    'en': 'Payment failed',
  },
  'gift_status_expired': {
    'ru': 'Срок оплаты истёк',
    'kk': 'Төлем мерзімі аяқталды',
    'en': 'Payment expired',
  },
  'gift_status_refunded': {
    'ru': 'Деньги возвращены',
    'kk': 'Ақша қайтарылды',
    'en': 'Refunded',
  },
  'gift_share_again': {
    'ru': 'Отправить код ещё раз',
    'kk': 'Кодты қайта жіберу',
    'en': 'Share code again',
  },
  'rewards_referral_accepted': {
    'ru': 'Код принят. Бонусы начислятся после первого заказа.',
    'kk': 'Код қабылданды. Бонустар алғашқы тапсырыстан кейін есептеледі.',
    'en': 'Code accepted. Bonuses will be credited after the first order.',
  },
  'rewards_bonus_credited': {
    'ru': 'Начислено {amount} бонусов',
    'kk': '{amount} бонус есептелді',
    'en': '{amount} bonuses credited',
  },
  'birthdate_example': {
    'ru': 'Например: 09.10.2003',
    'kk': 'Мысалы: 09.10.2003',
    'en': 'Example: 09.10.2003',
  },
  'map_unavailable': {
    'ru': 'Карта временно недоступна',
    'kk': 'Карта уақытша қолжетімсіз',
    'en': 'Map is temporarily unavailable',
  },
  'map_delivery_zones_title': {
    'ru': 'Карта зон доставки Bulka',
    'kk': 'Bulka жеткізу аймақтарының картасы',
    'en': 'Bulka delivery zones map',
  },
  'checkout_success_title': {'ru': 'Успешно', 'kk': 'Сәтті', 'en': 'Success'},
  'checkout_success_message': {
    'ru': 'Ваш заказ успешно оформлен!',
    'kk': 'Тапсырысыңыз сәтті рәсімделді!',
    'en': 'Your order has been placed successfully!',
  },
  'checkout_operation_missing': {
    'ru': 'Платёжный сервис не вернул номер операции',
    'kk': 'Төлем сервисі операция нөмірін қайтармады',
    'en': 'The payment service did not return an operation number',
  },
  'error_kaspi_payment': {
    'ru': 'Не удалось создать оплату Kaspi',
    'kk': 'Kaspi төлемін жасау мүмкін болмады',
    'en': 'Could not create the Kaspi payment',
  },
  'error_kaspi_status': {
    'ru': 'Не удалось проверить статус оплаты',
    'kk': 'Төлем күйін тексеру мүмкін болмады',
    'en': 'Could not check the payment status',
  },
  'error_forte_payment': {
    'ru': 'Не удалось создать оплату ForteBank',
    'kk': 'ForteBank төлемін жасау мүмкін болмады',
    'en': 'Could not create the ForteBank payment',
  },
  'error_forte_status': {
    'ru': 'Не удалось проверить статус оплаты ForteBank',
    'kk': 'ForteBank төлем күйін тексеру мүмкін болмады',
    'en': 'Could not check the ForteBank payment status',
  },
};
