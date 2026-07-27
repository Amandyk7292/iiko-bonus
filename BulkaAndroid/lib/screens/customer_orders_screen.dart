part of '../main.dart';

class CustomerOrdersScreen extends StatefulWidget {
  const CustomerOrdersScreen({
    required this.api,
    this.initialCompleted = false,
    this.onScopeChanged,
    this.cacheScope = 'session',
    super.key,
  });

  final BulkaApiClient api;
  final bool initialCompleted;
  final ValueChanged<bool>? onScopeChanged;
  final String cacheScope;

  @override
  State<CustomerOrdersScreen> createState() => _CustomerOrdersScreenState();
}

class _CustomerOrdersScreenState extends State<CustomerOrdersScreen>
    with WidgetsBindingObserver {
  Timer? _refreshTimer;
  StreamSubscription<Map<String, dynamic>>? _pushOrderSubscription;
  StreamSubscription<Map<String, dynamic>>? _realtimeOrderSubscription;
  late bool _completed;
  bool _loading = true;
  bool _refreshInFlight = false;
  String? _arrivalInFlight;
  String? _error;
  List<CustomerOrder> _orders = const [];
  bool _usingOfflineCache = false;

  String get _cacheKey =>
      'customer_orders_cache_${widget.cacheScope}_${_completed ? 'completed' : 'active'}';

  @override
  void initState() {
    super.initState();
    _completed = widget.initialCompleted;
    WidgetsBinding.instance.addObserver(this);
    _startRefreshTimer();
    _pushOrderSubscription = PushNotifications.orderEvents.listen(
      (_) => unawaited(_load(silent: true)),
    );
    _realtimeOrderSubscription = widget.api.customerEvents.listen((event) {
      final type = _asString(event['type']);
      if (type == 'order.created' ||
          type == 'order.updated' ||
          type == 'delivery.updated' ||
          type == 'order.customer_arrived') {
        unawaited(_load(silent: true));
      }
    });
    unawaited(_load());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _refreshTimer?.cancel();
    _pushOrderSubscription?.cancel();
    _realtimeOrderSubscription?.cancel();
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
      const Duration(seconds: 60),
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
      final orders = await widget.api.getCustomerOrders(completed: _completed);
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

  void _selectTab(bool completed) {
    if (_completed == completed) return;
    setState(() {
      _completed = completed;
      _orders = const [];
    });
    widget.onScopeChanged?.call(completed);
    unawaited(_load());
  }

  Future<void> _repeatOrder(CustomerOrder order) async {
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
    }
  }

  Future<void> _reviewOrder(CustomerOrder order) async {
    var rating = 5;
    String? complaintProductId;
    final comment = TextEditingController();
    final submitted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text('review_order_number'.trArgs({'number': order.number})),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'review_how_was_it'.tr,
                  style: const TextStyle(
                    fontFamily: _headingFont,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  children: List.generate(5, (index) {
                    final value = index + 1;
                    return IconButton(
                      onPressed: () => setDialogState(() => rating = value),
                      icon: Icon(
                        value <= rating
                            ? Icons.star_rounded
                            : Icons.star_border_rounded,
                        color: const Color(0xFFE1A52B),
                        size: 34,
                      ),
                      tooltip: 'review_rating_value'.trArgs({'value': value}),
                    );
                  }),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String?>(
                  initialValue: complaintProductId,
                  decoration: InputDecoration(
                    labelText: 'review_product_optional'.tr,
                  ),
                  items: [
                    DropdownMenuItem<String?>(
                      value: null,
                      child: Text('review_no_complaint'.tr),
                    ),
                    ...order.items.map(
                      (item) => DropdownMenuItem<String?>(
                        value: _asString(item['id']),
                        child: Text(
                          _asString(item['name']),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ),
                  ],
                  onChanged: (value) =>
                      setDialogState(() => complaintProductId = value),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: comment,
                  minLines: 3,
                  maxLines: 5,
                  maxLength: 1000,
                  decoration: InputDecoration(
                    labelText: 'review_comment'.tr,
                    alignLabelWithHint: true,
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: Text('review_later'.tr),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: Text('review_send'.tr),
            ),
          ],
        ),
      ),
    );
    if (submitted != true) {
      comment.dispose();
      return;
    }
    try {
      await widget.api.submitOrderReview(
        orderId: order.id,
        rating: rating,
        comment: comment.text.trim(),
        items: complaintProductId == null
            ? const []
            : [
                {
                  'productId': complaintProductId,
                  'rating': min(rating, 2),
                  'complaintReason': comment.text.trim().isEmpty
                      ? 'review_product_complaint'.tr
                      : comment.text.trim(),
                },
              ],
      );
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('review_thanks'.tr)));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(localizeErrorMessage(error))));
      }
    } finally {
      comment.dispose();
    }
  }

  Future<void> _markArrived(CustomerOrder order) async {
    if (_arrivalInFlight != null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('orders_arrival_confirm_title'.tr),
        content: Text(
          'orders_arrival_confirm_body'.trArgs({'number': order.number}),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text('cancel_btn'.tr),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text('orders_arrival_send'.tr),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _arrivalInFlight = order.id);
    try {
      final updated = await widget.api.markCustomerArrived(order.id);
      if (!mounted) return;
      setState(() {
        _orders = [
          for (final item in _orders) item.id == updated.id ? updated : item,
        ];
      });
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('orders_arrival_sent'.tr)));
    } catch (error) {
      if (!mounted) return;
      final message = localizeErrorMessage(
        error,
        fallbackKey: 'orders_arrival_error',
      );
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(message)));
    } finally {
      if (mounted) setState(() => _arrivalInFlight = null);
    }
  }

  Future<void> _openDetails(CustomerOrder order) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => OrderDetailsScreen(
          api: widget.api,
          initialOrder: order,
          onRepeat: _repeatOrder,
          onReview: _reviewOrder,
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
          Container(
            color: scheme.surface,
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
          if (_usingOfflineCache)
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 10, 18, 0),
              child: _OrderNotice(
                icon: Icons.wifi_off_rounded,
                text: 'orders_offline_cache'.tr,
                color: context.bulkaColors.warning,
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
          onReview: () => _reviewOrder(_orders[index]),
          onArrived: () => _markArrived(_orders[index]),
          onOpen: () => _openDetails(_orders[index]),
          arrivalLoading: _arrivalInFlight == _orders[index].id,
        ),
      ),
    );
  }
}

