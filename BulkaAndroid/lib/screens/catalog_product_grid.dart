part of '../main.dart';

({int columns, double spacing, double cardExtent}) catalogCategoryGridGeometry(
  double contentExtent,
) {
  const spacing = 14.0;
  final columns = contentExtent >= 980
      ? 4
      : contentExtent >= 620
      ? 3
      : 2;
  return (
    columns: columns,
    spacing: spacing,
    cardExtent: max(1.0, (contentExtent - spacing * (columns - 1)) / columns),
  );
}

extension _CatalogProductGrid on _CatalogScreenState {
  Widget _buildProductRows(
    List<CatalogProduct> products,
    int columns,
    double spacing, {
    Key? key,
  }) {
    final cart = context.read<CartProvider>();
    return SliverList.builder(
      key: key,
      itemCount: (products.length / columns).ceil(),
      itemBuilder: (context, row) {
        final content = Padding(
          padding: const EdgeInsets.only(bottom: 18),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (var column = 0; column < columns; column++) ...[
                if (column > 0) SizedBox(width: spacing),
                Expanded(
                  child: row * columns + column < products.length
                      ? _buildProductCard(
                          products[row * columns + column],
                          cart.getQuantity(products[row * columns + column].id),
                        )
                      : const SizedBox.shrink(),
                ),
              ],
            ],
          ),
        );
        final geometry = catalogCategoryGridGeometry(_catalogContentExtent);
        final firstRows = max(
          1,
          ((_catalogViewportHeight - 80) / (geometry.cardExtent + 100)).ceil(),
        );
        if (_openedCategory == null || row >= firstRows) return content;
        return AnimatedBuilder(
          key: ValueKey('catalog-row-enter-$_openedCategory-$row'),
          animation: _categoryEntrance,
          child: content,
          builder: (context, child) => Transform.translate(
            offset: Offset(
              0,
              10 * (1 - Curves.easeOutCubic.transform(_categoryEntrance.value)),
            ),
            child: child,
          ),
        );
      },
    );
  }
}
