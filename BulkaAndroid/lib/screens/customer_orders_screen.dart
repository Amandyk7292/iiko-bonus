part of '../main.dart';

class CustomerOrdersScreen extends StatefulWidget {
  const CustomerOrdersScreen({required this.api, super.key});

  final BulkaApiClient api;

  @override
  State<CustomerOrdersScreen> createState() => _CustomerOrdersScreenState();
}

class _CustomerOrdersScreenState extends State<CustomerOrdersScreen> {
  bool _completed = false;
  bool _loading = true;
  String? _error;
  List<CustomerOrder> _orders = const [];

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final orders = await widget.api.getCustomerOrders(completed: _completed);
      if (!mounted) return;
      setState(() => _orders = orders);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'orders_load_error'.tr);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _selectTab(bool completed) {
    if (_completed == completed) return;
    setState(() {
      _completed = completed;
      _orders = const [];
    });
    unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Scaffold(
      backgroundColor: colors.surfaceCream,
      appBar: AppBar(
        centerTitle: true,
        backgroundColor: Colors.white,
        title: Text(
          'orders_title'.tr,
          style: const TextStyle(fontSize: 25, fontWeight: FontWeight.w800),
        ),
      ),
      body: Column(
        children: [
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 18),
            child: Row(
              children: [
                Expanded(
                  child: _OrderTab(
                    label: 'orders_active'.tr,
                    selected: !_completed,
                    onTap: () => _selectTab(false),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _OrderTab(
                    label: 'orders_completed'.tr,
                    selected: _completed,
                    onTap: () => _selectTab(true),
                  ),
                ),
              ],
            ),
          ),
          Expanded(child: _buildContent()),
        ],
      ),
    );
  }

  Widget _buildContent() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator(color: _bulkaYellow));
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off_rounded, size: 58, color: _almond),
              const SizedBox(height: 16),
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: 20),
              OutlinedButton(onPressed: _load, child: Text('orders_retry'.tr)),
            ],
          ),
        ),
      );
    }
    if (_orders.isEmpty) return const _OrdersEmptyState();
    return RefreshIndicator(
      color: _bulkaYellow,
      onRefresh: _load,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(18, 20, 18, 32),
        itemCount: _orders.length,
        separatorBuilder: (_, _) => const SizedBox(height: 14),
        itemBuilder: (_, index) => _CustomerOrderCard(order: _orders[index]),
      ),
    );
  }
}

class _OrderTab extends StatelessWidget {
  const _OrderTab({required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      selected: selected,
      button: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(24),
        child: AnimatedContainer(
          duration: BulkaMotion.standard,
          height: 52,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected ? _bulkaYellow : Colors.white,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: _almond, width: 1.2),
          ),
          child: Text(
            label,
            style: TextStyle(
              color: _textDark,
              fontSize: 15,
              fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
            ),
          ),
        ),
      ),
    );
  }
}

class _OrdersEmptyState extends StatelessWidget {
  const _OrdersEmptyState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 142,
              height: 142,
              decoration: const BoxDecoration(color: _lightCardHighlight, shape: BoxShape.circle),
              child: const Icon(Icons.bakery_dining_outlined, size: 68, color: _almond),
            ),
            const SizedBox(height: 22),
            Text(
              'orders_empty_title'.tr,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 25, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 8),
            Text(
              'orders_empty_sub'.tr,
              textAlign: TextAlign.center,
              style: TextStyle(color: _textDark.withValues(alpha: .62), fontSize: 16),
            ),
          ],
        ),
      ),
    );
  }
}

class _CustomerOrderCard extends StatelessWidget {
  const _CustomerOrderCard({required this.order});
  final CustomerOrder order;

  String _date(DateTime value) =>
      '${value.day.toString().padLeft(2, '0')}.${value.month.toString().padLeft(2, '0')}.${value.year}';

  String get _status => 'order_status_${order.orderStatus}'.tr;

  Color get _statusColor {
    if (order.orderStatus == 'cancelled') return _errorRed;
    if (order.orderStatus == 'completed') return _successGreen;
    return const Color(0xFFB87919);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: context.bulkaColors.cardBorder),
        boxShadow: const [BoxShadow(color: Color(0x0C000000), blurRadius: 18, offset: Offset(0, 6))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: const BoxDecoration(color: _lightCardHighlight, shape: BoxShape.circle),
                child: const Icon(Icons.receipt_long_rounded, color: _textDark),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${'orders_number'.tr} ${order.number}',
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 3),
                    Text(_date(order.createdAt), style: TextStyle(color: _textDark.withValues(alpha: .58))),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                decoration: BoxDecoration(color: _statusColor.withValues(alpha: .1), borderRadius: BorderRadius.circular(20)),
                child: Text(_status, style: TextStyle(color: _statusColor, fontSize: 12, fontWeight: FontWeight.w800)),
              ),
            ],
          ),
          const SizedBox(height: 16),
          _OrderInfoRow(label: 'orders_branch'.tr, value: order.branch),
          if (order.pickupTime != null)
            _OrderInfoRow(label: 'orders_pickup'.tr, value: _date(order.pickupTime!)),
          const Divider(height: 24),
          ...order.items.take(3).map((item) {
            final name = _asString(item['name']);
            final quantity = _asInt(item['quantity'], fallback: 1);
            return Padding(
              padding: const EdgeInsets.only(bottom: 7),
              child: Row(
                children: [
                  Expanded(child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis)),
                  Text('× $quantity', style: const TextStyle(fontWeight: FontWeight.w700)),
                ],
              ),
            );
          }),
          if (order.items.length > 3)
            Text('+ ${order.items.length - 3}', style: TextStyle(color: _textDark.withValues(alpha: .55))),
          const Divider(height: 24),
          _OrderInfoRow(
            label: 'orders_bonus'.tr,
            value: '+${order.earnedBonus}',
            valueColor: _successGreen,
          ),
          _OrderInfoRow(
            label: 'orders_total'.tr,
            value: '${_formatCartMoney(order.amount)} ₸',
            strong: true,
          ),
          if (order.cancellationReason?.isNotEmpty == true) ...[
            const SizedBox(height: 10),
            Text(
              '${'orders_cancel_reason'.tr}: ${order.cancellationReason}',
              style: const TextStyle(color: _errorRed, fontSize: 13),
            ),
          ],
        ],
      ),
    );
  }
}

class _OrderInfoRow extends StatelessWidget {
  const _OrderInfoRow({required this.label, required this.value, this.strong = false, this.valueColor});
  final String label;
  final String value;
  final bool strong;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: Text(label, style: TextStyle(fontWeight: strong ? FontWeight.w800 : FontWeight.w500))),
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: TextStyle(color: valueColor, fontWeight: strong ? FontWeight.w900 : FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}
