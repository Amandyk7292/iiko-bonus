part of '../main.dart';

extension _CatalogStockSubscriptionController on _CatalogScreenState {
  String _stockSubscriptionKey(String productId, String branchId) =>
      '$productId::$branchId';

  Future<void> _loadStockSubscriptions() async {
    if (!_api.isAuthenticated) {
      if (mounted) _updateCatalogState(() => _stockSubscriptions = const {});
      return;
    }
    try {
      final subscriptions = await _api.getStockSubscriptions();
      if (!mounted) return;
      _updateCatalogState(() {
        _stockSubscriptions = {
          for (final subscription in subscriptions)
            if (subscription.status != 'cancelled')
              _stockSubscriptionKey(
                subscription.productId,
                subscription.branchId,
              ): subscription,
        };
      });
    } catch (_) {
      // The catalog remains usable if notification state cannot be loaded.
    }
  }

  Future<void> _toggleStockSubscription(CatalogProduct product) async {
    if (!_api.isAuthenticated) {
      final authenticated = await widget.onRequireAuth?.call() ?? false;
      if (!authenticated || !_api.isAuthenticated || !mounted) return;
      await _loadStockSubscriptions();
    }
    if (_selectedBakeryId.isEmpty) {
      await _selectFulfillmentSource();
      if (!mounted || _selectedBakeryId.isEmpty) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('stock_notify_select_branch'.tr)),
          );
        }
        return;
      }
    }
    final key = _stockSubscriptionKey(product.id, _selectedBakeryId);
    if (_stockSubscriptionBusy.contains(key)) return;
    final existing = _stockSubscriptions[key];
    _updateCatalogState(() {
      _stockSubscriptionBusy = {..._stockSubscriptionBusy, key};
    });
    try {
      if (existing == null) {
        final created = await _api.createStockSubscription(
          productId: product.id,
          branchId: _selectedBakeryId,
        );
        if (!mounted) return;
        _updateCatalogState(() {
          _stockSubscriptions = {..._stockSubscriptions, key: created};
        });
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('stock_notify_enabled'.tr)));
      } else {
        await _api.deleteStockSubscription(existing.id);
        if (!mounted) return;
        final next = {..._stockSubscriptions}..remove(key);
        _updateCatalogState(() => _stockSubscriptions = next);
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('stock_notify_disabled'.tr)));
      }
    } catch (error) {
      if (!mounted) return;
      showApiErrorSnackBar(
        context,
        error,
        fallbackKey: 'stock_notify_save_error',
      );
    } finally {
      if (mounted) {
        final next = {..._stockSubscriptionBusy}..remove(key);
        _updateCatalogState(() => _stockSubscriptionBusy = next);
      }
    }
  }
}

