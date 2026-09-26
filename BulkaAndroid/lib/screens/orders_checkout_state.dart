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
    // PendingForteOperationStore resolves payment ids before this route opens.
    // A local timestamp must never retire an unresolved server operation.
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
    // Only reuse a request after its payment status and cart identity have
    // been resolved by the caller. A recent id alone may be an old purchase.
    final preferredCheckoutId = widget.initialCheckoutId;
    if (!mounted) return;
    _promoController.text = prefs.getString(_draftKey('checkout_promo')) ?? '';
    _appliedPromoCode = _promoController.text.trim();
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
      _orderType = savedType;
      _deliveryAddress = address;
      _scheduledSlot = null;
      _locations = locations;
      _deliveryAvailable = locations.any(
        (location) => location.active && location.deliveryEnabled,
      );
      _deliveryAvailabilityChecked = locationsLoaded;
    });
    if (!_usesDelivery) unawaited(_loadScheduleOptions());
    if (parsedScheduledAt != null) {
      await _restoreScheduledSlot(parsedScheduledAt);
    }
  }
}
