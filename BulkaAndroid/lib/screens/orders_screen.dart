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
    this.onOpenProduct,
    this.onRequireAuth,
    this.onOpenOrders,
    super.key,
  });

  final BulkaApiClient api;
  final Customer? customer;
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
  bool _popularProductsRequested = false;
  List<_CartSuggestion> _popularProducts = const [];

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
    if (next.items.isEmpty && TickerMode.of(context)) {
      _ensurePopularProducts();
    }
  }

  @override
  void didUpdateWidget(covariant OrdersScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.api, widget.api)) {
      _popularProductsRequested = false;
      _popularProducts = const [];
      if (_cartProvider?.items.isEmpty == true && TickerMode.of(context)) {
        _ensurePopularProducts();
      }
    }
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

  void _ensurePopularProducts() {
    if (_popularProductsRequested) return;
    _popularProductsRequested = true;
    unawaited(_loadPopularProducts());
  }

  Future<void> _loadPopularProducts() async {
    final prefs = await SharedPreferences.getInstance();
    final savedType = prefs.getString('selected_order_type')?.trim() ?? '';
    final orderType = _orderTypeFromWire(savedType).wireValue;
    final branchId =
        prefs.getString('selected_bakery_location_id_$orderType')?.trim() ??
        (savedType == orderType
            ? prefs.getString('selected_bakery_location_id')?.trim()
            : null) ??
        '';
    final cacheKeys = <String>[
      'catalog_cache_${AppLang.current}_${orderType}_${branchId.isEmpty ? 'all' : branchId}',
      'catalog_cache_${AppLang.current}_${orderType}_all',
    ];

    Map<String, dynamic>? payload;
    List<String> recommendationIds = const [];
    try {
      final endpoint = Uri(
        path: '/api/guest/menu',
        queryParameters: {
          'orderType': orderType,
          if (branchId.isNotEmpty) 'branchId': branchId,
        },
      ).toString();
      final results = await Future.wait<dynamic>([
        widget.api._get(endpoint),
        _loadRecommendationIds(),
      ]);
      payload = _asMap(results.first);
      recommendationIds = (results.last as List).cast<String>();
    } catch (_) {
      for (final key in cacheKeys.toSet()) {
        final raw = prefs.getString(key);
        if (raw == null) continue;
        try {
          final cached = _asMap(jsonDecode(raw));
          final nested = _asMap(cached['payload']);
          payload = nested.isEmpty ? cached : nested;
          if (payload.isNotEmpty) break;
        } catch (_) {}
      }
    }
    if (!mounted) return;
    final suggestions = _suggestionsFromMenu(payload, recommendationIds);
    setState(() => _popularProducts = suggestions);
  }

  Future<List<String>> _loadRecommendationIds() async {
    if (!widget.api.isAuthenticated) return const [];
    try {
      return await widget.api.getRecommendationProductIds();
    } catch (_) {
      return const [];
    }
  }

  List<_CartSuggestion> _suggestionsFromMenu(
    Map<String, dynamic>? payload,
    List<String> recommendationIds,
  ) {
    if (payload == null) return const [];
    final ranking = {
      for (var index = 0; index < recommendationIds.length; index++)
        recommendationIds[index]: index,
    };
    final indexed = <({int index, _CartSuggestion product})>[];
    final seen = <String>{};
    final products = payload['products'] as List? ?? const [];
    for (var index = 0; index < products.length; index++) {
      final raw = _asMap(products[index]);
      final id = _asString(raw['id']).trim();
      final nameValue = raw['name'];
      final names = _asMap(nameValue);
      final name = _catalogDisplayName(
        names.isEmpty
            ? nameValue
            : names[AppLang.current] ?? names['ru'] ?? names['en'] ?? '',
      );
      final price = (raw['price'] as num?)?.round() ?? 0;
      final available = raw['availableQuantity'] ?? raw['inStockCount'];
      final availableCount = available is num
          ? available
          : num.tryParse('$available');
      if (id.isEmpty ||
          name.isEmpty ||
          price <= 0 ||
          !seen.add(id) ||
          raw['onlineOrderable'] == false ||
          raw['catalogAvailable'] == false ||
          raw['inStopList'] == true ||
          (availableCount != null && availableCount <= 0)) {
        continue;
      }
      indexed.add((
        index: index,
        product: _CartSuggestion(
          id: id,
          name: name,
          price: price,
          imageUrl: _asString(raw['imageUrl']),
        ),
      ));
    }
    indexed.sort((a, b) {
      final aRank = ranking[a.product.id];
      final bRank = ranking[b.product.id];
      if (aRank != null || bRank != null) {
        return (aRank ?? 100000).compareTo(bRank ?? 100000);
      }
      return a.index.compareTo(b.index);
    });
    return indexed.take(3).map((entry) => entry.product).toList();
  }

  void _openCatalog() {
    final callback = widget.onExplore;
    if (callback != null) {
      callback();
      return;
    }
    Navigator.of(
      context,
    ).push<void>(MaterialPageRoute(builder: (_) => const LocationsScreen()));
  }

  void _showSuccessDialog(BuildContext context) {
    showDialog(
      context: context,
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
    return ListView(
      padding: EdgeInsets.fromLTRB(
        16,
        18,
        16,
        BulkaLayout.bottomNavContentInset(context),
      ),
      children: [
        Container(
          key: const ValueKey('cart-empty-state'),
          padding: const EdgeInsets.fromLTRB(20, 22, 20, 20),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            borderRadius: BorderRadius.circular(BulkaRadii.card),
            border: Border.all(
              color: colors.cardBorder,
              width: BulkaStrokes.hairline,
            ),
            boxShadow: BulkaShadows.card,
          ),
          child: Column(
            children: [
              Container(
                width: 82,
                height: 82,
                decoration: BoxDecoration(
                  color: colors.brandGold.withValues(alpha: 0.16),
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: colors.cardBorder,
                    width: BulkaStrokes.hairline,
                  ),
                ),
                child: Icon(
                  Icons.shopping_bag_outlined,
                  size: 38,
                  color: colors.brandBrown,
                ),
              ),
              const SizedBox(height: 16),
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
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: GradientButton(
                  onPressed: _openCatalog,
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
        if (_popularProducts.isNotEmpty) ...[
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(
                child: Text(
                  'cart_popular_title'.tr,
                  style: const TextStyle(
                    fontFamily: _headingFont,
                    color: _textDark,
                    fontSize: BulkaTypeScale.titleSmall,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              TextButton(
                onPressed: _openCatalog,
                child: Text('cart_action'.tr),
              ),
            ],
          ),
          const SizedBox(height: 10),
          SizedBox(
            key: const ValueKey('cart-popular-products'),
            height: 206,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _popularProducts.length,
              separatorBuilder: (_, _) => const SizedBox(width: 12),
              itemBuilder: (context, index) => _CartPopularProductCard(
                product: _popularProducts[index],
                onTap: () {
                  final productId = _popularProducts[index].id;
                  final callback = widget.onOpenProduct;
                  if (callback != null) {
                    callback(productId);
                  } else {
                    Navigator.of(context).push<void>(
                      MaterialPageRoute(
                        builder: (_) => CatalogScreen(
                          api: widget.api,
                          initialClientUri: productClientUri(productId),
                        ),
                      ),
                    );
                  }
                },
              ),
            ),
          ),
        ],
      ],
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
            onCheckout: hasUnavailableItems
                ? null
                : () => _openCheckout(context, cart),
          ),
        ),
      ],
    );
  }
}
