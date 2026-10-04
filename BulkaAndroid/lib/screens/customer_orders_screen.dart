part of '../main.dart';

enum _RepeatCartChoice { cancel, merge, replace }

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

class _CustomerOrdersScreenState extends State<CustomerOrdersScreen> {
  StreamSubscription<Map<String, dynamic>>? _pushOrderSubscription;
  late _LiveRefresh _ordersLive;
  bool _loading = true;
  bool _refreshInFlight = false;
  final Set<String> _repeatInFlight = {};
  String? _error;
  List<CustomerOrder> _orders = const [];
  CustomerOrder? _activeBefore, _completedBefore;
  bool _moreActive = false, _moreCompleted = false, _loadingMore = false;
  bool _loadedMoreActive = false, _loadedMoreCompleted = false;
  bool _usingOfflineCache = false;
  bool _visible = true;
  int _requestRevision = 0;
  String? _identity;
  PaymentReturnNotice? _paymentReturnNotice;
  String? _pendingInitialOrderId;

  String? get _cacheKey {
    if (!widget.api.isAuthenticated) return null;
    final scope =
        widget.api.sessionCacheScope ??
        (widget.cacheScope == 'session' ? null : widget.cacheScope);
    return scope == null ? null : 'customer_orders_cache_${scope}_all';
  }

  @override
  void initState() {
    super.initState();
    _identity = widget.api.sessionCacheScope;
    _paymentReturnNotice = widget.paymentReturnNotice;
    _pendingInitialOrderId = widget.initialOrderId?.trim();
    _listenOrders();
    unawaited(_load());
  }

  void _listenOrders() {
    _pushOrderSubscription = PushNotifications.orderEvents.listen(
      (_) => _ordersLive.request(),
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
      active: () => mounted && _visible,
      fallbackInterval: const Duration(seconds: 15),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final visible = TickerMode.of(context);
    if (visible && !_visible) _ordersLive.request(immediate: true);
    _visible = visible;
  }

  @override
  void didUpdateWidget(CustomerOrdersScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.api != widget.api ||
        oldWidget.cacheScope != widget.cacheScope ||
        _identity != widget.api.sessionCacheScope) {
      _identity = widget.api.sessionCacheScope;
      _requestRevision++;
      _refreshInFlight = false;
      _loadingMore = false;
      _loading = true;
      _orders = const [];
      _usingOfflineCache = false;
      _activeBefore = _completedBefore = null;
      _moreActive = _moreCompleted = false;
      _loadedMoreActive = _loadedMoreCompleted = false;
      _error = null;
      _paymentReturnNotice = widget.paymentReturnNotice;
      _pendingInitialOrderId = widget.initialOrderId?.trim();
      _ordersLive.dispose();
      unawaited(_pushOrderSubscription?.cancel());
      _listenOrders();
      unawaited(_load());
    }
  }

  @override
  void dispose() {
    _requestRevision++;
    _pushOrderSubscription?.cancel();
    _ordersLive.dispose();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (_refreshInFlight || _loadingMore) return;
    final revision = ++_requestRevision;
    final api = widget.api;
    final identity = api.sessionCacheScope;
    final cacheKey = _cacheKey;
    bool current() =>
        mounted &&
        revision == _requestRevision &&
        api == widget.api &&
        identity == widget.api.sessionCacheScope;
    _refreshInFlight = true;
    if (!silent) {
      setState(() {
        _loading = _orders.isEmpty;
        _error = null;
      });
    }
    final cacheRead = _orders.isEmpty && cacheKey != null
        ? _restoreCache(cacheKey, current)
        : Future.value(false);
    try {
      final groups = await Future.wait([
        api.getCustomerOrders(),
        api.getCustomerOrders(completed: true),
      ]);
      if (!current()) return;
      final byId = <String, CustomerOrder>{
        if (!_usingOfflineCache)
          for (final order in _orders) order.id: order,
        for (final order in groups.expand((group) => group)) order.id: order,
      };
      if (!_loadedMoreActive) {
        _activeBefore = groups[0].lastOrNull;
        _moreActive = groups[0].length == 50;
      }
      if (!_loadedMoreCompleted) {
        _completedBefore = groups[1].lastOrNull;
        _moreCompleted = groups[1].length == 50;
      }
      final orders = byId.values.toList()
        ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
      setState(() {
        _orders = orders;
        _loading = false;
        _error = null;
        _usingOfflineCache = false;
      });
      _scheduleInitialOrderOpen();
      final prefs = await SharedPreferences.getInstance();
      if (current() && cacheKey != null) {
        await prefs.setString(
          cacheKey,
          jsonEncode({
            'cachedAt': DateTime.now().toUtc().toIso8601String(),
            'orders': orders.take(200).map((order) => order.toJson()).toList(),
          }),
        );
      }
    } catch (_) {
      if (!current()) return;
      final restored = await cacheRead;
      if (!silent && !restored && _orders.isEmpty && current()) {
        setState(() => _error = 'orders_load_error'.tr);
      }
    } finally {
      if (current()) {
        setState(() {
          _refreshInFlight = false;
          _loading = false;
        });
      }
    }
  }

