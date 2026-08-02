part of '../main.dart';

enum _CheckoutPaymentMethod { kaspi, forte }

enum _CheckoutPaymentVisual { kaspi, bankCard }

class _CheckoutDetails {
  const _CheckoutDetails({
    required this.checkoutId,
    required this.orderType,
    required this.scheduledAt,
    required this.paymentMethod,
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
  final _CheckoutPaymentMethod paymentMethod;
  final String? preorderFulfillmentType;
  final String? branch;
  final String? branchId;
  final DeliveryAddress? deliveryAddress;
  final String? additionalPhone;
  final String? promoCode;
  final String? comment;
}

class _CheckoutPaymentCard extends StatelessWidget {
  const _CheckoutPaymentCard({
    required this.cardKey,
    required this.title,
    required this.subtitle,
    required this.visual,
    required this.available,
    required this.selected,
    required this.onTap,
  });

  final Key cardKey;
  final String title;
  final String subtitle;
  final _CheckoutPaymentVisual visual;
  final bool? available;
  final bool selected;
  final VoidCallback onTap;

  Widget _buildPaymentMark(bool enabled) {
    return switch (visual) {
      _CheckoutPaymentVisual.kaspi => Icon(
        Icons.account_balance_wallet_outlined,
        color: enabled ? _textDark : Colors.grey,
      ),
      _CheckoutPaymentVisual.bankCard => Opacity(
        opacity: enabled ? 1 : 0.42,
        child: SvgPicture.asset(
          'assets/brand/card_networks.svg',
          width: 78,
          height: 24,
          fit: BoxFit.contain,
          excludeFromSemantics: true,
        ),
      ),
    };
  }

  @override
  Widget build(BuildContext context) {
    final enabled = available == true;
    return Semantics(
      button: true,
      selected: selected,
      enabled: enabled,
      label: '$title. $subtitle',
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        child: AnimatedContainer(
          key: cardKey,
          duration: const Duration(milliseconds: 180),
          width: double.infinity,
          constraints: const BoxConstraints(minHeight: 112),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(BulkaRadii.control),
            border: Border.all(
              color: selected && enabled ? _bulkaYellow : Colors.grey.shade300,
              width: selected && enabled ? 2 : 1.5,
            ),
          ),
          child: available == null
              ? const Center(
                  child: SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        _buildPaymentMark(enabled),
                        const Spacer(),
                        if (selected && enabled)
                          const Icon(
                            Icons.check_circle_rounded,
                            color: _bulkaYellow,
                            size: 20,
                          ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Text(
                      title,
                      style: TextStyle(
                        fontFamily: _headingFont,
                        fontWeight: FontWeight.w700,
                        color: enabled ? _textDark : Colors.grey.shade600,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      enabled ? subtitle : 'payment_method_unavailable'.tr,
                      style: TextStyle(
                        color: Colors.grey.shade600,
                        fontSize: BulkaTypeScale.caption,
                        height: 1.2,
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}
