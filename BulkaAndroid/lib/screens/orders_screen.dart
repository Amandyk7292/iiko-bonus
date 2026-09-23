part of '../main.dart';

enum _OrderType { pickup, delivery, preorder }

extension on _OrderType {
  String get wireValue => switch (this) {
    _OrderType.pickup => 'pickup',
    _OrderType.delivery => 'delivery',
    _OrderType.preorder => 'preorder',
  };

  String get label => switch (this) {
    _OrderType.pickup => 'order_pickup'.tr,
    _OrderType.delivery => 'order_delivery'.tr,
    _OrderType.preorder => 'order_preorder'.tr,
  };

  IconData get icon => switch (this) {
    _OrderType.pickup => Icons.storefront_outlined,
    _OrderType.delivery => Icons.delivery_dining_outlined,
    _OrderType.preorder => Icons.event_available_outlined,
  };
}

_OrderType _orderTypeFromWire(String? value) => switch (value) {
  'delivery' => _OrderType.delivery,
  'preorder' => _OrderType.preorder,
  _ => _OrderType.pickup,
};

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({
    required this.api,
    required this.customer,
    this.orderType = 'pickup',
    this.selectionRevision = 0,
    this.returnOrderType,
    this.onReturnToOrderType,
    this.transactions = const [],
    this.onExplore,
    this.onOpenProduct,
    this.onRequireAuth,
    this.onOpenOrders,
    super.key,
  });

  final BulkaApiClient api;
  final Customer? customer;
  final String orderType;
  final int selectionRevision;
  final String? returnOrderType;
  final Future<void> Function(String)? onReturnToOrderType;
  final List<BonusTransaction> transactions;
  final VoidCallback? onExplore;
  final ValueChanged<String>? onOpenProduct;
  final Future<bool> Function()? onRequireAuth;
  final Future<void> Function()? onOpenOrders;

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  CartProvider? _cartProvider;
  bool _restoreCheckoutPending = false;
  bool _checkoutOpen = false;
  late _LiveRefresh _popularLive;
  bool _popularVisible = false;
  bool _popularLoading = false;
  String? _popularScope;
  String _popularBranchId = '';
  List<_CartSuggestion> _popularProducts = const [];
  String _fulfillmentLabel = '';
  int _fulfillmentLoadRevision = 0;

  Future<void> _loadFulfillmentLabel() async {
    final revision = ++_fulfillmentLoadRevision;
    String label = '';
    if (widget.orderType == 'delivery') {
      try {
        label =
            (await AddressRepository(
              api: widget.api,
            ).loadSelectedAddress())?.displayAddress ??
            '';
      } catch (_) {
        label = '';
      }
    } else {
      final prefs = await SharedPreferences.getInstance();
      label =
          prefs.getString('selected_bakery_location_${widget.orderType}') ??
          prefs.getString('selected_bakery_location') ??
          '';
    }
    if (mounted && revision == _fulfillmentLoadRevision) {
      setState(() => _fulfillmentLabel = label);
    }
  }

  void _updateOrdersState(VoidCallback update) => setState(update);

  @override
  void initState() {
    super.initState();
    _popularLive = _createPopularRefresh();
    unawaited(_loadFulfillmentLabel());
    appLanguageNotifier.addListener(_ensurePopularProducts);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_prepareCheckoutRestore());
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final next = context.read<CartProvider>();
    final wasVisible = _popularVisible;
    _popularVisible = TickerMode.of(context);
    if (!wasVisible && _popularVisible) unawaited(_loadFulfillmentLabel());
    final changed = !identical(next, _cartProvider);
    if (changed) {
      _cartProvider?.removeListener(_restoreCheckoutIfReady);
      _cartProvider = next..addListener(_restoreCheckoutIfReady);
    }
    if ((changed || !wasVisible) && _popularVisible && next.items.isEmpty) {
      _ensurePopularProducts();
    }
  }

  @override
  void didUpdateWidget(covariant OrdersScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.orderType != widget.orderType ||
        oldWidget.selectionRevision != widget.selectionRevision ||
        oldWidget.customer != widget.customer) {
      unawaited(_loadFulfillmentLabel());
    }
    if (!identical(oldWidget.api, widget.api)) {
      _popularLive.dispose();
      _popularLive = _createPopularRefresh();
      _popularScope = null;
      _popularProducts = const [];
      if (_cartProvider?.items.isEmpty == true && TickerMode.of(context)) {
        _ensurePopularProducts();
      }
    }
  }

  @override
  void dispose() {
    _popularLive.dispose();
    appLanguageNotifier.removeListener(_ensurePopularProducts);
    _cartProvider?.removeListener(_restoreCheckoutIfReady);
    super.dispose();
  }

  Future<void> _prepareCheckoutRestore() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted || prefs.getString('lastAppScreen') != 'checkout') return;
    _restoreCheckoutPending = true;
    _restoreCheckoutIfReady();
  }

  Future<void> _markMainScreen() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('lastAppScreen', 'main');
  }

  void _restoreCheckoutIfReady() {
    final cart = _cartProvider;
    if (mounted && cart?.items.isEmpty == true && TickerMode.of(context)) {
      _ensurePopularProducts();
    }
    if (!mounted ||
        !_restoreCheckoutPending ||
        _checkoutOpen ||
        cart == null ||
        !cart.isRestored) {
      return;
    }
    _restoreCheckoutPending = false;
    if (cart.items.isEmpty) {
      unawaited(_markMainScreen());
      return;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_openCheckout(context, cart));
    });
  }

  void _showSuccessDialog(BuildContext context) {
    showDialog(
      context: context,
      animationStyle: BulkaMotion.reduced(context)
          ? AnimationStyle.noAnimation
          : null,
      builder: (context) => BulkaActionDialog(
        title: Text(
          'checkout_success_title'.tr,
          style: const TextStyle(fontFamily: _headingFont),
        ),
        content: Text(
          'checkout_success_message'.tr,
          style: const TextStyle(fontSize: BulkaTypeScale.body),
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              if (widget.onExplore != null) widget.onExplore!();
            },
            child: const Text(
              'OK',
              style: TextStyle(
                fontFamily: _headingFont,
                color: _bulkaYellow,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<Map<String, dynamic>> _paymentItems(CartProvider cart) =>
      cart.items.values.map((item) => item.toOrderPayload()).toList();

  Future<void> _openCheckout(BuildContext context, CartProvider cart) async {
    if (cart.items.isEmpty || _checkoutOpen) return;
    if (widget.customer == null || !widget.api.isAuthenticated) {
      final authenticated = await widget.onRequireAuth?.call() ?? false;
      if (!mounted || !authenticated) return;
      await Future<void>.delayed(Duration.zero);
      if (widget.customer == null || !widget.api.isAuthenticated) return;
    }
    _checkoutOpen = true;
    final checkoutCartRevision = cart.checkoutRevision;
    widget.api.trackEvent(
      'checkout_started',
      properties: {'items': cart.itemCount, 'total': cart.totalAmount},
    );
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('lastAppScreen', 'checkout');
    bool? completed;
    try {
      if (!context.mounted) return;
      final pending = await PendingForteOperationStore.resolveForCheckout(
        widget.api,
        cartRevision: checkoutCartRevision,
      );
      if (!context.mounted) return;
      if (cart.checkoutRevision != checkoutCartRevision) {
        throw ApiException('checkout_cart_changed'.tr);
      }
      completed = await Navigator.of(context).push<bool>(
        MaterialPageRoute(
          settings: const RouteSettings(name: 'checkout'),
          builder: (_) => _CheckoutScreen(
            api: widget.api,
            total: cart.totalAmount,
            cartItems: _paymentItems(cart),
            cartRevision: checkoutCartRevision,
            initialCheckoutId: pending?.checkoutId,
            onSubmit: (details) {
              if (cart.checkoutRevision != checkoutCartRevision) {
                throw ApiException('checkout_cart_changed'.tr);
              }
              return _createOrder(cart, details);
            },
          ),
        ),
      );
    } on ApiException catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          bulkaSnackBar(content: Text(localizeErrorMessage(error))),
        );
      }
    } finally {
      _checkoutOpen = false;
      await prefs.setString('lastAppScreen', 'main');
    }
    if (!context.mounted || completed != true) return;
    _showSuccessDialog(context);
  }

  Future<void> _confirmClear(BuildContext context, CartProvider cart) async {
    final shouldClear = await showDialog<bool>(
      context: context,
      animationStyle: BulkaMotion.reduced(context)
          ? AnimationStyle.noAnimation
          : null,
      builder: (dialogContext) => Dialog(
        backgroundColor: Colors.white,
        insetPadding: const EdgeInsets.symmetric(horizontal: 38),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(BulkaRadii.control),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(28, 32, 28, 28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'cart_clear_title'.tr,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontFamily: _headingFont,
                  color: _textDark,
                  fontSize: BulkaTypeScale.title,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 28),
              Row(
                children: [
                  Expanded(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: _bulkaYellow,
                        gradient: _bulkaGlassGradient,
                        borderRadius: BorderRadius.circular(BulkaRadii.card),
                      ),
                      child: TextButton(
                        onPressed: () => Navigator.pop(dialogContext, true),
                        style: TextButton.styleFrom(
                          foregroundColor: Colors.white,
                          minimumSize: const Size.fromHeight(52),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(
                              BulkaRadii.card,
                            ),
                          ),
                        ),
                        child: Text(
                          'cart_clear'.tr,
                          maxLines: 1,
                          softWrap: false,
                          style: const TextStyle(
                            fontFamily: _headingFont,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextButton(
                      onPressed: () => Navigator.pop(dialogContext, false),
                      style: TextButton.styleFrom(
                        foregroundColor: _textDark,
                        backgroundColor: const Color(0xFFF1F1F1),
                        minimumSize: const Size.fromHeight(52),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(BulkaRadii.card),
                        ),
                      ),
                      child: Text(
                        'cancel_btn'.tr,
                        style: const TextStyle(
                          fontFamily: _headingFont,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
    if (shouldClear == true) cart.clear();
  }

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartProvider>();
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      backgroundColor: scheme.surface,
      appBar: AppBar(
        toolbarHeight: BulkaLayout.appBarHeight(context),
        automaticallyImplyLeading: false,
        leadingWidth: BulkaLayout.appBarSideSlot,
        leading: const SizedBox(width: BulkaLayout.appBarSideSlot),
        centerTitle: true,
        backgroundColor: scheme.surface,
        title: _BulkaPageTitle(
          'nav_cart'.tr,
          key: const ValueKey('cart-page-title'),
        ),
        actions: [
          SizedBox(
            width: BulkaLayout.appBarSideSlot,
            child: cart.items.isNotEmpty
                ? IconButton(
                    onPressed: () => _confirmClear(context, cart),
                    tooltip: 'cart_clear'.tr,
                    icon: const Icon(Icons.delete_outline_rounded),
                  )
                : null,
          ),
        ],
      ),
      body: cart.items.isEmpty
          ? _buildEmptyState(context)
          : _buildCartItems(context, cart),
    );
  }

  Widget _buildCartItems(BuildContext context, CartProvider cart) {
    final items = cart.items.values.toList();
    final hasUnavailableItems = items.any((item) => item.isStopListed);

    return Column(
      children: [
        Expanded(
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 18, 16, 24),
            itemCount: items.length,
            separatorBuilder: (_, _) => const SizedBox(height: 14),
            itemBuilder: (context, index) {
              final item = items[index];
              return _CartProductCard(
                item: item,
                onDecrease: () => cart.setQuantity(
                  item.cartKey,
                  item.quantity - item.increment,
                ),
                onIncrease: item.isStopListed
                    ? null
                    : () => cart.setQuantity(
                        item.cartKey,
                        item.quantity + item.increment,
                      ),
              );
            },
          ),
        ),
        Padding(
          padding: EdgeInsets.only(
            bottom: BulkaLayout.bottomNavigationExtent(context),
          ),
          child: _CartCheckoutBar(
            total: cart.totalAmount,
            cashbackPercent: widget.customer?.cashbackPercent ?? 0,
            hasUnavailableItems: hasUnavailableItems,
            isGuest: widget.customer == null,
            orderType: widget.orderType,
            fulfillmentLabel: _fulfillmentLabel,
            returnOrderType: widget.returnOrderType,
            onReturnToOrderType: widget.onReturnToOrderType,
            onCheckout: hasUnavailableItems
                ? null
                : () => _openCheckout(context, cart),
          ),
        ),
      ],
    );
  }
}
