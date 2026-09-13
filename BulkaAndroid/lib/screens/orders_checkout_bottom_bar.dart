part of '../main.dart';

extension _CheckoutBottomBar on _CheckoutScreenState {
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
