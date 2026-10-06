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
          if (_quoteError != null) ...[
            ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight: min(120, MediaQuery.sizeOf(context).height * 0.24),
              ),
              child: SingleChildScrollView(
                child: _CheckoutQuoteError(
                  message: _quoteError!,
                  onRetry: _isQuoting ? null : () => _refreshQuote(),
                ),
              ),
            ),
            const SizedBox(height: 10),
          ],
          Row(
            children: [
              if (!_onlineOrderingDisabled) ...[
                Expanded(
                  flex: 3,
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: _buildPaymentOptions(),
                  ),
                ),
                const SizedBox(width: 12),
              ],
              Expanded(
                flex: 2,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      'checkout_total'.tr,
                      textAlign: TextAlign.end,
                      style: TextStyle(
                        color: colors.mutedText,
                        fontSize: BulkaTypeScale.caption,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      _quotedTotal == null
                          ? '—'
                          : '${_formatCartMoney(_quotedTotal!)} ₸',
                      textAlign: TextAlign.end,
                      style: const TextStyle(
                        color: _textDark,
                        fontFamily: _headingFont,
                        fontSize: BulkaTypeScale.title,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: GradientButton(
              key: const ValueKey('checkout-submit'),
              onPressed: _canSubmit ? _submit : null,
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
