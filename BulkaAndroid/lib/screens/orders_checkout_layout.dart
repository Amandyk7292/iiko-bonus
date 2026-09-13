part of '../main.dart';

extension _CheckoutScreenLayout on _CheckoutScreenState {
  Widget _buildCheckoutScreen(BuildContext context) {
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
      body: !_preferencesReady
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(24, 24, 24, 28),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _CheckoutSteps(
                    addressComplete: _usesDelivery
                        ? _deliveryAddress != null &&
                              _deliveryBranchLocation != null
                        : _branch.trim().isNotEmpty,
                    timeComplete: _usesDelivery || _scheduledSlot != null,
                    paymentComplete: _selectedPaymentAvailable,
                  ),
                  const SizedBox(height: 16),
                  _SelectedOrderTypeCard(value: _orderType),
                  if (_onlineOrderingDisabled) ...[
                    const SizedBox(height: 14),
                    const _OnlineOrderingDisabledNotice(),
                  ],
                  if (_deliveryUnavailable) ...[
                    const SizedBox(height: 10),
                    const _CheckoutDeliveryUnavailable(),
                  ],
                  const SizedBox(height: 28),
                  if (_usesDelivery) ...[
                    _CheckoutLabel(
                      'checkout_delivery_address'.tr,
                      required: true,
                    ),
                    const SizedBox(height: 10),
                    _CheckoutField(
                      label:
                          _deliveryAddress?.displayAddress ??
                          'checkout_select_delivery_address'.tr,
                      icon: Icons.location_on_outlined,
                      onTap: _isSelectingAddress
                          ? null
                          : _selectDeliveryAddress,
                      loading: _isSelectingAddress,
                    ),
                  ] else ...[
                    _CheckoutLabel('checkout_branch'.tr, required: true),
                    const SizedBox(height: 10),
                    _CheckoutField(
                      label: _branch.isEmpty
                          ? 'checkout_select_branch'.tr
                          : _branch,
                      icon: Icons.storefront_outlined,
                      onTap: _isSelectingBranch ? null : _selectBranch,
                      loading: _isSelectingBranch,
                    ),
                  ],
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
                            key: const ValueKey('checkout-promo-input'),
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
                            key: const ValueKey('checkout-apply-promo'),
                            onPressed:
                                (_promoController.text.trim().isEmpty &&
                                        !_hasUnappliedPromo) ||
                                    _isApplyingPromo ||
                                    _isSubmitting
                                ? null
                                : _applyPromo,
                            style: FilledButton.styleFrom(
                              backgroundColor: _bulkaYellow,
                              foregroundColor: _textDark,
                              disabledBackgroundColor: _almond.withValues(
                                alpha: 0.5,
                              ),
                            ),
                            child: _isApplyingPromo
                                ? const SizedBox(
                                    width: 20,
                                    height: 20,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : FittedBox(
                                    fit: BoxFit.scaleDown,
                                    child: Text(
                                      'checkout_apply'.tr,
                                      maxLines: 1,
                                    ),
                                  ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 26),
                  if (_usesDelivery)
                    Text(_accountText('deliveryAsap'))
                  else ...[
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
                        loading: false,
                      )
                    else
                      _CheckoutField(
                        label:
                            _scheduledSlot?.label ?? 'checkout_select_time'.tr,
                        icon: Icons.calendar_month_outlined,
                        onTap: _isSelectingTime ? null : _selectScheduledTime,
                        loading: false,
                      ),
                  ],
                  if (!_onlineOrderingDisabled) ...[
                    const SizedBox(height: 24),
                    _buildBonusSwitch(),
                    const SizedBox(height: 28),
                    _CheckoutLabel('checkout_payment_title'.tr),
                    const SizedBox(height: 10),
                    _buildPaymentOptions(),
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
                  const SizedBox(height: 24),
                  _buildCheckoutBreakdown(context),
                ],
              ),
            ),
      bottomNavigationBar: !_preferencesReady
          ? null
          : _buildCheckoutBottomBar(context),
    );
  }

  Widget _buildCheckoutBreakdown(BuildContext context) {
    final colors = context.bulkaColors;
    return Container(
      key: const ValueKey('checkout-price-breakdown'),
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        border: Border.all(
          color: colors.cardBorder,
          width: BulkaStrokes.hairline,
        ),
        boxShadow: BulkaShadows.card,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'checkout_summary_title'.tr,
            style: const TextStyle(
              color: _textDark,
              fontFamily: _headingFont,
              fontSize: BulkaTypeScale.titleSmall,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (_quoteError != null) ...[
            const SizedBox(height: 12),
            _CheckoutQuoteError(
              message: _quoteError!,
              onRetry: _isQuoting ? null : () => _refreshQuote(),
            ),
          ],
          if (_quoteEtaText.isNotEmpty) ...[
            const SizedBox(height: 12),
            Semantics(
              liveRegion: true,
              label: '${'orders_eta'.tr}: $_quoteEtaText. $_quoteEtaConfidence',
              child: Container(
                width: double.infinity,
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
                                color: colors.mutedText,
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
          const SizedBox(height: 14),
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
          if (_usesDelivery) ...[
            const SizedBox(height: 8),
            _CheckoutTotalRow(
              label: 'checkout_delivery_fee'.tr,
              value: _quotedTotal == null
                  ? '—'
                  : _deliveryFee == 0
                  ? 'checkout_delivery_free'.tr
                  : '${_formatCartMoney(_deliveryFee)} ₸',
            ),
            const SizedBox(height: 6),
            Text(
              'checkout_free_delivery_threshold'.tr,
              style: TextStyle(
                color: colors.mutedText,
                fontSize: BulkaTypeScale.caption,
              ),
            ),
          ],
          if (_useBonuses) ...[
            const SizedBox(height: 8),
            _CheckoutTotalRow(
              label: 'checkout_bonus_spent'.tr,
              value: _quotedTotal == null
                  ? '—'
                  : '− ${_formatCartMoney(_bonusSpent)} ₸',
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildCheckoutBottomBar(BuildContext context) {
    final colors = context.bulkaColors;
    return Container(
      key: const ValueKey('checkout-sticky-action'),
      padding: EdgeInsets.fromLTRB(
        24,
        12,
        24,
        14 + BulkaLayout.safeBottomInset(context),
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(
          top: BorderSide(
            color: colors.cardBorder,
            width: BulkaStrokes.hairline,
          ),
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x12532814),
            blurRadius: 14,
            offset: Offset(0, -3),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _CheckoutTotalRow(
            label: 'checkout_total'.tr,
            value: _quotedTotal == null
                ? '—'
                : '${_formatCartMoney(_quotedTotal!)} ₸',
            emphasized: true,
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: GradientButton(
              key: const ValueKey('checkout-submit'),
              onPressed:
                  _isSubmitting ||
                      !_selectedPaymentAvailable ||
                      _isQuoting ||
                      !_quoteValid ||
                      _hasUnappliedPromo ||
                      _quotedTotal == null ||
                      _quoteError != null
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
    );
  }
}