int _catalogProductQuantityLimit(CatalogProduct product) => min(
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
    this.disabled = false,
    super.key,
  });

  final String url;
  final String semanticLabel;
  final Object? heroTag;
  final BorderRadius borderRadius;
  final EdgeInsets safePadding;
  final bool disabled;

  @override
  Widget build(BuildContext context) {
    Widget image = ClipRRect(
      borderRadius: borderRadius,
      child: ColoredBox(
        color: Colors.white,
        child: Center(
          child: Padding(
            padding: url.trim().isEmpty ? EdgeInsets.zero : safePadding,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(BulkaRadii.control),
              child: _NetworkImage(
                url: url,
                fit: BoxFit.cover,
                semanticLabel: semanticLabel,
              ),
            ),
          ),
        ),
      ),
    );
    if (heroTag != null) {
      image = BulkaHero(tag: heroTag!, child: image);
    }
    if (disabled) {
      image = ColorFiltered(
        colorFilter: const ColorFilter.matrix(<double>[
          0.2126,
          0.7152,
          0.0722,
          0,
          0,
          0.2126,
          0.7152,
          0.0722,
          0,
          0,
          0.2126,
          0.7152,
          0.0722,
          0,
          0,
          0,
          0,
          0,
          0.58,
          0,
        ]),
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

  static const compactHeight = 68.0;
  static const expandedHeight = 124.0;

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

class _CatalogCategorySkeletonStrip extends StatelessWidget {
  const _CatalogCategorySkeletonStrip();

  @override
  Widget build(BuildContext context) {
    const widths = [92.0, 116.0, 104.0];
    return ExcludeSemantics(
      child: ListView.separated(
        key: const ValueKey('catalog-category-skeleton-strip'),
        scrollDirection: Axis.horizontal,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: widths.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, index) =>
            _CatalogSkeletonBox(width: widths[index], height: 48, radius: 16),
      ),
    );
  }
}

class _CatalogCategoryChip extends StatelessWidget {
  const _CatalogCategoryChip({
    super.key,
    required this.label,
    required this.imageUrl,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String? imageUrl;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
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
            child: AnimatedContainer(
              duration: BulkaMotion.duration(context, BulkaMotion.fast),
              curve: BulkaMotion.standardCurve,
              height: 48,
              padding: const EdgeInsets.fromLTRB(6, 5, 14, 5),
              decoration: BoxDecoration(
                color: selected ? _bulkaYellow : scheme.surface,
                borderRadius: BorderRadius.circular(BulkaRadii.control),
                border: Border.all(
                  color: selected ? _bulkaYellow : colors.cardBorder,
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: colors.surfaceCream,
                      shape: BoxShape.circle,
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: imageUrl == null || imageUrl!.isEmpty
                        ? Icon(
                            Icons.grid_view_rounded,
                            size: 18,
                            color: colors.brandBrown,
                          )
                        : _NetworkImage(
                            url: imageUrl!,
                            fit: BoxFit.cover,
                            semanticLabel: label,
                          ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: selected ? _textDark : scheme.onSurface,
                      fontSize: BulkaTypeScale.bodySmall,
                      fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CatalogCategoryFallback extends StatelessWidget {
  const _CatalogCategoryFallback({
    required this.category,
    required this.assetPath,
    super.key,
  });

  final String category;
  final String? assetPath;

  IconData get _icon {
    final normalized = category.toLowerCase();
    if (normalized.contains('напит') ||
        normalized.contains('кофе') ||
        normalized.contains('чай')) {
      return Icons.local_cafe_rounded;
    }
    if (normalized.contains('торт') ||
        normalized.contains('десерт') ||
        normalized.contains('кондитер')) {
      return Icons.cake_rounded;
    }
    if (normalized.contains('печень')) return Icons.cookie_rounded;
    if (normalized.contains('блин') || normalized.contains('бауыр')) {
      return Icons.breakfast_dining_rounded;
    }
    if (normalized.contains('хлеб') ||
        normalized.contains('булоч') ||
        normalized.contains('круас') ||
        normalized.contains('выпеч')) {
      return Icons.bakery_dining_rounded;
    }
    if (normalized.contains('кулинар') || normalized.contains('готов')) {
      return Icons.lunch_dining_rounded;
    }
    return Icons.restaurant_menu_rounded;
  }

  @override
  Widget build(BuildContext context) {
    final brown = context.bulkaColors.brandBrown;
    final asset = assetPath;
    if (asset != null) {
      return Image.asset(
        asset,
        fit: BoxFit.cover,
        alignment: asset.endsWith('pickup_banner.jpg')
            ? Alignment.centerRight
            : Alignment.center,
        filterQuality: FilterQuality.medium,
      );
    }
    return ColoredBox(
      color: Colors.white,
      child: Center(
        child: Icon(_icon, size: 64, color: brown.withValues(alpha: 0.58)),
      ),
    );
  }
}

class _CatalogImageQuantityControl extends StatelessWidget {
  const _CatalogImageQuantityControl({
    required this.quantity,
    required this.stopListed,
    required this.onAdd,
    required this.onDecrease,
    required this.onIncrease,
  });

  final int quantity;
  final bool stopListed;
  final VoidCallback onAdd;
  final VoidCallback onDecrease;
  final VoidCallback? onIncrease;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    if (quantity <= 0) {
      return Semantics(
        button: true,
        enabled: !stopListed,
        label: stopListed ? 'catalog_stop_list'.tr : 'catalog_add_to_cart'.tr,
        child: BulkaPressScale(
          enabled: !stopListed,
          child: IconButton(
            key: const ValueKey('catalog-image-add'),
            onPressed: stopListed ? null : onAdd,
            style: IconButton.styleFrom(
              backgroundColor: stopListed
                  ? const Color(0xFFD9D5D0)
                  : colors.brandGold,
              foregroundColor: colors.brandBrown,
              disabledForegroundColor: colors.mutedText,
              minimumSize: const Size(50, 50),
              side: const BorderSide(color: Colors.white, width: 2),
              elevation: 6,
              shadowColor: colors.brandBrown.withValues(alpha: 0.25),
            ),
            icon: Icon(
              stopListed ? Icons.block_rounded : Icons.add_rounded,
              size: 29,
            ),
          ),
        ),
      );
    }

    return Semantics(
      container: true,
      label: 'catalog_quantity_value'.trArgs({'count': quantity}),
      child: Container(
        key: const ValueKey('catalog-quantity'),
        height: 50,
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [Color(0xFFFFD35C), Color(0xFFFFB814)],
          ),
          borderRadius: BorderRadius.circular(BulkaRadii.card),
          border: Border.all(color: Colors.white, width: 2),
          boxShadow: [
            BoxShadow(
              color: colors.brandBrown.withValues(alpha: 0.22),
              blurRadius: 14,
              offset: const Offset(0, 7),
            ),
          ],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Semantics(
              button: true,
              label: 'catalog_decrease_quantity'.tr,
              child: ExcludeSemantics(
                child: IconButton(
                  onPressed: onDecrease,
                  style: IconButton.styleFrom(
                    minimumSize: const Size(44, 48),
                    foregroundColor: colors.brandBrown,
                  ),
                  icon: const Icon(Icons.remove_rounded, size: 22),
                ),
              ),
            ),
            SizedBox(
              width: 28,
              child: Text(
                '$quantity',
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
    required this.icon,
    required this.title,
    required this.subtitle,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final String? actionLabel;
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
            border: Border.all(color: context.bulkaColors.cardBorder),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
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
                  icon: const Icon(Icons.refresh_rounded, size: 20),
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
