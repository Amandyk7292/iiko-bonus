part of '../main.dart';

extension _CheckoutQuoteState on _CheckoutScreenState {
  bool get _hasUnappliedPromo =>
      _promoController.text.trim() != _appliedPromoCode;

  // Bonus selection does not change merchandise prices or the delivery token.
  // The server still reserves and verifies the exact bonus amount at payment.
  String get _currentQuoteKey => jsonEncode({
    'customer': widget.api.sessionCacheScope,
    'items': widget.cartItems,
    'type': _orderType.wireValue,
    'branch': _usesDelivery ? null : _branch,
    'branchId': _usesDelivery ? null : _branchId,
    'deliveryBranch': _usesDelivery ? _deliveryBranchLocation?.id : null,
    'address': _usesDelivery ? _deliveryAddress?.toOrderPayload() : null,
    'scheduledAt': _scheduledSlot?.value,
    'promo': _appliedPromoCode,
  });

  void _recalculateBonusSelection() {
    final beforeBonuses = _quotedTotal == null
        ? null
        : _quotedTotal! + _bonusSpent;
    _bonusSpent = _useBonuses ? _bonusMaximum : 0;
    if (beforeBonuses != null) _quotedTotal = beforeBonuses - _bonusSpent;
  }

  void _showPromoFeedback() {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          _appliedPromoCode.isNotEmpty
              ? 'checkout_promo_applied'.tr
              : 'checkout_price_checked'.tr,
        ),
      ),
    );
  }

  Future<void> _refreshQuote({bool showFeedback = false}) async {
    if (!_canQuote || _isSubmitting) return;
    final key = _currentQuoteKey;
    if (_isQuoting) {
      _quotePending = _quotePending || key != _inflightQuoteKey;
      _quoteFeedbackPending = _quoteFeedbackPending || showFeedback;
      if (showFeedback) _updateCheckoutState(() => _isApplyingPromo = true);
      return;
    }
    if (_quoteValid &&
        _lastQuotedKey == key &&
        _quoteFreshness?.isActive == true) {
      if (showFeedback) _showPromoFeedback();
      return;
    }
    final revision = ++_quoteRevision;
    _inflightQuoteKey = key;
    _updateCheckoutState(() {
      _isQuoting = true;
      _isApplyingPromo = showFeedback;
      _quoteError = null;
      if (_lastQuotedKey != key) _quoteValid = false;
    });
    try {
      final quote = await widget.api.quoteForteOrder(
        cartItems: widget.cartItems,
        orderType: _orderType.wireValue,
        preorderFulfillmentType: _isPreorder ? 'pickup' : null,
        branch: _usesDelivery ? null : _branch,
        branchId: _usesDelivery ? null : _branchId,
        scheduledAt: _scheduledSlot?.value,
        deliveryAddress: _usesDelivery ? _deliveryAddress : null,
        promoCode: _appliedPromoCode,
      );
      if (!mounted || revision != _quoteRevision || key != _currentQuoteKey) {
        return;
      }
      _updateCheckoutState(() {
        _discount = (quote['discount'] as num?)?.round() ?? 0;
        _bonusAvailable = (quote['bonusAvailable'] as num?)?.floor();
        final subtotal = (quote['subtotal'] as num?)?.round() ?? widget.total;
        final merchandiseMaximum = max(0, ((subtotal - _discount) / 2).floor());
        _bonusMaximum = max(
          0,
          min(
            (quote['bonusMaximum'] as num?)?.floor() ?? 0,
            min(_bonusAvailable ?? 0, merchandiseMaximum),
          ),
        );
        _bonusSpent = (quote['bonusSpent'] as num?)?.floor() ?? 0;
        _deliveryFee = (quote['deliveryFee'] as num?)?.round() ?? 0;
        _quotedTotal = (quote['total'] as num?)?.round();
        _recalculateBonusSelection();
        _deliveryQuoteToken = quote['deliveryQuoteToken'] as String?;
        final eta = _asMap(quote['eta']);
        _etaQuote = eta.isEmpty ? null : eta;
        _quoteValid = _quotedTotal != null;
        _lastQuotedKey = key;
      });
      _quoteFreshness?.cancel();
      _quoteFreshness = Timer(const Duration(seconds: 30), () {});
      if (showFeedback || (_quoteFeedbackPending && !_quotePending)) {
        _showPromoFeedback();
      }
    } catch (error) {
      if (mounted && revision == _quoteRevision && key == _currentQuoteKey) {
        _updateCheckoutState(() {
          _quoteError = localizeErrorMessage(error);
          _quoteValid = false;
        });
      }
    } finally {
      if (mounted) {
        final repeat = _quotePending;
        final feedback = _quoteFeedbackPending;
        _quotePending = false;
        _quoteFeedbackPending = false;
        _inflightQuoteKey = null;
        _updateCheckoutState(() {
          _isQuoting = false;
          _isApplyingPromo = false;
        });
        if (repeat) unawaited(_refreshQuote(showFeedback: feedback));
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
    final code = _promoController.text.trim();
    if (code != _appliedPromoCode) {
      _updateCheckoutState(() {
        _appliedPromoCode = code;
        _quoteValid = false;
        _quoteRevision++;
      });
    }
    await _refreshQuote(showFeedback: true);
  }
}
