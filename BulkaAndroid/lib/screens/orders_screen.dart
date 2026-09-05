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
    this.transactions = const [],
    this.onExplore,
    this.onRequireAuth,
    this.onOpenOrders,
    super.key,
  });

  final BulkaApiClient api;
  final Customer? customer;
  final List<BonusTransaction> transactions;
  final VoidCallback? onExplore;
  final Future<bool> Function()? onRequireAuth;
  final Future<void> Function()? onOpenOrders;

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  CartProvider? _cartProvider;
  bool _restoreCheckoutPending = false;
  bool _checkoutOpen = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_prepareCheckoutRestore());
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final next = context.read<CartProvider>();
    if (identical(next, _cartProvider)) return;
    _cartProvider?.removeListener(_restoreCheckoutIfReady);
    _cartProvider = next..addListener(_restoreCheckoutIfReady);
  }

  @override
  void dispose() {
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
      builder: (context) => AlertDialog(
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

  Future<FortePaymentOutcome> _createOrder(
    CartProvider cart,
    _CheckoutDetails details,
  ) async {
    if (cart.items.isEmpty) return FortePaymentOutcome.failed;
    final items = cart.items.values
        .map((item) => item.toOrderPayload())
        .toList();
    final result = await widget.api.createFortePayment(
      cartItems: items,
      orderType: details.orderType.wireValue,
      preorderFulfillmentType: details.preorderFulfillmentType,
      branch: details.branch,
      branchId: details.branchId,
      scheduledAt: details.scheduledAt,
      deliveryAddress: details.deliveryAddress,
      checkoutId: details.checkoutId,
      savedPaymentMethodId: details.savedPaymentMethodId,
      additionalPhone: details.additionalPhone,
      promoCode: details.promoCode,
      comment: details.comment,
    );
    final operationId = (result['operationId'] ?? '').toString();
    if (operationId.isEmpty) {
      throw ApiException('checkout_operation_missing'.tr);
    }
    final forteRedirectUrl = (result['redirectUrl'] ?? '').toString();
    if (forteRedirectUrl.isEmpty) {
      throw ApiException('forte_checkout_invalid'.tr);
    }
    // Persist the provider operation before opening the web checkout. If the
    // app is killed or the hosted page is closed, the next attempt can resume
    // this operation instead of creating another order.
    await PendingForteOperationStore.save(
      widget.api,
      operationId: operationId,
      checkoutId: details.checkoutId,
    );
    if (!mounted) return FortePaymentOutcome.pending;
    final paymentResult = await Navigator.of(context).push<FortePaymentResult>(
      MaterialPageRoute(
        builder: (_) => FortePaymentScreen(
          api: widget.api,
          operationId: operationId,
          redirectUrl: forteRedirectUrl,
          checkoutId: details.checkoutId,
        ),
      ),
    );
    if (paymentResult?.paid == true) cart.clear();
    return paymentResult?.outcome ?? FortePaymentOutcome.pending;
  }

  Future<void> _openCheckout(BuildContext context, CartProvider cart) async {
    if (cart.items.isEmpty || _checkoutOpen) return;
    if (widget.customer == null || !widget.api.isAuthenticated) {
      final authenticated = await widget.onRequireAuth?.call() ?? false;
      if (!mounted || !authenticated) return;
      await Future<void>.delayed(Duration.zero);
      if (widget.customer == null || !widget.api.isAuthenticated) return;
    }
    _checkoutOpen = true;
    widget.api.trackEvent(
      'checkout_started',
      properties: {'items': cart.itemCount, 'total': cart.totalAmount},
    );
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('lastAppScreen', 'checkout');
    bool? completed;
    try {
      if (!context.mounted) return;
      final pending = await PendingForteOperationStore.load(widget.api);
      if (!context.mounted) return;
      completed = await Navigator.of(context).push<bool>(
        MaterialPageRoute(
          settings: const RouteSettings(name: 'checkout'),
          builder: (_) => _CheckoutScreen(
            api: widget.api,
            total: cart.totalAmount,
            cartItems: _paymentItems(cart),
            initialCheckoutId: pending?.checkoutId,
            onSubmit: (details) => _createOrder(cart, details),
          ),
        ),
      );
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
                        gradient: const LinearGradient(
                          colors: [Color(0xFFFFD95F), Color(0xFFFFAF08)],
                        ),
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

  Widget _buildEmptyState(BuildContext context) {
    final colors = context.bulkaColors;
    return Center(
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(
          24,
          24,
          24,
          BulkaLayout.bottomNavContentInset(context),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 132,
              height: 132,
              decoration: BoxDecoration(
                color: colors.brandGold.withValues(alpha: 0.16),
                shape: BoxShape.circle,
                border: Border.all(color: colors.cardBorder),
              ),
              child: Icon(
                Icons.shopping_bag_outlined,
                size: 58,
                color: colors.brandBrown,
              ),
            ),
            const SizedBox(height: 24),
            Text(
              'cart_empty_title'.tr,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: colors.brandBrown,
                fontFamily: _headingFont,
                fontSize: BulkaTypeScale.pageTitle,
                fontWeight: FontWeight.w400,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'cart_empty_sub'.tr,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: colors.mutedText,
                fontSize: BulkaTypeScale.body,
                height: 1.35,
              ),
            ),
            const SizedBox(height: 28),
            SizedBox(
              width: 240,
              child: GradientButton(
                onPressed:
                    widget.onExplore ??
                    () {
                      Navigator.of(context).push<void>(
                        MaterialPageRoute(
                          builder: (_) => const LocationsScreen(),
                        ),
                      );
                    },
                child: Text(
                  'cart_action'.tr,
                  style: const TextStyle(
                    fontFamily: _headingFont,
                    fontSize: BulkaTypeScale.body,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
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
                onDecrease: () =>
                    cart.setQuantity(item.cartKey, item.quantity - 1),
                onIncrease: item.isStopListed
                    ? null
                    : () => cart.setQuantity(item.cartKey, item.quantity + 1),
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
            onCheckout: hasUnavailableItems
                ? null
                : () => _openCheckout(context, cart),
          ),
        ),
      ],
    );
  }
}
