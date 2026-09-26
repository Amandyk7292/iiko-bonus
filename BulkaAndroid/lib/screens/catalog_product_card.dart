part of '../main.dart';

extension _CatalogProductCard on _CatalogScreenState {
  Widget _buildProductCard(CatalogProduct product, num quantity) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    final favorite = _favoriteProductIds.contains(product.id);
    final unavailable = product.isStopListed;
    return Semantics(
      container: true,
      explicitChildNodes: true,
      enabled: true,
      label: product.title,
      value: [
        '${_CatalogScreenState._formatPrice(context, product.price)} ₸',
        product.isStopListed ? 'catalog_stop_list'.tr : 'catalog_in_stock'.tr,
        if (product.weightGrams != null)
          'catalog_weight_value'.trArgs({'weight': product.weightGrams}),
      ].join('. '),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              RepaintBoundary(
                child: Material(
                  color: Colors.transparent,
                  child: Semantics(
                    button: true,
                    enabled: true,
                    label: _catalogOpenProductLabel(product),
                    excludeSemantics: true,
                    child: InkWell(
                      onTap: () => _openProductDetails(product),
                      borderRadius: BorderRadius.circular(BulkaRadii.card),
                      child: _CatalogProductImage(
                        key: ValueKey('catalog-product-image-${product.id}'),
                        url: product.imageUrl,
                        semanticLabel: product.title,
                        heroTag: 'catalog-product-${product.id}',
                        borderRadius: BorderRadius.circular(BulkaRadii.card),
                        safePadding: EdgeInsets.zero,
                      ),
                    ),
                  ),
                ),
              ),
              Positioned(
                top: 8,
                right: 8,
                child: Semantics(
                  button: true,
                  toggled: favorite,
                  label: favorite
                      ? 'catalog_remove_favorite'.tr
                      : 'catalog_add_favorite'.tr,
                  excludeSemantics: true,
                  child: IconButton(
                    key: ValueKey('catalog-favorite-${product.id}'),
                    onPressed: () => unawaited(_toggleFavorite(product)),
                    tooltip: favorite
                        ? 'catalog_remove_favorite'.tr
                        : 'catalog_add_favorite'.tr,
                    style: IconButton.styleFrom(
                      backgroundColor: Colors.white.withValues(alpha: 0.94),
                      foregroundColor: favorite
                          ? colors.brandBrown
                          : colors.mutedText,
                      minimumSize: const Size(44, 44),
                      side: BorderSide(
                        color: favorite
                            ? colors.brandGold
                            : colors.cardBorder.withValues(alpha: 0.72),
                      ),
                      shape: const CircleBorder(),
                    ),
                    icon: BulkaFavoriteGlyph(selected: favorite, size: 23),
                  ),
                ),
              ),
              if (product.badges.isNotEmpty)
                Positioned(
                  left: 8,
                  top: 8,
                  right: 56,
                  child: IgnorePointer(
                    child: ProductBadgeChips(badges: product.badges),
                  ),
                ),
              Positioned(
                left: 0,
                right: 7,
                bottom: -20,
                child: AnimatedSwitcher(
                  duration: BulkaMotion.duration(
                    context,
                    const Duration(milliseconds: 220),
                  ),
                  layoutBuilder: (current, previous) => Stack(
                    alignment: Alignment.centerRight,
                    children: [
                      for (final child in previous)
                        ExcludeSemantics(child: IgnorePointer(child: child)),
                      ?current,
                    ],
                  ),
                  switchInCurve: Curves.easeOutCubic,
                  switchOutCurve: Curves.easeIn,
                  transitionBuilder: (child, animation) => FadeTransition(
                    opacity: animation,
                    child: ScaleTransition(scale: animation, child: child),
                  ),
                  child: unavailable
                      ? ExcludeSemantics(
                          key: ValueKey('catalog-stop-list-${product.id}'),
                          child: Align(
                            alignment: Alignment.centerRight,
                            child: Container(
                              constraints: const BoxConstraints(minHeight: 40),
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 9,
                              ),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF0EEEB),
                                borderRadius: BorderRadius.circular(
                                  BulkaRadii.small,
                                ),
                                border: Border.all(
                                  color: colors.cardBorder,
                                  width: BulkaStrokes.hairline,
                                ),
                              ),
                              child: Center(
                                widthFactor: 1,
                                heightFactor: 1,
                                child: Text(
                                  'catalog_stop_list'.tr,
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    color: colors.mutedText,
                                    fontFamily: _descriptionFont,
                                    fontSize: BulkaTypeScale.badge,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        )
                      : _CatalogImageQuantityControl(
                          key: ValueKey('catalog-quantity-${product.id}'),
                          quantity: quantity,
                          unit: product.quantityStep < 1 ? product.unit : '',
                          stopListed: false,
                          onAdd: () =>
                              _setProductQuantity(product, product.increment),
                          onDecrease: () => _setProductQuantity(
                            product,
                            quantity - product.increment,
                          ),
                          onIncrease:
                              quantity >= _catalogProductQuantityLimit(product)
                              ? null
                              : () => _setProductQuantity(
                                  product,
                                  quantity + product.increment,
                                ),
                        ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 25),
          Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: () => _openProductDetails(product),
              borderRadius: BorderRadius.circular(BulkaRadii.control),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 3),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${_CatalogScreenState._formatPrice(context, product.price)} ₸',
                      maxLines: 1,
                      style: TextStyle(
                        fontFamily: _descriptionFont,
                        fontWeight: FontWeight.w700,
                        fontSize: BulkaTypeScale.titleSmall,
                        color: unavailable
                            ? colors.mutedText
                            : colors.brandBrown,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      product.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: BulkaTypeScale.bodySmall,
                        color: unavailable
                            ? colors.mutedText
                            : scheme.onSurface,
                        height: 1.18,
                        letterSpacing: -0.2,
                      ),
                    ),
                    if (_selectedBakeryId.isNotEmpty &&
                        !unavailable &&
                        product.inStockCount != null) ...[
                      const SizedBox(height: 8),
                      CatalogStockBadge(
                        quantity: product.inStockCount!,
                        unit: product.unit,
                      ),
                    ],
                    if (product.weightGrams != null) ...[
                      const SizedBox(height: 5),
                      Text(
                        'catalog_weight_short'.trArgs({
                          'weight': product.weightGrams,
                        }),
                        style: TextStyle(
                          fontSize: BulkaTypeScale.caption,
                          fontWeight: FontWeight.w600,
                          color: colors.mutedText,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
