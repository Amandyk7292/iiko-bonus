part of '../main.dart';

const int _maximumSavedPaymentMethods = 3;

enum _CheckoutSubmissionState { completed, failed, pending }

@immutable
class _CheckoutSubmissionResult {
  const _CheckoutSubmissionResult(this.state, {this.openOrders = false});

  const _CheckoutSubmissionResult.completed()
    : state = _CheckoutSubmissionState.completed,
      openOrders = false;

  final _CheckoutSubmissionState state;
  final bool openOrders;
}

enum _CheckoutRouteResult { completed, openOrders }

String _paymentMethodAddErrorMessage(Object error) {
  if (error is ApiException &&
      error.code == 'FORTE_WIDGET_PAYMENT_METHOD_LIMIT') {
    return 'payment_methods_limit_reached'.tr;
  }
  return 'payment_methods_add_error'.tr;
}

class _CheckoutDetails {
  const _CheckoutDetails({
    required this.checkoutId,
    required this.orderType,
    required this.scheduledAt,
    required this.substitutionPreference,
    this.savedPaymentMethodId,
    this.preorderFulfillmentType,
    this.branch,
    this.branchId,
    this.deliveryAddress,
    this.additionalPhone,
    this.promoCode,
    this.comment,
  });

  final String checkoutId;
  final _OrderType orderType;
  final String scheduledAt;
  final String substitutionPreference;
  final String? savedPaymentMethodId;
  final String? preorderFulfillmentType;
  final String? branch;
  final String? branchId;
  final DeliveryAddress? deliveryAddress;
  final String? additionalPhone;
  final String? promoCode;
  final String? comment;
}

class _CheckoutSavedCards extends StatelessWidget {
  const _CheckoutSavedCards({
    required this.methods,
    required this.selectedMethodId,
    required this.loading,
    required this.adding,
    required this.available,
    required this.error,
    required this.onSelect,
    required this.onAdd,
    required this.onRetry,
  });

