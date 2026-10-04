part of '../main.dart';

extension _CatalogScreenView on _CatalogScreenState {
  double get _catalogSearchHeight => max(
    56,
    MediaQuery.textScalerOf(context).scale(BulkaTypeScale.body) * 1.3 + 24,
  );

  double get _catalogCategoryHeight => max(
    48,
    MediaQuery.textScalerOf(context).scale(BulkaTypeScale.bodySmall) * 1.2 + 18,
  );

  double _catalogToolsHeight(bool categories) =>
      _catalogSearchHeight + 12 + (categories ? _catalogCategoryHeight + 8 : 0);

  Widget _buildCatalogToolsHeader({
    required bool showCategorySelector,
    bool loadingCategories = false,
  }) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    final categories = _catalogFeedLayout?.categoryOffsets.keys.toList() ?? [];
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(BulkaRadii.control),
      borderSide: BorderSide(color: colors.cardBorder),
    );
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: Row(
            children: [
              Expanded(
                child: SizedBox(
                  height: _catalogSearchHeight,
                  child: TextField(
                    key: const ValueKey('catalog-sticky-search'),
                    controller: _searchController,
                    onChanged: _queueSearch,
                    onSubmitted: _submitSearch,
                    textInputAction: TextInputAction.search,
                    autofillHints: const <String>[],
                    autocorrect: false,
                    enableSuggestions: false,
                    style: TextStyle(
                      fontSize: BulkaTypeScale.body,
                      fontWeight: FontWeight.w500,
                      color: scheme.onSurface,
                    ),
                    decoration: InputDecoration(
                      hintText:
                          (MediaQuery.textScalerOf(context).scale(1) > 1.3
                                  ? 'search_hint'
                                  : 'catalog_search')
                              .tr,
                      hintMaxLines: 1,
                      hintStyle: TextStyle(color: colors.mutedText),
                      prefixIcon: Icon(
                        Icons.search_rounded,
                        color: colors.brandBrown,
                      ),
                      suffixIcon: _searchQuery.isEmpty
                          ? null
                          : IconButton(
                              onPressed: _clearSearch,
                              tooltip: 'catalog_clear_search'.tr,
                              icon: const Icon(Icons.close_rounded, size: 20),
                            ),
                      filled: true,
                      fillColor: scheme.surface,
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 12,
                      ),
                      border: border,
                      enabledBorder: border,
                      focusedBorder: border.copyWith(
                        borderSide: BorderSide(
                          color: colors.brandGold,
                          width: 1.5,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 6),
              IconButton(
                key: const ValueKey('catalog-favorites-toggle'),
                onPressed: () {
                  unawaited(BulkaMotion.selection());
                  _updateCatalogState(() => _favoritesOnly = !_favoritesOnly);
                },
                tooltip: 'catalog_favorites'.tr,
                isSelected: _favoritesOnly,
                style: IconButton.styleFrom(
                  backgroundColor: _favoritesOnly
                      ? colors.brandBrown
                      : scheme.surface,
                  foregroundColor: _favoritesOnly
                      ? Colors.white
                      : colors.brandBrown,
                  minimumSize: const Size(48, 48),
                  side: BorderSide(color: colors.cardBorder),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(BulkaRadii.control),
                  ),
                ),
                icon: Icon(
                  _favoritesOnly
                      ? Icons.favorite_rounded
                      : Icons.favorite_border_rounded,
                  size: 25,
                ),
              ),
              const SizedBox(width: 4),
              _buildFilterButton(
                filterActive: _filterActive,
                iconOnly: true,
                key: const ValueKey('catalog-results-filter'),
              ),
            ],
          ),
        ),
        if (showCategorySelector)
          SizedBox(
            height: _catalogCategoryHeight + 8,
            child: ValueListenableBuilder<String>(
              valueListenable: _activeCatalogCategory,
              builder: (context, selected, _) => SingleChildScrollView(
                key: const ValueKey('catalog-category-strip'),
                controller: _categoryStripController,
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: Row(
                  children: [
                    for (final category in [
                      _catalogAllCategoryKey,
                      ...categories,
                    ])
                      Padding(
                        key: _categoryChipKeys.putIfAbsent(
                          category,
                          () => GlobalKey(),
                        ),
                        padding: const EdgeInsets.only(right: 8),
                        child: _CatalogCategoryChip(
                          key: ValueKey('catalog-category-chip-$category'),
                          label: category == _catalogAllCategoryKey
                              ? 'catalog_view_all'.tr
                              : category,
                          height: _catalogCategoryHeight,
                          selected: selected == category,
                          onTap: () => _navigateToCatalogCategory(category),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          )
        else if (loadingCategories)
          ExcludeSemantics(
            child: Padding(
              key: const ValueKey('catalog-category-skeleton-strip'),
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Row(
                children: [
                  _CatalogSkeletonBox(
                    width: 68,
                    height: _catalogCategoryHeight,
                    radius: 24,
                  ),
                  const SizedBox(width: 8),
                  _CatalogSkeletonBox(
                    width: 120,
                    height: _catalogCategoryHeight,
                    radius: 24,
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildCatalogFulfillmentSource() {
    final colors = context.bulkaColors;
    final branchName =
        _selectedBakeryLocation?.name.trim() ??
        _selectedBakery.split(',').first.trim();
    final caption = _orderType == 'delivery'
        ? (_selectedDeliveryAddress?.displayAddress ??
              'checkout_select_delivery_address'.tr)
        : (branchName.isEmpty ? 'catalog_action'.tr : branchName);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Semantics(
        button: true,
        label: '$_catalogMenuTitle. $caption',
        child: Material(
          color: colors.surfaceCream,
          borderRadius: BorderRadius.circular(BulkaRadii.control),
          child: InkWell(
            key: ValueKey('catalog-fulfillment-banner-$_orderType'),
            onTap: _selectFulfillmentSource,
            borderRadius: BorderRadius.circular(BulkaRadii.control),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 48),
                child: Row(
                  children: [
                    Icon(
                      _orderType == 'delivery'
                          ? Icons.delivery_dining_outlined
                          : Icons.storefront_outlined,
                      color: colors.brandBrown,
                      size: 24,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _catalogMenuTitle,
                            style: TextStyle(
                              fontFamily: _descriptionFont,
                              fontSize: 14,
                              height: 1.25,
                              fontWeight: FontWeight.w700,
                              color: colors.brandBrown,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            caption,
                            style: TextStyle(
                              fontSize: 12,
                              height: 1.25,
                              color: Theme.of(context).colorScheme.onSurface,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 6),
                    Icon(Icons.chevron_right_rounded, color: colors.brandBrown),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildFilterButton({
    required bool filterActive,
    required bool iconOnly,
    Key? key,
  }) {
    final colors = context.bulkaColors;
    return IconButton(
      key: key,
      onPressed: _openFilterModal,
      tooltip: 'catalog_filter'.tr,
      style: IconButton.styleFrom(
        backgroundColor: filterActive
            ? _bulkaYellow
            : Theme.of(context).colorScheme.surface,
        foregroundColor: colors.brandBrown,
        minimumSize: const Size(48, 48),
        side: BorderSide(
          color: filterActive ? _bulkaYellow : colors.cardBorder,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(BulkaRadii.control),
        ),
      ),
      icon: Badge(
        isLabelVisible: filterActive,
        backgroundColor: colors.brandBrown,
        smallSize: 8,
        child: const Icon(Icons.tune_rounded, size: 22),
      ),
    );
  }
}
