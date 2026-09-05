part of '../main.dart';

class _CheckoutScreen extends StatefulWidget {
  const _CheckoutScreen({
    required this.api,
    required this.total,
    required this.cartItems,
    required this.onSubmit,
    this.initialCheckoutId,
  });

  final BulkaApiClient api;
  final int total;
  final List<Map<String, dynamic>> cartItems;
  final Future<FortePaymentOutcome> Function(_CheckoutDetails details) onSubmit;
  final String? initialCheckoutId;

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
  bool _quotePending = false;
  bool _quoteFeedbackPending = false;
  bool _isSelectingBranch = false;
  bool _isSelectingAddress = false;
  bool _isSelectingTime = false;
  bool? _forteAvailable;
  bool _onlineOrderingDisabled = false;
  String? _selectedPaymentMethodId;
  int _discount = 0;
  int _deliveryFee = 0;
  int? _quotedTotal;
  Map<String, dynamic>? _etaQuote;
  int _branchTimezoneOffsetMinutes = 300;
  int _quoteRevision = 0;
  String _checkoutId = _newCheckoutId();

  bool get _isPreorder => _orderType == _OrderType.preorder;
  bool get _usesDelivery =>
      _orderType == _OrderType.delivery ||
      (_isPreorder && _preorderFulfillment == _OrderType.delivery);
  String _draftKey(String base) =>
      customerPreferenceKey(base, widget.api.sessionCacheScope);
  void _updateCheckoutState(VoidCallback update) => setState(update);

  @override
  void initState() {
    super.initState();
    final initialCheckoutId = widget.initialCheckoutId;
    if (initialCheckoutId != null &&
        RegExp(
          r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          caseSensitive: false,
        ).hasMatch(initialCheckoutId)) {
      _checkoutId = initialCheckoutId;
    }
    _phoneController = TextEditingController();
    _promoController.addListener(_refreshPromoButton);
    _phoneController.addListener(_saveDraft);
    _promoController.addListener(_saveDraft);
    _commentController.addListener(_saveDraft);
    _onlineOrderingDisabled = widget.api.onlineOrderingDisabled;
    unawaited(_loadCheckoutPreferences());
    unawaited(_loadPaymentAvailability());
  }

  bool get _selectedPaymentAvailable =>
      !_onlineOrderingDisabled &&
      _forteAvailable == true &&
      _selectedPaymentMethodId != null;

  Future<void> _loadPaymentAvailability() async {
    if (mounted) {
      setState(() => _forteAvailable = null);
    }
    final available = await widget.api.isFortePaymentAvailable().catchError(
      (_) => false,
    );
    if (!mounted) return;
    setState(() {
      _forteAvailable = available;
      _onlineOrderingDisabled = widget.api.onlineOrderingDisabled;
      if (!available) _selectedPaymentMethodId = null;
    });
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
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(localizeErrorMessage(error))));
    } finally {
      if (mounted) setState(() => _isSelectingTime = false);
    }
  }

  bool get _canQuote =>
      !_onlineOrderingDisabled &&
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
    if (_isQuoting) {
      _quotePending = true;
      _quoteFeedbackPending = _quoteFeedbackPending || showFeedback;
      return;
    }
    final revision = ++_quoteRevision;
    setState(() => _isQuoting = true);
    try {
      final quote = await widget.api.quoteForteOrder(
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
        if (_quotePending) {
          final pendingFeedback = _quoteFeedbackPending;
          _quotePending = false;
          _quoteFeedbackPending = false;
          unawaited(_refreshQuote(showFeedback: pendingFeedback));
        }
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
    if (_onlineOrderingDisabled) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('checkout_online_ordering_disabled'.tr)),
      );
      return;
    }
    if (!_selectedPaymentAvailable) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            _forteAvailable == true && _selectedPaymentMethodId == null
                ? 'payment_methods_empty'.tr
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
      if (!await _revalidateScheduledSlot()) {
        if (mounted) setState(() => _isSubmitting = false);
        return;
      }
      final prefs = await SharedPreferences.getInstance();
      // Keep the id before the network call. A crash after the order is
      // created but before the response is received must still retry the
      // same idempotent request after restart.
      await Future.wait([
        prefs.setString(_draftKey('checkout_id'), _checkoutId),
        prefs.setString(
          _draftKey('checkout_id_created_at'),
          DateTime.now().toUtc().toIso8601String(),
        ),
      ]);
      final outcome = await widget.onSubmit(
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
        ),
      );
      if (mounted && outcome == FortePaymentOutcome.paid) {
        final prefs = await SharedPreferences.getInstance();
        await Future.wait([
          prefs.remove(_draftKey('checkout_scheduled_at')),
          prefs.remove(_draftKey('checkout_phone')),
          prefs.remove(_draftKey('checkout_promo')),
          prefs.remove(_draftKey('checkout_comment')),
          prefs.remove(_draftKey('checkout_preorder_fulfillment')),
          prefs.remove(_draftKey('checkout_id')),
          prefs.remove(_draftKey('checkout_id_created_at')),
        ]);
        if (mounted) Navigator.pop(context, true);
      }
      if (mounted && outcome != FortePaymentOutcome.paid) {
        setState(() {
          _isSubmitting = false;
          // Keep the id while Forte is still pending so a retry resumes the
          // same idempotent operation. A terminal failure clears the pending
          // record and is the only safe point to issue a new checkout id.
          if (outcome == FortePaymentOutcome.failed) {
            _checkoutId = _newCheckoutId();
            unawaited(
              Future.wait([
                prefs.remove(_draftKey('checkout_id')),
                prefs.remove(_draftKey('checkout_id_created_at')),
              ]),
            );
          }
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
  Widget build(BuildContext context) => _buildCheckoutScreen(context);
}
