part of '../main.dart';

extension _CheckoutScreenLayout on _CheckoutScreenState {
  Widget _buildCheckoutScreen(BuildContext context) {
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
            if (_onlineOrderingDisabled) ...[
              const SizedBox(height: 14),
              const _OnlineOrderingDisabledNotice(),
            ],
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
            if (!_onlineOrderingDisabled) ...[
              const SizedBox(height: 28),
              _CheckoutLabel('payment_methods_title'.tr),
              const SizedBox(height: 10),
              _CheckoutSavedCardsPanel(
                api: widget.api,
                available: _forteAvailable,
                selectedMethodId: _selectedPaymentMethodId,
                onDefaultResolved: (methodId) {
                  if (_selectedPaymentMethodId == methodId) return;
                  _updateCheckoutState(
                    () => _selectedPaymentMethodId = methodId,
                  );
                },
                onSelect: (methodId) {
                  _updateCheckoutState(
                    () => _selectedPaymentMethodId = methodId,
                  );
                },
                onRetryAvailability: () =>
                    unawaited(_loadPaymentAvailability()),
              ),
            ],
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
                key: const ValueKey('checkout-submit'),
                onPressed: _isSubmitting || !_selectedPaymentAvailable
                    ? null
                    : _submit,
                loading: _isSubmitting,
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    _onlineOrderingDisabled
                        ? 'checkout_online_ordering_disabled_button'.tr
                        : 'cart_checkout'.tr,
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
