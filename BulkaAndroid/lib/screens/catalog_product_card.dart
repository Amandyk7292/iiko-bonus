part of '../main.dart';

extension _CatalogProductCard on _CatalogScreenState {
  Widget _buildProductCard(CatalogProduct product, int quantity) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    final favorite = _favoriteProductIds.contains(product.id);
    final unavailable = product.isStopListed;
    final stockKey = _stockSubscriptionKey(product.id, _selectedBakeryId);
    final stockSubscribed = _stockSubscriptions.containsKey(stockKey);
    final stockBusy = _stockSubscriptionBusy.contains(stockKey);

    return Semantics(
      container: true,
      explicitChildNodes: true,
      enabled: !unavailable,
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
              BulkaPressScale(
                pressedScale: 0.975,
                child: Material(
                  color: Colors.transparent,
                  child: Semantics(
                    button: true,
                    enabled: !unavailable,
                    label: _catalogOpenProductLabel(product),
                    excludeSemantics: true,
                    child: InkWell(
                      onTap: unavailable
                          ? null
                          : () => _openProductDetails(product),
                      borderRadius: BorderRadius.circular(BulkaRadii.card),
                      child: _CatalogProductImage(
                        key: ValueKey('catalog-product-image-${product.id}'),
                        url: product.imageUrl,
                        semanticLabel: product.title,
                        heroTag: 'catalog-product-${product.id}',
                        borderRadius: BorderRadius.circular(BulkaRadii.card),
                        safePadding: EdgeInsets.zero,
                        disabled: unavailable,
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
                    onPressed: unavailable
                        ? null
                        : () => unawaited(_toggleFavorite(product)),
                    tooltip: favorite
                        ? 'catalog_remove_favorite'.tr
                        : 'catalog_add_favorite'.tr,
                    style: IconButton.styleFrom(
                      backgroundColor: unavailable
                          ? const Color(0xFFF0EEEB).withValues(alpha: 0.94)
                          : Colors.white.withValues(alpha: 0.9),
                      foregroundColor: unavailable
                          ? colors.mutedText
                          : favorite
                          ? colors.brandBrown
                          : colors.mutedText,
                      minimumSize: const Size(44, 44),
                      side: BorderSide(
                        color: unavailable
                            ? colors.cardBorder
                            : favorite
                            ? colors.brandGold
                            : colors.cardBorder.withValues(alpha: 0.72),
                      ),
                      shape: const CircleBorder(),
                    ),
                    icon: Icon(
                      favorite
                          ? Icons.favorite_rounded
                          : Icons.favorite_border_rounded,
                      size: 23,
                    ),
                  ),
                ),
              ),
              if (unavailable)
                Positioned(
                  left: 8,
                  top: 8,
                  child: ExcludeSemantics(
                    child: Container(
                      key: ValueKey('catalog-stop-list-${product.id}'),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 9,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF0EEEB).withValues(alpha: 0.96),
                        borderRadius: BorderRadius.circular(BulkaRadii.small),
                        border: Border.all(color: colors.cardBorder),
                      ),
                      child: Text(
                        'catalog_stop_list'.tr,
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
              Positioned(
                right: 7,
                bottom: -20,
                child: unavailable
                    ? Semantics(
                        button: true,
                        toggled: stockSubscribed,
                        label: stockSubscribed
                            ? 'stock_notify_enabled'.tr
                            : 'stock_notify_enable'.tr,
                        child: IconButton.filled(
                          key: ValueKey('stock-notify-${product.id}'),
                          tooltip: stockSubscribed
                              ? 'stock_notify_enabled'.tr
                              : 'stock_notify_enable'.tr,
                          onPressed: stockBusy
                              ? null
                              : () => unawaited(
                                  _toggleStockSubscription(product),
                                ),
                          style: IconButton.styleFrom(
                            minimumSize: const Size(48, 48),
                            backgroundColor: stockSubscribed
                                ? colors.brandBrown
                                : _bulkaYellow,
                            foregroundColor: stockSubscribed
                                ? Colors.white
                                : _textDark,
                          ),
                          icon: Icon(
                            stockSubscribed
                                ? Icons.notifications_active_rounded
                                : Icons.add_alert_rounded,
                          ),
                        ),
                      )
                    : _CatalogImageQuantityControl(
                        quantity: quantity,
                        stopListed: false,
                        onAdd: () => _setProductQuantity(product, 1),
                        onDecrease: () =>
                            _setProductQuantity(product, quantity - 1),
                        onIncrease:
                            quantity >= _catalogProductQuantityLimit(product)
                            ? null
                            : () => _setProductQuantity(product, quantity + 1),
                      ),
              ),
            ],
          ),
          const SizedBox(height: 25),
          Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: unavailable ? null : () => _openProductDetails(product),
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
