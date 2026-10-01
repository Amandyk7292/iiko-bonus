part of '../main.dart';

class _CatalogFeedRow {
  const _CatalogFeedRow({required this.extent, this.category, this.products});
  final double extent;
  final String? category;
  final List<CatalogProduct>? products;
}

// Known row extents let the lazy list jump directly to a distant category.
// Text is measured with the same font, width and text scaling as the cards.
class _CatalogFeedLayout {
  _CatalogFeedLayout({
    required this.products,
    required this.width,
    required this.textScaler,
    required this.direction,
    required this.locale,
    required this.showStock,
    required this.grouped,
    required this.formatPrice,
  }) {
    columns = textScaler.scale(14) > 20 && width < 620
        ? 1
        : catalogCategoryGridGeometry(width).columns;
    cardWidth = (width - spacing * (columns - 1)) / columns;
    if (grouped) {
      final groups = <String, List<CatalogProduct>>{};
      for (final product in products) {
        groups.putIfAbsent(product.category, () => []).add(product);
      }
      for (final group in catalogCategoriesAvailableFirst(
        groups.entries.toList(),
      )) {
        categoryOffsets[group.key] = totalExtent;
        _add(
          _CatalogFeedRow(
            category: group.key,
            extent:
                28 +
                _textHeight(
                  group.key,
                  const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    height: 1.25,
                  ),
                  width,
                  maxLines: 2,
                ),
          ),
        );
        _addProducts(group.value);
      }
    } else {
      _addProducts(products);
    }
  }

  static const spacing = 14.0;
  final List<CatalogProduct> products;
  final double width;
  final TextScaler textScaler;
  final TextDirection direction;
  final String locale;
  final bool showStock;
  final bool grouped;
  final String Function(int) formatPrice;
  late final int columns;
  late final double cardWidth;
  final rows = <_CatalogFeedRow>[];
  final categoryOffsets = <String, double>{};
  double totalExtent = 0;

  void _add(_CatalogFeedRow row) {
    rows.add(row);
    totalExtent += row.extent;
  }

  void _addProducts(List<CatalogProduct> items) {
    for (var first = 0; first < items.length; first += columns) {
      final row = items.sublist(first, min(first + columns, items.length));
      final height = row.map(_cardHeight).reduce(max);
      _add(_CatalogFeedRow(products: row, extent: height + 18));
    }
  }

  double _textHeight(
    String value,
    TextStyle style,
    double availableWidth, {
    int? maxLines,
  }) {
    final painter = TextPainter(
      text: TextSpan(
        text: value,
        style: style.copyWith(fontFamily: _descriptionFont),
      ),
      textDirection: direction,
      textScaler: textScaler,
      maxLines: maxLines,
      ellipsis: maxLines == null ? null : '…',
    )..layout(maxWidth: max(1, availableWidth));
    final height = painter.height;
    painter.dispose();
    return height;
  }

  double _cardHeight(CatalogProduct product) {
    final textWidth = cardWidth - 4;
    var height = cardWidth + 10 + 6;
    if (product.badges.any(ProductPhotoSticker.isSticker)) {
      final badgeHeight = _textBadgeHeight(product.badges);
      if (badgeHeight > 0) height += badgeHeight + 6;
    }
    height += _textHeight(
      '${formatPrice(product.price)} ₸',
      const TextStyle(
        fontSize: BulkaTypeScale.titleSmall,
        fontWeight: FontWeight.w700,
        height: 1.2,
      ),
      textWidth,
      maxLines: 1,
    );
    height +=
        5 +
        _textHeight(
          product.title,
          const TextStyle(
            fontSize: BulkaTypeScale.bodySmall,
            fontWeight: FontWeight.w600,
            height: 1.18,
            letterSpacing: -0.2,
          ),
          textWidth,
          maxLines: 2,
        );
    if (showStock && !product.isStopListed && product.inStockCount != null) {
      final pieces = product.unit == 'шт.' || product.unit == 'шт';
      final label =
          (pieces ? 'catalog_remaining_pieces' : 'catalog_remaining_weight')
              .trArgs({
                'count': productQuantityText(product.inStockCount!),
                'unit': product.unit,
              });
      height +=
          8 +
          12 +
          _textHeight(
            label,
            const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              height: 1.25,
            ),
            textWidth - 18,
          );
    }
    if (product.weightGrams != null) {
      height +=
          5 +
          _textHeight(
            'catalog_weight_short'.trArgs({'weight': product.weightGrams}),
            const TextStyle(
              fontSize: BulkaTypeScale.caption,
              fontWeight: FontWeight.w600,
              height: 1.25,
            ),
            textWidth,
          );
    }
    return height.ceilToDouble() + 1;
  }

  double _textBadgeHeight(List<Map<String, dynamic>> badges) {
    var rowsHeight = 0.0, rowWidth = 0.0, rowHeight = 0.0;
    for (final badge
        in badges.where((b) => !ProductPhotoSticker.isSticker(b)).take(3)) {
      final painter = TextPainter(
        text: TextSpan(
          text: '${badge['label'] ?? ''}',
          style: ProductBadgeChips.textStyle,
        ),
        textDirection: direction,
        textScaler: textScaler,
        maxLines: 1,
        ellipsis: '…',
      )..layout(maxWidth: max(1, cardWidth - 16));
      final chipWidth = min(cardWidth, painter.width + 16);
      final chipHeight = painter.height + 8;
      painter.dispose();
      if (rowWidth > 0 && rowWidth + 4 + chipWidth > cardWidth) {
        rowsHeight += rowHeight + 4;
        rowWidth = 0;
        rowHeight = 0;
      }
      rowWidth += (rowWidth > 0 ? 4 : 0) + chipWidth;
      rowHeight = max(rowHeight, chipHeight);
    }
    return rowsHeight + rowHeight;
  }
}

