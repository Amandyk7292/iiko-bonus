part of '../main.dart';

class _ProductPhotoHeader extends StatelessWidget {
  const _ProductPhotoHeader({required this.product});

  final CatalogProduct product;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return LayoutBuilder(
      builder: (context, constraints) {
        final extent = product.imageUrl.trim().isEmpty
            ? 320.0
            : (constraints.maxWidth * 1.16).clamp(360.0, 520.0);
        final fallback = DecoratedBox(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFFF7ECD7), Color(0xFFEED7B4)],
            ),
          ),
          child: Center(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 56),
              child: Opacity(
                opacity: 0.48,
                child: Image.asset(
                  'assets/brand/bulka_logo.png',
                  width: 112,
                  excludeFromSemantics: true,
                ),
              ),
            ),
          ),
        );
        return ClipRRect(
          borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
          child: Stack(
            key: const ValueKey('product-photo-area'),
            children: [
              Positioned.fill(
                child: BulkaHero(
                  tag: 'catalog-product-${product.id}',
                  child: _NetworkImage(
                    url: product.imageUrl,
                    fit: BoxFit.cover,
                    semanticLabel: product.title,
                    loadingPlaceholder: fallback,
                    errorPlaceholder: fallback,
                  ),
                ),
              ),
              const Positioned.fill(
                child: IgnorePointer(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          Color(0x00FFFFFF),
                          Color(0x00FFFFFF),
                          Color(0xE6FFFFFF),
                          Colors.white,
                        ],
                        stops: [0, 0.55, 0.84, 1],
                      ),
                    ),
                  ),
                ),
              ),
              Padding(
                padding: EdgeInsets.fromLTRB(24, extent - 78, 24, 20),
                child: Align(
                  alignment: Alignment.center,
                  child: Text(
                    product.title,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontFamily: _headingFont,
                      fontSize: BulkaTypeScale.titleLarge,
                      fontWeight: FontWeight.w800,
                      height: 1.14,
                      color: colors.brandBrown,
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _ProductPurchaseBar extends StatelessWidget {
  const _ProductPurchaseBar({
    required this.price,
    required this.quantity,
    required this.disabled,
    required this.stopListed,
    required this.onAdd,
    required this.onDecrease,
    required this.onIncrease,
  });

  final int price;
  final int quantity;
  final bool disabled;
  final bool stopListed;
  final VoidCallback onAdd;
  final VoidCallback onDecrease;
  final VoidCallback? onIncrease;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final priceText = Text(
      '${formatUiInteger(context, price)} ₸',
      style: const TextStyle(
        fontFamily: _descriptionFont,
        fontSize: BulkaTypeScale.titleSmall,
        fontWeight: FontWeight.w700,
        fontFeatures: [FontFeature.tabularFigures()],
      ),
    );
    final label = Text(
      stopListed ? 'catalog_stop_list'.tr : 'catalog_add_to_cart'.tr,
      style: const TextStyle(
        fontFamily: _headingFont,
        fontSize: BulkaTypeScale.body,
        fontWeight: FontWeight.w800,
      ),
    );
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      decoration: const BoxDecoration(
        color: Colors.white,
        boxShadow: [
          BoxShadow(
            color: Color(0x0D6D3317),
            blurRadius: 24,
            offset: Offset(0, -6),
          ),
        ],
      ),
      child: quantity > 0 && !stopListed
          ? Container(
              constraints: const BoxConstraints(minHeight: 68),
              padding: const EdgeInsets.fromLTRB(20, 8, 8, 8),
              decoration: BoxDecoration(
                color: colors.surfaceCream,
                borderRadius: BorderRadius.circular(32),
                border: Border.all(color: colors.cardBorder),
              ),
              child: Row(
                children: [
                  Expanded(child: priceText),
                  _CatalogImageQuantityControl(
                    quantity: quantity,
                    stopListed: disabled,
                    onAdd: onAdd,
                    onDecrease: onDecrease,
                    onIncrease: onIncrease,
                  ),
                ],
              ),
            )
          : FilledButton(
              key: const ValueKey('catalog-image-add'),
              onPressed: disabled ? null : onAdd,
              style: FilledButton.styleFrom(
                backgroundColor: colors.brandGold,
                foregroundColor: colors.brandBrown,
                disabledBackgroundColor: colors.surfaceCream,
                disabledForegroundColor: colors.mutedText,
                minimumSize: const Size(double.infinity, 68),
                padding: const EdgeInsets.symmetric(
                  horizontal: 24,
                  vertical: 18,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(32),
                ),
              ),
              child: MediaQuery.textScalerOf(context).scale(1) > 1.3
                  ? Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        label,
                        const SizedBox(height: 8),
                        Align(
                          alignment: Alignment.centerRight,
                          child: priceText,
                        ),
                      ],
                    )
                  : Row(
                      children: [
                        Expanded(child: label),
                        const SizedBox(width: 12),
                        priceText,
                      ],
                    ),
            ),
    );
  }
}

