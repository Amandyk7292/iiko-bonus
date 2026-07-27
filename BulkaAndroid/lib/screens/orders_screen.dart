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
    super.key,
  });

  final BulkaApiClient api;
  final Customer? customer;
  final List<BonusTransaction> transactions;
  final VoidCallback? onExplore;
  final Future<bool> Function()? onRequireAuth;

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

  Future<bool> _createOrder(CartProvider cart, _CheckoutDetails details) async {
    if (cart.items.isEmpty) return false;
    final items = cart.items.values
        .map((item) => item.toOrderPayload())
        .toList();
    final result = details.paymentMethod == _CheckoutPaymentMethod.forte
        ? await widget.api.createFortePayment(
            cartItems: items,
            orderType: details.orderType.wireValue,
            preorderFulfillmentType: details.preorderFulfillmentType,
            branch: details.branch,
            branchId: details.branchId,
            scheduledAt: details.scheduledAt,
            deliveryAddress: details.deliveryAddress,
            checkoutId: details.checkoutId,
            additionalPhone: details.additionalPhone,
            promoCode: details.promoCode,
            comment: details.comment,
          )
        : await widget.api.createKaspiPayment(
            cartItems: items,
            orderType: details.orderType.wireValue,
            preorderFulfillmentType: details.preorderFulfillmentType,
            branch: details.branch,
            branchId: details.branchId,
            scheduledAt: details.scheduledAt,
            deliveryAddress: details.deliveryAddress,
            checkoutId: details.checkoutId,
            additionalPhone: details.additionalPhone,
            promoCode: details.promoCode,
            comment: details.comment,
          );
    final operationId = (result['operationId'] ?? '').toString();
    if (operationId.isEmpty) {
      throw ApiException('checkout_operation_missing'.tr);
    }
    final forteRedirectUrl =
        details.paymentMethod == _CheckoutPaymentMethod.forte
        ? (result['redirectUrl'] ?? '').toString()
        : null;
    if (details.paymentMethod == _CheckoutPaymentMethod.forte &&
        forteRedirectUrl!.isEmpty) {
      throw ApiException('forte_checkout_invalid'.tr);
    }
    if (!mounted) return false;
    final paid = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) {
          if (details.paymentMethod == _CheckoutPaymentMethod.forte) {
            return FortePaymentScreen(
              api: widget.api,
              operationId: operationId,
              redirectUrl: forteRedirectUrl!,
            );
          }
          return KaspiPaymentScreen(
            api: widget.api,
            operationId: operationId,
            qrToken: result['qrToken']?.toString(),
          );
        },
      ),
    );
    if (paid == true) cart.clear();
    return paid == true;
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
      'checkout_start',
      properties: {'items': cart.itemCount, 'total': cart.totalAmount},
    );
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('lastAppScreen', 'checkout');
    bool? completed;
    try {
      if (!context.mounted) return;
      completed = await Navigator.of(context).push<bool>(
        MaterialPageRoute(
          settings: const RouteSettings(name: 'checkout'),
          builder: (_) => _CheckoutScreen(
            api: widget.api,
            total: cart.totalAmount,
            cartItems: _paymentItems(cart),
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
                          'confirm_btn'.tr,
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

String _formatCartMoney(int value) {
  final source = value.toString();
  final result = StringBuffer();
  for (var i = 0; i < source.length; i++) {
    if (i > 0 && (source.length - i) % 3 == 0) result.write(' ');
    result.write(source[i]);
  }
  return result.toString();
}

String _newCheckoutId() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes
      .map((value) => value.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

class _CartProductCard extends StatelessWidget {
  const _CartProductCard({
    required this.item,
    required this.onDecrease,
    required this.onIncrease,
  });

  final CartItem item;
  final VoidCallback onDecrease;
  final VoidCallback? onIncrease;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    final textScale = MediaQuery.textScalerOf(context).scale(1);
    final compact = MediaQuery.sizeOf(context).width < 360;
    final cardHeight =
        138.0 + ((textScale - 1).clamp(0.0, 1.0) * 40) + (compact ? 4.0 : 0.0);
    return Container(
      height: cardHeight,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        border: Border.all(color: colors.cardBorder),
      ),
      child: Row(
        children: [
          SizedBox(
            width: compact ? 110 : 126,
            height: double.infinity,
            child: _NetworkImage(url: item.imageUrl, fit: BoxFit.cover),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 10, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontFamily: _headingFont,
                      color: scheme.onSurface,
                      fontSize: BulkaTypeScale.body,
                      height: 1.15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    item.isStopListed
                        ? 'cart_unavailable'.tr
                        : '${'cart_contains'.tr} · ${item.quantity} ${'cart_units'.tr}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: item.isStopListed ? colors.danger : colors.success,
                      fontSize: BulkaTypeScale.caption,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const Spacer(),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${_formatCartMoney(item.total)} ₸',
                          maxLines: 1,
                          style: TextStyle(
                            fontFamily: _headingFont,
                            color: scheme.onSurface,
                            fontSize: BulkaTypeScale.body,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      _CartQuantityStepper(
                        quantity: item.quantity,
                        onDecrease: onDecrease,
                        onIncrease: onIncrease,
                      ),
                    ],
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

class _CartQuantityStepper extends StatelessWidget {
  const _CartQuantityStepper({
    required this.quantity,
    required this.onDecrease,
    required this.onIncrease,
  });

  final int quantity;
  final VoidCallback onDecrease;
  final VoidCallback? onIncrease;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 46,
      decoration: BoxDecoration(
        color: _bulkaYellow,
        borderRadius: BorderRadius.circular(BulkaRadii.control),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            onPressed: onDecrease,
            tooltip: 'cart_decrease'.tr,
            constraints: const BoxConstraints.tightFor(width: 44, height: 46),
            padding: EdgeInsets.zero,
            icon: const Icon(Icons.remove_rounded, size: 20),
          ),
          Semantics(
            label: 'cart_quantity'.tr,
            value: '$quantity',
            child: SizedBox(
              width: 28,
              child: Text(
                '$quantity',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontFamily: _headingFont,
                  color: _textDark,
                  fontSize: BulkaTypeScale.body,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
          IconButton(
            onPressed: onIncrease,
            tooltip: 'cart_increase'.tr,
            constraints: const BoxConstraints.tightFor(width: 44, height: 46),
            padding: EdgeInsets.zero,
            icon: const Icon(Icons.add_rounded, size: 20),
          ),
        ],
      ),
    );
  }
}

class _CartCheckoutBar extends StatelessWidget {
  const _CartCheckoutBar({
    required this.total,
    required this.cashbackPercent,
    required this.hasUnavailableItems,
    required this.onCheckout,
  });

  final int total;
  final int cashbackPercent;
  final bool hasUnavailableItems;
  final VoidCallback? onCheckout;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(24, 18, 24, 20),
      decoration: BoxDecoration(
        color: scheme.surface,
        border: Border(top: BorderSide(color: colors.cardBorder)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (hasUnavailableItems) ...[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.info_outline_rounded,
                  size: 20,
                  color: context.bulkaColors.danger,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'cart_unavailable_hint'.tr,
                    style: TextStyle(
                      color: context.bulkaColors.danger,
                      fontSize: BulkaTypeScale.bodySmall,
                      height: 1.25,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
          ],
          Row(
            children: [
              Expanded(
                child: Text(
                  'cart_reward'.tr,
                  maxLines: 1,
                  style: TextStyle(fontSize: BulkaTypeScale.body),
                ),
              ),
              const SizedBox(width: 12),
              Text(
                '+ ${(total * cashbackPercent / 100).round()} ${'cart_points'.tr}',
                style: TextStyle(
                  color: colors.mutedText,
                  fontSize: BulkaTypeScale.body,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Text(
                  'cart_total'.tr,
                  maxLines: 1,
                  style: TextStyle(
                    fontFamily: _headingFont,
                    fontSize: BulkaTypeScale.titleSmall,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Text(
                '${_formatCartMoney(total)} ₸',
                style: const TextStyle(
                  fontFamily: _headingFont,
                  fontSize: BulkaTypeScale.title,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: GradientButton(
              onPressed: onCheckout,
              child: Text(
                'cart_checkout'.tr,
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
    );
  }
}

enum _CheckoutPaymentMethod { kaspi, forte }

class _CheckoutDetails {
  const _CheckoutDetails({
    required this.checkoutId,
    required this.orderType,
    required this.scheduledAt,
    required this.paymentMethod,
    this.preorderFulfillmentType,
    this.branch,
    this.branchId,
    this.deliveryAddress,
    this.additionalPhone,
    this.promoCode,
    this.comment,
  });

  final String checkoutId;
  final _OrderType orderType;
  final String scheduledAt;
  final _CheckoutPaymentMethod paymentMethod;
  final String? preorderFulfillmentType;
  final String? branch;
  final String? branchId;
  final DeliveryAddress? deliveryAddress;
  final String? additionalPhone;
  final String? promoCode;
  final String? comment;
}

class _CheckoutPaymentCard extends StatelessWidget {
  const _CheckoutPaymentCard({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.available,
    required this.selected,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final bool? available;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final enabled = available == true;
    return Semantics(
      button: true,
      selected: selected,
      enabled: enabled,
      label: '$title. $subtitle',
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          width: 190,
          constraints: const BoxConstraints(minHeight: 112),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(BulkaRadii.control),
            border: Border.all(
              color: selected && enabled ? _bulkaYellow : Colors.grey.shade300,
              width: selected && enabled ? 2 : 1.5,
            ),
          ),
          child: available == null
              ? const Center(
                  child: SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        Icon(icon, color: enabled ? _textDark : Colors.grey),
                        const Spacer(),
                        if (selected && enabled)
                          const Icon(
                            Icons.check_circle_rounded,
                            color: _bulkaYellow,
                            size: 20,
                          ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Text(
                      title,
                      style: TextStyle(
                        fontFamily: _headingFont,
                        fontWeight: FontWeight.w700,
                        color: enabled ? _textDark : Colors.grey.shade600,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      enabled ? subtitle : 'payment_method_unavailable'.tr,
                      style: TextStyle(
                        color: Colors.grey.shade600,
                        fontSize: BulkaTypeScale.caption,
                        height: 1.2,
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}

class _PickupSlot {
  const _PickupSlot({
    required this.label,
    required this.value,
    required this.startsAt,
    required this.endsAt,
    this.remaining,
  });
  final String label;
  final String value;
  final DateTime startsAt;
  final DateTime endsAt;
  final int? remaining;
}

class _CheckoutScreen extends StatefulWidget {
  const _CheckoutScreen({
    required this.api,
    required this.total,
    required this.cartItems,
    required this.onSubmit,
  });

  final BulkaApiClient api;
  final int total;
  final List<Map<String, dynamic>> cartItems;
  final Future<bool> Function(_CheckoutDetails details) onSubmit;

  @override
  State<_CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<_CheckoutScreen> {
  late final TextEditingController _phoneController;
  final _promoController = TextEditingController();
  final _commentController = TextEditingController();
  _OrderType _orderType = _OrderType.pickup;
  _OrderType _preorderFulfillment = _OrderType.pickup;
  String _branch = '';
  String? _branchId;
  DeliveryAddress? _deliveryAddress;
  _PickupSlot? _scheduledSlot;
  List<BakeryLocation> _locations = const [];
  bool _deliveryAvailable = false;
  bool _deliveryAvailabilityChecked = false;
  bool _isSubmitting = false;
  bool _isQuoting = false;
  bool _isSelectingBranch = false;
  bool _isSelectingAddress = false;
  bool _isSelectingTime = false;
  bool? _kaspiAvailable;
  bool? _forteAvailable;
  _CheckoutPaymentMethod _paymentMethod = _CheckoutPaymentMethod.kaspi;
  int _discount = 0;
  int _deliveryFee = 0;
  int? _quotedTotal;
  Map<String, dynamic>? _etaQuote;
  int _quoteRevision = 0;
  String _checkoutId = _newCheckoutId();

  bool get _isPreorder => _orderType == _OrderType.preorder;
  bool get _usesDelivery =>
      _orderType == _OrderType.delivery ||
      (_isPreorder && _preorderFulfillment == _OrderType.delivery);
  String _draftKey(String base) =>
      customerPreferenceKey(base, widget.api.sessionCacheScope);

  @override
  void initState() {
    super.initState();
    _phoneController = TextEditingController();
    _promoController.addListener(_refreshPromoButton);
    _phoneController.addListener(_saveDraft);
    _promoController.addListener(_saveDraft);
    _commentController.addListener(_saveDraft);
    unawaited(_loadCheckoutPreferences());
    unawaited(_loadPaymentAvailability());
  }

  bool get _selectedPaymentAvailable =>
      _paymentMethod == _CheckoutPaymentMethod.kaspi
      ? _kaspiAvailable == true
      : _forteAvailable == true;

  Future<void> _loadPaymentAvailability() async {
    if (mounted) {
      setState(() {
        _kaspiAvailable = null;
        _forteAvailable = null;
      });
    }
    final availability = await Future.wait<bool>([
      widget.api.isKaspiPaymentAvailable().catchError((_) => true),
      widget.api.isFortePaymentAvailable().catchError((_) => true),
    ]);
    if (!mounted) return;
    setState(() {
      _kaspiAvailable = availability[0];
      _forteAvailable = availability[1];
      if (_paymentMethod == _CheckoutPaymentMethod.kaspi &&
          _kaspiAvailable != true &&
          _forteAvailable == true) {
        _paymentMethod = _CheckoutPaymentMethod.forte;
      } else if (_paymentMethod == _CheckoutPaymentMethod.forte &&
          _forteAvailable != true &&
          _kaspiAvailable == true) {
        _paymentMethod = _CheckoutPaymentMethod.kaspi;
      }
    });
  }

  Future<void> _loadCheckoutPreferences() async {
    final prefs = await SharedPreferences.getInstance();
    final savedBranch = prefs.getString('selected_bakery_location') ?? '';
    final savedType = _orderTypeFromWire(
      prefs.getString('selected_order_type'),
    );
    final savedPreorderFulfillment =
        prefs.getString(_draftKey('checkout_preorder_fulfillment')) ==
            'delivery'
        ? _OrderType.delivery
        : _OrderType.pickup;
    DeliveryAddress? address;
    try {
      address = await AddressRepository(api: widget.api).loadSelectedAddress();
    } catch (_) {
      address = null;
    }
    List<BakeryLocation> locations = const [];
    var locationsLoaded = false;
    try {
      locations = await widget.api.getFulfillmentLocations();
      locationsLoaded = true;
    } catch (_) {
      // Checkout remains usable for pickup while branch availability retries.
    }
    final savedScheduledAt = prefs.getString(
      _draftKey('checkout_scheduled_at'),
    );
    final parsedScheduledAt = DateTime.tryParse(savedScheduledAt ?? '');
    final savedSlot =
        parsedScheduledAt != null &&
            parsedScheduledAt.isAfter(DateTime.now()) &&
            (savedType == _OrderType.preorder ||
                _isOnLocalToday(parsedScheduledAt))
        ? _slotFromDate(parsedScheduledAt, orderType: savedType)
        : null;
    if (!mounted) return;
    _phoneController.text = prefs.getString(_draftKey('checkout_phone')) ?? '';
    _promoController.text = prefs.getString(_draftKey('checkout_promo')) ?? '';
    _commentController.text =
        prefs.getString(_draftKey('checkout_comment')) ?? '';
    setState(() {
      _branch = savedBranch;
      _branchId = prefs.getString('selected_bakery_location_id');
      _orderType = savedType;
      _preorderFulfillment = savedPreorderFulfillment;
      _deliveryAddress = address;
      _scheduledSlot = savedSlot;
      _locations = locations;
      _deliveryAvailable = locations.any(
        (location) => location.active && location.deliveryEnabled,
      );
      _deliveryAvailabilityChecked = locationsLoaded;
    });
    if (_scheduledSlot != null) unawaited(_refreshQuote());
  }

  void _refreshPromoButton() {
    if (mounted) {
      _quoteRevision++;
      setState(() {
        _discount = 0;
        _isQuoting = false;
        _quotedTotal = null;
        _etaQuote = null;
      });
    }
  }

  _PickupSlot _slotFromDate(
    DateTime date, {
    DateTime? endDate,
    int? remaining,
    _OrderType? orderType,
  }) {
    final local = date.toLocal();
    final end = (endDate ?? local.add(const Duration(hours: 1))).toLocal();
    final selectedType = orderType ?? _orderType;
    if (selectedType != _OrderType.preorder) {
      return _PickupSlot(
        label: '${_clockLabel(local)}–${_clockLabel(end)}',
        value: local.toUtc().toIso8601String(),
        startsAt: local,
        endsAt: end,
        remaining: remaining,
      );
    }
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final slotDay = DateTime(local.year, local.month, local.day);
    final offset = slotDay.difference(today).inDays;
    final dayLabel = offset == 0
        ? 'checkout_today'.tr
        : offset == 1
        ? 'checkout_tomorrow'.tr
        : formatUiDate(context, local);
    return _PickupSlot(
      label: '$dayLabel, ${_clockLabel(local)}–${_clockLabel(end)}',
      value: local.toUtc().toIso8601String(),
      startsAt: local,
      endsAt: end,
      remaining: remaining,
    );
  }

  bool _isOnLocalToday(DateTime value) {
    final now = DateTime.now();
    final local = value.toLocal();
    return local.year == now.year &&
        local.month == now.month &&
        local.day == now.day;
  }

  String _clockLabel(DateTime value) => formatUiTime(context, value);

  void _saveDraft() {
    unawaited(_persistDraft());
  }

  Future<void> _persistDraft() async {
    final prefs = await SharedPreferences.getInstance();
    await Future.wait([
      prefs.setString('selected_order_type', _orderType.wireValue),
      prefs.setString(
        _draftKey('checkout_preorder_fulfillment'),
        _preorderFulfillment.wireValue,
      ),
      prefs.setString(_draftKey('checkout_phone'), _phoneController.text),
      prefs.setString(_draftKey('checkout_promo'), _promoController.text),
      prefs.setString(_draftKey('checkout_comment'), _commentController.text),
      if (_scheduledSlot == null)
        prefs.remove(_draftKey('checkout_scheduled_at'))
      else
        prefs.setString(
          _draftKey('checkout_scheduled_at'),
          _scheduledSlot!.value,
        ),
    ]);
  }

  BakeryLocation? get _selectedBranchLocation {
    for (final location in _locations) {
      if ((_branchId != null && location.id == _branchId) ||
          location.displayLabel == _branch ||
          location.name == _branch) {
        return location;
      }
    }
    return null;
  }

  double _distanceToAddressKm(
    BakeryLocation location,
    DeliveryAddress address,
  ) {
    final latitude = location.latitude;
    final longitude = location.longitude;
    if (latitude == null || longitude == null) return double.infinity;
    return distanceBetweenCoordinatesKm(
      firstLatitude: latitude,
      firstLongitude: longitude,
      secondLatitude: address.location.latitude,
      secondLongitude: address.location.longitude,
    );
  }

  BakeryLocation? get _deliveryBranchLocation {
    final address = _deliveryAddress;
    if (address == null) return null;
    final candidates =
        _locations
            .where(
              (location) =>
                  location.active &&
                  location.deliveryEnabled &&
                  (!_isPreorder || location.preorderEnabled) &&
                  location.deliveryZoneForDistance(
                        _distanceToAddressKm(location, address),
                      ) !=
                      null,
            )
            .toList()
          ..sort(
            (left, right) => _distanceToAddressKm(
              left,
              address,
            ).compareTo(_distanceToAddressKm(right, address)),
          );
    return candidates.isEmpty ? null : candidates.first;
  }

  BakeryLocation? get _effectiveLocation =>
      _usesDelivery ? _deliveryBranchLocation : _selectedBranchLocation;

  Future<void> _setPreorderFulfillment(_OrderType value) async {
    if (!_isPreorder || value == _preorderFulfillment) return;
    _quoteRevision++;
    setState(() {
      _preorderFulfillment = value;
      _scheduledSlot = null;
      _discount = 0;
      _deliveryFee = 0;
      _quotedTotal = null;
      _etaQuote = null;
      _isQuoting = false;
    });
    await _persistDraft();
  }

  @override
  void dispose() {
    _promoController.removeListener(_refreshPromoButton);
    _phoneController.removeListener(_saveDraft);
    _promoController.removeListener(_saveDraft);
    _commentController.removeListener(_saveDraft);
    _phoneController.dispose();
    _promoController.dispose();
    _commentController.dispose();
    super.dispose();
  }

  Future<void> _selectBranch() async {
    if (_isSelectingBranch) return;
    setState(() => _isSelectingBranch = true);
    try {
      final selected = await Navigator.of(context).push<String>(
        MaterialPageRoute(
          builder: (_) => LocationsScreen(orderType: _orderType.wireValue),
        ),
      );
      if (!mounted || selected == null || selected.trim().isEmpty) return;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('selected_bakery_location', selected);
      if (!mounted) return;
      _quoteRevision++;
      setState(() {
        _branch = selected;
        _branchId = prefs.getString('selected_bakery_location_id');
        _scheduledSlot = null;
        _deliveryFee = 0;
        _isQuoting = false;
        _quotedTotal = null;
        _etaQuote = null;
      });
      await _persistDraft();
    } finally {
      if (mounted) setState(() => _isSelectingBranch = false);
    }
  }

  Future<void> _selectDeliveryAddress() async {
    if (_isSelectingAddress) return;
    setState(() => _isSelectingAddress = true);
    try {
      final selected = await Navigator.of(context).push<DeliveryAddress>(
        MaterialPageRoute(
          builder: (_) => AddressSelectionScreen(api: widget.api),
        ),
      );
      if (!mounted || selected == null) return;
      _quoteRevision++;
      setState(() {
        _deliveryAddress = selected;
        _scheduledSlot = null;
        _deliveryFee = 0;
        _isQuoting = false;
        _quotedTotal = null;
        _etaQuote = null;
      });
      await _persistDraft();
    } finally {
      if (mounted) setState(() => _isSelectingAddress = false);
    }
  }

  Future<void> _selectScheduledTime() async {
    if (_isSelectingTime) return;
    if (!_usesDelivery && _branch.trim().isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('checkout_branch_required'.tr)));
      return;
    }
    if (_usesDelivery && _deliveryAddress == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('checkout_delivery_address_required'.tr)),
      );
      return;
    }
    if (_usesDelivery && _deliveryBranchLocation == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('checkout_delivery_outside_zone'.tr)),
      );
      return;
    }
    final location = _effectiveLocation;
    if (location == null) return;
    setState(() => _isSelectingTime = true);
    try {
      List<_PickupSlot> timeSlots;
      final slots = await widget.api.getFulfillmentSlots(
        branchId: location.id,
        orderType: _orderType.wireValue,
        days: _orderType == _OrderType.preorder ? 7 : 1,
      );
      timeSlots = slots
          .map(
            (slot) => _slotFromDate(
              slot.startsAt,
              endDate: slot.endsAt,
              remaining: slot.remaining,
            ),
          )
          .take(_orderType == _OrderType.preorder ? 50 : 30)
          .toList();
      if (!mounted) return;
      if (timeSlots.isEmpty) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('checkout_no_time_slots'.tr)));
        return;
      }
      DateTime? selectedDay;
      if (_isPreorder) {
        selectedDay = await showModalBottomSheet<DateTime>(
          context: context,
          isScrollControlled: true,
          backgroundColor: Colors.transparent,
          builder: (sheetContext) => _PreorderCalendarSheet(
            slots: timeSlots,
            selected: _scheduledSlot?.startsAt,
          ),
        );
        if (!mounted || selectedDay == null) return;
      }
      final selectableSlots = selectedDay == null
          ? timeSlots
          : timeSlots
                .where(
                  (slot) => DateUtils.isSameDay(slot.startsAt, selectedDay),
                )
                .toList();
      final selected = await showModalBottomSheet<_PickupSlot>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (sheetContext) => _CheckoutTimeSheet(
          slots: selectableSlots,
          selectedValue: _scheduledSlot?.value,
        ),
      );
      if (mounted && selected != null) {
        setState(() => _scheduledSlot = selected);
        await _persistDraft();
        await _refreshQuote();
      }
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(localizeErrorMessage(error))));
    } finally {
      if (mounted) setState(() => _isSelectingTime = false);
    }
  }

  bool get _canQuote =>
      _scheduledSlot != null &&
      (_usesDelivery
          ? _deliveryAddress != null && _deliveryBranchLocation != null
          : _branch.trim().isNotEmpty);

  String get _quoteEtaText {
    final eta = _etaQuote;
    if (eta == null) return '';
    final minimum = DateTime.tryParse(_asString(eta['minAt']))?.toLocal();
    final maximum = DateTime.tryParse(_asString(eta['maxAt']))?.toLocal();
    if (minimum != null && maximum != null) {
      final start = _clockLabel(minimum);
      final end = _clockLabel(maximum);
      return 'checkout_eta_window'.trArgs({
        'date': formatUiDate(context, minimum),
        'min': start,
        'max': end,
      });
    }
    final minimumMinutes = (eta['minMinutes'] as num?)?.round();
    final maximumMinutes = (eta['maxMinutes'] as num?)?.round();
    if (minimumMinutes != null && maximumMinutes != null) {
      return 'order_eta_range_minutes'.trArgs({
        'min': minimumMinutes,
        'max': maximumMinutes,
      });
    }
    return '';
  }

  String get _quoteEtaConfidence {
    final confidence = _asString(_etaQuote?['confidence']);
    return const {'low', 'medium', 'high'}.contains(confidence)
        ? 'order_eta_confidence_$confidence'.tr
        : '';
  }

  Future<void> _refreshQuote({bool showFeedback = false}) async {
    if (!_canQuote) return;
    if (_isQuoting) return;
    final revision = ++_quoteRevision;
    setState(() => _isQuoting = true);
    try {
      final quote = await widget.api.quoteKaspiOrder(
        cartItems: widget.cartItems,
        orderType: _orderType.wireValue,
        preorderFulfillmentType: _isPreorder
            ? _preorderFulfillment.wireValue
            : null,
        branch: _usesDelivery ? null : _branch,
        branchId: _usesDelivery ? null : _branchId,
        scheduledAt: _scheduledSlot?.value,
        deliveryAddress: _usesDelivery ? _deliveryAddress : null,
        promoCode: _promoController.text.trim(),
      );
      if (!mounted || revision != _quoteRevision) return;
      setState(() {
        _discount = (quote['discount'] as num?)?.round() ?? 0;
        _deliveryFee = (quote['deliveryFee'] as num?)?.round() ?? 0;
        _quotedTotal = (quote['total'] as num?)?.round();
        final eta = _asMap(quote['eta']);
        _etaQuote = eta.isEmpty ? null : eta;
      });
      if (showFeedback) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              _discount > 0
                  ? 'checkout_promo_applied'.tr
                  : 'checkout_price_checked'.tr,
            ),
          ),
        );
      }
    } catch (error) {
      if (mounted && revision == _quoteRevision) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(localizeErrorMessage(error))));
      }
    } finally {
      if (mounted && revision == _quoteRevision) {
        setState(() => _isQuoting = false);
      }
    }
  }

  Future<void> _applyPromo() async {
    FocusScope.of(context).unfocus();
    if (!_canQuote) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('checkout_time_required'.tr)));
      return;
    }
    await _refreshQuote(showFeedback: true);
  }

  Future<void> _submit() async {
    if (!_selectedPaymentAvailable) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            _paymentMethod == _CheckoutPaymentMethod.kaspi
                ? 'checkout_kaspi_unavailable'.tr
                : 'checkout_forte_unavailable'.tr,
          ),
        ),
      );
      return;
    }
    if (!_usesDelivery && _branch.trim().isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('checkout_branch_required'.tr)));
      return;
    }
    if (_usesDelivery &&
        (_deliveryAddress == null || !_deliveryAddress!.hasValidCoordinates)) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('checkout_delivery_address_required'.tr)),
      );
      return;
    }
    if (_scheduledSlot == null) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('checkout_time_required'.tr)));
      return;
    }
    final phoneDigits = _phoneController.text.replaceAll(RegExp(r'\D'), '');
    if (phoneDigits.isNotEmpty && phoneDigits.length < 10) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('checkout_phone_invalid'.tr)));
      return;
    }
    if (_isSubmitting) return;
    setState(() => _isSubmitting = true);
    try {
      final completed = await widget.onSubmit(
        _CheckoutDetails(
          checkoutId: _checkoutId,
          orderType: _orderType,
          paymentMethod: _paymentMethod,
          preorderFulfillmentType: _isPreorder
              ? _preorderFulfillment.wireValue
              : null,
          branch: _usesDelivery ? null : _branch,
          branchId: _usesDelivery ? null : _branchId,
          scheduledAt: _scheduledSlot!.value,
          deliveryAddress: _usesDelivery ? _deliveryAddress : null,
          additionalPhone: _phoneController.text.trim(),
          promoCode: _promoController.text.trim(),
          comment: _commentController.text.trim(),
        ),
      );
      if (mounted && completed) {
        final prefs = await SharedPreferences.getInstance();
        await Future.wait([
          prefs.remove(_draftKey('checkout_scheduled_at')),
          prefs.remove(_draftKey('checkout_phone')),
          prefs.remove(_draftKey('checkout_promo')),
          prefs.remove(_draftKey('checkout_comment')),
          prefs.remove(_draftKey('checkout_preorder_fulfillment')),
        ]);
        if (mounted) Navigator.pop(context, true);
      }
      if (mounted && !completed) {
        setState(() {
          _isSubmitting = false;
          _checkoutId = _newCheckoutId();
        });
      }
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(localizeErrorMessage(error))));
      setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        toolbarHeight: BulkaLayout.appBarHeight(context),
        centerTitle: true,
        backgroundColor: scheme.surface,
        title: _BulkaPageTitle('checkout_title'.tr),
        actions: const [SizedBox(width: BulkaLayout.appBarSideSlot)],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 24, 24, 220),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _SelectedOrderTypeCard(value: _orderType),
            if (_isPreorder) ...[
              const SizedBox(height: 14),
              _PreorderFulfillmentSelector(
                value: _preorderFulfillment,
                onChanged: _setPreorderFulfillment,
              ),
            ],
            if (_usesDelivery &&
                _deliveryAvailabilityChecked &&
                !_deliveryAvailable) ...[
              const SizedBox(height: 10),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.info_outline_rounded,
                    size: 18,
                    color: colors.mutedText,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'checkout_delivery_unavailable'.tr,
                      style: TextStyle(
                        color: colors.mutedText,
                        fontSize: BulkaTypeScale.bodySmall,
                        height: 1.35,
                      ),
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 28),
            if (_usesDelivery) ...[
              _CheckoutLabel('checkout_delivery_address'.tr, required: true),
              const SizedBox(height: 10),
              _CheckoutField(
                label:
                    _deliveryAddress?.displayAddress ??
                    'checkout_select_delivery_address'.tr,
                icon: Icons.location_on_outlined,
                onTap: _isSelectingAddress ? null : _selectDeliveryAddress,
                loading: _isSelectingAddress,
              ),
            ] else ...[
              _CheckoutLabel('checkout_branch'.tr, required: true),
              const SizedBox(height: 10),
              _CheckoutField(
                label: _branch.isEmpty ? 'checkout_select_branch'.tr : _branch,
                icon: Icons.storefront_outlined,
                onTap: _isSelectingBranch ? null : _selectBranch,
                loading: _isSelectingBranch,
              ),
            ],
            const SizedBox(height: 24),
            _CheckoutLabel('checkout_additional_phone'.tr),
            const SizedBox(height: 10),
            TextField(
              controller: _phoneController,
              keyboardType: TextInputType.phone,
              autofillHints: const [AutofillHints.telephoneNumber],
              decoration: const InputDecoration(
                hintText: '+7 700 000 00 00',
                suffixIcon: Icon(Icons.phone_outlined),
              ),
            ),
            const SizedBox(height: 24),
            _CheckoutLabel('checkout_promo'.tr),
            const SizedBox(height: 10),
            SizedBox(
              height: 58,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(
                    child: TextField(
                      controller: _promoController,
                      textCapitalization: TextCapitalization.characters,
                      decoration: InputDecoration(
                        hintText: 'checkout_enter_code'.tr,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  SizedBox(
                    width: 126,
                    child: FilledButton(
                      onPressed:
                          _promoController.text.trim().isEmpty || _isQuoting
                          ? null
                          : _applyPromo,
                      style: FilledButton.styleFrom(
                        backgroundColor: _bulkaYellow,
                        foregroundColor: _textDark,
                        disabledBackgroundColor: _almond.withValues(alpha: 0.5),
                      ),
                      child: _isQuoting
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : FittedBox(
                              fit: BoxFit.scaleDown,
                              child: Text('checkout_apply'.tr, maxLines: 1),
                            ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 26),
            _CheckoutLabel(
              _usesDelivery
                  ? 'checkout_select_delivery_time'.tr
                  : 'checkout_select_pickup_time'.tr,
              required: true,
            ),
            const SizedBox(height: 10),
            if (_isPreorder && _scheduledSlot != null)
              _PreorderScheduleField(
                slot: _scheduledSlot!,
                onTap: _isSelectingTime ? null : _selectScheduledTime,
                loading: _isSelectingTime,
              )
            else
              _CheckoutField(
                label: _scheduledSlot?.label ?? 'checkout_select_time'.tr,
                icon: Icons.calendar_month_outlined,
                onTap: _isSelectingTime ? null : _selectScheduledTime,
                loading: _isSelectingTime,
              ),
            const SizedBox(height: 28),
            _CheckoutLabel('checkout_payment_method'.tr, required: true),
            const SizedBox(height: 12),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                _CheckoutPaymentCard(
                  title: 'Kaspi Pay',
                  subtitle: 'checkout_kaspi_card_hint'.tr,
                  icon: Icons.account_balance_wallet_outlined,
                  available: _kaspiAvailable,
                  selected: _paymentMethod == _CheckoutPaymentMethod.kaspi,
                  onTap: () {
                    if (_kaspiAvailable == true) {
                      setState(
                        () => _paymentMethod = _CheckoutPaymentMethod.kaspi,
                      );
                    } else {
                      unawaited(_loadPaymentAvailability());
                    }
                  },
                ),
                _CheckoutPaymentCard(
                  title: 'ForteBank',
                  subtitle: 'checkout_forte_card_hint'.tr,
                  icon: Icons.credit_card_rounded,
                  available: _forteAvailable,
                  selected: _paymentMethod == _CheckoutPaymentMethod.forte,
                  onTap: () {
                    if (_forteAvailable == true) {
                      setState(
                        () => _paymentMethod = _CheckoutPaymentMethod.forte,
                      );
                    } else {
                      unawaited(_loadPaymentAvailability());
                    }
                  },
                ),
              ],
            ),
            const SizedBox(height: 28),
            _CheckoutLabel('checkout_comment'.tr),
            const SizedBox(height: 10),
            TextField(
              controller: _commentController,
              minLines: 4,
              maxLines: 6,
              decoration: InputDecoration(
                hintText: 'checkout_comment_hint'.tr,
                alignLabelWithHint: true,
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: Container(
        padding: EdgeInsets.fromLTRB(
          24,
          16,
          24,
          16 + BulkaLayout.safeBottomInset(context),
        ),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border(
            top: BorderSide(color: _almond.withValues(alpha: 0.45)),
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_quoteEtaText.isNotEmpty) ...[
              Semantics(
                liveRegion: true,
                label:
                    '${'orders_eta'.tr}: $_quoteEtaText. $_quoteEtaConfidence',
                child: Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    color: _bulkaYellow.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(BulkaRadii.control),
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.schedule_rounded,
                        size: 21,
                        color: _textDark,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _quoteEtaText,
                              style: const TextStyle(
                                fontFamily: _headingFont,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            if (_quoteEtaConfidence.isNotEmpty)
                              Text(
                                _quoteEtaConfidence,
                                style: TextStyle(
                                  fontSize: BulkaTypeScale.caption,
                                  color: _textDark.withValues(alpha: 0.68),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
            _CheckoutTotalRow(
              label: 'checkout_subtotal'.tr,
              value: '${_formatCartMoney(widget.total)} ₸',
            ),
            if (_discount > 0) ...[
              const SizedBox(height: 8),
              _CheckoutTotalRow(
                label: 'checkout_discount'.tr,
                value: '− ${_formatCartMoney(_discount)} ₸',
              ),
            ],
            if (_deliveryFee > 0) ...[
              const SizedBox(height: 8),
              _CheckoutTotalRow(
                label: 'checkout_delivery_fee'.tr,
                value: '${_formatCartMoney(_deliveryFee)} ₸',
              ),
            ],
            const SizedBox(height: 8),
            _CheckoutTotalRow(
              label: 'checkout_total'.tr,
              value:
                  '${_formatCartMoney(_quotedTotal ?? widget.total + _deliveryFee)} ₸',
              emphasized: true,
            ),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: GradientButton(
                onPressed: _isSubmitting || !_selectedPaymentAvailable
                    ? null
                    : _submit,
                loading: _isSubmitting,
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    'cart_checkout'.tr,
                    maxLines: 1,
                    style: const TextStyle(
                      fontFamily: _headingFont,
                      fontSize: BulkaTypeScale.body,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SelectedOrderTypeCard extends StatelessWidget {
  const _SelectedOrderTypeCard({required this.value});

  final _OrderType value;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: '${'checkout_order_type'.tr}: ${value.label}',
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(BulkaRadii.control),
          border: Border.all(color: _almond.withValues(alpha: 0.7)),
        ),
        child: Row(
          children: [
            Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                color: _bulkaYellow.withValues(alpha: 0.22),
                borderRadius: BorderRadius.circular(BulkaRadii.control),
              ),
              child: Icon(value.icon, color: _textDark, size: 25),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'checkout_order_type'.tr,
                    style: TextStyle(
                      color: context.bulkaColors.mutedText,
                      fontSize: BulkaTypeScale.caption,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    value.label,
                    style: const TextStyle(
                      fontFamily: _headingFont,
                      color: _textDark,
                      fontSize: BulkaTypeScale.body,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'checkout_catalog_locked'.tr,
                    style: TextStyle(
                      color: context.bulkaColors.mutedText,
                      fontSize: BulkaTypeScale.caption,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(Icons.check_circle_rounded, color: Color(0xFF2E7D32)),
          ],
        ),
      ),
    );
  }
}

class _PreorderFulfillmentSelector extends StatelessWidget {
  const _PreorderFulfillmentSelector({
    required this.value,
    required this.onChanged,
  });

  final _OrderType value;
  final Future<void> Function(_OrderType value) onChanged;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: 'checkout_preorder_method'.tr,
      child: Row(
        children: [
          for (final type in const [
            _OrderType.delivery,
            _OrderType.pickup,
          ]) ...[
            if (type == _OrderType.pickup) const SizedBox(width: 10),
            Expanded(
              child: InkWell(
                key: ValueKey('preorder-fulfillment-${type.wireValue}'),
                onTap: () => onChanged(type),
                borderRadius: BorderRadius.circular(BulkaRadii.control),
                child: AnimatedContainer(
                  duration: BulkaMotion.duration(context, BulkaMotion.fast),
                  constraints: const BoxConstraints(minHeight: 70),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    gradient: value == type
                        ? const LinearGradient(
                            colors: [Color(0xFFFFE79A), Color(0xFFFFC447)],
                          )
                        : null,
                    color: value == type ? null : Colors.white,
                    borderRadius: BorderRadius.circular(BulkaRadii.control),
                    border: Border.all(
                      color: value == type
                          ? _bulkaYellow
                          : context.bulkaColors.cardBorder,
                    ),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(type.icon, size: 24, color: _textDark),
                      const SizedBox(width: 8),
                      Flexible(
                        child: Text(
                          type.label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontFamily: _headingFont,
                            fontSize: BulkaTypeScale.body,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _PreorderScheduleField extends StatelessWidget {
  const _PreorderScheduleField({
    required this.slot,
    required this.onTap,
    this.loading = false,
  });

  final _PickupSlot slot;
  final VoidCallback? onTap;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final local = slot.startsAt.toLocal();
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final day = DateTime(local.year, local.month, local.day);
    final offset = day.difference(today).inDays;
    final relative = offset == 0
        ? 'checkout_today'.tr
        : offset == 1
        ? 'checkout_tomorrow'.tr
        : MaterialLocalizations.of(context).formatShortDate(local);
    final exact =
        '${formatUiDate(context, local)}, ${formatUiTime(context, local)}';
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 70),
          child: Ink(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFFFFDA64), Color(0xFFFFB312)],
              ),
              borderRadius: BorderRadius.circular(BulkaRadii.card),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    relative,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontFamily: _headingFont,
                      color: Colors.white,
                      fontSize: BulkaTypeScale.body,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.82),
                    borderRadius: BorderRadius.circular(BulkaRadii.control),
                  ),
                  child: Text(
                    exact,
                    style: TextStyle(
                      fontFamily: _headingFont,
                      color: _textDark.withValues(alpha: 0.58),
                      fontSize: BulkaTypeScale.bodySmall,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                if (loading)
                  const SizedBox(
                    key: ValueKey('checkout-time-loading'),
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.4,
                      color: Colors.white,
                    ),
                  )
                else
                  const Icon(
                    Icons.calendar_month_outlined,
                    color: Colors.white,
                    size: 27,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PreorderCalendarSheet extends StatefulWidget {
  const _PreorderCalendarSheet({required this.slots, this.selected});

  final List<_PickupSlot> slots;
  final DateTime? selected;

  @override
  State<_PreorderCalendarSheet> createState() => _PreorderCalendarSheetState();
}

class _PreorderCalendarSheetState extends State<_PreorderCalendarSheet> {
  late final List<DateTime> _days;
  late DateTime _selected;

  DateTime _day(DateTime value) {
    final local = value.toLocal();
    return DateTime(local.year, local.month, local.day);
  }

  @override
  void initState() {
    super.initState();
    _days = widget.slots.map((slot) => _day(slot.startsAt)).toSet().toList()
      ..sort();
    final requested = widget.selected == null ? null : _day(widget.selected!);
    _selected = requested != null && _days.contains(requested)
        ? requested
        : _days.first;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final available = _days.toSet();
    return Container(
      height: min(MediaQuery.sizeOf(context).height * 0.82, 700),
      padding: EdgeInsets.fromLTRB(
        20,
        10,
        20,
        18 + BulkaLayout.safeBottomInset(context),
      ),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(BulkaRadii.sheet),
        ),
      ),
      child: Column(
        children: [
          Container(
            width: 44,
            height: 5,
            decoration: BoxDecoration(
              color: _almond,
              borderRadius: BorderRadius.circular(BulkaRadii.small),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: Text(
                  'checkout_choose_date'.tr,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontFamily: _headingFont,
                    fontSize: BulkaTypeScale.title,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              IconButton(
                onPressed: () => Navigator.pop(context),
                tooltip: 'close_tooltip'.tr,
                icon: const Icon(Icons.close_rounded),
                style: IconButton.styleFrom(
                  backgroundColor: _almond.withValues(alpha: 0.65),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Expanded(
            child: Theme(
              data: theme.copyWith(
                colorScheme: theme.colorScheme.copyWith(
                  primary: const Color(0xFFD2A347),
                  onPrimary: Colors.white,
                  surface: Colors.white,
                ),
                datePickerTheme: const DatePickerThemeData(
                  backgroundColor: Colors.white,
                  surfaceTintColor: Colors.transparent,
                  headerBackgroundColor: Colors.white,
                  dividerColor: Colors.transparent,
                ),
              ),
              child: CalendarDatePicker(
                initialDate: _selected,
                firstDate: _days.first,
                lastDate: _days.last,
                currentDate: DateTime.now(),
                selectableDayPredicate: available.contains,
                onDateChanged: (value) => setState(() => _selected = value),
              ),
            ),
          ),
          const Divider(height: 1),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: GradientButton(
              onPressed: () => Navigator.pop(context, _selected),
              child: Text(
                'continue_btn'.tr,
                style: const TextStyle(
                  fontFamily: _headingFont,
                  color: Colors.white,
                  fontSize: BulkaTypeScale.body,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CheckoutTimeSheet extends StatefulWidget {
  const _CheckoutTimeSheet({required this.slots, this.selectedValue});

  final List<_PickupSlot> slots;
  final String? selectedValue;

  @override
  State<_CheckoutTimeSheet> createState() => _CheckoutTimeSheetState();
}

class _CheckoutTimeSheetState extends State<_CheckoutTimeSheet> {
  late int _index;
  late final FixedExtentScrollController _controller;

  @override
  void initState() {
    super.initState();
    final selected = widget.slots.indexWhere(
      (slot) => slot.value == widget.selectedValue,
    );
    _index = selected < 0 ? 0 : selected;
    _controller = FixedExtentScrollController(initialItem: _index);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: min(MediaQuery.sizeOf(context).height * 0.68, 570),
      padding: EdgeInsets.fromLTRB(
        16,
        12,
        16,
        18 + BulkaLayout.safeBottomInset(context),
      ),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(BulkaRadii.sheet),
        ),
      ),
      child: Column(
        children: [
          Container(
            width: 44,
            height: 5,
            decoration: BoxDecoration(
              color: _almond,
              borderRadius: BorderRadius.circular(BulkaRadii.small),
            ),
          ),
          const SizedBox(height: 18),
          Text(
            'checkout_choose_time'.tr,
            style: const TextStyle(
              fontFamily: _headingFont,
              fontSize: BulkaTypeScale.title,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 14),
          Expanded(
            child: ListWheelScrollView.useDelegate(
              controller: _controller,
              itemExtent: 64,
              diameterRatio: 2.4,
              perspective: 0.002,
              physics: const FixedExtentScrollPhysics(),
              onSelectedItemChanged: (index) => setState(() => _index = index),
              childDelegate: ListWheelChildBuilderDelegate(
                childCount: widget.slots.length,
                builder: (context, index) {
                  final selected = index == _index;
                  final slot = widget.slots[index];
                  final start = slot.startsAt.toLocal();
                  final end = slot.endsAt.toLocal();
                  return AnimatedContainer(
                    duration: BulkaMotion.duration(context, BulkaMotion.fast),
                    alignment: Alignment.center,
                    margin: const EdgeInsets.symmetric(horizontal: 4),
                    decoration: BoxDecoration(
                      color: selected
                          ? const Color(0xFFF2F2F4)
                          : Colors.transparent,
                      borderRadius: BorderRadius.circular(BulkaRadii.control),
                    ),
                    child: Text(
                      '${formatUiTime(context, start)}–${formatUiTime(context, end)}',
                      style: TextStyle(
                        color: selected
                            ? _textDark
                            : _textDark.withValues(alpha: 0.28),
                        fontSize: selected ? 20 : 17,
                        fontWeight: selected
                            ? FontWeight.w700
                            : FontWeight.w500,
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
          const Divider(height: 1),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: GradientButton(
              onPressed: () => Navigator.pop(context, widget.slots[_index]),
              child: Text(
                'continue_btn'.tr,
                style: const TextStyle(
                  fontFamily: _headingFont,
                  color: Colors.white,
                  fontSize: BulkaTypeScale.body,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CheckoutLabel extends StatelessWidget {
  const _CheckoutLabel(this.text, {this.required = false});

  final String text;
  final bool required;

  @override
  Widget build(BuildContext context) {
    return Text.rich(
      TextSpan(
        text: text,
        children: [
          if (required)
            const TextSpan(
              text: ' *',
              style: TextStyle(color: _errorRed, fontFamily: _descriptionFont),
            ),
        ],
      ),
      style: const TextStyle(
        fontFamily: _headingFont,
        fontSize: BulkaTypeScale.body,
        fontWeight: FontWeight.w700,
      ),
    );
  }
}

class _CheckoutField extends StatelessWidget {
  const _CheckoutField({
    required this.label,
    required this.icon,
    required this.onTap,
    this.loading = false,
  });

  final String label;
  final IconData icon;
  final VoidCallback? onTap;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(BulkaRadii.control),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 62),
          child: Ink(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(BulkaRadii.control),
              border: Border.all(color: context.bulkaColors.cardBorder),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    label,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: BulkaTypeScale.body),
                  ),
                ),
                const SizedBox(width: 12),
                if (loading)
                  const SizedBox(
                    key: ValueKey('checkout-field-loading'),
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.2),
                  )
                else
                  Icon(icon, color: _textDark.withValues(alpha: 0.72)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CheckoutTotalRow extends StatelessWidget {
  const _CheckoutTotalRow({
    required this.label,
    required this.value,
    this.emphasized = false,
  });

  final String label;
  final String value;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final style = TextStyle(
      fontSize: emphasized ? 18 : 16,
      fontWeight: emphasized ? FontWeight.w700 : FontWeight.w500,
    );
    return Row(
      children: [
        Expanded(child: Text(label, maxLines: 1, style: style)),
        const SizedBox(width: 12),
        Text(value, maxLines: 1, style: style),
      ],
    );
  }
}

class BalanceHistoryScreen extends StatelessWidget {
  const BalanceHistoryScreen({
    required this.transactions,
    this.onExplore,
    super.key,
  });

  final List<BonusTransaction> transactions;
  final VoidCallback? onExplore;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: BulkaLayout.appBarHeight(context),
        title: _BulkaPageTitle('balance_history_title'.tr),
        actions: const [SizedBox(width: BulkaLayout.appBarSideSlot)],
      ),
      body: transactions.isEmpty
          ? Center(
              child: Container(
                margin: const EdgeInsets.all(24),
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: _cream,
                  borderRadius: BorderRadius.circular(BulkaRadii.card),
                  boxShadow: _softShadow,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.receipt_long_rounded,
                      color: _caramel,
                      size: 38,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'orders_empty_title'.tr,
                      style: const TextStyle(
                        color: _textDark,
                        fontFamily: _headingFont,
                        fontSize: BulkaTypeScale.titleSmall,
                        fontWeight: FontWeight.w400,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'orders_empty_sub'.tr,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: _textDark.withValues(alpha: 0.58),
                        fontSize: BulkaTypeScale.bodySmall,
                      ),
                    ),
                    if (onExplore != null) ...[
                      const SizedBox(height: 18),
                      SizedBox(
                        width: double.infinity,
                        child: GradientButton(
                          onPressed: onExplore,
                          child: Text('orders_empty_action'.tr),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            )
          : ListView.separated(
              padding: EdgeInsets.fromLTRB(
                16,
                8,
                16,
                BulkaLayout.bottomNavContentInset(context),
              ),
              itemBuilder: (_, index) =>
                  TransactionCard(transaction: transactions[index]),
              separatorBuilder: (_, _) => const SizedBox(height: 12),
              itemCount: transactions.length,
            ),
    );
  }
}

class TransactionCard extends StatelessWidget {
  const TransactionCard({required this.transaction, super.key});

  final BonusTransaction transaction;

  void _showReceiptDetails(BuildContext context) {
    if (transaction.items == null || transaction.items!.isEmpty) return;

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) {
        return Container(
          decoration: const BoxDecoration(
            color: _cream,
            borderRadius: BorderRadius.vertical(
              top: Radius.circular(BulkaRadii.card),
            ),
          ),
          padding: const EdgeInsets.all(24),
          constraints: BoxConstraints(
            maxHeight: MediaQuery.of(context).size.height * 0.8,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: _almond,
                    borderRadius: BorderRadius.circular(BulkaRadii.small),
                  ),
                ),
              ),
              const SizedBox(height: 24),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'order_details'.tr,
                      style: const TextStyle(
                        color: _textDark,
                        fontFamily: _headingFont,
                        fontSize: BulkaTypeScale.title,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    tooltip: 'close_tooltip'.tr,
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Expanded(
                child: ListView.separated(
                  itemCount: transaction.items!.length,
                  separatorBuilder: (_, _) =>
                      Divider(color: _almond.withValues(alpha: 0.3)),
                  itemBuilder: (context, index) {
                    final item = _asMap(transaction.items![index]);
                    final name = _asString(
                      item['name'],
                      fallback: 'product_fallback'.tr,
                    );
                    final qty = item['amount'] ?? item['quantity'] ?? 1;
                    final price = item['sum'] ?? item['price'] ?? 0;
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text(
                              '$name x$qty',
                              style: const TextStyle(
                                color: _textDark,
                                fontSize: BulkaTypeScale.body,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            '${formatMoney(double.tryParse(price.toString()) ?? 0)} ₸',
                            style: const TextStyle(
                              color: _textDark,
                              fontSize: BulkaTypeScale.body,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final earning = transaction.isEarning;
    final color = earning ? _successGreen : _errorRed;
    final prefix = earning ? '+' : '-';
    final hasItems = transaction.items != null && transaction.items!.isNotEmpty;

    return Card(
      color: _cream,
      elevation: 0,
      shadowColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        side: BorderSide(color: _almond.withValues(alpha: 0.45)),
      ),
      child: InkWell(
        onTap: hasItems ? () => _showReceiptDetails(context) : null,
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 34,
                          height: 34,
                          decoration: BoxDecoration(
                            color: color.withValues(alpha: 0.12),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            earning
                                ? Icons.keyboard_arrow_up_rounded
                                : Icons.keyboard_arrow_down_rounded,
                            color: color,
                            size: 22,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            localizeTransactionType(
                              transaction.type,
                              isEarning: transaction.isEarning,
                            ),
                            style: const TextStyle(
                              color: _textDark,
                              fontFamily: _headingFont,
                              fontSize: BulkaTypeScale.body,
                              fontWeight: FontWeight.w400,
                            ),
                          ),
                        ),
                        Text(
                          '$prefix${formatMoney(transaction.amount)} ₸',
                          style: TextStyle(
                            fontFamily: _headingFont,
                            color: color,
                            fontSize: BulkaTypeScale.body,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                    if ((transaction.orderTotal ?? 0) > 0) ...[
                      const SizedBox(height: 8),
                      Text(
                        '${'check_sum'.tr}: ${formatMoney(transaction.orderTotal!)} ₸',
                        style: TextStyle(
                          color: _textDark.withValues(alpha: 0.7),
                          fontSize: BulkaTypeScale.bodySmall,
                        ),
                      ),
                    ],
                    const SizedBox(height: 4),
                    Text(
                      formatDateTime(transaction.timestamp),
                      style: TextStyle(
                        color: _textDark.withValues(alpha: 0.5),
                        fontSize: BulkaTypeScale.caption,
                      ),
                    ),
                  ],
                ),
              ),
              if (hasItems) ...[
                const SizedBox(width: 8),
                Icon(
                  Icons.chevron_right_rounded,
                  color: _textDark.withValues(alpha: 0.3),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
