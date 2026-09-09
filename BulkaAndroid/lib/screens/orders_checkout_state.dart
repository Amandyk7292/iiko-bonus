part of '../main.dart';

extension _CheckoutScreenStatePreferences on _CheckoutScreenState {
  bool get _deliveryUnavailable =>
      _usesDelivery && _deliveryAvailabilityChecked && !_deliveryAvailable;

  Future<void> _loadPaymentAvailability() async {
    if (_checkingPaymentAvailability) return;
    _checkingPaymentAvailability = true;
    try {
      final available = await widget.api.isFortePaymentAvailable();
      if (!mounted) return;
      _updateCheckoutState(() {
        _forteAvailable = available;
        _onlineOrderingDisabled = widget.api.onlineOrderingDisabled;
        if (!available) _selectedPaymentMethodId = null;
      });
    } catch (_) {
      // A failed background refresh must not discard an already loaded card.
      if (mounted && _forteAvailable == null) {
        _updateCheckoutState(() => _forteAvailable = false);
      }
    } finally {
      _checkingPaymentAvailability = false;
    }
  }

  Future<void> _loadCheckoutPreferences() async {
    final prefs = await SharedPreferences.getInstance();
    final savedCheckoutId = prefs.getString(_draftKey('checkout_id'));
    final savedCheckoutCreatedAt = DateTime.tryParse(
      prefs.getString(_draftKey('checkout_id_created_at')) ?? '',
    );
    final savedCheckoutIsFresh =
        savedCheckoutId != null &&
        savedCheckoutCreatedAt != null &&
        DateTime.now().difference(savedCheckoutCreatedAt).abs() <=
            const Duration(days: 2);
    if (widget.initialCheckoutId == null &&
        savedCheckoutId != null &&
        !savedCheckoutIsFresh) {
      await Future.wait([
        prefs.remove(_draftKey('checkout_id')),
        prefs.remove(_draftKey('checkout_id_created_at')),
      ]);
    }
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
    final preferredCheckoutId =
        widget.initialCheckoutId ??
        (savedCheckoutIsFresh ? savedCheckoutId : null);
    if (!mounted) return;
    _phoneController.text = prefs.getString(_draftKey('checkout_phone')) ?? '';
    _promoController.text = prefs.getString(_draftKey('checkout_promo')) ?? '';
    _commentController.text =
        prefs.getString(_draftKey('checkout_comment')) ?? '';
    _updateCheckoutState(() {
      if (preferredCheckoutId != null &&
          RegExp(
            r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
            caseSensitive: false,
          ).hasMatch(preferredCheckoutId)) {
        _checkoutId = preferredCheckoutId;
      }
      _branch = savedBranch;
      _branchId = prefs.getString('selected_bakery_location_id');
      _explicitDeliveryBranchId = prefs.getString(
        'selected_bakery_location_id_delivery',
      );
      _orderType = savedType;
      _preorderFulfillment = savedPreorderFulfillment;
      _deliveryAddress = address;
      _scheduledSlot = null;
      _locations = locations;
      _deliveryAvailable = locations.any(
        (location) => location.active && location.deliveryEnabled,
      );
      _deliveryAvailabilityChecked = locationsLoaded;
    });
    if (parsedScheduledAt != null) {
      await _restoreScheduledSlot(parsedScheduledAt);
    }
  }
}