class _ProductFactIcon extends StatelessWidget {
  const _ProductFactIcon({required this.value, required this.isAllergen});

  final String value;
  final bool isAllergen;

  double _assetExtent(String assetName) => switch (assetName) {
    // EAC has a much denser silhouette than the circular marks. A smaller
    // optical box keeps all certificates equally weighted in the grid.
    'eac' => 54,
    'under-3' || 'traces-nuts-sesame' => 60,
    _ => 62,
  };

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final assetName = isAllergen
        ? _allergenIconName(value)
        : _productMarkIconName(value);
    final label = isAllergen
        ? localizeAllergenLabel(value)
        : localizeProductMarkLabel(value);
    return Semantics(
      label: label,
      image: true,
      child: SizedBox(
        width: double.infinity,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox.square(
              dimension: 72,
              child: Center(
                child: assetName != null
                    ? Image.asset(
                        'assets/product_marks/$assetName.png',
                        width: _assetExtent(assetName),
                        height: _assetExtent(assetName),
                        fit: BoxFit.contain,
                        alignment: Alignment.center,
                        filterQuality: FilterQuality.high,
                        excludeFromSemantics: true,
                      )
                    : Container(
                        width: 58,
                        height: 58,
                        decoration: BoxDecoration(
                          color: colors.brandGold.withValues(alpha: 0.14),
                          shape: BoxShape.circle,
                          border: Border.all(color: colors.cardBorder),
                        ),
                        child: Icon(
                          isAllergen
                              ? Icons.warning_amber_rounded
                              : Icons.verified_outlined,
                          color: colors.brandBrown,
                        ),
                      ),
              ),
            ),
            const SizedBox(height: 5),
            ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 32),
              child: Center(
                child: Text(
                  label,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontFamily: _descriptionFont,
                    color: colors.brandBrown,
                    fontSize: BulkaTypeScale.caption,
                    height: 1.18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ProductFactGrid extends StatelessWidget {
  const _ProductFactGrid({required this.values, required this.isAllergen});

  final List<String> values;
  final bool isAllergen;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth >= 640
            ? 4
            : constraints.maxWidth >= 440
            ? 3
            : 2;
        const spacing = 12.0;
        final cellWidth =
            (constraints.maxWidth - spacing * (columns - 1)) / columns;
        return Wrap(
          alignment: WrapAlignment.center,
          crossAxisAlignment: WrapCrossAlignment.start,
          spacing: spacing,
          runSpacing: 16,
          children: values
              .map(
                (value) => SizedBox(
                  width: cellWidth,
                  child: _ProductFactIcon(value: value, isAllergen: isAllergen),
                ),
              )
              .toList(),
        );
      },
    );
  }
}

class _ProductStorageConditions extends StatelessWidget {
  const _ProductStorageConditions({required this.conditions});

  final List<ProductStorageCondition> conditions;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return LayoutBuilder(
      builder: (context, constraints) {
        final textScale = MediaQuery.textScalerOf(context).scale(1);
        final columns =
            conditions.length > 1 &&
                constraints.maxWidth >= 280 &&
                textScale <= 1.3
            ? 2
            : 1;
        const spacing = 16.0;
        final cellWidth =
            (constraints.maxWidth - spacing * (columns - 1)) / columns;
        return Wrap(
          alignment: WrapAlignment.center,
          spacing: spacing,
          runSpacing: 18,
          children: conditions
              .map(
                (condition) => Semantics(
                  label:
                      '${'catalog_storage_at_temperature'.tr} ${condition.temperature}, ${productStorageDurationLabel(condition)}',
                  child: SizedBox(
                    width: cellWidth,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'catalog_storage_at_temperature'.tr,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontFamily: _descriptionFont,
                            color: colors.mutedText,
                            fontSize: BulkaTypeScale.bodySmall,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        const SizedBox(height: 7),
                        Text(
                          condition.temperature,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontFamily: _descriptionFont,
                            color: colors.brandGold,
                            fontSize: BulkaTypeScale.title,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          productStorageDurationLabel(condition),
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontFamily: _descriptionFont,
                            color: colors.brandGold,
                            fontSize: BulkaTypeScale.body,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              )
              .toList(),
        );
      },
    );
  }
}
