part of '../main.dart';

num _catalogProductQuantityLimit(CatalogProduct product) => min(
  product.inStockCount ?? CartProvider.maxItemQuantity,
  CartProvider.maxItemQuantity,
);

String _catalogOpenProductLabel(CatalogProduct product) =>
    'catalog_open_product'.trArgs({'name': product.title});

class _CatalogProductImage extends StatelessWidget {
  const _CatalogProductImage({
    required this.url,
    required this.semanticLabel,
    this.heroTag,
    this.borderRadius = const BorderRadius.all(
      Radius.circular(BulkaRadii.control),
    ),
    this.safePadding = const EdgeInsets.all(4),
    super.key,
  });

  final String url;
  final String semanticLabel;
  final Object? heroTag;
  final BorderRadius borderRadius;
  final EdgeInsets safePadding;

  @override
  Widget build(BuildContext context) {
    final imageUrl = url.trim();
    final placeholderDecoration = BoxDecoration(
      gradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [Colors.white, context.bulkaColors.skeletonBase],
      ),
      borderRadius: borderRadius,
      border: Border.all(
        color: context.bulkaColors.cardBorder,
        width: BulkaStrokes.hairline,
      ),
    );
    Widget image = ClipRRect(
      borderRadius: borderRadius,
      child: ColoredBox(
        color: Colors.white,
        child: Center(
          child: Padding(
            padding: imageUrl.isEmpty ? EdgeInsets.zero : safePadding,
            child: _NetworkImage(
              url: imageUrl,
              fit: BoxFit.cover,
              photo: true,
              animate: false,
              semanticLabel: semanticLabel,
              loadingPlaceholder: DecoratedBox(
                decoration: placeholderDecoration,
                child: const _PhotoLoadingIndicator(),
              ),
              errorPlaceholder: DecoratedBox(decoration: placeholderDecoration),
            ),
          ),
        ),
      ),
    );
    if (heroTag != null) {
      image = BulkaHero(
        tag: heroTag!,
        freezeImageDuringFlight: true,
        child: image,
      );
    }
    return AspectRatio(aspectRatio: 1, child: image);
  }
}

class _CatalogToolsHeaderDelegate extends SliverPersistentHeaderDelegate {
  const _CatalogToolsHeaderDelegate({
    required this.backgroundColor,
    required this.height,
    required this.child,
  });

  final Color backgroundColor;
  final double height;
  final Widget child;

  @override
  double get minExtent => height;

  @override
  double get maxExtent => height;

  @override
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    return Material(
      color: backgroundColor,
      surfaceTintColor: Colors.transparent,
      elevation: overlapsContent ? 3 : 0,
      shadowColor: const Color(0x336D3317),
      child: child,
    );
  }

  @override
  bool shouldRebuild(covariant _CatalogToolsHeaderDelegate oldDelegate) {
    return oldDelegate.backgroundColor != backgroundColor ||
        oldDelegate.height != height ||
        oldDelegate.child != child;
  }
}

