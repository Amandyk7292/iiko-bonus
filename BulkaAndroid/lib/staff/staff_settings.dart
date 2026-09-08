part of '../main.dart';

class StaffSettings extends StatefulWidget {
  const StaffSettings({
    required this.api,
    required this.canEdit,
    this.bonus = false,
    super.key,
  });
  final StaffApiClient api;
  final bool canEdit, bonus;
  @override
  State<StaffSettings> createState() => _StaffSettingsState();
}

class _StaffSettingsState extends State<StaffSettings> {
  Map<String, dynamic>? _settings;
  String? _error;
  bool _loading = false;
  late final StaffLiveRefresh _live;
  @override
  void initState() {
    super.initState();
    _live = StaffLiveRefresh(widget.api, () => _load(), isBusy: () => _loading);
    unawaited(_load());
  }

  @override
  void dispose() {
    _live.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (!mounted || _loading) return;
    setState(() => _loading = true);
    try {
      final result = await widget.api.request('/settings');
      if (mounted) {
        setState(() {
          _settings = Map<String, dynamic>.from(result as Map);
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  StaffField _number(
    String key,
    String ru,
    String kk,
    String en, {
    num maxValue = 999999999999.99,
    num minimum = 0,
  }) => StaffField(
    key,
    staffText(ru, kk, en),
    type: 'number',
    required: true,
    minimum: minimum,
    maximum: maxValue,
  );
  StaffField _flag(String key, String ru, String kk, String en) =>
      StaffField(key, staffText(ru, kk, en), type: 'bool');
  StaffField _text(
    String key,
    String ru,
    String kk,
    String en,
    int maxLength,
  ) => StaffField(
    key,
    staffText(ru, kk, en),
    type: 'multiline',
    maxLength: maxLength,
  );
  Future<void> _edit(String key, String title, List<StaffField> fields) async {
    if (!widget.canEdit || _settings == null) return;
    final initial = key.isEmpty
        ? _settings!
        : Map<String, dynamic>.from((_settings![key] as Map?) ?? {});
    final saved = await staffEdit(
      context,
      title: title,
      fields: fields,
      initial: initial,
      save: (values) async {
        for (final entry in values.entries) {
          if ((entry.key.endsWith('_days') || entry.key == 'delay_days') &&
              entry.value is num &&
              entry.value != (entry.value as num).roundToDouble()) {
            throw Exception(
              staffText(
                'Количество дней должно быть целым',
                'Күндер саны бүтін болуы керек',
                'Day counts must be whole numbers',
              ),
            );
          }
        }
        await widget.api.request(
          '/settings',
          method: 'POST',
          body: key.isEmpty ? values : {key: values},
        );
      },
    );
    if (saved == true && mounted) unawaited(_load());
  }

  Widget _group(String key, String title, List<StaffField> fields) => Card(
    margin: const EdgeInsets.symmetric(vertical: 8),
    child: ListTile(
      contentPadding: const EdgeInsets.all(18),
      title: Text(title),
      subtitle: key.isNotEmpty && (_settings?[key] as Map?)?['enabled'] != null
          ? Text(
              (_settings![key] as Map)['enabled'] == true
                  ? staffText('Включено', 'Қосылған', 'Enabled')
                  : staffText('Выключено', 'Өшірілген', 'Disabled'),
            )
          : null,
      trailing: const Icon(Icons.chevron_right),
      onTap: widget.canEdit
          ? () => _edit(key, title, fields)
          : () => showDialog<void>(
              context: context,
              builder: (c) => BulkaActionDialog(
                title: Text(title),
                content: SingleChildScrollView(
                  child: StaffFacts({
                    for (final f in fields)
                      f.label:
                          '${(key.isEmpty ? _settings : (_settings?[key] as Map?))?[f.key] ?? '—'}',
                  }),
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(c),
                    child: Text(staffText('Закрыть', 'Жабу', 'Close')),
                  ),
                ],
              ),
            ),
    ),
  );
  Future<void> _release(String platform) async {
    if (!widget.canEdit || _settings == null) return;
    final policy = Map<String, dynamic>.from(
      (_settings!['app_release_policy'] as Map?) ?? {},
    );
    await staffEdit(
      context,
      title: platform == 'ios' ? 'iOS' : 'Android',
      fields: [
        StaffField(
          'latest_version',
          staffText('Последняя версия', 'Соңғы нұсқа', 'Latest version'),
          required: true,
        ),
        StaffField(
          'minimum_version',
          staffText(
            'Минимальная версия',
            'Ең төменгі нұсқа',
            'Minimum version',
          ),
          required: true,
        ),
        StaffField(
          'store_url',
          staffText('Ссылка на магазин', 'Дүкен сілтемесі', 'Store URL'),
        ),
      ],
      initial: Map<String, dynamic>.from((policy[platform] as Map?) ?? {}),
      save: (values) async {
        await widget.api.request(
          '/settings',
          method: 'POST',
          body: {
            'app_release_policy': {...policy, platform: values},
          },
        );
      },
    );
    if (mounted) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: _load,
    child: ListView(
      padding: const EdgeInsets.all(18),
      children: [
        if (_loading) const LinearProgressIndicator(),
        if (_error != null) _StaffError(message: _error!, onRetry: _load),
        if (_settings != null) ...[
          Card(
            child: ListTile(
              title: Text(
                staffText(
                  'Промокоды программы',
                  'Бағдарлама промокодтары',
                  'Program promo codes',
                ),
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: widget.canEdit
                  ? () async {
                      await Navigator.push(
                        context,
                        StaffPageRoute<void>(
                          builder: (_) => StaffBonusPromos(
                            api: widget.api,
                            promos: staffRows(_settings!['bonus_promocodes']),
                          ),
                        ),
                      );
                      if (mounted) unawaited(_load());
                    }
                  : null,
            ),
          ),
          _group(
            '',
            staffText(
              'Основные правила бонусов',
              'Бонустардың негізгі ережелері',
              'Base bonus rules',
            ),
            [
              StaffField(
                'bonus_mode',
                staffText('Режим', 'Режим', 'Mode'),
                options: {
                  'cashback': staffText('Кешбэк', 'Кешбэк', 'Cashback'),
                  'discount': staffText('Скидка', 'Жеңілдік', 'Discount'),
                },
              ),
              _number(
                'base_cashback_percent',
                'Базовый кешбэк, %',
                'Базалық кешбэк, %',
                'Base cashback, %',
                maxValue: 100,
              ),
              _number(
                'max_discount_percent',
                'Максимальная оплата бонусами, %',
                'Бонустармен ең көп төлем, %',
                'Maximum bonus payment, %',
                maxValue: 100,
              ),
              for (final tier in {
                'silver': 'Silver',
                'gold': 'Gold',
                'platinum': 'Platinum',
              }.entries) ...[
                _number(
                  'tier_${tier.key}_th',
                  'Порог ${tier.value}, ₸',
                  '${tier.value} шегі, ₸',
                  '${tier.value} threshold, ₸',
                ),
                _number(
                  'tier_${tier.key}_cb',
                  'Кешбэк ${tier.value}, %',
                  '${tier.value} кешбэк, %',
                  '${tier.value} cashback, %',
                  maxValue: 100,
                ),
              ],
            ],
          ),
          _group(
            'bonus_activation',
            staffText(
              'Активация бонусов',
              'Бонустарды белсендіру',
              'Bonus activation',
            ),
            [
              _flag('enabled', 'Включено', 'Қосылған', 'Enabled'),
              _number(
                'delay_days',
                'Задержка, дней',
                'Кідіріс, күн',
                'Delay, days',
                maxValue: 3650,
              ),
              _number(
                'first_transaction_bonus',
                'Бонус за первую покупку',
                'Бірінші сатып алу бонусы',
                'First purchase bonus',
              ),
              _text(
                'first_transaction_notification',
                'Сообщение',
                'Хабарлама',
                'Message',
                500,
              ),
            ],
          ),
          _group(
            'bonus_expiration',
            staffText(
              'Сгорание бонусов',
              'Бонустардың аяқталуы',
              'Bonus expiration',
            ),
            [
              _flag('enabled', 'Включено', 'Қосылған', 'Enabled'),
              _number(
                'expiration_days',
                'Срок, дней',
                'Мерзім, күн',
                'Expires after days',
                minimum: 1,
                maxValue: 3650,
              ),
              _number(
                'notify_before_days',
                'Предупредить за, дней',
                'Алдын ала ескерту, күн',
                'Notify days before',
                minimum: 1,
                maxValue: 3650,
              ),
              _flag(
                'auto_write_off',
                'Автоматически списывать',
                'Автоматты есептен шығару',
                'Automatic expiration',
              ),
            ],
          ),
          _group(
            'bonus_birthday',
            staffText('День рождения', 'Туған күн', 'Birthday'),
            [
              _flag('enabled', 'Включено', 'Қосылған', 'Enabled'),
              _number('bonus_amount', 'Бонус', 'Бонус', 'Bonus amount'),
              _number(
                'expiration_days',
                'Срок, дней',
                'Мерзім, күн',
                'Validity, days',
                minimum: 1,
                maxValue: 3650,
              ),
              _text('message', 'Сообщение', 'Хабарлама', 'Message', 500),
            ],
          ),
          _group(
            'bonus_cross',
            staffText(
              'Бонусы клиентам',
              'Клиенттер бонустары',
              'Customer bonuses',
            ),
            [
              _flag('enabled', 'Включено', 'Қосылған', 'Enabled'),
              _number(
                'new_clients_bonus',
                'Новым клиентам',
                'Жаңа клиенттерге',
                'New customers',
              ),
              _number(
                'loyal_clients_bonus',
                'Постоянным клиентам',
                'Тұрақты клиенттерге',
                'Returning customers',
              ),
              StaffField(
                'period',
                staffText('Период', 'Кезең', 'Period'),
                options: {
                  'none': staffText('Без периода', 'Кезеңсіз', 'None'),
                  'day': staffText('День', 'Күн', 'Day'),
                  'week': staffText('Неделя', 'Апта', 'Week'),
                  'month': staffText('Месяц', 'Ай', 'Month'),
                },
              ),
              StaffField(
                'city',
                staffText('Город', 'Қала', 'City'),
                maxLength: 160,
              ),
              _number(
                'min_check',
                'Минимальный чек',
                'Ең аз чек',
                'Minimum receipt',
              ),
            ],
          ),
          _group(
            'bonus_referral',
            staffText('Приглашение друзей', 'Достарды шақыру', 'Referrals'),
            [
              _flag('enabled', 'Включено', 'Қосылған', 'Enabled'),
              _number(
                'inviter_bonus',
                'Пригласившему',
                'Шақырушыға',
                'Inviter bonus',
              ),
              _number('friend_bonus', 'Другу', 'Досына', 'Friend bonus'),
              _number(
                'min_first_order',
                'Минимальный первый заказ',
                'Ең аз бірінші тапсырыс',
                'Minimum first order',
              ),
            ],
          ),
          _group(
            'bonus_automailing',
            staffText(
              'Возвращение клиентов',
              'Клиенттерді қайтару',
              'Customer reactivation',
            ),
            [
              _flag('enabled', 'Включено', 'Қосылған', 'Enabled'),
              _number(
                'inactive_days',
                'Без покупок, дней',
                'Сатып алусыз, күн',
                'Inactive days',
                minimum: 1,
                maxValue: 3650,
              ),
              _text('message', 'Сообщение', 'Хабарлама', 'Message', 1000),
            ],
          ),
          _group(
            'bonus_card_media',
            staffText('Бонусная карта', 'Бонус картасы', 'Bonus card'),
            [
              StaffField(
                'card_title',
                staffText('Название', 'Атауы', 'Title'),
                maxLength: 120,
              ),
              StaffField(
                'banner_url',
                staffText('Ссылка на баннер', 'Баннер сілтемесі', 'Banner URL'),
              ),
              StaffField(
                'logo_url',
                staffText('Ссылка на логотип', 'Логотип сілтемесі', 'Logo URL'),
              ),
            ],
          ),
          _group(
            'bonus_corporate',
            staffText(
              'Корпоративная программа',
              'Корпоративтік бағдарлама',
              'Corporate program',
            ),
            [
              _flag('enabled', 'Включено', 'Қосылған', 'Enabled'),
              StaffField(
                'company_name',
                staffText('Компания', 'Компания', 'Company'),
                maxLength: 160,
              ),
              _number(
                'monthly_limit',
                'Месячный лимит',
                'Айлық лимит',
                'Monthly limit',
              ),
              _number(
                'employee_cashback_percent',
                'Кешбэк сотрудника, %',
                'Қызметкер кешбэгі, %',
                'Employee cashback, %',
                maxValue: 100,
              ),
            ],
          ),
          if (!widget.bonus)
            for (final platform in ['ios', 'android'])
              Card(
                child: ListTile(
                  title: Text(platform == 'ios' ? 'iOS' : 'Android'),
                  subtitle: Text(
                    staffText(
                      'Версии приложения',
                      'Қолданба нұсқалары',
                      'Application versions',
                    ),
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => _release(platform),
                ),
              ),
        ],
      ],
    ),
  );
}