  final List<Map<String, dynamic>> methods;
  final String? selectedMethodId;
  final bool loading;
  final bool adding;
  final bool? available;
  final String? error;
  final ValueChanged<String> onSelect;
  final VoidCallback onAdd;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    if (loading) {
      return Container(
        key: const ValueKey('checkout-saved-cards-loading'),
        width: double.infinity,
        constraints: const BoxConstraints(minHeight: 88),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        decoration: BoxDecoration(
          color: colors.surfaceCream,
          borderRadius: BorderRadius.circular(BulkaRadii.control),
          border: Border.all(color: colors.cardBorder),
        ),
        child: Row(
          children: [
            SizedBox.square(
              dimension: 24,
              child: CircularProgressIndicator(
                strokeWidth: 2.2,
                color: colors.brandGold,
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Text(
                'payment_methods_loading'.tr,
                style: TextStyle(color: colors.mutedText),
              ),
            ),
          ],
        ),
      );
    }

    if (error != null || available != true) {
      return _CheckoutSavedCardsNotice(
        key: const ValueKey('checkout-saved-cards-error'),
        icon: Icons.error_outline_rounded,
        message: error ?? 'checkout_forte_unavailable'.tr,
        actionLabel: 'retry_btn'.tr,
        onAction: onRetry,
      );
    }

    if (methods.isEmpty) {
      return _CheckoutSavedCardsNotice(
        key: const ValueKey('checkout-saved-cards-empty'),
        icon: Icons.credit_card_off_rounded,
        message: 'payment_methods_empty'.tr,
        actionLabel: 'payment_methods_add'.tr,
        actionLoading: adding,
        onAction: onAdd,
      );
    }

    final canAdd = methods.length < _maximumSavedPaymentMethods;
    return Column(
      children: [
        ...methods.map((method) {
          final id = (method['id'] ?? '').toString();
          return Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: _CheckoutSavedCardTile(
              method: method,
              selected: selectedMethodId == id,
              onTap: () => onSelect(id),
            ),
          );
        }),
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Semantics(
            label: 'checkout_saved_card_oneclick_hint'.tr,
            child: Row(
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
                    'checkout_saved_card_oneclick_hint'.tr,
                    style: TextStyle(
                      color: colors.mutedText,
                      fontSize: BulkaTypeScale.caption,
                      height: 1.35,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        if (canAdd)
          SizedBox(
            width: double.infinity,
            height: 52,
            child: OutlinedButton.icon(
              key: const ValueKey('checkout-add-saved-card'),
              onPressed: adding ? null : onAdd,
              icon: adding
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.add_card_rounded),
              label: Text(
                'payment_methods_add'.tr,
                style: const TextStyle(
                  fontFamily: _headingFont,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          )
        else
          _CheckoutSavedCardsLimitNotice(
            key: const ValueKey('checkout-saved-cards-limit'),
          ),
      ],
    );
  }
}

class _CheckoutSavedCardsLimitNotice extends StatelessWidget {
  const _CheckoutSavedCardsLimitNotice({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Semantics(
      liveRegion: true,
      child: Container(
        width: double.infinity,
        constraints: const BoxConstraints(minHeight: 48),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: colors.surfaceCream,
          borderRadius: BorderRadius.circular(BulkaRadii.control),
          border: Border.all(color: colors.cardBorder),
        ),
        child: Row(
          children: [
            Icon(
              Icons.info_outline_rounded,
              color: colors.brandBrown,
              size: 22,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                'payment_methods_limit_reached'.tr,
                style: TextStyle(
                  color: colors.mutedText,
                  fontSize: BulkaTypeScale.bodySmall,
                  height: 1.3,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CheckoutSavedCardTile extends StatelessWidget {
  const _CheckoutSavedCardTile({
    required this.method,
    required this.selected,
    required this.onTap,
  });

  final Map<String, dynamic> method;
  final bool selected;
  final VoidCallback onTap;

  String get _id => (method['id'] ?? '').toString();

  String get _cardLabel {
    final brand = (method['brand'] ?? 'card').toString().trim().toUpperCase();
    final lastFour = (method['lastFour'] ?? '').toString().trim();
    return '$brand •••• $lastFour';
  }

  String get _details {
    final month = int.tryParse('${method['expMonth'] ?? ''}');
    final year = int.tryParse('${method['expYear'] ?? ''}');
    final values = <String>[];
    if (month != null && year != null) {
      values.add(
        '${'payment_methods_expiry'.tr} '
        '${month.toString().padLeft(2, '0')}/'
        '${(year % 100).toString().padLeft(2, '0')}',
      );
    }
    if (method['isDefault'] == true) {
      values.add('payment_methods_default'.tr);
    }
    return values.join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final details = _details;
    return Semantics(
      button: true,
      selected: selected,
      label: details.isEmpty ? _cardLabel : '$_cardLabel. $details',
      child: InkWell(
        key: ValueKey('checkout-saved-card-$_id'),
        onTap: onTap,
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOut,
          width: double.infinity,
          constraints: const BoxConstraints(minHeight: 78),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
          decoration: BoxDecoration(
            color: selected ? colors.surfaceCream : Colors.white,
            borderRadius: BorderRadius.circular(BulkaRadii.control),
            border: Border.all(
              color: selected ? colors.brandGold : colors.cardBorder,
              width: selected ? 2 : 1,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 46,
                height: 42,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: colors.cardBorder),
                ),
                child: Icon(
                  Icons.credit_card_rounded,
                  color: colors.brandBrown,
                  size: 24,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _cardLabel,
                      style: const TextStyle(
                        fontFamily: _headingFont,
                        fontSize: BulkaTypeScale.body,
                        fontWeight: FontWeight.w700,
                        color: _textDark,
                      ),
                    ),
                    if (details.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        details,
                        style: TextStyle(
                          color: colors.mutedText,
                          fontSize: BulkaTypeScale.caption,
                          height: 1.25,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Icon(
                selected
                    ? Icons.check_circle_rounded
                    : Icons.radio_button_unchecked_rounded,
                color: selected ? colors.brandGold : colors.mutedText,
                size: 24,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CheckoutSavedCardsNotice extends StatelessWidget {
  const _CheckoutSavedCardsNotice({
    super.key,
    required this.icon,
    required this.message,
    required this.actionLabel,
    required this.onAction,
    this.actionLoading = false,
  });

  final IconData icon;
  final String message;
  final String actionLabel;
  final VoidCallback onAction;
  final bool actionLoading;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: colors.surfaceCream,
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        border: Border.all(color: colors.cardBorder),
      ),
      child: Column(
        children: [
          Icon(icon, size: 34, color: colors.brandBrown),
          const SizedBox(height: 10),
          Text(
            message,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: colors.mutedText,
              fontSize: BulkaTypeScale.bodySmall,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: GradientButton(
              onPressed: actionLoading ? null : onAction,
              loading: actionLoading,
              child: Text(
                actionLabel,
                style: const TextStyle(
                  fontFamily: _headingFont,
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