class _CatalogCategoryChip extends StatelessWidget {
  const _CatalogCategoryChip({
    super.key,
    required this.label,
    required this.height,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final double height;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      child: BulkaPressScale(
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(BulkaRadii.control),
            child: BulkaButtonSurface(
              ink: true,
              tone: selected
                  ? BulkaButtonTone.choice
                  : BulkaButtonTone.secondary,
              child: Container(
                height: height,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Center(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: selected ? Colors.white : _bulkaBrown,
                      fontSize: BulkaTypeScale.bodySmall,
                      fontFamily: _descriptionFont,
                      height: 1.2,
                      fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CatalogImageQuantityControl extends StatelessWidget {
  const _CatalogImageQuantityControl({
    super.key,
    required this.quantity,
    required this.stopListed,
    required this.onAdd,
    required this.onDecrease,
    required this.onIncrease,
    this.unit = '',
  });

  final num quantity;
  final String unit;
  final bool stopListed;
  final VoidCallback onAdd;
  final VoidCallback onDecrease;
  final VoidCallback? onIncrease;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    if (quantity <= 0) {
      return Semantics(
        key: const ValueKey('catalog-image-add-semantics'),
        button: true,
        enabled: !stopListed,
        label: stopListed ? 'catalog_stop_list'.tr : 'catalog_add_to_cart'.tr,
        child: BulkaPressScale(
          enabled: !stopListed,
          child: IconButton(
            key: const ValueKey('catalog-image-add'),
            onPressed: stopListed ? null : onAdd,
            tooltip: stopListed
                ? 'catalog_stop_list'.tr
                : 'catalog_add_to_cart'.tr,
            style: IconButton.styleFrom(
              backgroundColor: stopListed
                  ? const Color(0xFFD9D5D0)
                  : colors.brandGold,
              foregroundColor: colors.brandBrown,
              disabledForegroundColor: colors.mutedText,
              minimumSize: const Size(50, 50),
              shape: const CircleBorder(),
              elevation: 1,
              shadowColor: colors.brandBrown.withValues(alpha: 0.12),
            ).copyWith(backgroundBuilder: _bulkaPrimaryButtonBackground),
            icon: Icon(
              stopListed ? Icons.block_rounded : Icons.add_rounded,
              size: 29,
            ),
          ),
        ),
      );
    }

    return Semantics(
      key: const ValueKey('catalog-image-quantity-semantics'),
      container: true,
      label: 'catalog_quantity_value'.trArgs({'count': quantity}),
      child: Container(
        key: const ValueKey('catalog-quantity'),
        height: 50,
        decoration: BoxDecoration(
          color: _bulkaYellow,
          gradient: _bulkaGlassGradient,
          borderRadius: BorderRadius.circular(BulkaRadii.card),
          border: Border.all(
            color: const Color(0xFFE2C995),
            width: BulkaStrokes.hairline,
          ),
          boxShadow: BulkaButtonSurface.softShadow,
        ),
        child: LayoutBuilder(
          builder: (context, constraints) => Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Semantics(
                button: true,
                label: 'catalog_decrease_quantity'.tr,
                child: ExcludeSemantics(
                  child: IconButton(
                    onPressed: onDecrease,
                    tooltip: 'catalog_decrease_quantity'.tr,
                    style: IconButton.styleFrom(
                      minimumSize: const Size(44, 48),
                      foregroundColor: colors.brandBrown,
                    ),
                    icon: const Icon(Icons.remove_rounded, size: 22),
                  ),
                ),
              ),
              SizedBox(
                width: min(
                  unit.isEmpty ? 28.0 : 66.0,
                  max(20.0, constraints.maxWidth - 100),
                ),
                child: BulkaValueTransition(
                  value: quantity,
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      '${productQuantityText(quantity)}${unit.isEmpty ? '' : ' $unit'}',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontFamily: _headingFont,
                        color: colors.brandBrown,
                        fontSize: BulkaTypeScale.body,
                        fontWeight: FontWeight.w700,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                  ),
                ),
              ),
              Semantics(
                button: true,
                enabled: onIncrease != null,
                label: onIncrease == null
                    ? 'catalog_quantity_limit_reached'.trArgs({
                        'count': CartProvider.maxItemQuantity,
                      })
                    : 'catalog_increase_quantity'.tr,
                child: ExcludeSemantics(
                  child: IconButton(
                    onPressed: onIncrease,
                    tooltip: onIncrease == null
                        ? 'catalog_quantity_limit_reached'.trArgs({
                            'count': CartProvider.maxItemQuantity,
                          })
                        : 'catalog_increase_quantity'.tr,
                    style: IconButton.styleFrom(
                      minimumSize: const Size(44, 48),
                      foregroundColor: colors.brandBrown,
                    ),
                    icon: const Icon(Icons.add_rounded, size: 22),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CatalogSkeletonCatalog extends StatefulWidget {
  const _CatalogSkeletonCatalog();

  @override
  State<_CatalogSkeletonCatalog> createState() =>
      _CatalogSkeletonCatalogState();
}

class _CatalogSkeletonCatalogState extends State<_CatalogSkeletonCatalog>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (BulkaMotion.reduced(context)) {
      _controller.stop();
    } else if (!_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduced = BulkaMotion.reduced(context);
    return Semantics(
      container: true,
      liveRegion: true,
      label: 'catalog_loading'.tr,
      child: ExcludeSemantics(
        child: IgnorePointer(
          child: RepaintBoundary(
            key: const ValueKey('catalog-skeleton-categories'),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
              child: LayoutBuilder(
                builder: (context, constraints) {
                  const spacing = 14.0;
                  final columnCount = constraints.maxWidth >= 980
                      ? 4
                      : constraints.maxWidth >= 620
                      ? 3
                      : 2;
                  final cardWidth =
                      (constraints.maxWidth - spacing * (columnCount - 1)) /
                      columnCount;
                  final textScale = MediaQuery.textScalerOf(context).scale(1);
                  final shimmer = reduced ? null : _controller;
                  return GridView.builder(
                    shrinkWrap: true,
                    primary: false,
                    physics: const NeverScrollableScrollPhysics(),
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: columnCount,
                      mainAxisSpacing: spacing,
                      crossAxisSpacing: spacing,
                      mainAxisExtent: cardWidth + (textScale > 1.2 ? 24 : 0),
                    ),
                    itemCount: columnCount * 2,
                    itemBuilder: (context, index) => ClipRRect(
                      key: ValueKey('catalog-skeleton-category-$index'),
                      borderRadius: BorderRadius.circular(BulkaRadii.card),
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          _CatalogSkeletonBox(radius: 24, animation: shimmer),
                          Positioned(
                            left: 16,
                            top: 16,
                            child: _CatalogSkeletonBox(
                              width: index.isEven ? 112 : 86,
                              height: 18,
                              radius: 4,
                              animation: shimmer,
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CatalogMessageState extends StatelessWidget {
  const _CatalogMessageState({
    this.icon,
    required this.title,
    required this.subtitle,
    this.actionLabel,
    this.actionIcon = Icons.refresh_rounded,
    this.onAction,
    super.key,
  });

  final IconData? icon;
  final String title;
  final String subtitle;
  final String? actionLabel;
  final IconData actionIcon;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      child: Center(
        child: Container(
          constraints: const BoxConstraints(maxWidth: 420),
          margin: const EdgeInsets.fromLTRB(24, 28, 24, 16),
          padding: const EdgeInsets.fromLTRB(24, 26, 24, 22),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(BulkaRadii.card),
            border: Border.all(
              color: context.bulkaColors.cardBorder,
              width: BulkaStrokes.hairline,
            ),
            boxShadow: BulkaShadows.card,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Container(
                  width: 64,
                  height: 64,
                  decoration: const BoxDecoration(
                    color: Color(0xFFFFECC0),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(icon, color: _bulkaBrown, size: 30),
                ),
                const SizedBox(height: 16),
              ],
              Text(
                title,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontFamily: _headingFont,
                  color: _textDark,
                  fontSize: BulkaTypeScale.titleSmall,
                  height: 1.2,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 7),
              Text(
                subtitle,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: context.bulkaColors.mutedText,
                  fontSize: BulkaTypeScale.bodySmall,
                  height: 1.35,
                  fontWeight: FontWeight.w500,
                ),
              ),
              if (actionLabel != null && onAction != null) ...[
                const SizedBox(height: 18),
                FilledButton.icon(
                  onPressed: onAction,
                  icon: Icon(actionIcon, size: 20),
                  label: Text(actionLabel!),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _CatalogSkeletonBox extends StatelessWidget {
  const _CatalogSkeletonBox({
    this.width,
    this.height,
    this.radius = 8,
    this.animation,
  });

  final double? width;
  final double? height;
  final double radius;
  final Animation<double>? animation;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    Widget box(double value) => Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment(-1.5 + value * 3, -0.2),
          end: Alignment(-0.5 + value * 3, 0.2),
          colors: [
            colors.skeletonBase,
            colors.skeletonHighlight,
            colors.skeletonBase,
          ],
        ),
        borderRadius: BorderRadius.circular(radius),
      ),
    );
    final source = animation;
    if (source == null) return box(0.45);
    return AnimatedBuilder(
      animation: source,
      builder: (context, _) => box(source.value),
    );
  }
}
