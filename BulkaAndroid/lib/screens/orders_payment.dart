part of '../main.dart';

extension _OrdersPayment on _OrdersScreenState {
  Future<FortePaymentOutcome> _createOrder(
    CartProvider cart,
    _CheckoutDetails details,
  ) async {
    if (cart.items.isEmpty) return FortePaymentOutcome.failed;
    final cartRevision = cart.checkoutRevision;
    await cart.persisted;
    final items = cart.items.values
        .map((item) => item.toOrderPayload())
        .toList();
    final result = await widget.api.createFortePayment(
      paymentMethod: details.paymentMethod,
      expectedTotal: details.expectedTotal,
      cartItems: items,
      orderType: details.orderType.wireValue,
      preorderFulfillmentType: details.preorderFulfillmentType,
      branch: details.branch,
      branchId: details.branchId,
      scheduledAt: details.scheduledAt,
      deliveryAddress: details.deliveryAddress,
      checkoutId: details.checkoutId,
      savedPaymentMethodId: details.savedPaymentMethodId,
      useBonuses: details.useBonuses,
      expectedBonusSpent: details.bonusSpent,
      deliveryQuoteToken: details.deliveryQuoteToken,
      promoCode: details.promoCode,
      comment: details.comment,
    );
    final operationId = (result['operationId'] ?? '').toString();
    if (operationId.isEmpty) {
      throw ApiException('checkout_operation_missing'.tr);
    }
    final status = _asString(result['paymentStatus']).toLowerCase();
    if (status == 'paid') {
      // Clear the purchased cart before retiring its recovery record. A crash
      // between these writes cannot apply this payment to a new cart.
      if (cart.checkoutRevision == cartRevision) await cart.clearAndWait();
      await PendingForteOperationStore.clear(
        widget.api,
        expectedCheckoutId: details.checkoutId,
      );
      return FortePaymentOutcome.paid;
    }
    if (isTerminalForteFailure(status)) {
      await PendingForteOperationStore.clear(
        widget.api,
        expectedCheckoutId: details.checkoutId,
      );
      throw ApiException(
        'forte_payment_session_closed'.tr,
        code: 'PAYMENT_SESSION_CLOSED',
      );
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
      cartRevision: cartRevision,
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
    if (paymentResult?.paid == true) {
      if (cart.checkoutRevision == cartRevision) await cart.clearAndWait();
      await PendingForteOperationStore.clear(
        widget.api,
        expectedCheckoutId: details.checkoutId,
      );
    }
    return paymentResult?.outcome ?? FortePaymentOutcome.pending;
  }
}

extension _CheckoutPaymentOptions on _CheckoutScreenState {
  Widget _buildPaymentOptions() => Column(
    children: [
      PersonalAccountOption(
        api: widget.api,
        selected: _usePersonalAccount,
        onAvailable: (available) =>
            _updateCheckoutState(() => _personalAccountAvailable = available),
        onSelect: () => _updateCheckoutState(() => _usePersonalAccount = true),
      ),
      _CheckoutSavedCardsPanel(
        active: !_usePersonalAccount,
        api: widget.api,
        available: _forteAvailable,
        selectedMethodId: _usePersonalAccount ? null : _selectedPaymentMethodId,
        onDefaultResolved: (methodId) {
          if (_selectedPaymentMethodId == methodId) return;
          _updateCheckoutState(() => _selectedPaymentMethodId = methodId);
        },
        onSelect: (methodId) {
          _updateCheckoutState(() {
            _selectedPaymentMethodId = methodId;
            _usePersonalAccount = false;
          });
        },
        onActivate: () =>
            _updateCheckoutState(() => _usePersonalAccount = false),
        onRetryAvailability: () => unawaited(_loadPaymentAvailability()),
      ),
    ],
  );
}
