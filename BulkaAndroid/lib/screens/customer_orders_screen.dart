part of '../main.dart';

class CustomerOrdersScreen extends StatefulWidget {
  const CustomerOrdersScreen({
    required this.api,
    this.initialCompleted = false,
    this.onScopeChanged,
    this.cacheScope = 'session',
    this.paymentReturnNotice,
    this.initialOrderId,
    super.key,
  });

  final BulkaApiClient api;
  final bool initialCompleted;
  final ValueChanged<bool>? onScopeChanged;
  final String cacheScope;
  final PaymentReturnNotice? paymentReturnNotice;
  final String? initialOrderId;

  @override
  State<CustomerOrdersScreen> createState() => _CustomerOrdersScreenState();
}

class _CustomerOrdersScreenState extends State<CustomerOrdersScreen>
    with WidgetsBindingObserver {
  Timer? _refreshTimer;
  StreamSubscription<Map<String, dynamic>>? _pushOrderSubscription;
  late final _LiveRefresh _ordersLive;
  bool _loading = true;
  bool _refreshInFlight = false;
  final Set<String> _repeatInFlight = {};
  String? _error;
  List<CustomerOrder> _orders = const [];
  bool _usingOfflineCache = false;
  PaymentReturnNotice? _paymentReturnNotice;
  String? _pendingInitialOrderId;

  String get _cacheKey => 'customer_orders_cache_${widget.cacheScope}_all';

  @override
  void initState() {
    super.initState();
    _paymentReturnNotice = widget.paymentReturnNotice;
    _pendingInitialOrderId = widget.initialOrderId?.trim();
    WidgetsBinding.instance.addObserver(this);
    _startRefreshTimer();
    _pushOrderSubscription = PushNotifications.orderEvents.listen(
      (_) => unawaited(_load(silent: true)),
    );
    _ordersLive = _LiveRefresh(
      widget.api,
      {
        'order.created',
        'order.updated',
        'delivery.updated',
        'order.customer_arrived',
        'locations',
        'menu',
      },
      () => _load(silent: true),
      busy: () => _refreshInFlight,
    );
    unawaited(_load());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _refreshTimer?.cancel();
    _pushOrderSubscription?.cancel();
    _ordersLive.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _startRefreshTimer();
      unawaited(_load(silent: true));
    } else {
      _refreshTimer?.cancel();
    }
  }

  void _startRefreshTimer() {
    _refreshTimer?.cancel();
    _refreshTimer = Timer.periodic(
      const Duration(seconds: 15),
      (_) => unawaited(_load(silent: true)),
    );
  }

  Future<void> _load({bool silent = false}) async {
    if (_refreshInFlight) return;
    _refreshInFlight = true;
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final groups = await Future.wait([
        widget.api.getCustomerOrders(),
        widget.api.getCustomerOrders(completed: true),
      ]);
      final byId = <String, CustomerOrder>{
        for (final order in groups.expand((group) => group)) order.id: order,
      };
      final orders = byId.values.toList()
        ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _cacheKey,
        jsonEncode({
          'cachedAt': DateTime.now().toUtc().toIso8601String(),
          'orders': orders.map((order) => order.toJson()).toList(),
        }),
      );
      if (!mounted) return;
      setState(() {
        _orders = orders;
        _error = null;
        _usingOfflineCache = false;
      });
      _scheduleInitialOrderOpen();
    } catch (_) {
      if (!mounted) return;
      final restored = await _restoreCache();
      if (!silent && !restored && mounted) {
        setState(() => _error = 'orders_load_error'.tr);
      }
    } finally {
      _refreshInFlight = false;
      if (!silent && mounted) setState(() => _loading = false);
    }
  }

  Future<bool> _restoreCache() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_cacheKey);
      if (raw == null) return false;
      final payload = _asMap(jsonDecode(raw));
      final values = payload['orders'] as List? ?? const [];
      final orders = values
          .map((item) => CustomerOrder.fromJson(_asMap(item)))
          .where((order) => order.id.isNotEmpty)
          .toList();
      if (!mounted || orders.isEmpty) return false;
      setState(() {
        _orders = orders;
        _usingOfflineCache = true;
        _error = null;
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  void _scheduleInitialOrderOpen() {
    final id = _pendingInitialOrderId;
    if (id == null || id.isEmpty || !mounted) return;
    CustomerOrder? match;
    for (final order in _orders) {
      if (order.id == id) {
        match = order;
        break;
      }
    }
    if (match != null) {
      _pendingInitialOrderId = null;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_openDetails(match!));
      });
      return;
    }
    _pendingInitialOrderId = null;
  }

  Future<void> _repeatOrder(CustomerOrder order) async {
    if (_repeatInFlight.contains(order.id)) return;
    setState(() => _repeatInFlight.add(order.id));
    try {
      final items = await widget.api.reorder(order.id);
      if (!mounted) return;
      final cart = context.read<CartProvider>()..clear();
      for (final item in items) {
        final configuration = item['configuration'] is Map
            ? Map<String, dynamic>.from(item['configuration'])
            : null;
        final modifiers = item['modifiers'] is List
            ? (item['modifiers'] as List)
                  .whereType<Map>()
                  .map((value) => Map<String, dynamic>.from(value))
                  .toList()
            : <Map<String, dynamic>>[];
        final quantity = _asInt(item['quantity'], fallback: 1);
        if (configuration != null || modifiers.isNotEmpty) {
          cart.addConfiguredItem(
            productId: _asString(item['id']),
            name: _asString(item['name']),
            basePrice: _asInt(item['basePrice'] ?? item['price']),
            unitPrice: _asInt(item['price']),
            imageUrl: _asString(item['imageUrl']),
            configuration: configuration,
            modifiers: modifiers,
            quantity: quantity,
          );
        } else {
          cart.addItem(
            productId: _asString(item['id']),
            name: _asString(item['name']),
            price: _asInt(item['price']),
            imageUrl: _asString(item['imageUrl']),
          );
          cart.setQuantity(_asString(item['id']), quantity);
        }
      }
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('selected_order_type', order.fulfillmentType);
      final preorderFulfillmentKey = customerPreferenceKey(
        'checkout_preorder_fulfillment',
        widget.api.sessionCacheScope,
      );
      if (order.fulfillmentType == 'preorder') {
        await prefs.setString(
          preorderFulfillmentKey,
          order.effectiveFulfillmentType,
        );
      } else {
        await prefs.remove(preorderFulfillmentKey);
      }
      if (order.branch.trim().isNotEmpty) {
        await prefs.setString('selected_bakery_location', order.branch);
      }
      await prefs.remove('selected_bakery_location_id');
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('order_added_to_cart'.tr)));
      Navigator.of(context).pop();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(localizeErrorMessage(error))));
    } finally {
      if (mounted) setState(() => _repeatInFlight.remove(order.id));
    }
  }

  Future<void> _openDetails(CustomerOrder order) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => OrderDetailsScreen(
          api: widget.api,
          initialOrder: order,
          onRepeat: _repeatOrder,
          onOrderChanged: (updated) {
            if (!mounted) return;
            setState(() {
              _orders = [
                for (final item in _orders)
                  if (item.id == updated.id) updated else item,
              ];
            });
          },
        ),
      ),
    );
    if (mounted) unawaited(_load(silent: true));
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        toolbarHeight: BulkaLayout.appBarHeight(context),
        centerTitle: true,
        backgroundColor: scheme.surface,
        title: _BulkaPageTitle('orders_title'.tr),
        actions: const [SizedBox(width: BulkaLayout.appBarSideSlot)],
      ),
      body: Column(
        children: [
          if (_usingOfflineCache)
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 10, 18, 0),
              child: _OrderNotice(
                icon: Icons.wifi_off_rounded,
                text: 'orders_offline_cache'.tr,
                color: context.bulkaColors.warning,
              ),
            ),
          if (_paymentReturnNotice == PaymentReturnNotice.cancelled)
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 12, 18, 0),
              child: _PaymentCancellationNotice(
                onDismiss: () => setState(() => _paymentReturnNotice = null),
                onBackToCart: () => Navigator.of(context).maybePop(),
              ),
            ),
          Expanded(child: _buildContent()),
        ],
      ),
    );
  }

  Widget _buildContent() {
    if (_loading) {
      return const Center(
        child: CircularProgressIndicator(color: _bulkaYellow),
      );
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
        itemBuilder: (_, index) => _CustomerOrderCard(
          order: _orders[index],
          onRepeat: () => _repeatOrder(_orders[index]),
          onOpen: () => _openDetails(_orders[index]),
          repeatLoading: _repeatInFlight.contains(_orders[index].id),
        ),
      ),
    );
  }
}

