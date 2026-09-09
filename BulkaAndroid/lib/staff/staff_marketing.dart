part of '../main.dart';

Future<String?> staffPickDateTime(BuildContext context) async {
  final now = DateTime.now().toUtc().add(const Duration(hours: 5));
  final date = await showDatePicker(
    context: context,
    initialDate: now,
    firstDate: DateTime(2020),
    lastDate: DateTime(now.year + 20),
  );
  if (date == null || !context.mounted) return null;
  final time = await showTimePicker(
    context: context,
    initialTime: TimeOfDay(hour: now.hour, minute: now.minute),
  );
  if (time == null) return null;
  return '${staffDay(date)}T${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}:00+05:00';
}

List<String> staffSplit(dynamic value) => '$value'
    .split(RegExp(r'[,\n]'))
    .map((v) => v.trim())
    .where((v) => v.isNotEmpty)
    .toSet()
    .toList();
List<StaffField> staffLocaleFields(
  String key,
  String label, {
  bool multiline = false,
  bool required = false,
}) => [
  for (final locale in ['ru', 'kk', 'en'])
    StaffField(
      '${key}_$locale',
      '$label · ${locale.toUpperCase()}',
      type: multiline ? 'multiline' : 'text',
      required: required && locale == 'ru',
    ),
];
Map<String, dynamic> staffLocaleInitial(Map row, List<String> keys) => {
  for (final key in keys)
    for (final locale in ['ru', 'kk', 'en'])
      '${key}_$locale': (row[key] as Map?)?[locale] ?? '',
};
Map<String, dynamic> staffPackLocales(
  Map<String, dynamic> values,
  List<String> keys,
) {
  final body = Map<String, dynamic>.from(values);
  for (final key in keys) {
    body[key] = {
      for (final locale in ['ru', 'kk', 'en'])
        locale: body.remove('${key}_$locale') ?? '',
    };
  }
  return body;
}

class StaffMarketing extends StatefulWidget {
  const StaffMarketing({required this.api, super.key});
  final StaffApiClient api;
  @override
  State<StaffMarketing> createState() => _StaffMarketingState();
}

