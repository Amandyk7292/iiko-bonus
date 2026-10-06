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
                  ),
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
                      onTap:
                          _isSelectingBranch ||
                              _isSubmitting ||
                              _pickupPhotoLocked
                          ? null
                          : _selectBranch,
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
                  ],
                  if (!_usesDelivery && !_onlineOrderingDisabled) ...[
                    _buildPickupPhotoSection(context),
                  ],
                  const SizedBox(height: 28),
                  _CheckoutLabel('checkout_comment'.tr),
                  const SizedBox(height: 10),
                  TextField(
                    key: const ValueKey('checkout-comment-input'),
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
      bottomNavigationBar: !_preferencesReady
          ? null
          : _buildCheckoutBottomBar(context),
    );
  }
}
