part of '../main.dart';

extension _CheckoutScheduleState on _CheckoutScreenState {
  Future<void> _refreshLiveCheckout() async {
    final refreshSchedule = _scheduleNeedsRefresh;
    _scheduleNeedsRefresh = false;
    // A server invalidation supersedes the cached quote even when the cart is unchanged.
    _quoteRevision++;
    _quoteFreshness?.cancel();
    _updateCheckoutState(() => _quoteValid = false);
    if (refreshSchedule) {
      _scheduleRevision++;
      if (_isSelectingTime) _scheduleOptions.value = null;
    }
    unawaited(_loadPaymentAvailability());
    try {
      final locations = await widget.api.getFulfillmentLocations();
      if (!mounted) return;
      _updateCheckoutState(() {
        _locations = locations;
        _deliveryAvailable = locations.any(
          (b) => b.active && b.deliveryEnabled,
        );
        _deliveryAvailabilityChecked = true;
        final branch = locations.where((b) => b.id == _branchId).firstOrNull;
        if (branch != null) _branch = branch.name;
      });
      if (refreshSchedule && (_scheduledSlot != null || _isSelectingTime)) {
        if (!await _loadScheduleOptions()) return;
        if (_scheduledSlot != null) await _applyScheduleToSelection();
      }
      await _refreshQuote();
    } catch (error) {
      _scheduleNeedsRefresh = _scheduleNeedsRefresh || refreshSchedule;
      if (mounted && refreshSchedule) {
        _updateCheckoutState(() => _quoteError = localizeErrorMessage(error));
        _scheduleError = localizeErrorMessage(error);
        _scheduleOptions.value = const [];
      }
      rethrow;
    }
  }

  Future<bool> _loadScheduleOptions() {
    final key = '${_effectiveLocation?.id}:${_orderType.wireValue}';
    if (_scheduleFlight != null &&
        _scheduleFlightKey == key &&
        _scheduleFlightRevision == _scheduleRevision) {
      return _scheduleFlight!;
    }
    _scheduleFlightKey = key;
    late final Future<bool> result;
    result = _fetchScheduleOptions().whenComplete(() {
      if (identical(_scheduleFlight, result)) _scheduleFlight = null;
    });
    _scheduleFlightRevision = _scheduleRevision;
    _scheduleFlight = result;
    return result;
  }

  Future<bool> _fetchScheduleOptions() async {
    final revision = ++_scheduleRevision;
    final location = _effectiveLocation;
    final type = _orderType;
    _scheduleError = null;
    if (location == null ||
        !location.active ||
        !location.supports(type.wireValue)) {
      _scheduleOptions.value = const [];
      return true;
    }
    final key = '${location.id}:${type.wireValue}';
    if (_scheduleKey != key) _scheduleOptions.value = null;
    _scheduleKey = key;
    List<FulfillmentSlot> slots;
    try {
      slots = await widget.api.getFulfillmentSlots(
        branchId: location.id,
        orderType: type.wireValue,
        days: type == _OrderType.preorder ? 3 : 1,
        productIds: widget.cartItems
            .map((item) => _asString(item['id']))
            .toList(),
      );
    } catch (error) {
      if (mounted && revision == _scheduleRevision) {
        _scheduleError = error is FulfillmentSlotsUnavailable
            ? error.message
            : localizeErrorMessage(error);
        _scheduleOptions.value = const [];
        if (error is FulfillmentSlotsUnavailable) return true;
      }
      return false;
    }
    if (!mounted ||
        revision != _scheduleRevision ||
        type != _orderType ||
        location.id != _effectiveLocation?.id) {
      return false;
    }
    if (slots.isNotEmpty) {
      _branchTimezoneOffsetMinutes = slots.first.timezoneOffsetMinutes;
    }
    _scheduleOptions.value = slots.map(_slotFromFulfillment).toList();
    return true;
  }

  Future<bool> _applyScheduleToSelection() async {
    final selected = _scheduledSlot;
    if (selected == null) return false;
    final current = _scheduleOptions.value
        ?.where((slot) => slot.value == selected.value)
        .firstOrNull;
    _updateCheckoutState(() {
      _scheduledSlot = current;
      if (current == null) {
        _quoteValid = false;
        _quoteError = null;
        _etaQuote = null;
      }
    });
    if (current == null) {
      await _persistDraft();
      if (!mounted) return false;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(bulkaSnackBar(content: Text('checkout_time_expired'.tr)));
    }
    return current != null;
  }

  Widget _liveScheduleSheet({DateTime? day, bool calendar = false}) {
    return ValueListenableBuilder<List<_PickupSlot>?>(
      valueListenable: _scheduleOptions,
      builder: (context, options, _) {
        if (options == null) {
          return const Padding(
            padding: EdgeInsets.all(40),
            child: CircularProgressIndicator(),
          );
        }
        final slots = day == null
            ? options
            : options
                  .where((slot) => DateUtils.isSameDay(slot.startsAt, day))
                  .toList();
        if (slots.isEmpty) {
          return SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text(_scheduleError ?? 'checkout_no_time_slots'.tr),
            ),
          );
        }
        // Calendar days and wheel selection must be rebuilt when hours change.
        return KeyedSubtree(
          key: ObjectKey(options),
          child: calendar
              ? _PreorderCalendarSheet(
                  slots: slots,
                  selected: _scheduledSlot?.startsAt,
                )
              : _CheckoutTimeSheet(
                  slots: slots,
                  selectedValue: _scheduledSlot?.value,
                ),
        );
      },
    );
  }
}
