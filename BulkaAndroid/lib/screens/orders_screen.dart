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
    super.key,
  });

  final BulkaApiClient api;
  final Customer customer;
  final List<BonusTransaction> transactions;
  final VoidCallback? onExplore;

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
          'success'.tr,
          style: const TextStyle(fontFamily: _headingFont),
        ),
        content: Text(
          'Ваш заказ успешно оформлен!',
          style: const TextStyle(fontSize: 16),
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
                color: _bulkaYellow,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<Map<String, dynamic>> _paymentItems(CartProvider cart) => cart
      .items
      .values
      .map((item) => {'id': item.id, 'quantity': item.quantity})
      .toList();

  Future<bool> _createOrder(CartProvider cart, _CheckoutDetails details) async {
    if (cart.items.isEmpty) return false;
    final items = cart.items.values
        .map((item) => {'id': item.id, 'quantity': item.quantity})
        .toList();
    final result = await widget.api.createKaspiPayment(
      cartItems: items,
      orderType: details.orderType.wireValue,
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
      throw ApiException('Kaspi не вернул номер операции');
    }
    if (!mounted) return false;
    final paid = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => KaspiPaymentScreen(
          api: widget.api,
          operationId: operationId,
          qrToken: result['qrToken']?.toString(),
        ),
      ),
    );
    if (paid == true) cart.clear();
    return paid == true;
  }

  Future<void> _openCheckout(BuildContext context, CartProvider cart) async {
    if (cart.items.isEmpty || _checkoutOpen) return;
    _checkoutOpen = true;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('lastAppScreen', 'checkout');
    bool? completed;
    try {
      if (!context.mounted) return;
      completed = await Navigator.of(context).push<bool>(
        MaterialPageRoute(
          settings: const RouteSettings(name: 'checkout'),
          builder: (_) => _CheckoutScreen(
            customer: widget.customer,
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
      builder: (dialogContext) => AlertDialog(
        title: Text('cart_clear_title'.tr),
        content: Text('cart_clear_body'.tr),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text('cancel_btn'.tr),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            style: TextButton.styleFrom(foregroundColor: _errorRed),
            child: Text('cart_clear'.tr),
          ),
        ],
      ),
    );
    if (shouldClear == true) cart.clear();
  }

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartProvider>();
    final colors = context.bulkaColors;

    return Scaffold(
      backgroundColor: colors.surfaceCream,
      appBar: AppBar(
        automaticallyImplyLeading: false,
        centerTitle: true,
        backgroundColor: Colors.white,
        title: Text(
          'nav_cart'.tr,
          style: const TextStyle(
            fontFamily: _headingFont,
            fontSize: 27,
            fontWeight: FontWeight.w400,
          ),
        ),
        actions: [
          if (cart.items.isNotEmpty)
            IconButton(
              onPressed: () => _confirmClear(context, cart),
              tooltip: 'cart_clear'.tr,
              icon: const Icon(Icons.delete_outline_rounded),
            ),
          const SizedBox(width: 8),
        ],
      ),
      body: cart.items.isEmpty
          ? _buildEmptyState(context)
          : _buildCartItems(context, cart),
    );
  }

  Widget _buildEmptyState(BuildContext context) {
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
                color: _lightCardHighlight,
                shape: BoxShape.circle,
                border: Border.all(color: _almond),
              ),
              child: const Icon(
                Icons.shopping_bag_outlined,
                size: 58,
                color: _textDark,
              ),
            ),
            const SizedBox(height: 24),
            Text(
              'cart_empty_title'.tr,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: _textDark,
                fontFamily: _headingFont,
                fontSize: 30,
                fontWeight: FontWeight.w400,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'cart_empty_sub'.tr,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: _textDark.withValues(alpha: 0.66),
                fontSize: 17,
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
                    fontSize: 16,
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
                onDecrease: () => cart.setQuantity(item.id, item.quantity - 1),
                onIncrease: item.isStopListed
                    ? null
                    : () => cart.setQuantity(item.id, item.quantity + 1),
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
            cashbackPercent: widget.customer.cashbackPercent,
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
    final textScale = MediaQuery.textScalerOf(context).scale(1);
    final compact = MediaQuery.sizeOf(context).width < 360;
    final cardHeight =
        138.0 + ((textScale - 1).clamp(0.0, 1.0) * 40) + (compact ? 4.0 : 0.0);
    return Container(
      height: cardHeight,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
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
                    style: const TextStyle(
                      color: _textDark,
                      fontSize: 16,
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
                      fontSize: 12,
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
                          style: const TextStyle(
                            color: _textDark,
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
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
        borderRadius: BorderRadius.circular(15),
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
                  color: _textDark,
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
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
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(24, 18, 24, 20),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: _almond.withValues(alpha: 0.45))),
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
                      fontSize: 13,
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
                  style: TextStyle(fontSize: 15),
                ),
              ),
              const SizedBox(width: 12),
              Text(
                '+ ${(total * cashbackPercent / 100).round()} ${'cart_points'.tr}',
                style: TextStyle(
                  color: _textDark.withValues(alpha: 0.72),
                  fontSize: 15,
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
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                ),
              ),
              const SizedBox(width: 12),
              Text(
                '${_formatCartMoney(total)} ₸',
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
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
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CheckoutDetails {
  const _CheckoutDetails({
    required this.checkoutId,
    required this.orderType,
    required this.scheduledAt,
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
  final String? branch;
  final String? branchId;
  final DeliveryAddress? deliveryAddress;
  final String? additionalPhone;
  final String? promoCode;
  final String? comment;
}

class _PickupSlot {
  const _PickupSlot({required this.label, required this.value});
  final String label;
  final String value;
}

class _CheckoutScreen extends StatefulWidget {
  const _CheckoutScreen({
    required this.customer,
    required this.api,
    required this.total,
    required this.cartItems,
    required this.onSubmit,
  });

  final Customer customer;
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
  String _branch = '';
  String? _branchId;
  DeliveryAddress? _deliveryAddress;
  _PickupSlot? _scheduledSlot;
  List<BakeryLocation> _locations = const [];
  bool _deliveryAvailable = false;
  bool _deliveryAvailabilityChecked = false;
  bool _isSubmitting = false;
  bool _isQuoting = false;
  int _discount = 0;
  int _deliveryFee = 0;
  int? _quotedTotal;
  int _quoteRevision = 0;
  String _checkoutId = _newCheckoutId();

  @override
  void initState() {
    super.initState();
    _phoneController = TextEditingController();
    _promoController.addListener(_refreshPromoButton);
    _phoneController.addListener(_saveDraft);
    _promoController.addListener(_saveDraft);
    _commentController.addListener(_saveDraft);
    unawaited(_loadCheckoutPreferences());
  }

  Future<void> _loadCheckoutPreferences() async {
    final prefs = await SharedPreferences.getInstance();
    final savedBranch = prefs.getString('selected_bakery_location') ?? '';
    final savedType = _orderTypeFromWire(
      prefs.getString('selected_order_type'),
    );
    DeliveryAddress? address;
    try {
      address = await AddressRepository(api: widget.api).loadSelectedAddress();
    } catch (_) {
      address = null;
    }
    List<BakeryLocation> locations = const [];
    try {
      locations = await widget.api.getFulfillmentLocations();
    } catch (_) {
      // Checkout remains usable for pickup while branch availability retries.
    }
    final savedScheduledAt = prefs.getString('checkout_scheduled_at');
    final parsedScheduledAt = DateTime.tryParse(savedScheduledAt ?? '');
    final savedSlot =
        parsedScheduledAt != null && parsedScheduledAt.isAfter(DateTime.now())
        ? _slotFromDate(parsedScheduledAt)
        : null;
    if (!mounted) return;
    _phoneController.text = prefs.getString('checkout_phone') ?? '';
    _promoController.text = prefs.getString('checkout_promo') ?? '';
    _commentController.text = prefs.getString('checkout_comment') ?? '';
    setState(() {
      _branch = savedBranch;
      _branchId = prefs.getString('selected_bakery_location_id');
      _orderType = savedType;
      _deliveryAddress = address;
      _scheduledSlot = savedSlot;
      _locations = locations;
      _deliveryAvailable = locations.any(
        (location) => location.active && location.deliveryEnabled,
      );
      _deliveryAvailabilityChecked = true;
      if (_orderType == _OrderType.delivery && !_deliveryAvailable) {
        _orderType = _OrderType.pickup;
      }
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
      });
    }
  }

  _PickupSlot _slotFromDate(DateTime date) {
    final local = date.toLocal();
    final end = local.add(const Duration(hours: 1));
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final slotDay = DateTime(local.year, local.month, local.day);
    final offset = slotDay.difference(today).inDays;
    final dayLabel = offset == 0
        ? 'checkout_today'.tr
        : offset == 1
        ? 'checkout_tomorrow'.tr
        : '${local.day.toString().padLeft(2, '0')}.${local.month.toString().padLeft(2, '0')}';
    return _PickupSlot(
      label:
          '$dayLabel, ${local.hour.toString().padLeft(2, '0')}:00–${end.hour.toString().padLeft(2, '0')}:00',
      value: local.toUtc().toIso8601String(),
    );
  }

  void _saveDraft() {
    unawaited(_persistDraft());
  }

  Future<void> _persistDraft() async {
    final prefs = await SharedPreferences.getInstance();
    await Future.wait([
      prefs.setString('selected_order_type', _orderType.wireValue),
      prefs.setString('checkout_phone', _phoneController.text),
      prefs.setString('checkout_promo', _promoController.text),
      prefs.setString('checkout_comment', _commentController.text),
      if (_scheduledSlot == null)
        prefs.remove('checkout_scheduled_at')
      else
        prefs.setString('checkout_scheduled_at', _scheduledSlot!.value),
    ]);
  }

  Future<void> _setOrderType(_OrderType value) async {
    if (value == _orderType) return;
    if (value == _OrderType.delivery && !_deliveryAvailable) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('checkout_delivery_unavailable'.tr)),
      );
      return;
    }
    final selectedLocation = _selectedBranchLocation;
    final clearBranch =
        value != _OrderType.delivery &&
        selectedLocation != null &&
        !selectedLocation.supports(value.wireValue);
    BulkaMotion.selection();
    _quoteRevision++;
    setState(() {
      _orderType = value;
      if (clearBranch) {
        _branch = '';
        _branchId = null;
      }
      _scheduledSlot = null;
      _discount = 0;
      _deliveryFee = 0;
      _isQuoting = false;
      _quotedTotal = null;
    });
    if (clearBranch) {
      final prefs = await SharedPreferences.getInstance();
      await Future.wait([
        prefs.remove('selected_bakery_location'),
        prefs.remove('selected_bakery_location_id'),
      ]);
    }
    await _persistDraft();
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
    const radius = 6371.0;
    double radians(double degrees) => degrees * pi / 180;
    final latitudeDelta = radians(address.location.latitude - latitude);
    final longitudeDelta = radians(address.location.longitude - longitude);
    final value =
        pow(sin(latitudeDelta / 2), 2) +
        cos(radians(latitude)) *
            cos(radians(address.location.latitude)) *
            pow(sin(longitudeDelta / 2), 2);
    return radius * 2 * atan2(sqrt(value), sqrt(1 - value));
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
                  location.deliveryRadiusKm != null &&
                  location.deliveryRadiusKm! > 0 &&
                  _distanceToAddressKm(location, address) <=
                      location.deliveryRadiusKm!,
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

  BakeryLocation? get _effectiveLocation => _orderType == _OrderType.delivery
      ? _deliveryBranchLocation
      : _selectedBranchLocation;

  int? _clockMinutes(Object? value) {
    final match = RegExp(r'^(\d{2}):(\d{2})$').firstMatch('$value');
    if (match == null) return null;
    final hour = int.parse(match.group(1)!);
    final minute = int.parse(match.group(2)!);
    if (hour > 24 || minute > 59 || (hour == 24 && minute != 0)) return null;
    return hour * 60 + minute;
  }

  ({int open, int close})? _scheduleFor(BakeryLocation location, DateTime day) {
    const dayNames = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    final raw =
        location.hours[dayNames[day.weekday - 1]] ?? location.hours['daily'];
    final schedule = _asMap(raw);
    if (schedule.isEmpty || schedule['closed'] == true) return null;
    final open = _clockMinutes(schedule['open']);
    final close = _clockMinutes(schedule['close']);
    if (open == null || close == null || open >= close) return null;
    return (open: open, close: close);
  }

  List<_PickupSlot> _buildTimeSlots() {
    final now = DateTime.now();
    final leadMinutes = switch (_orderType) {
      _OrderType.preorder => 120,
      _OrderType.delivery => 60,
      _OrderType.pickup => 30,
    };
    final minimum = now.add(Duration(minutes: leadMinutes));
    final result = <_PickupSlot>[];
    final location = _effectiveLocation;
    if (location == null) return result;
    final days = _orderType == _OrderType.preorder ? 7 : 3;
    final maximumSlots = _orderType == _OrderType.preorder ? 36 : 24;
    for (
      var dayOffset = 0;
      dayOffset < days && result.length < maximumSlots;
      dayOffset++
    ) {
      final day = DateTime(now.year, now.month, now.day + dayOffset);
      final schedule = _scheduleFor(location, day);
      if (schedule == null) continue;
      final firstMinute = ((schedule.open + 59) ~/ 60) * 60;
      for (
        var minute = firstMinute;
        minute + 60 <= schedule.close && result.length < maximumSlots;
        minute += 60
      ) {
        final start = DateTime(
          day.year,
          day.month,
          day.day,
        ).add(Duration(minutes: minute));
        if (start.isBefore(minimum)) continue;
        result.add(_slotFromDate(start));
      }
    }
    return result;
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
    final selected = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => LocationsScreen(orderType: _orderType.wireValue),
      ),
    );
    if (!mounted || selected == null || selected.trim().isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('selected_bakery_location', selected);
    if (mounted) {
      _quoteRevision++;
      setState(() {
        _branch = selected;
        _branchId = prefs.getString('selected_bakery_location_id');
        _scheduledSlot = null;
        _deliveryFee = 0;
        _isQuoting = false;
        _quotedTotal = null;
      });
      await _persistDraft();
    }
  }

  Future<void> _selectDeliveryAddress() async {
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
    });
    await _persistDraft();
  }

  Future<void> _selectScheduledTime() async {
    if (_orderType != _OrderType.delivery && _branch.trim().isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('checkout_branch_required'.tr)));
      return;
    }
    if (_orderType == _OrderType.delivery && _deliveryAddress == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('checkout_delivery_address_required'.tr)),
      );
      return;
    }
    if (_orderType == _OrderType.delivery && _deliveryBranchLocation == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('checkout_delivery_outside_zone'.tr)),
      );
      return;
    }
    final timeSlots = _buildTimeSlots();
    if (timeSlots.isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('checkout_no_time_slots'.tr)));
      return;
    }
    final selected = await showModalBottomSheet<_PickupSlot>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => Container(
        height: min(MediaQuery.sizeOf(sheetContext).height * 0.72, 620),
        padding: EdgeInsets.fromLTRB(
          16,
          12,
          16,
          20 + BulkaLayout.safeBottomInset(sheetContext),
        ),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
        ),
        child: Column(
          children: [
            Container(
              width: 44,
              height: 5,
              decoration: BoxDecoration(
                color: _almond,
                borderRadius: BorderRadius.circular(3),
              ),
            ),
            const SizedBox(height: 18),
            Text(
              'checkout_select_time'.tr,
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 18),
            Expanded(
              child: ListView.separated(
                itemCount: timeSlots.length,
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (context, index) {
                  final slot = timeSlots[index];
                  final isSelected = slot.value == _scheduledSlot?.value;
                  return ListTile(
                    onTap: () => Navigator.pop(sheetContext, slot),
                    selected: isSelected,
                    selectedTileColor: _lightCardHighlight,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                    title: Text(
                      slot.label,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: isSelected
                            ? _textDark
                            : _textDark.withValues(alpha: 0.72),
                        fontSize: 18,
                        fontWeight: isSelected
                            ? FontWeight.w800
                            : FontWeight.w500,
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
    if (mounted && selected != null) {
      setState(() => _scheduledSlot = selected);
      await _persistDraft();
      await _refreshQuote();
    }
  }

  bool get _canQuote =>
      _scheduledSlot != null &&
      (_orderType == _OrderType.delivery
          ? _deliveryAddress != null && _deliveryBranchLocation != null
          : _branch.trim().isNotEmpty);

  Future<void> _refreshQuote({bool showFeedback = false}) async {
    if (!_canQuote) return;
    if (_isQuoting) return;
    final revision = ++_quoteRevision;
    setState(() => _isQuoting = true);
    try {
      final quote = await widget.api.quoteKaspiOrder(
        cartItems: widget.cartItems,
        orderType: _orderType.wireValue,
        branch: _orderType == _OrderType.delivery ? null : _branch,
        branchId: _orderType == _OrderType.delivery ? null : _branchId,
        scheduledAt: _scheduledSlot?.value,
        deliveryAddress: _orderType == _OrderType.delivery
            ? _deliveryAddress
            : null,
        promoCode: _promoController.text.trim(),
      );
      if (!mounted || revision != _quoteRevision) return;
      setState(() {
        _discount = (quote['discount'] as num?)?.round() ?? 0;
        _deliveryFee = (quote['deliveryFee'] as num?)?.round() ?? 0;
        _quotedTotal = (quote['total'] as num?)?.round();
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
        ).showSnackBar(SnackBar(content: Text(error.toString())));
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
    if (_orderType != _OrderType.delivery && _branch.trim().isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('checkout_branch_required'.tr)));
      return;
    }
    if (_orderType == _OrderType.delivery &&
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
          branch: _orderType == _OrderType.delivery ? null : _branch,
          branchId: _orderType == _OrderType.delivery ? null : _branchId,
          scheduledAt: _scheduledSlot!.value,
          deliveryAddress: _orderType == _OrderType.delivery
              ? _deliveryAddress
              : null,
          additionalPhone: _phoneController.text.trim(),
          promoCode: _promoController.text.trim(),
          comment: _commentController.text.trim(),
        ),
      );
      if (mounted && completed) {
        final prefs = await SharedPreferences.getInstance();
        await Future.wait([
          prefs.remove('checkout_scheduled_at'),
          prefs.remove('checkout_phone'),
          prefs.remove('checkout_promo'),
          prefs.remove('checkout_comment'),
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
      ).showSnackBar(SnackBar(content: Text(error.toString())));
      setState(() => _isSubmitting = false);
    }
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
          'checkout_title'.tr,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 24, 24, 220),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _OrderTypeSelector(
              value: _orderType,
              enabledTypes: {
                _OrderType.pickup,
                _OrderType.preorder,
                if (_deliveryAvailable) _OrderType.delivery,
              },
              onChanged: _isSubmitting ? null : _setOrderType,
            ),
            if (_deliveryAvailabilityChecked && !_deliveryAvailable) ...[
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
                        fontSize: 13,
                        height: 1.35,
                      ),
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 28),
            if (_orderType == _OrderType.delivery) ...[
              _CheckoutLabel('checkout_delivery_address'.tr, required: true),
              const SizedBox(height: 10),
              _CheckoutField(
                label:
                    _deliveryAddress?.displayAddress ??
                    'checkout_select_delivery_address'.tr,
                icon: Icons.location_on_outlined,
                onTap: _selectDeliveryAddress,
              ),
            ] else ...[
              _CheckoutLabel('checkout_branch'.tr, required: true),
              const SizedBox(height: 10),
              _CheckoutField(
                label: _branch.isEmpty ? 'checkout_select_branch'.tr : _branch,
                icon: Icons.storefront_outlined,
                onTap: _selectBranch,
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
              _orderType == _OrderType.delivery
                  ? 'checkout_select_delivery_time'.tr
                  : _orderType == _OrderType.preorder
                  ? 'checkout_select_preorder_time'.tr
                  : 'checkout_select_pickup_time'.tr,
              required: true,
            ),
            const SizedBox(height: 10),
            _CheckoutField(
              label: _scheduledSlot?.label ?? 'checkout_select_time'.tr,
              icon: Icons.schedule_rounded,
              onTap: _selectScheduledTime,
            ),
            const SizedBox(height: 28),
            _CheckoutLabel('checkout_payment_method'.tr, required: true),
            const SizedBox(height: 12),
            Container(
              width: 152,
              height: 94,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: _bulkaYellow, width: 1.5),
              ),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Icon(Icons.credit_card_rounded, color: _textDark),
                  Text('Kaspi', style: TextStyle(fontWeight: FontWeight.w700)),
                ],
              ),
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
                onPressed: _isSubmitting ? null : _submit,
                loading: _isSubmitting,
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    'cart_checkout'.tr,
                    maxLines: 1,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
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

class _OrderTypeSelector extends StatelessWidget {
  const _OrderTypeSelector({
    required this.value,
    required this.enabledTypes,
    required this.onChanged,
  });

  final _OrderType value;
  final Set<_OrderType> enabledTypes;
  final ValueChanged<_OrderType>? onChanged;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: 'checkout_order_type'.tr,
      child: Container(
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: _almond.withValues(alpha: 0.7)),
        ),
        child: Row(
          children: [
            for (final type in _OrderType.values)
              Expanded(
                child: Semantics(
                  selected: type == value,
                  enabled: enabledTypes.contains(type),
                  button: true,
                  child: Material(
                    color: type == value ? _bulkaYellow : Colors.transparent,
                    borderRadius: BorderRadius.circular(18),
                    child: InkWell(
                      onTap: onChanged == null || !enabledTypes.contains(type)
                          ? null
                          : () => onChanged!(type),
                      borderRadius: BorderRadius.circular(18),
                      child: SizedBox(
                        height: 62,
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              type.icon,
                              size: 21,
                              color: enabledTypes.contains(type)
                                  ? _textDark
                                  : _textDark.withValues(alpha: 0.32),
                            ),
                            const SizedBox(height: 3),
                            FittedBox(
                              fit: BoxFit.scaleDown,
                              child: Text(
                                type.label,
                                maxLines: 1,
                                style: TextStyle(
                                  color: enabledTypes.contains(type)
                                      ? _textDark
                                      : _textDark.withValues(alpha: 0.32),
                                  fontSize: 13,
                                  fontWeight: type == value
                                      ? FontWeight.w800
                                      : FontWeight.w600,
                                ),
                              ),
                            ),
                          ],
                        ),
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
              text: '*',
              style: TextStyle(color: _errorRed),
            ),
        ],
      ),
      style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
    );
  }
}

class _CheckoutField extends StatelessWidget {
  const _CheckoutField({
    required this.label,
    required this.icon,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 62),
          child: Ink(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: context.bulkaColors.cardBorder),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    label,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 16),
                  ),
                ),
                const SizedBox(width: 12),
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
      fontWeight: emphasized ? FontWeight.w900 : FontWeight.w500,
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
        title: Text(
          'balance_history_title'.tr,
          style: const TextStyle(
            fontFamily: _headingFont,
            fontWeight: FontWeight.w400,
          ),
        ),
      ),
      body: transactions.isEmpty
          ? Center(
              child: Container(
                margin: const EdgeInsets.all(24),
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: _cream,
                  borderRadius: BorderRadius.circular(24),
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
                        fontSize: 18,
                        fontWeight: FontWeight.w400,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'orders_empty_sub'.tr,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: _textDark.withValues(alpha: 0.58),
                        fontSize: 14,
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
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
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
                    borderRadius: BorderRadius.circular(2),
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
                        fontSize: 20,
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
                                fontSize: 16,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            '${formatMoney(double.tryParse(price.toString()) ?? 0)} ₸',
                            style: const TextStyle(
                              color: _textDark,
                              fontSize: 16,
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
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: _almond.withValues(alpha: 0.45)),
      ),
      child: InkWell(
        onTap: hasItems ? () => _showReceiptDetails(context) : null,
        borderRadius: BorderRadius.circular(20),
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
                              fontSize: 16,
                              fontWeight: FontWeight.w400,
                            ),
                          ),
                        ),
                        Text(
                          '$prefix${formatMoney(transaction.amount)} ₸',
                          style: TextStyle(
                            color: color,
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
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
                          fontSize: 14,
                        ),
                      ),
                    ],
                    const SizedBox(height: 4),
                    Text(
                      formatDateTime(transaction.timestamp),
                      style: TextStyle(
                        color: _textDark.withValues(alpha: 0.5),
                        fontSize: 12,
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
