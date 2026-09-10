part of '../main.dart';

class CatalogStockBadge extends StatelessWidget {
  const CatalogStockBadge({
    super.key,
    required this.quantity,
    this.unit = 'шт.',
  });
  final num quantity;
  final String unit;

  @override
  Widget build(BuildContext context) {
    final low = quantity <= 3;
    final pieces = unit == 'шт.' || unit == 'шт';
    final label =
        (pieces ? 'catalog_remaining_pieces' : 'catalog_remaining_weight')
            .trArgs({'count': productQuantityText(quantity), 'unit': unit});
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
        color: low ? const Color(0xFFFFF2D8) : const Color(0xFFEDF6EF),
        borderRadius: BorderRadius.circular(9),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: low ? const Color(0xFF855016) : const Color(0xFF28633E),
          fontSize: 12,
          fontWeight: FontWeight.w600,
          height: 1.25,
          fontFeatures: const [FontFeature.tabularFigures()],
        ),
      ),
    );
  }
}
