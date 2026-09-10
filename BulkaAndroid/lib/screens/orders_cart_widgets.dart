part of '../main.dart';

String _formatCartMoney(int value) {
  final source = value.toString();
  final result = StringBuffer();
  for (var i = 0; i < source.length; i++) {
    if (i > 0 && (source.length - i) % 3 == 0) result.write(' ');
    result.write(source[i]);
  }
  return result.toString();
}

String _newCheckoutId() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes
      .map((value) => value.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

class _CartProductCard extends StatelessWidget {
  const _CartProductCard({
    required this.item,
    required this.onDecrease,
    required this.onIncrease,
  });

  final CartItem item;
  final VoidCallback onDecrease;
  final VoidCallback? onIncrease;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        border: Border.all(color: colors.cardBorder),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (item.imageUrl.trim().isNotEmpty) ...[
                  ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: SizedBox(
                      width: 64,
                      height: 64,
                      child: _NetworkImage(
                        url: item.imageUrl,
                        fit: BoxFit.cover,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                ],
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        localizeCatalogName(item.name),
                        style: TextStyle(
                          color: scheme.onSurface,
                          fontSize: BulkaTypeScale.body,
                          height: 1.3,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      if (item.isStopListed)
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Text(
                            'cart_unavailable'.tr,
                            style: TextStyle(color: colors.danger),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 12,
              runSpacing: 10,
              children: [
                Text(
                  '${_formatCartMoney(item.price)} ₸',
                  style: TextStyle(
                    color: scheme.onSurface,
                    fontSize: BulkaTypeScale.body,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                _CartQuantityStepper(
                  quantity: item.quantity,
                  unit: item.quantityStep < 1 ? item.unit : '',
                  onDecrease: onDecrease,
                  onIncrease: onIncrease,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _CartQuantityStepper extends StatelessWidget {
  const _CartQuantityStepper({
    required this.quantity,
    required this.onDecrease,
    required this.onIncrease,
    this.unit = '',
  });

  final num quantity;
  final String unit;
  final VoidCallback onDecrease;
  final VoidCallback? onIncrease;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minHeight: 48),
      decoration: BoxDecoration(
        color: _bulkaYellow,
        borderRadius: BorderRadius.circular(BulkaRadii.control),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            onPressed: onDecrease,
            tooltip: 'cart_decrease'.tr,
            constraints: const BoxConstraints.tightFor(width: 44, height: 48),
            padding: EdgeInsets.zero,
            icon: const Icon(Icons.remove_rounded, size: 20),
          ),
          Semantics(
            label: 'cart_quantity'.tr,
            value: '${productQuantityText(quantity)} $unit',
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              child: Text(
                '${productQuantityText(quantity)}${unit.isEmpty ? '' : ' $unit'}',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontFamily: _headingFont,
                  color: _textDark,
                  fontSize: BulkaTypeScale.body,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
          IconButton(
            onPressed: onIncrease,
            tooltip: 'cart_increase'.tr,
            constraints: const BoxConstraints.tightFor(width: 44, height: 48),
            padding: EdgeInsets.zero,
            icon: const Icon(Icons.add_rounded, size: 20),
          ),
        ],
      ),
    );
  }
}

class _CartCheckoutBar extends StatelessWidget {
  const _CartCheckoutBar({
    required this.total,
    required this.cashbackPercent,
    required this.hasUnavailableItems,
    required this.onCheckout,
  });

  final int total;
  final int cashbackPercent;
  final bool hasUnavailableItems;
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
        border: Border(top: BorderSide(color: colors.cardBorder)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
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
                    'cart_unavailable_hint'.tr,
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
            const SizedBox(height: 12),
          ],
          _CartSummaryLine(
            label: 'cart_reward'.tr,
            value:
                '+ ${(total * cashbackPercent / 100).round()} ${'cart_points'.tr}',
          ),
          const SizedBox(height: 12),
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

class _PickupSlot {
  const _PickupSlot({
    required this.label,
    required this.value,
    required this.startsAt,
    required this.endsAt,
    required this.timezoneOffsetMinutes,
    required this.serverNow,
    this.remaining,
  });
  final String label;
  final String value;
  final DateTime startsAt;
  final DateTime endsAt;
  final int timezoneOffsetMinutes;
  final DateTime serverNow;
  final int? remaining;
}

class _CartSummaryLine extends StatelessWidget {
  const _CartSummaryLine({
    required this.label,
    required this.value,
    this.emphasized = false,
  });
  final String label;
  final String value;
  final bool emphasized;
  @override
  Widget build(BuildContext context) {
    final style = TextStyle(
      fontSize: emphasized ? BulkaTypeScale.titleSmall : BulkaTypeScale.body,
      fontWeight: emphasized ? FontWeight.w600 : FontWeight.w400,
    );
    if (MediaQuery.textScalerOf(context).scale(1) > 1.3) {
      return SizedBox(
        width: double.infinity,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: style),
            const SizedBox(height: 4),
            Text(value, style: style),
          ],
        ),
      );
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: Text(label, style: style)),
        const SizedBox(width: 12),
        Flexible(
          child: Text(value, textAlign: TextAlign.end, style: style),
        ),
      ],
    );
  }
}
