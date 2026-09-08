part of '../main.dart';

class StaffOverview extends StatefulWidget {
  const StaffOverview({
    required this.api,
    required this.role,
    required this.analytics,
    required this.navigate,
    super.key,
  });
  final StaffApiClient api;
  final String role;
  final bool analytics;
  final ValueChanged<String> navigate;
  @override
  State<StaffOverview> createState() => _StaffOverviewState();
}

class _StaffOverviewState extends State<StaffOverview> {
  Map<String, dynamic>? _data;
  String? _error;
  bool _loading = false;
  late final StaffLiveRefresh _live;
  @override
  void initState() {
    super.initState();
    _live = StaffLiveRefresh(widget.api, () => _load(), isBusy: () => _loading);
    unawaited(_load());
  }

  Future<void> _load() async {
    if (_loading || !mounted) return;
    setState(() => _loading = true);
    try {
      final result = await widget.api.request(
        widget.analytics ? '/stats' : '/operations/summary',
      );
      if (mounted) {
        setState(() {
          _data = Map<String, dynamic>.from(result as Map);
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Map<String, String> get _labels => widget.analytics
      ? {
          'totalCustomers': staffText('Клиенты', 'Клиенттер', 'Customers'),
          'newCustomersLast30Days': staffText(
            'Новые клиенты · 30 дней',
            'Жаңа клиенттер · 30 күн',
            'New customers · 30 days',
          ),
          'totalSales': staffText('Выручка', 'Түсім', 'Revenue'),
          'totalEarned': staffText(
            'Начислено бонусов',
            'Есептелген бонустар',
            'Bonus earned',
          ),
          'totalRedeemed': staffText(
            'Оплачено бонусами',
            'Бонустармен төленді',
            'Bonus redeemed',
          ),
          'currentLiabilities': staffText(
            'Остаток бонусов',
            'Бонус қалдығы',
            'Bonus liabilities',
          ),
          'bonusPaymentPercent': staffText(
            'Оплата бонусами, %',
            'Бонустармен төлем, %',
            'Bonus payment, %',
          ),
          'paidOrdersLast30Days': staffText(
            'Оплаченные заказы · 30 дней',
            'Төленген тапсырыстар · 30 күн',
            'Paid orders · 30 days',
          ),
          'salesLast30Days': staffText(
            'Выручка · 30 дней',
            'Түсім · 30 күн',
            'Revenue · 30 days',
          ),
          'averageOrderValueLast30Days': staffText(
            'Средний чек · 30 дней',
            'Орташа чек · 30 күн',
            'Average order · 30 days',
          ),
          'refundsLast30Days': staffText(
            'Возвраты · 30 дней',
            'Қайтарулар · 30 күн',
            'Refunds · 30 days',
          ),
          'refundAmountLast30Days': staffText(
            'Сумма возвратов · 30 дней',
            'Қайтару сомасы · 30 күн',
            'Refund amount · 30 days',
          ),
          'averageCompletionMinutesLast30Days': staffText(
            'Выполнение, мин',
            'Орындау, мин',
            'Completion, min',
          ),
          'cancelledOrdersLast30Days': staffText(
            'Отменено · 30 дней',
            'Бас тартылды · 30 күн',
            'Cancelled · 30 days',
          ),
        }
      : {
          'newOrders': staffText(
            'Новые заказы',
            'Жаңа тапсырыстар',
            'New orders',
          ),
          'activeOrders': staffText(
            'Активные заказы',
            'Белсенді тапсырыстар',
            'Active orders',
          ),
          'kitchenOverdue': staffText(
            'Задержки кухни',
            'Асүй кешігулері',
            'Kitchen overdue',
          ),
          'deliveryAttention': staffText(
            'Проверить доставку',
            'Жеткізуді тексеру',
            'Delivery attention',
          ),
          'paymentIssues': staffText(
            'Проблемы оплаты',
            'Төлем мәселелері',
            'Payment issues',
          ),
          'supportNew': staffText(
            'Новые обращения',
            'Жаңа өтініштер',
            'New support requests',
          ),
          'supportOverdue': staffText(
            'Просроченные обращения',
            'Кешіккен өтініштер',
            'Overdue requests',
          ),
          'supportMine': staffText(
            'Мои обращения',
            'Менің өтініштерім',
            'My requests',
          ),
          'whatsappUnread': staffText(
            'Непрочитанные WhatsApp',
            'Оқылмаған WhatsApp',
            'Unread WhatsApp',
          ),
          'whatsappDialogs': staffText(
            'Диалоги WhatsApp',
            'WhatsApp диалогтары',
            'WhatsApp conversations',
          ),
          'stoppedProducts': staffText(
            'В стоп-листе',
            'Стоп-тізімде',
            'Stopped products',
          ),
        };
  String _target(String key) => key.startsWith('support')
      ? 'support'
      : key.startsWith('whatsapp')
      ? 'whatsapp'
      : key == 'kitchenOverdue'
      ? 'kitchen'
      : key == 'deliveryAttention'
      ? 'dispatch'
      : key == 'stoppedProducts'
      ? 'menu'
      : 'orders';
  @override
  Widget build(BuildContext context) {
    final counts = widget.analytics ? _data : (_data?['counts'] as Map?);
    final available = _data?['capabilities'] as Map? ?? {};
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          if (_loading) const LinearProgressIndicator(),
          if (_error != null) _StaffError(message: _error!, onRetry: _load),
          if (_data != null) ...[
            LayoutBuilder(
              builder: (context, constraints) {
                final two =
                    constraints.maxWidth >= 500 &&
                    MediaQuery.textScalerOf(context).scale(16) < 25;
                return Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    for (final entry in _labels.entries)
                      if (widget.analytics ||
                          available[_target(entry.key) == 'menu'
                                  ? 'inventory'
                                  : _target(entry.key)] ==
                              true)
                        SizedBox(
                          width: two
                              ? (constraints.maxWidth - 12) / 2
                              : constraints.maxWidth,
                          child: Card(
                            margin: EdgeInsets.zero,
                            child: InkWell(
                              onTap: widget.analytics
                                  ? null
                                  : () => widget.navigate(_target(entry.key)),
                              borderRadius: BorderRadius.circular(20),
                              child: Padding(
                                padding: const EdgeInsets.all(20),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(entry.value),
                                    const SizedBox(height: 10),
                                    Text(
                                      staffNumber(counts?[entry.key] ?? 0),
                                      style: Theme.of(
                                        context,
                                      ).textTheme.headlineMedium,
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                  ],
                );
              },
            ),
            if (widget.analytics) ...[
              const SizedBox(height: 24),
              Text(
                staffText('По филиалам', 'Филиалдар бойынша', 'By branch'),
                style: Theme.of(context).textTheme.titleLarge,
              ),
              StaffBarChart(
                rows: staffRows(_data!['branchPerformance']),
                name: 'branch',
                value: 'revenue',
              ),
              for (final row in staffRows(_data!['branchPerformance']))
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: StaffFacts({
                      staffText('Филиал', 'Филиал', 'Branch'):
                          '${row['branch']}',
                      staffText('Заказы', 'Тапсырыстар', 'Orders'): staffNumber(
                        row['orders'],
                      ),
                      staffText('Выручка', 'Түсім', 'Revenue'): staffMoney(
                        row['revenue'],
                      ),
                    }),
                  ),
                ),
              const SizedBox(height: 20),
              Text(
                staffText(
                  'Популярные товары',
                  'Танымал тауарлар',
                  'Top products',
                ),
                style: Theme.of(context).textTheme.titleLarge,
              ),
              for (final row in staffRows(_data!['topProducts']))
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text('${row['name'] ?? row['id']}'),
                  subtitle: Text(
                    '${staffNumber(row['quantity'])} · ${staffMoney(row['revenue'])}',
                  ),
                ),
              const SizedBox(height: 20),
              Text(
                staffText(
                  'Путь к заказу',
                  'Тапсырысқа апаратын жол',
                  'Order funnel',
                ),
                style: Theme.of(context).textTheme.titleLarge,
              ),
              StaffBarChart(
                rows: [
                  for (final step in {
                    if (_data!['funnelStartEvent'] != 'catalog_view')
                      'app_open': staffText(
                        'Открытие приложения',
                        'Қолданбаны ашу',
                        'App opened',
                      ),
                    'catalog_view': staffText('Каталог', 'Каталог', 'Catalog'),
                    'add_to_cart': staffText(
                      'В корзину',
                      'Себетке',
                      'Added to cart',
                    ),
                    'checkout_started': staffText(
                      'Оформление',
                      'Рәсімдеу',
                      'Checkout',
                    ),
                    'payment_started': staffText(
                      'Начало оплаты',
                      'Төлем басталды',
                      'Payment started',
                    ),
                    'payment_paid': staffText('Оплачено', 'Төленді', 'Paid'),
                  }.entries)
                    {
                      'name': step.value,
                      'value': (_data!['funnel'] as Map?)?[step.key] ?? 0,
                    },
                ],
                name: 'name',
                value: 'value',
              ),
            ] else ...[
              const SizedBox(height: 20),
              for (final order in staffRows(_data!['orders']))
                Card(
                  child: ListTile(
                    title: Text(
                      '№${order['number']} · ${staffMoney(order['amount'])}',
                    ),
                    subtitle: Text(
                      '${order['branch']}\n${staffStatus(order['orderStatus'])} · ${staffDate(order['createdAt'])}',
                    ),
                    onTap: () => Navigator.push(
                      context,
                      StaffPageRoute<void>(
                        builder: (_) => StaffOrders(
                          api: widget.api,
                          role: widget.role,
                          initialSearch: '${order['number']}',
                        ),
                      ),
                    ),
                  ),
                ),
              for (final row in staffRows(_data!['support']))
                Card(
                  child: ListTile(
                    title: Text('${row['preview']}'),
                    subtitle: Text(
                      '${row['branch']} · ${staffDate(row['createdAt'])}',
                    ),
                    onTap: () => widget.navigate('support'),
                  ),
                ),
              for (final row in staffRows(_data!['whatsapp']))
                Card(
                  child: ListTile(
                    title: Text('${row['displayName']}'),
                    subtitle: Text('${row['preview']}'),
                    onTap: () => widget.navigate('whatsapp'),
                  ),
                ),
            ],
          ],
        ],
      ),
    );
  }

  @override
  void dispose() {
    _live.dispose();
    super.dispose();
  }
}

class StaffBarChart extends StatelessWidget {
  const StaffBarChart({
    required this.rows,
    required this.name,
    required this.value,
    super.key,
  });
  final List<Map<String, dynamic>> rows;
  final String name, value;
  @override
  Widget build(BuildContext context) {
    final maximum = rows.fold<double>(
      1,
      (a, row) => max(a, (row[value] as num?)?.toDouble() ?? 0),
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Column(
        children: [
          for (final row in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Semantics(
                label: '${row[name]}: ${staffNumber(row[value])}',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Wrap(
                      alignment: WrapAlignment.spaceBetween,
                      spacing: 12,
                      children: [
                        Text('${row[name]}'),
                        Text(staffNumber(row[value])),
                      ],
                    ),
                    const SizedBox(height: 8),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: LinearProgressIndicator(
                        value:
                            (((row[value] as num?)?.toDouble() ?? 0) / maximum)
                                .clamp(0, 1),
                        minHeight: 10,
                        backgroundColor: const Color(0xFFF3F0EB),
                        color: const Color(0xFFFFB300),
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
