part of '../main.dart';

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
      itemBuilder: (context, row) => Padding(
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
      ),
    );
  }
}
