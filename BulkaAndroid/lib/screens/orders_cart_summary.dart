part of '../main.dart';

class _CartCheckoutBar extends StatelessWidget {
  const _CartCheckoutBar({
    required this.total,
    required this.cashbackPercent,
    required this.hasUnavailableItems,
    required this.isGuest,
    required this.orderType,
    required this.fulfillmentLabel,
    this.returnOrderType,
    this.onReturnToOrderType,
    this.onChooseOrderType,
    required this.onCheckout,
  });

  final int total;
  final int cashbackPercent;
  final bool hasUnavailableItems;
  final bool isGuest;
  final String orderType;
  final String fulfillmentLabel;
  final String? returnOrderType;
  final Future<void> Function(String)? onReturnToOrderType;
  final VoidCallback? onChooseOrderType;
  final VoidCallback? onCheckout;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(24, 18, 24, 20),
      decoration: BoxDecoration(
        color: scheme.surface,
        border: Border(
          top: BorderSide(
            color: colors.cardBorder,
            width: BulkaStrokes.hairline,
          ),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              '${_orderTypeFromWire(orderType).label}${fulfillmentLabel.isEmpty ? '' : ' · $fulfillmentLabel'}',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
          const SizedBox(height: 12),
          if (hasUnavailableItems) ...[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.info_outline_rounded,
                  size: 20,
                  color: context.bulkaColors.danger,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    (returnOrderType != null &&
                                returnOrderType != orderType &&
                                onReturnToOrderType != null
                            ? 'cart_unavailable_return_hint'
                            : 'cart_unavailable_hint')
                        .tr,
                    style: TextStyle(
                      color: context.bulkaColors.danger,
                      fontSize: BulkaTypeScale.bodySmall,
                      height: 1.25,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
            if (returnOrderType != null &&
                returnOrderType != orderType &&
                onReturnToOrderType != null)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: () => onReturnToOrderType!(returnOrderType!),
                  child: Text(
                    'cart_return_to_mode'.trArgs({
                      'type': _orderTypeFromWire(returnOrderType).label,
                    }),
                  ),
                ),
              ),
            if ((returnOrderType == null ||
                    returnOrderType == orderType ||
                    onReturnToOrderType == null) &&
                onChooseOrderType != null)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: onChooseOrderType,
                  child: Text('cart_choose_order_type'.tr),
                ),
              ),
            const SizedBox(height: 12),
          ],
          if (isGuest)
            Align(
              alignment: Alignment.centerLeft,
              child: Text('cart_guest_bonus_hint'.tr),
            )
          else
            _CartSummaryLine(
              label: 'cart_reward'.tr,
              value:
                  '+ ${(total * cashbackPercent / 100).round()} ${'cart_points'.tr}',
            ),
          const SizedBox(height: 12),
          if (orderType == 'delivery') ...[
            Align(
              alignment: Alignment.centerLeft,
              child: Text('cart_delivery_fee_hint'.tr),
            ),
            const SizedBox(height: 12),
          ],
          _CartSummaryLine(
            label: 'cart_total'.tr,
            value: '${_formatCartMoney(total)} ₸',
            emphasized: true,
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: GradientButton(
              onPressed: onCheckout,
              child: Text(
                'cart_checkout'.tr,
                style: const TextStyle(
                  fontFamily: _headingFont,
                  fontSize: BulkaTypeScale.body,
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