class _StaffMarketingState extends State<StaffMarketing> {
  String _tab = 'promotions';
  int _revision = 0;
  Future<void> _gift() async {
    // One key per issue dialog, retained when the server response is uncertain.
    final requestId = staffRequestId();
    Map<String, dynamic>? issued;
    final saved = await staffEdit(
      context,
      title: staffText(
        'Выпустить сертификат',
        'Сертификат шығару',
        'Issue gift card',
      ),
      submitLabel: staffText('Выпустить', 'Шығару', 'Issue'),
      fields: [
        StaffField(
          'amount',
          staffText('Номинал, ₸', 'Номинал, ₸', 'Value, ₸'),
          type: 'number',
          required: true,
          minimum: 500,
          maximum: 1000000,
        ),
        StaffField(
          'recipientName',
          staffText('Получатель', 'Алушы', 'Recipient'),
          maxLength: 160,
        ),
        StaffField(
          'recipientCustomerId',
          staffText('ID клиента', 'Клиент ID', 'Customer ID'),
        ),
        StaffField(
          'message',
          staffText('Поздравление', 'Құттықтау', 'Message'),
          type: 'multiline',
          maxLength: 500,
        ),
        StaffField(
          'expiresAt',
          staffText('Действует до', 'Жарамдылық мерзімі', 'Expires at'),
          pick: () => staffPickDateTime(context),
        ),
      ],
      initial: {'amount': 5000},
      save: (values) async {
        if ((values['amount'] as num) % 1 != 0) {
          throw Exception(
            staffText(
              'Укажите целое число',
              'Бүтін санды енгізіңіз',
              'Enter a whole number',
            ),
          );
        }
        final result = await widget.api.request(
          '/gift-cards',
          method: 'POST',
          body: {
            ...values,
            'idempotencyKey': requestId,
            'recipientCustomerId': values['recipientCustomerId'] == ''
                ? null
                : values['recipientCustomerId'],
            'expiresAt': values['expiresAt'] == '' ? null : values['expiresAt'],
          },
        );
        issued = Map<String, dynamic>.from(result['giftCard'] as Map);
      },
    );
    if (saved == true && mounted) {
      setState(() => _revision++);
      await showDialog<void>(
        context: context,
        builder: (c) => AlertDialog(
          title: Text(
            staffText(
              'Сертификат выпущен',
              'Сертификат шығарылды',
              'Gift card issued',
            ),
          ),
          content: SelectableText(
            '${issued?['code']}\n${staffMoney(issued?['initial_balance'] ?? issued?['balance'])}',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(c),
              child: const Text('OK'),
            ),
          ],
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) => Column(
    children: [
      Padding(
        padding: const EdgeInsets.all(18),
        child: StaffPicker(
          label: staffText('Раздел', 'Бөлім', 'Section'),
          value: _tab,
          options: {
            'promotions': staffText('Промокоды', 'Промокодтар', 'Promotions'),
            'gift-cards': staffText(
              'Сертификаты',
              'Сертификаттар',
              'Gift cards',
            ),
            'automations': staffText(
              'Автоматизации',
              'Автоматтандыру',
              'Automations',
            ),
          },
          onChanged: (v) => setState(() => _tab = v),
        ),
      ),
      if (_tab == 'gift-cards')
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 18),
          child: FilledButton.icon(
            onPressed: _gift,
            icon: const Icon(Icons.add),
            label: Text(
              staffText(
                'Выпустить сертификат',
                'Сертификат шығару',
                'Issue gift card',
              ),
            ),
          ),
        ),
      Expanded(
        child: _tab == 'promotions'
            ? StaffResource(
                key: const ValueKey('promotions'),
                api: widget.api,
                path: '/promotions',
                listKey: 'promotions',
                title: staffText('Промокод', 'Промокод', 'Promotion'),
                titleKey: 'code',
                canEdit: true,
                defaults: {
                  'active': true,
                  'discountType': 'percent',
                  'discountValue': 10,
                  'minOrder': 0,
                  'maxDiscount': 0,
                  'usageLimit': 0,
                  'perCustomerLimit': 1,
                },
                initial: (row) => {
                  'discountType': row['discount_type'],
                  'discountValue': row['discount_value'],
                  'minOrder': row['min_order'],
                  'maxDiscount': row['max_discount'] ?? 0,
                  'usageLimit': row['usage_limit'] ?? 0,
                  'perCustomerLimit': row['per_customer_limit'],
                  'customerIds': (row['customer_ids'] as List? ?? []).join(
                    ', ',
                  ),
                  'customerTags': (row['customer_tags'] as List? ?? []).join(
                    ', ',
                  ),
                  'startsAt': row['starts_at'],
                  'endsAt': row['ends_at'],
                },
                facts: {
                  'title': staffText('Название', 'Атауы', 'Title'),
                  'usage_count': staffText(
                    'Использован',
                    'Қолданылған',
                    'Uses',
                  ),
                  'active': staffText('Активен', 'Белсенді', 'Active'),
                },
                fields: [
                  StaffField(
                    'code',
                    staffText('Код', 'Код', 'Code'),
                    required: true,
                    maxLength: 64,
                  ),
                  StaffField(
                    'title',
                    staffText('Название', 'Атауы', 'Title'),
                    maxLength: 160,
                    advanced: true,
                  ),
                  StaffField(
                    'discountType',
                    staffText('Тип скидки', 'Жеңілдік түрі', 'Discount type'),
                    options: {
                      'percent': '%',
                      'fixed': '₸',
                      'free_delivery': staffText(
                        'Бесплатная доставка',
                        'Тегін жеткізу',
                        'Free delivery',
                      ),
                    },
                  ),
                  StaffField(
                    'discountValue',
                    staffText('Скидка', 'Жеңілдік', 'Discount'),
                    type: 'number',
                    required: true,
                    minimum: 0.01,
                    maximum: 100000000,
                    visibleWhen: (values) =>
                        values['discountType'] != 'free_delivery',
                  ),
                  StaffField(
                    'minOrder',
                    staffText(
                      'Минимальный заказ, ₸',
                      'Ең аз тапсырыс, ₸',
                      'Minimum order, ₸',
                    ),
                    type: 'number',
                    minimum: 0,
                    required: true,
                  ),
                  StaffField(
                    'maxDiscount',
                    staffText(
                      'Лимит скидки, ₸ · 0 = без лимита',
                      'Жеңілдік шегі, ₸ · 0 = шектеусіз',
                      'Discount cap, ₸ · 0 = unlimited',
                    ),
                    type: 'number',
                    minimum: 0,
                    advanced: true,
                    visibleWhen: (values) =>
                        values['discountType'] != 'free_delivery',
                  ),
                  StaffField(
                    'customerIds',
                    staffText(
                      'ID клиентов через запятую',
                      'Клиент ID, үтір арқылы',
                      'Customer IDs, comma separated',
                    ),
                    type: 'multiline',
                    advanced: true,
                  ),
                  StaffField(
                    'customerTags',
                    staffText(
                      'Метки клиентов',
                      'Клиент белгілері',
                      'Customer tags',
                    ),
                    type: 'multiline',
                    advanced: true,
                  ),
                  StaffField(
                    'usageLimit',
                    staffText(
                      'Лимит применений · 0 = без лимита',
                      'Қолдану шегі · 0 = шектеусіз',
                      'Usage limit · 0 = unlimited',
                    ),
                    type: 'number',
                    minimum: 0,
                    maximum: 1000000,
                    advanced: true,
                  ),
                  StaffField(
                    'perCustomerLimit',
                    staffText(
                      'На одного клиента',
                      'Бір клиентке',
                      'Per customer limit',
                    ),
                    type: 'number',
                    required: true,
                    minimum: 1,
                    maximum: 1000,
                    advanced: true,
                  ),
                  StaffField(
                    'startsAt',
                    staffText('Начало', 'Басталуы', 'Starts at'),
                    pick: () => staffPickDateTime(context),
                    advanced: true,
                  ),
                  StaffField(
                    'endsAt',
                    staffText('Окончание', 'Аяқталуы', 'Ends at'),
                    pick: () => staffPickDateTime(context),
                    advanced: true,
                  ),
                  StaffField(
                    'active',
                    staffText('Активен', 'Белсенді', 'Active'),
                    type: 'bool',
                  ),
                ],
                onExtra: (context, row, refresh) => [
                  Text(
                    row['discount_type'] == 'free_delivery'
                        ? staffText(
                            'Бесплатная доставка',
                            'Тегін жеткізу',
                            'Free delivery',
                          )
                        : '${staffText('Скидка', 'Жеңілдік', 'Discount')}: ${staffNumber(row['discount_value'])}${row['discount_type'] == 'percent' ? '%' : ' ₸'}',
                  ),
                ],
                prepare: (v, row) {
                  if (v['discountType'] == 'percent' &&
                      (v['discountValue'] as num) > 100) {
                    throw Exception(
                      staffText(
                        'Скидка не больше 100%',
                        'Жеңілдік 100%-дан аспайды',
                        'Discount must not exceed 100%',
                      ),
                    );
                  }
                  return {
                    ...v,
                    if (row?['branch_ids'] is List)
                      'branchIds': row!['branch_ids'],
                    'code': '${v['code']}'.toUpperCase(),
                    'discountValue': v['discountType'] == 'free_delivery'
                        ? 0
                        : v['discountValue'],
                    'customerIds': staffSplit(v['customerIds']),
                    'customerTags': staffSplit(v['customerTags']),
                    'maxDiscount':
                        v['discountType'] == 'free_delivery' ||
                            v['maxDiscount'] == 0
                        ? null
                        : v['maxDiscount'],
                    'usageLimit': v['usageLimit'] == 0 ? null : v['usageLimit'],
                    'startsAt': v['startsAt'] == '' ? null : v['startsAt'],
                    'endsAt': v['endsAt'] == '' ? null : v['endsAt'],
                  };
                },
              )
            : _tab == 'gift-cards'
            ? StaffResource(
                key: ValueKey('gift-$_revision'),
                api: widget.api,
                path: '/gift-cards',
                listKey: 'giftCards',
                title: staffText('Сертификаты', 'Сертификаттар', 'Gift cards'),
                titleKey: 'code_last4',
                canEdit: false,
                fields: [],
                facts: {
                  'recipient_name': staffText(
                    'Получатель',
                    'Алушы',
                    'Recipient',
                  ),
                  'initial_balance': staffText(
                    'Номинал',
                    'Номинал',
                    'Initial value',
                  ),
                  'balance': staffText('Остаток', 'Қалдық', 'Balance'),
                  'status': staffText('Статус', 'Мәртебе', 'Status'),
                  'expires_at': staffText(
                    'Действует до',
                    'Жарамдылық мерзімі',
                    'Expires at',
                  ),
                },
              )
            : StaffResource(
                key: const ValueKey('automations'),
                api: widget.api,
                path: '/automations',
                listKey: 'automations',
                title: staffText(
                  'Автоматизация',
                  'Автоматтандыру',
                  'Automation',
                ),
                titleKey: 'title_translations',
                canEdit: true,
                canCreate: false,
                facts: {
                  'trigger_type': staffText('Условие', 'Шарт', 'Trigger'),
                  'active': staffText('Активна', 'Белсенді', 'Active'),
                },
                fields: [
                  ...staffLocaleFields(
                    'titleTranslations',
                    staffText('Заголовок', 'Тақырып', 'Title'),
                  ),
                  ...staffLocaleFields(
                    'bodyTranslations',
                    staffText('Сообщение', 'Хабарлама', 'Message'),
                    multiline: true,
                  ),
                  StaffField(
                    'active',
                    staffText('Включена', 'Қосылған', 'Enabled'),
                    type: 'bool',
                  ),
                ],
                initial: (row) => staffLocaleInitial(
                  {
                    'titleTranslations': row['title_translations'],
                    'bodyTranslations': row['body_translations'],
                  },
                  ['titleTranslations', 'bodyTranslations'],
                ),
                prepare: (v, row) => {
                  ...staffPackLocales(v, [
                    'titleTranslations',
                    'bodyTranslations',
                  ]),
                  'config': row?['config'] ?? {},
                },
              ),
      ),
    ],
  );
}
