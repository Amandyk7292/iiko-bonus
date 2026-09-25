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

@immutable
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
        border: Border.all(
          color: colors.cardBorder,
          width: BulkaStrokes.hairline,
        ),
        boxShadow: BulkaShadows.card,
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