class _OrderTab extends StatelessWidget {
  const _OrderTab({
    required this.label,
    required this.selected,
    required this.onTap,
  });
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      selected: selected,
      button: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        child: AnimatedContainer(
          duration: BulkaMotion.duration(context, BulkaMotion.standard),
          height: 52,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected ? _bulkaYellow : scheme.surface,
            borderRadius: BorderRadius.circular(BulkaRadii.card),
            border: Border.all(color: colors.cardBorder, width: 1.2),
          ),
          child: Text(
            label,
            style: TextStyle(
              color: selected ? _textDark : scheme.onSurface,
              fontSize: BulkaTypeScale.body,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
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
    required this.onReview,
    required this.onArrived,
    required this.onOpen,
    required this.arrivalLoading,
  });
  final CustomerOrder order;
  final VoidCallback onRepeat;
  final VoidCallback onReview;
  final VoidCallback onArrived;
  final VoidCallback onOpen;
  final bool arrivalLoading;

  String _date(BuildContext context, DateTime value) =>
      formatUiDate(context, value);

  String _dateTime(BuildContext context, DateTime value) =>
      formatUiDateTime(context, value);

  String _etaWindow(BuildContext context) {
    final minimum = order.etaMinAt?.toLocal();
    final maximum = order.etaMaxAt?.toLocal();
    if (minimum == null || maximum == null) {
      return order.estimatedDeliveryAt == null
          ? ''
          : _dateTime(context, order.estimatedDeliveryAt!.toLocal());
    }
    final start = formatUiTime(context, minimum);
    final end = formatUiTime(context, maximum);
    return '${_date(context, minimum)} · $start–$end';
  }

  String get _status => 'order_status_${order.orderStatus}'.tr;