  Future<bool> _restoreCache(String cacheKey, bool Function() current) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(cacheKey);
      if (raw == null) return false;
      final payload = _asMap(jsonDecode(raw));
      final values = payload['orders'] as List? ?? const [];
      final orders = values
          .map((item) => CustomerOrder.fromJson(_asMap(item)))
          .where((order) => order.id.isNotEmpty)
          .toList();
      if (!current() || !_loading || _orders.isNotEmpty || orders.isEmpty) {
        return false;
      }
      setState(() {
        _orders = orders;
        _usingOfflineCache = true;
        _loading = false;
        _error = null;
      });
      _scheduleInitialOrderOpen();
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore || _refreshInFlight) return;
    final api = widget.api;
    final identity = api.sessionCacheScope;
    final revision = _requestRevision;
    bool current() =>
        mounted &&
        api == widget.api &&
        identity == widget.api.sessionCacheScope &&
        revision == _requestRevision;
    setState(() => _loadingMore = true);
    try {
      final loadActive = _moreActive && _activeBefore != null;
      final loadCompleted = _moreCompleted && _completedBefore != null;
      final pages = await Future.wait([
        if (loadActive)
          api.getMoreCustomerOrders(_activeBefore!)
        else
          Future.value(<CustomerOrder>[]),
        if (loadCompleted)
          api.getMoreCustomerOrders(_completedBefore!, completed: true)
        else
          Future.value(<CustomerOrder>[]),
      ]);
      if (!current()) return;
      setState(() {
        if (loadActive) _loadedMoreActive = true;
        if (loadCompleted) _loadedMoreCompleted = true;
        _activeBefore = pages[0].lastOrNull ?? _activeBefore;
        _completedBefore = pages[1].lastOrNull ?? _completedBefore;
        if (loadActive) _moreActive = pages[0].length == 50;
        if (loadCompleted) _moreCompleted = pages[1].length == 50;
        _orders = {
          for (final order in [..._orders, ...pages.expand((page) => page)])
            order.id: order,
        }.values.toList()..sort((a, b) => b.createdAt.compareTo(a.createdAt));
      });
    } catch (error) {
      if (mounted && current()) {
        ScaffoldMessenger.of(context).showSnackBar(
          bulkaSnackBar(content: Text(localizeErrorMessage(error))),
        );
      }
    } finally {
      if (current()) setState(() => _loadingMore = false);
    }
  }

  void _scheduleInitialOrderOpen() {
    final id = _pendingInitialOrderId;
    if (id == null || id.isEmpty || !mounted) return;
    final api = widget.api;
    final identity = api.sessionCacheScope;
    bool current() =>
        mounted &&
        api == widget.api &&
        identity == widget.api.sessionCacheScope;
    CustomerOrder? match;
    for (final order in _orders) {
      if (order.id == id) {
        match = order;
        break;
      }
    }
    if (match != null) {
      if (match.needsDeliveryDecision) {
        if (!_usingOfflineCache) _pendingInitialOrderId = null;
        return;
      }
      _pendingInitialOrderId = null;
      final refreshOnOpen = _usingOfflineCache;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (current()) {
          unawaited(_openDetails(match!, refreshOnOpen: refreshOnOpen));
        }
      });
      return;
    }
    _pendingInitialOrderId = null;
    unawaited(
      api
          .getCustomerOrder(id)
          .then((order) {
            if (current() && !order.needsDeliveryDecision) {
              return _openDetails(order, refreshOnOpen: false);
            }
          })
          .catchError((Object error) {
            if (mounted && current()) {
              ScaffoldMessenger.of(context).showSnackBar(
                bulkaSnackBar(content: Text(localizeErrorMessage(error))),
              );
            }
          }),
    );
  }

  Future<void> _repeatOrder(CustomerOrder order) async {
    if (_repeatInFlight.contains(order.id)) return;
    setState(() => _repeatInFlight.add(order.id));
    try {
      final cart = context.read<CartProvider>();
      await cart.restored;
      if (!mounted) return;
      final prefs = await SharedPreferences.getInstance();
      final currentType = prefs.getString('selected_order_type')?.trim() ?? '';
      final currentBranchId =
          order.fulfillmentType != 'delivery' &&
              currentType == order.fulfillmentType
          ? (prefs.getString(
                      'selected_bakery_location_id_${order.fulfillmentType}',
                    ) ??
                    prefs.getString('selected_bakery_location_id') ??
                    '')
                .trim()
          : '';
      final branchId = currentBranchId.isNotEmpty
          ? currentBranchId
          : order.branchId?.trim() ?? '';
      if (branchId.isEmpty) throw ApiException('order_repeat_choose_branch'.tr);
      final branches = await widget.api.getFulfillmentLocations();
      final branch = branches
          .where(
            (candidate) =>
                candidate.id == branchId &&
                candidate.active &&
                candidate.supports(order.fulfillmentType),
          )
          .firstOrNull;
      if (branch == null) {
        throw ApiException('order_repeat_branch_unavailable'.tr);
      }
      if (!mounted) return;
      final canMerge =
          currentType == order.fulfillmentType && currentBranchId.isNotEmpty;
      var choice = _RepeatCartChoice.replace;
      if (cart.items.isNotEmpty) {
        choice =
            await showDialog<_RepeatCartChoice>(
              context: context,
              builder: (dialogContext) => AlertDialog(
                title: Text('order_repeat_cart_title'.tr),
                content: Text(
                  (canMerge
                          ? 'order_repeat_cart_message'
                          : 'order_repeat_replace_only_message')
                      .tr,
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(dialogContext),
                    child: Text('cancel_btn'.tr),
                  ),
                  if (canMerge)
                    TextButton(
                      key: const ValueKey('repeat-merge-cart'),
                      onPressed: () =>
                          Navigator.pop(dialogContext, _RepeatCartChoice.merge),
                      child: Text('order_repeat_merge'.tr),
                    ),
                  FilledButton(
                    key: const ValueKey('repeat-replace-cart'),
                    onPressed: () =>
                        Navigator.pop(dialogContext, _RepeatCartChoice.replace),
                    child: Text('order_repeat_replace'.tr),
                  ),
                ],
              ),
            ) ??
            _RepeatCartChoice.cancel;
        if (choice == _RepeatCartChoice.cancel || !mounted) return;
      }
      final items = await widget.api.reorder(order.id, branchId: branchId);
      if (!mounted) return;
      final next = items.map((item) {
        final configuration = item['configuration'] is Map
            ? Map<String, dynamic>.from(item['configuration'])
            : null;
        final modifiers = item['modifiers'] is List
            ? (item['modifiers'] as List)
                  .whereType<Map>()
                  .map((value) => Map<String, dynamic>.from(value))
                  .toList()
            : <Map<String, dynamic>>[];
        final quantity = num.tryParse('${item['quantity']}') ?? 1;
        final quantityStep =
            num.tryParse('${item['quantityStep']}') ??
            (quantity % 1 != 0 ? 0.001 : 1);
        final id = _asString(item['id']);
        return CartItem(
          id: id,
          cartKey: configuration != null || modifiers.isNotEmpty
              ? CartProvider.configuredCartKey(id, configuration, modifiers)
              : id,
          name: _asString(item['name']),
          price: _asInt(item['price']),
          basePrice: _asInt(item['basePrice'] ?? item['price']),
          imageUrl: _asString(item['imageUrl']),
          configuration: configuration,
          modifiers: modifiers,
          quantity: quantity,
          quantityStep: quantityStep,
          unit: _asString(
            item['unit'],
            fallback: quantityStep < 1 ? 'кг' : 'шт.',
          ),
        );
      }).toList();
      if (next.isEmpty ||
          next.any(
            (item) => item.id.isEmpty || item.price <= 0 || item.quantity <= 0,
          )) {
        throw ApiException('order_repeat_empty'.tr);
      }
      await PendingForteOperationStore.prepareNewCheckout(widget.api);
      if (!mounted) return;
      if (choice == _RepeatCartChoice.merge) {
        cart.mergeItems(next, reconcileMenu: false);
      } else {
        cart.replaceWithItems(next, reconcileMenu: false);
      }
      await cart.persisted;
      await Future.wait([
        prefs.setString('selected_order_type', order.fulfillmentType),
        prefs.setString('selected_bakery_location', branch.displayLabel),
        prefs.setString('selected_bakery_location_id', branch.id),
        prefs.setString(
          'selected_bakery_location_${order.fulfillmentType}',
          branch.displayLabel,
        ),
        prefs.setString(
          'selected_bakery_location_id_${order.fulfillmentType}',
          branch.id,
        ),
      ]);
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
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(bulkaSnackBar(content: Text('order_added_to_cart'.tr)));
      Navigator.of(context).pop();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(bulkaSnackBar(content: Text(localizeErrorMessage(error))));
    } finally {
      if (mounted) setState(() => _repeatInFlight.remove(order.id));
    }
  }

  Future<void> _openDetails(CustomerOrder order, {bool? refreshOnOpen}) async {
    final api = widget.api;
    final identity = api.sessionCacheScope;
    bool current() =>
        mounted &&
        api == widget.api &&
        identity == widget.api.sessionCacheScope;
    final needsRefresh = refreshOnOpen ?? _usingOfflineCache;
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => OrderDetailsScreen(
          api: api,
          initialOrder: order,
          refreshOnOpen: needsRefresh,
          onRepeat: _repeatOrder,
          onOrderChanged: (updated) {
            if (!current()) return;
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
    if (current()) _ordersLive.request(immediate: true);
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
          if (_refreshInFlight && !_loading)
            const LinearProgressIndicator(minHeight: 2),
          if (_usingOfflineCache && !_refreshInFlight)
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
        itemCount: _orders.length + (_moreActive || _moreCompleted ? 1 : 0),
        separatorBuilder: (_, _) => const SizedBox(height: 14),
        itemBuilder: (_, index) => index == _orders.length
            ? OutlinedButton(
                onPressed: _loadingMore ? null : _loadMore,
                child: _loadingMore
                    ? const SizedBox.square(
                        dimension: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(
                        staffText('Показать ещё', 'Тағы көрсету', 'Show more'),
                      ),
              )
            : _CustomerOrderCard(
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
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        '${_formatCartMoney(order.amount)} ₸',
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                          height: 1.15,
                        ),
                      ),
                    ),
                    if (order.number > 0) ...[
                      const SizedBox(width: 12),
                      Text(
                        '№${order.number}',
                        key: ValueKey('customer-order-number-${order.id}'),
                        semanticsLabel: 'order_details_title'.trArgs({
                          'number': order.number,
                        }),
                        style: TextStyle(
                          color: colors.brandBrown,
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 5),
                Row(
                  children: [
                    Expanded(
                      flex: 5,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
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
                                              photo: true,
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
                        label: customerOrderStatusLabel(order),
                        color: order.orderStatus == 'cancelled'
                            ? _errorRed
                            : colors.brandBrown,
                      ),
                      if (order.usesDelivery &&
                          !order.isClosed &&
                          !order.hasDeliveryResolutionInProgress)
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
