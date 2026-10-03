part of '../main.dart';

const Map<String, Map<String, String>> _deliveryResolutionTranslations = {
  'delivery_choice_title': {
    'ru': 'Курьер не найден',
    'kk': 'Курьер жоқ',
    'en': 'No courier found',
  },
  'delivery_choice_body': {
    'ru': 'Заказ №{number} сохранён. Выберите самовывоз или отмену.',
    'kk':
        '№{number} тапсырыс сақталды. Өзіңіз алып кетіңіз немесе бас тартыңыз.',
    'en': 'Order #{number} is saved. Choose pickup or cancel.',
  },
  'delivery_choice_pickup': {
    'ru': 'Выбрать самовывоз',
    'kk': 'Өзім алып кетемін',
    'en': 'Choose pickup',
  },
  'delivery_choice_cancel': {
    'ru': 'Отменить заказ',
    'kk': 'Бас тарту',
    'en': 'Cancel order',
  },
  'delivery_choice_cancel_body': {
    'ru':
        'Отменить заказ №{number}? Возврат будет оформлен по условиям оплаты.',
    'kk':
        '№{number} тапсырыстан бас тартасыз ба? Қаражат төлем шарттарына сай қайтарылады.',
    'en': 'Cancel order #{number}? The refund follows the payment terms.',
  },
  'delivery_choice_pickup_title': {
    'ru': 'Забрать заказ',
    'kk': 'Өзі алып кету',
    'en': 'Pickup',
  },
  'delivery_choice_time': {
    'ru': 'Время получения',
    'kk': 'Алып кету уақыты',
    'en': 'Pickup time',
  },
  'delivery_choice_time_zone': {
    'ru': 'По времени точки · UTC{offset}',
    'kk': 'Орынның уақытымен · UTC{offset}',
    'en': 'Location time · UTC{offset}',
  },
  'delivery_choice_submit': {
    'ru': 'Подтвердить самовывоз',
    'kk': 'Алып кетуді растау',
    'en': 'Confirm pickup',
  },
  'delivery_choice_approval': {
    'ru': 'Точка подтвердит замену доставки.',
    'kk': 'Орын жеткізудің ауыстырылуын растайды.',
    'en': 'The location will confirm the delivery change.',
  },
  'delivery_choice_pending': {
    'ru': 'Самовывоз ждёт подтверждения точки',
    'kk': 'Алып кету орынның растауын күтуде',
    'en': 'Pickup awaits location approval',
  },
  'delivery_choice_processing': {
    'ru': 'Обрабатываем изменение доставки',
    'kk': 'Жеткізуді ауыстыру өңделуде',
    'en': 'Processing the delivery change',
  },
  'delivery_choice_refunding': {
    'ru': 'Оформляем возврат оплаты',
    'kk': 'Төлемді қайтару рәсімделуде',
    'en': 'Processing your refund',
  },
  'delivery_choice_rejected_refunding': {
    'ru': 'Точка отклонила самовывоз. Оформляем возврат.',
    'kk': 'Орын алып кетуден бас тартты. Қаражат қайтарылуда.',
    'en': 'The location declined pickup. Processing your refund.',
  },
  'delivery_choice_rejected_reason': {
    'ru': 'Точка отклонила самовывоз взамен доставки.',
    'kk': 'Орын жеткізудің орнына алып кетуден бас тартты.',
    'en': 'The location declined pickup in place of delivery.',
  },
  'delivery_choice_cancelled_reason': {
    'ru': 'Вы отменили заказ, потому что курьер не найден.',
    'kk': 'Курьер табылмағандықтан тапсырыстан бас тарттыңыз.',
    'en': 'You cancelled the order because no courier was found.',
  },
  'delivery_choice_needed': {
    'ru': 'Выберите самовывоз или отмену',
    'kk': 'Алып кетуді не бас тартуды таңдаңыз',
    'en': 'Choose pickup or cancellation',
  },
  'delivery_choice_empty': {
    'ru': 'Доступного времени получения нет.',
    'kk': 'Алып кетуге қолжетімді уақыт жоқ.',
    'en': 'No pickup times are available.',
  },
  'delivery_choice_error': {
    'ru': 'Не удалось сохранить выбор. Попробуйте ещё раз.',
    'kk': 'Таңдауды сақтау мүмкін болмады. Қайта көріңіз.',
    'en': 'Could not save your choice. Please try again.',
  },
  'delivery_choice_load_error': {
    'ru': 'Не удалось загрузить время получения.',
    'kk': 'Алып кету уақытын жүктеу мүмкін болмады.',
    'en': 'Could not load pickup times.',
  },
  'delivery_choice_slot_changed': {
    'ru': 'Время уже недоступно. Выберите другое.',
    'kk': 'Бұл уақыт қолжетімсіз. Басқа уақытты таңдаңыз.',
    'en': 'This time is no longer available. Choose another.',
  },
  'delivery_choice_changed': {
    'ru': 'Заказ уже изменился. Обновляем его состояние.',
    'kk': 'Тапсырыс өзгерді. Күйін жаңартып жатырмыз.',
    'en': 'The order has changed. Refreshing its status.',
  },
};