extension _CatalogFeedView on _CatalogScreenState {
  _CatalogFeedLayout _prepareCatalogFeed(
    List<CatalogProduct> products,
    double width, {
    required bool grouped,
  }) {
    final scale = MediaQuery.textScalerOf(context);
    final direction = Directionality.of(context);
    final cached = _catalogFeedLayout;
    if (cached == null ||
        cached.width != width ||
        cached.textScaler != scale ||
        cached.direction != direction ||
        cached.locale != AppLang.current ||
        cached.showStock != _selectedBakeryId.isNotEmpty ||
        cached.grouped != grouped ||
        !listEquals(cached.products, products)) {
      _catalogClampedSelection = null;
      _catalogFeedLayout = _CatalogFeedLayout(
        products: products,
        width: width,
        textScaler: scale,
        direction: direction,
        locale: AppLang.current,
        formatPrice: (price) => formatUiInteger(context, price),
        showStock: _selectedBakeryId.isNotEmpty,
        grouped: grouped,
      );
    }
    _scheduleCatalogScrollSync();
    return _catalogFeedLayout!;
  }

  Widget _buildCatalogFeed(_CatalogFeedLayout feed) {
    final cart = context.read<CartProvider>();
    return SliverPadding(
      padding: EdgeInsets.fromLTRB(
        16,
        0,
        16,
        _catalogContentBottomInset(context),
      ),
      sliver: SliverVariedExtentList.builder(
        key: _catalogFeedKey,
        itemCount: feed.rows.length,
        itemExtentBuilder: (index, _) =>
            index < feed.rows.length ? feed.rows[index].extent : null,
        itemBuilder: (context, index) {
          final row = feed.rows[index];
          if (row.category != null) {
            return Padding(
              padding: const EdgeInsets.only(top: 16, bottom: 12),
              child: Semantics(
                header: true,
                child: Text(
                  row.category!,
                  key: ValueKey('catalog-section-${row.category}'),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontFamily: _descriptionFont,
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    height: 1.25,
                    color: Theme.of(context).colorScheme.onSurface,
                  ),
                ),
              ),
            );
          }
          final products = row.products!;
          return Padding(
            padding: const EdgeInsets.only(bottom: 18),
            child: Align(
              alignment: Alignment.topCenter,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (var column = 0; column < feed.columns; column++) ...[
                    if (column > 0)
                      const SizedBox(width: _CatalogFeedLayout.spacing),
                    Expanded(
                      child: column < products.length
                          ? _buildProductCard(
                              products[column],
                              cart.getQuantity(products[column].id),
                            )
                          : const SizedBox.shrink(),
                    ),
                  ],
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