  Color get _statusColor {
    if (order.orderStatus == 'cancelled') return _errorRed;
    if (order.orderStatus == 'completed') return _successGreen;
    return const Color(0xFFB87919);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    final canReportArrival =
        order.paymentStatus == 'paid' &&
        ['pickup', 'preorder'].contains(order.fulfillmentType) &&
        order.orderStatus == 'ready';
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        border: Border.all(color: colors.cardBorder),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0C000000),
            blurRadius: 18,
            offset: Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: const BoxDecoration(
                  color: _lightCardHighlight,
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.receipt_long_rounded, color: _textDark),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${'orders_number'.tr} ${order.number}',
                      style: const TextStyle(
                        fontFamily: _headingFont,
                        fontSize: BulkaTypeScale.titleSmall,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      _date(context, order.createdAt),
                      style: TextStyle(color: colors.mutedText),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 7,
                ),
                decoration: BoxDecoration(
                  color: _statusColor.withValues(alpha: .1),
                  borderRadius: BorderRadius.circular(BulkaRadii.control),
                ),
                child: Text(
                  _status,
                  style: TextStyle(
                    fontFamily: _headingFont,
                    color: _statusColor,
                    fontSize: BulkaTypeScale.caption,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          _OrderInfoRow(label: 'orders_branch'.tr, value: order.branch),
          if (order.fulfillmentType == 'delivery') ...[
            _DeliveryProgress(status: order.deliveryStatus),
            if (order.deliveryPin?.isNotEmpty == true &&
                order.deliveryStatus != 'delivered')
              Container(
                width: double.infinity,
                margin: const EdgeInsets.only(top: 12, bottom: 4),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: _bulkaYellow.withValues(alpha: .16),
                  borderRadius: BorderRadius.circular(BulkaRadii.control),
                  border: Border.all(
                    color: _bulkaYellow.withValues(alpha: .65),
                  ),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.password_rounded, color: _textDark),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'orders_delivery_pin'.tr,
                            style: const TextStyle(
                              fontFamily: _headingFont,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'orders_delivery_pin_hint'.tr,
                            style: TextStyle(
                              color: colors.mutedText,
                              fontSize: BulkaTypeScale.caption,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    SelectableText(
                      order.deliveryPin!,
                      style: const TextStyle(
                        fontFamily: _headingFont,
                        fontSize: BulkaTypeScale.titleLarge,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 4,
                      ),
                    ),
                  ],
                ),
              ),
            if (order.courier != null)
              _OrderInfoRow(
                label: 'orders_courier'.tr,
                value: [order.courier!.name, order.courier!.vehicle]
                    .whereType<String>()
                    .where((value) => value.isNotEmpty)
                    .join(' · '),
              ),
            if (order.courier?.latitude != null &&
                order.courier?.longitude != null)
              Padding(
                padding: const EdgeInsets.only(top: 6, bottom: 4),
                child: SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: () => launchUrl(
                      Uri.parse(
                        'https://yandex.kz/maps/?pt=${order.courier!.longitude},${order.courier!.latitude}&z=16&l=map',
                      ),
                      mode: LaunchMode.externalApplication,
                    ),
                    icon: const Icon(Icons.delivery_dining_rounded),
                    label: Text('orders_courier_map'.tr),
                  ),
                ),
              ),
            if (order.trackingUrl?.isNotEmpty == true)
              Padding(
                padding: const EdgeInsets.only(top: 6, bottom: 4),
                child: SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: () => launchUrl(
                      Uri.parse(order.trackingUrl!),
                      mode: LaunchMode.externalApplication,
                    ),
                    icon: const Icon(Icons.delivery_dining_rounded),
                    label: Text('orders_track_yandex'.tr),
                  ),
                ),
              ),
            if (order.etaMinAt != null || order.estimatedDeliveryAt != null)
              _OrderInfoRow(label: 'orders_eta'.tr, value: _etaWindow(context)),
            if (order.trackingCode?.isNotEmpty == true)
              _OrderInfoRow(
                label: 'orders_tracking'.tr,
                value: order.trackingCode!,
              ),
          ],
          if (order.pickupTime != null)
            _OrderInfoRow(
              label: 'orders_pickup'.tr,
              value: _date(context, order.pickupTime!),
            ),
          const Divider(height: 24),
          ...order.items.take(3).map((item) {
            final name = _asString(item['name']);
            final quantity = _asInt(item['quantity'], fallback: 1);
            return Padding(
              padding: const EdgeInsets.only(bottom: 7),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Text(
                    '× $quantity',
                    style: const TextStyle(
                      fontFamily: _headingFont,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            );
          }),
          if (order.items.length > 3)
            Text(
              '+ ${order.items.length - 3}',
              style: TextStyle(color: colors.mutedText),
            ),
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
          if (order.paymentStatus == 'refunded')
            _OrderInfoRow(
              label: 'orders_refund'.tr,
              value:
                  '${_formatCartMoney(order.refundAmount ?? order.amount)} ₸',
              valueColor: _successGreen,
              strong: true,
            ),
          if (order.cancellationReason?.isNotEmpty == true) ...[
            const SizedBox(height: 10),
            Text(
              '${'orders_cancel_reason'.tr}: ${order.cancellationReason}',
              style: const TextStyle(
                color: _errorRed,
                fontSize: BulkaTypeScale.bodySmall,
              ),
            ),
          ],
          if (canReportArrival) ...[
            const SizedBox(height: 12),
            if (order.customerArrivedAt != null)
              Semantics(
                liveRegion: true,
                label: 'orders_arrival_sent'.tr,
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 14,
                  ),
                  decoration: BoxDecoration(
                    color: context.bulkaColors.success.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(BulkaRadii.control),
                    border: Border.all(
                      color: context.bulkaColors.success.withValues(
                        alpha: 0.45,
                      ),
                    ),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.check_circle_rounded,
                        color: context.bulkaColors.success,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          'orders_arrival_sent'.tr,
                          style: const TextStyle(
                            fontFamily: _headingFont,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              )
            else
              Semantics(
                button: true,
                enabled: !arrivalLoading,
                label: 'orders_i_arrived'.tr,
                hint: 'orders_i_arrived_hint'.tr,
                child: ExcludeSemantics(
                  child: SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: arrivalLoading ? null : onArrived,
                      icon: arrivalLoading
                          ? const SizedBox.square(
                              dimension: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.near_me_rounded),
                      label: Text('orders_i_arrived'.tr),
                    ),
                  ),
                ),
              ),
          ],
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: TextButton.icon(
              onPressed: onOpen,
              icon: const Icon(Icons.route_rounded),
              label: Text('order_open_details'.tr),
              style: TextButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
              ),
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: onRepeat,
                  icon: const Icon(Icons.replay_rounded),
                  label: Text('order_repeat'.tr),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(48),
                    foregroundColor: colors.brandBrown,
                    side: BorderSide(color: colors.cardBorder),
                  ),
                ),
              ),
              if (order.orderStatus == 'completed' ||
                  order.deliveryStatus == 'delivered') ...[
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: onReview,
                    icon: const Icon(Icons.star_outline_rounded),
                    label: Text('order_review'.tr),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      backgroundColor: _bulkaYellow,
                      foregroundColor: _textDark,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _DeliveryProgress extends StatelessWidget {
  const _DeliveryProgress({required this.status});

  final String status;

  static const _steps = ['assigned', 'picked_up', 'en_route', 'delivered'];

  @override
  Widget build(BuildContext context) {
    final normalized = _steps.contains(status) ? status : 'unassigned';
    final activeIndex = _steps.indexOf(normalized);
    return Semantics(
      label:
          '${'orders_delivery_status'.tr}: ${'delivery_status_$normalized'.tr}',
      child: Container(
        margin: const EdgeInsets.only(top: 12, bottom: 8),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: _lightCardHighlight.withValues(alpha: .68),
          borderRadius: BorderRadius.circular(BulkaRadii.control),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'delivery_status_$normalized'.tr,
              style: const TextStyle(
                fontFamily: _headingFont,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 10),
            Row(
              children: List.generate(_steps.length * 2 - 1, (index) {
                if (index.isOdd) {
                  final step = index ~/ 2;
                  return Expanded(
                    child: Container(
                      height: 3,
                      color: step < activeIndex ? _successGreen : _almond,
                    ),
                  );
                }
                final step = index ~/ 2;
                final completed = step <= activeIndex;
                return AnimatedContainer(
                  duration: BulkaMotion.duration(context, BulkaMotion.fast),
                  width: 22,
                  height: 22,
                  decoration: BoxDecoration(
                    color: completed ? _successGreen : Colors.white,
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: completed ? _successGreen : _almond,
                      width: 2,
                    ),
                  ),
                  child: completed
                      ? const Icon(
                          Icons.check_rounded,
                          size: 14,
                          color: Colors.white,
                        )
                      : null,
                );
              }),
            ),
          ],
        ),
      ),
    );
  }
}

class _OrderInfoRow extends StatelessWidget {
  const _OrderInfoRow({
    required this.label,
    required this.value,
    this.strong = false,
    this.valueColor,
  });
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
                color: valueColor,
                fontWeight: strong ? FontWeight.w700 : FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
