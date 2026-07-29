part of '../main.dart';

class _PickupSlot {
  const _PickupSlot({
    required this.label,
    required this.value,
    required this.startsAt,
    required this.endsAt,
    required this.timezoneOffsetMinutes,
    required this.serverNow,
    this.remaining,
  });
  final String label;
  final String value;
  final DateTime startsAt;
  final DateTime endsAt;
  final int timezoneOffsetMinutes;
  final DateTime serverNow;
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
  final Future<_CheckoutSubmissionResult> Function(_CheckoutDetails details)
  onSubmit;

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
  bool? _forteAvailable;
  List<Map<String, dynamic>> _savedPaymentMethods = const [];
  String? _selectedPaymentMethodId;
  bool _paymentMethodsLoading = true;
  bool _addingPaymentMethod = false;
  String? _paymentMethodsError;
  int _discount = 0;
  int _deliveryFee = 0;
  int? _quotedTotal;
  Map<String, dynamic>? _etaQuote;
  int _branchTimezoneOffsetMinutes = 300;
  int _quoteRevision = 0;
  String _checkoutId = _newCheckoutId();
  String _substitutionPreference = 'call_customer';
  String? _checkoutTrackedBranchId;

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
    unawaited(_loadPaymentMethods());
  }

  bool get _selectedPaymentAvailable =>
      _forteAvailable == true &&
      !_paymentMethodsLoading &&
      _selectedPaymentMethodId != null;

  Future<void> _loadPaymentMethods() async {
    if (mounted) {
      setState(() {
        _paymentMethodsLoading = true;
        _paymentMethodsError = null;
      });
    }
    try {
      final available = await widget.api.isFortePaymentAvailable();
      final methods = available
          ? await widget.api.getFortePaymentMethods()
          : const <Map<String, dynamic>>[];
      if (!mounted) return;
      final validMethods = methods
          .where((method) => (method['id'] ?? '').toString().isNotEmpty)
          .toList();
      final validIds = validMethods
          .map((method) => (method['id'] ?? '').toString())
          .toSet();
      var selectedId = _selectedPaymentMethodId;
      if (!validIds.contains(selectedId)) {
        Map<String, dynamic>? preferred;
        for (final method in validMethods) {
          if (method['isDefault'] == true) {
            preferred = method;
            break;
          }
        }
        selectedId = preferred != null
            ? preferred['id']?.toString()
            : validMethods.isEmpty
            ? null
            : validMethods.first['id']?.toString();
      }
      setState(() {
        _forteAvailable = available;
        _savedPaymentMethods = validMethods;
        _selectedPaymentMethodId = selectedId;
        _paymentMethodsLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _forteAvailable = false;
        _paymentMethodsLoading = false;
        _paymentMethodsError = 'payment_methods_load_error'.tr;
      });
    }
  }

  Future<void> _addPaymentMethod() async {
    if (_addingPaymentMethod || _isSubmitting) return;
    if (_savedPaymentMethods.length >= _maximumSavedPaymentMethods) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('payment_methods_limit_reached'.tr)),
      );
      return;
    }
    final previousMethodIds = _savedPaymentMethods
        .map((method) => (method['id'] ?? '').toString())
        .where((id) => id.isNotEmpty)
        .toSet();
    setState(() => _addingPaymentMethod = true);
    try {
      final result = await widget.api.createForteCardSetup();
      final operationId = (result['operationId'] ?? '').toString();
      final redirectUrl = (result['redirectUrl'] ?? '').toString();
      if (operationId.isEmpty || redirectUrl.isEmpty) {
        throw ApiException('payment_methods_add_error'.tr);
      }
      if (!mounted) return;
      final setupResult = await Navigator.of(context).push<FortePaymentResult>(
        MaterialPageRoute(
          builder: (_) => FortePaymentScreen(
            api: widget.api,
            operationId: operationId,
            redirectUrl: redirectUrl,
            cardSetup: true,
          ),
        ),
      );
      if (setupResult?.paid == true) {
        await _loadPaymentMethods();
        if (!mounted) return;
        String? addedMethodId;
        for (final method in _savedPaymentMethods) {
          final id = (method['id'] ?? '').toString();
          if (id.isNotEmpty && !previousMethodIds.contains(id)) {
            addedMethodId = id;
            break;
          }
        }
        if (addedMethodId != null) {
          setState(() => _selectedPaymentMethodId = addedMethodId);
        }
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_paymentMethodAddErrorMessage(error))),
        );
      }
    } finally {
      if (mounted) setState(() => _addingPaymentMethod = false);
    }
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
    if (!mounted) return;
    _phoneController.text = prefs.getString(_draftKey('checkout_phone')) ?? '';
    _promoController.text = prefs.getString(_draftKey('checkout_promo')) ?? '';
    _commentController.text =
        prefs.getString(_draftKey('checkout_comment')) ?? '';
    final savedSubstitutionPreference =
        prefs.getString(_draftKey('checkout_substitution_preference')) ??
        'call_customer';
    setState(() {
      _branch = savedBranch;
      _branchId = prefs.getString('selected_bakery_location_id');
      _orderType = savedType;
      _preorderFulfillment = savedPreorderFulfillment;
      _deliveryAddress = address;
      _scheduledSlot = null;
      _locations = locations;
      _deliveryAvailable = locations.any(
        (location) => location.active && location.deliveryEnabled,
      );
      _deliveryAvailabilityChecked = locationsLoaded;
      _substitutionPreference =
          const {
            'remove_refund',
            'call_customer',
            'replace_with_approval',
          }.contains(savedSubstitutionPreference)
          ? savedSubstitutionPreference
          : 'call_customer';
    });
    _trackCheckoutStart();
    if (parsedScheduledAt != null) {
      await _restoreScheduledSlot(parsedScheduledAt);
    }
  }

  void _trackCheckoutStart() {
    final branchId = _branchId;
    if (branchId == null ||
        branchId.isEmpty ||
        _checkoutTrackedBranchId == branchId) {
      return;
    }
    _checkoutTrackedBranchId = branchId;
    widget.api.trackEvent(
      'checkout_start',
      branchId: branchId,
      properties: {
        'items': widget.cartItems.fold<int>(
          0,
          (total, item) => total + _asInt(item['quantity'], fallback: 1),
        ),
        'total': widget.total,
      },
    );
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
    int? timezoneOffsetMinutes,
    DateTime? serverNow,
  }) {
    final offset = timezoneOffsetMinutes ?? _branchTimezoneOffsetMinutes;
    final startsAt = date.toUtc();
    final endsAt = (endDate ?? startsAt.add(const Duration(hours: 1))).toUtc();
    final local = branchWallClock(startsAt, offset);
    final end = branchWallClock(endsAt, offset);
    final branchNow = branchWallClock(
      serverNow?.toUtc() ?? DateTime.now().toUtc(),
      offset,
    );
    final selectedType = orderType ?? _orderType;
    if (selectedType != _OrderType.preorder) {
      return _PickupSlot(
        label: '${_clockLabel(local)}–${_clockLabel(end)}',
        value: startsAt.toIso8601String(),
        startsAt: local,
        endsAt: end,
        timezoneOffsetMinutes: offset,
        serverNow: branchNow,
        remaining: remaining,
      );
    }
    final today = DateTime(branchNow.year, branchNow.month, branchNow.day);
    final slotDay = DateTime(local.year, local.month, local.day);
    final dayOffset = slotDay.difference(today).inDays;
    final dayLabel = dayOffset == 0
        ? 'checkout_today'.tr
        : dayOffset == 1
        ? 'checkout_tomorrow'.tr
        : formatUiDate(context, local);
    return _PickupSlot(
      label: '$dayLabel, ${_clockLabel(local)}–${_clockLabel(end)}',
      value: startsAt.toIso8601String(),
      startsAt: local,
      endsAt: end,
      timezoneOffsetMinutes: offset,
      serverNow: branchNow,
      remaining: remaining,
    );
  }

  _PickupSlot _slotFromFulfillment(
    FulfillmentSlot slot, {
    _OrderType? orderType,
  }) {
    return _slotFromDate(
      slot.startsAt,
      endDate: slot.endsAt,
      remaining: slot.remaining,
      orderType: orderType,
      timezoneOffsetMinutes: slot.timezoneOffsetMinutes,
      serverNow: slot.serverTime,
    );
  }

  Future<void> _restoreScheduledSlot(DateTime savedScheduledAt) async {
    final location = _effectiveLocation;
    if (location == null) return;
    try {
      final slots = await widget.api.getFulfillmentSlots(
        branchId: location.id,
        orderType: _orderType.wireValue,
        days: _orderType == _OrderType.preorder ? 7 : 1,
      );
      FulfillmentSlot? matchingSlot;
      for (final slot in slots) {
        if (slot.startsAt.isAtSameMomentAs(savedScheduledAt.toUtc())) {
          matchingSlot = slot;
          break;
        }
      }
      if (!mounted) return;
      if (matchingSlot == null) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.remove(_draftKey('checkout_scheduled_at'));
        return;
      }
      final restored = _slotFromFulfillment(
        matchingSlot,
        orderType: _orderType,
      );
      setState(() {
        _branchTimezoneOffsetMinutes = matchingSlot!.timezoneOffsetMinutes;
        _scheduledSlot = restored;
      });
      await _refreshQuote();
    } catch (_) {
      // Keep checkout usable; the customer can select a fresh slot manually.
    }
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
      prefs.setString(
        _draftKey('checkout_substitution_preference'),
        _substitutionPreference,
      ),
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
      _trackCheckoutStart();
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
          .map(_slotFromFulfillment)
          .take(_orderType == _OrderType.preorder ? 50 : 30)
          .toList();
      if (!mounted) return;
      if (slots.isNotEmpty) {
        _branchTimezoneOffsetMinutes = slots.first.timezoneOffsetMinutes;
      }
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
      showApiErrorSnackBar(context, error);
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
    final minimumInstant = DateTime.tryParse(_asString(eta['minAt']));
    final maximumInstant = DateTime.tryParse(_asString(eta['maxAt']));
    if (minimumInstant != null && maximumInstant != null) {
      final minimum = branchWallClock(
        minimumInstant,
        _branchTimezoneOffsetMinutes,
      );
      final maximum = branchWallClock(
        maximumInstant,
        _branchTimezoneOffsetMinutes,
      );
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
        showApiErrorSnackBar(context, error);
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

  Future<bool> _revalidateScheduledSlot() async {
    final selected = _scheduledSlot;
    final location = _effectiveLocation;
    if (selected == null || location == null) return false;
    final slots = await widget.api.getFulfillmentSlots(
      branchId: location.id,
      orderType: _orderType.wireValue,
      days: _orderType == _OrderType.preorder ? 7 : 1,
    );
    FulfillmentSlot? matchingSlot;
    final selectedInstant = DateTime.parse(selected.value);
    for (final slot in slots) {
      if (slot.startsAt.isAtSameMomentAs(selectedInstant)) {
        matchingSlot = slot;
        break;
      }
    }
    if (!mounted) return false;
    if (matchingSlot == null) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_draftKey('checkout_scheduled_at'));
      if (!mounted) return false;
      setState(() {
        _scheduledSlot = null;
        _quotedTotal = null;
        _etaQuote = null;
      });
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('checkout_time_expired'.tr)));
      return false;
    }
    final refreshed = _slotFromFulfillment(matchingSlot);
    setState(() {
      _branchTimezoneOffsetMinutes = matchingSlot!.timezoneOffsetMinutes;
      _scheduledSlot = refreshed;
    });
    return true;
  }

  Future<void> _submit() async {
    if (!_selectedPaymentAvailable) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('checkout_forte_unavailable'.tr)));
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
      if (!await _revalidateScheduledSlot()) {
        if (mounted) setState(() => _isSubmitting = false);
        return;
      }
      final result = await widget.onSubmit(
        _CheckoutDetails(
          checkoutId: _checkoutId,
          orderType: _orderType,
          savedPaymentMethodId: _selectedPaymentMethodId,
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
          substitutionPreference: _substitutionPreference,
        ),
      );
      if (mounted && result.state == _CheckoutSubmissionState.completed) {
        final prefs = await SharedPreferences.getInstance();
        await Future.wait([
          prefs.remove(_draftKey('checkout_scheduled_at')),
          prefs.remove(_draftKey('checkout_phone')),
          prefs.remove(_draftKey('checkout_promo')),
          prefs.remove(_draftKey('checkout_comment')),
          prefs.remove(_draftKey('checkout_substitution_preference')),
          prefs.remove(_draftKey('checkout_preorder_fulfillment')),
        ]);
        if (mounted) Navigator.pop(context, _CheckoutRouteResult.completed);
      }
      if (mounted &&
          result.state == _CheckoutSubmissionState.pending &&
          result.openOrders) {
        Navigator.pop(context, _CheckoutRouteResult.openOrders);
        return;
      }
      if (mounted && result.state != _CheckoutSubmissionState.completed) {
        setState(() {
          _isSubmitting = false;
          if (result.state == _CheckoutSubmissionState.failed) {
            _checkoutId = _newCheckoutId();
          }
        });
      }
    } catch (error) {
      if (!mounted) return;
      showApiErrorSnackBar(context, error);
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
              height:
                  58 +
                  (MediaQuery.textScalerOf(context).scale(1) - 1).clamp(
                        0.0,
                        1.0,
                      ) *
                      22,
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
                          : Text(
                              'checkout_apply'.tr,
                              maxLines: 2,
                              textAlign: TextAlign.center,
                              overflow: TextOverflow.visible,
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
            _CheckoutLabel('checkout_substitution_title'.tr, required: true),
            const SizedBox(height: 6),
            Text(
              'checkout_substitution_hint'.tr,
              style: TextStyle(
                color: context.bulkaColors.mutedText,
                fontSize: BulkaTypeScale.bodySmall,
              ),
            ),
            const SizedBox(height: 12),
            _CheckoutSubstitutionPreference(
              value: _substitutionPreference,
              onChanged: (value) {
                setState(() => _substitutionPreference = value);
                _saveDraft();
              },
            ),
            const SizedBox(height: 28),
            _CheckoutLabel('payment_methods_title'.tr, required: true),
            const SizedBox(height: 12),
            _CheckoutSavedCards(
              methods: _savedPaymentMethods,
              selectedMethodId: _selectedPaymentMethodId,
              loading: _paymentMethodsLoading,
              adding: _addingPaymentMethod,
              available: _forteAvailable,
              error: _paymentMethodsError,
              onSelect: (methodId) {
                setState(() => _selectedPaymentMethodId = methodId);
              },
              onAdd: () => unawaited(_addPaymentMethod()),
              onRetry: () => unawaited(_loadPaymentMethods()),
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
                height:
                    58 +
                    (MediaQuery.textScalerOf(context).scale(1) - 1).clamp(
                          0.0,
                          1.0,
                        ) *
                        18,
                child: Text(
                  'cart_checkout'.tr,
                  maxLines: 2,
                  textAlign: TextAlign.center,
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
    final now = slot.serverNow;
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
                currentDate: widget.slots.first.serverNow,
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