class _RefundProgressCard extends StatelessWidget {
  const _RefundProgressCard({required this.order});

  final CustomerOrder order;

  @override
  Widget build(BuildContext context) {
    final status = order.paymentStatus == 'refunded'
        ? 'succeeded'
        : (order.refundStatus ?? 'processing');
    final (titleKey, hintKey, icon, color) = switch (status) {
      'succeeded' => (
        'refund_stage_sent',
        order.paymentProvider == 'forte'
            ? 'orders_card_refund_notice'
            : 'orders_original_payment_refund_notice',
        Icons.check_circle_rounded,
        context.bulkaColors.success,
      ),
      'unknown' => (
        'refund_stage_checking',
        'refund_stage_checking_hint',
        Icons.sync_rounded,
        context.bulkaColors.warning,
      ),
      'failed' => (
        'refund_stage_attention',
        'refund_stage_attention_hint',
        Icons.error_outline_rounded,
        _errorRed,
      ),
      _ => (
        'refund_stage_processing',
        'refund_stage_processing_hint',
        Icons.hourglass_top_rounded,
        context.bulkaColors.warning,
      ),
    };
    final title = titleKey.tr;
    final hint = hintKey.tr;
    return Semantics(
      container: true,
      liveRegion: true,
      label: '$title. $hint',
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(BulkaRadii.control),
          border: Border.all(color: color.withValues(alpha: 0.35)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: color),
            const SizedBox(width: 11),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontFamily: _headingFont,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    hint,
                    style: TextStyle(
                      color: context.bulkaColors.mutedText,
                      fontSize: BulkaTypeScale.bodySmall,
                    ),
                  ),
                  if (status == 'succeeded') ...[
                    const SizedBox(height: 7),
                    Text(
                      '${_formatCartMoney(order.refundAmount ?? order.amount)} ₸',
                      style: TextStyle(
                        color: color,
                        fontFamily: _headingFont,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PaymentCancellationNotice extends StatelessWidget {
  const _PaymentCancellationNotice({
    required this.onDismiss,
    required this.onBackToCart,
  });

  final VoidCallback onDismiss;
  final VoidCallback onBackToCart;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final title = 'payment_cancelled_title'.tr;
    final description = 'payment_cancelled_explanation'.tr;
    return Semantics(
      container: true,
      liveRegion: true,
      label: '$title. $description',
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.fromLTRB(16, 14, 8, 12),
        decoration: BoxDecoration(
          color: colors.warning.withValues(alpha: .11),
          borderRadius: BorderRadius.circular(BulkaRadii.control),
          border: Border.all(color: colors.warning.withValues(alpha: .55)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: colors.warning.withValues(alpha: .18),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.info_outline_rounded,
                    color: colors.warning,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: const TextStyle(
                            fontFamily: _headingFont,
                            fontSize: BulkaTypeScale.titleSmall,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          description,
                          style: TextStyle(
                            color: colors.mutedText,
                            fontSize: BulkaTypeScale.bodySmall,
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                IconButton(
                  key: const ValueKey('payment-cancel-notice-dismiss'),
                  onPressed: onDismiss,
                  tooltip: 'payment_cancelled_dismiss'.tr,
                  icon: const Icon(Icons.close_rounded),
                ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.only(left: 52, top: 8, right: 8),
              child: TextButton.icon(
                onPressed: onBackToCart,
                icon: const Icon(Icons.shopping_bag_outlined),
                label: Text('payment_back_cart'.tr),
              ),
            ),
          ],
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
              decoration: const BoxDecoration(
                color: _lightCardHighlight,
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.bakery_dining_outlined,
                size: 68,
                color: _almond,
              ),
            ),
            const SizedBox(height: 22),
            Text(
              'orders_empty_title'.tr,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontFamily: _headingFont,
                fontSize: BulkaTypeScale.titleLarge,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'orders_empty_sub'.tr,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: context.bulkaColors.mutedText,
                fontSize: BulkaTypeScale.body,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CustomerOrderCard extends StatelessWidget {
  const _CustomerOrderCard({
    required this.order,
    required this.onRepeat,
    required this.onOpen,
    required this.repeatLoading,
  });
  final CustomerOrder order;
  final VoidCallback onRepeat;
  final VoidCallback onOpen;
  final bool repeatLoading;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final images = order.items
        .map((item) => _asString(item['imageUrl'] ?? item['image_url']))
        .toList();
    if (images.isEmpty) images.add('');
    final date = order.createdAt.toLocal();
    final type = order.fulfillmentType;
    final typeColor = type == 'delivery'
        ? const Color(0xFF286D9E)
        : type == 'preorder'
        ? const Color(0xFF8062A8)
        : const Color(0xFF3B7B60);
    final address = order.branchAddress?.trim() ?? '';
    final branch = order.branch.trim();
    final location = [
      if (branch.isNotEmpty) branch,
      if (address.isNotEmpty &&
          !branch.toLowerCase().contains(address.toLowerCase()))
        address,
    ].join('\n');
    final paymentIssue = order.paymentStatus != 'paid';
    return Container(
      key: ValueKey('customer-order-${order.id}'),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: colors.cardBorder, width: 1),
        borderRadius: BorderRadius.circular(24),
        boxShadow: const [
          BoxShadow(
            color: Color(0x09000000),
            blurRadius: 24,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(24),
        child: InkWell(
          onTap: onOpen,
          borderRadius: BorderRadius.circular(24),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      flex: 5,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${_formatCartMoney(order.amount)} ₸',
                            style: const TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.w700,
                              height: 1.15,
                            ),
                          ),
                          const SizedBox(height: 5),
                          Text(
                            '${date.day.toString().padLeft(2, '0')}.${date.month.toString().padLeft(2, '0')}',
                            style: TextStyle(
                              color: colors.mutedText,
                              fontSize: 12,
                              height: 1.15,
                            ),
                          ),
                          const SizedBox(height: 5),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(Icons.location_on_outlined, size: 14),
                              const SizedBox(width: 3),
                              Expanded(
                                child: Text(
                                  location.isNotEmpty
                                      ? location
                                      : 'orders_branch_unknown'.tr,
                                  style: TextStyle(
                                    color: colors.mutedText,
                                    fontSize: 11,
                                    height: 1.2,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Text(
                            'order_$type'.tr,
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: typeColor,
                              height: 1.15,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      flex: 5,
                      child: LayoutBuilder(
                        builder: (context, constraints) {
                          final count = min(
                            images.length,
                            max(1, (constraints.maxWidth / 42).floor()),
                          );
                          return Wrap(
                            spacing: 4,
                            runSpacing: 4,
                            children: [
                              for (final url in images.take(count))
                                ClipOval(
                                  child: SizedBox.square(
                                    dimension: 38,
                                    child: ColoredBox(
                                      color: const Color(0xFFF4F3F0),
                                      child: url.isEmpty
                                          ? const SizedBox.expand()
                                          : _NetworkImage(
                                              url: url,
                                              fit: BoxFit.cover,
                                            ),
                                    ),
                                  ),
                                ),
                            ],
                          );
                        },
                      ),
                    ),
                    const SizedBox(width: 4),
                    IconButton(
                      onPressed: repeatLoading ? null : onRepeat,
                      tooltip: 'order_repeat'.tr,
                      icon: repeatLoading
                          ? const SizedBox.square(
                              dimension: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.replay_rounded, size: 26),
                    ),
                  ],
                ),
                if (!order.isClosed ||
                    paymentIssue ||
                    order.orderStatus == 'cancelled') ...[
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      _OrderStateChip(
                        icon: Icons.shopping_bag_outlined,
                        label: 'order_status_${order.orderStatus}'.tr,
                        color: order.orderStatus == 'cancelled'
                            ? _errorRed
                            : colors.brandBrown,
                      ),
                      if (order.usesDelivery && !order.isClosed)
                        _OrderStateChip(
                          icon: Icons.delivery_dining_outlined,
                          label: 'delivery_status_${order.deliveryStatus}'.tr,
                          color: colors.brandBrown,
                        ),
                      if (paymentIssue)
                        _OrderStateChip(
                          icon: Icons.payments_outlined,
                          label: 'payment_status_${order.paymentStatus}'.tr,
                          color: order.paymentStatus == 'refunded'
                              ? _successGreen
                              : _errorRed,
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _OrderStateChip extends StatelessWidget {
  const _OrderStateChip({
    required this.icon,
    required this.label,
    required this.color,
  });

  final IconData icon;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    constraints: const BoxConstraints(minHeight: 36),
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
    decoration: BoxDecoration(
      color: color.withValues(alpha: .1),
      borderRadius: BorderRadius.circular(BulkaRadii.control),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 17, color: color),
        const SizedBox(width: 6),
        Flexible(
          child: Text(
            label,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontFamily: _headingFont,
              color: color,
              fontSize: BulkaTypeScale.caption,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    ),
  );
}

class _OrderInfoRow extends StatelessWidget {
  const _OrderInfoRow({
    required this.label,
    required this.value,
    this.strong = false,
  });
  final String label;
  final String value;
  final bool strong;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontWeight: strong ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: TextStyle(
                fontWeight: strong ? FontWeight.w700 : FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
