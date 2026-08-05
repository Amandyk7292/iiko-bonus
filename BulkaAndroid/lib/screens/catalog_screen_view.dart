part of '../main.dart';

extension _CatalogScreenView on _CatalogScreenState {
  Widget _buildCategoryGridCard(
    String category,
    List<CatalogProduct> products,
  ) {
    final colors = context.bulkaColors;
    final imageUrl = (_apiCategoryImages[category] ?? '').trim();
    final fallbackAsset = _catalogCategoryFallbackAsset(category);
    final availableCount = products
        .where((product) => !product.isStopListed)
        .length;

    return Semantics(
      key: ValueKey('catalog-category-card-$category'),
      button: true,
      label: availableCount == 0
          ? '$category. ${'catalog_stop_list'.tr}'
          : category,
      hint: '${'catalog_view_all'.tr} $category',
      child: BulkaPressScale(
        pressedScale: 0.975,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: () => _openCategoryPage(category),
            borderRadius: BorderRadius.circular(BulkaRadii.card),
            child: Ink(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(BulkaRadii.card),
                border: Border.all(
                  color: colors.cardBorder.withValues(alpha: 0.72),
                ),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x176D3317),
                    blurRadius: 20,
                    offset: Offset(0, 9),
                  ),
                ],
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(BulkaRadii.card),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    ExcludeSemantics(
                      child: imageUrl.isEmpty
                          ? _CatalogCategoryFallback(
                              key: ValueKey(
                                'catalog-category-fallback-$category',
                              ),
                              category: category,
                              assetPath: fallbackAsset,
                            )
                          : _NetworkImage(
                              key: ValueKey('catalog-category-image-$category'),
                              url: imageUrl,
                              fit: BoxFit.cover,
                            ),
                    ),
                    const DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          stops: [0, 0.42, 0.76],
                          colors: [
                            Color(0xF7FFFFFF),
                            Color(0xA6FFFFFF),
                            Color(0x00FFFFFF),
                          ],
                        ),
                      ),
                    ),
                    Positioned(
                      left: 16,
                      top: 16,
                      right: 16,
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          key: ValueKey('catalog-category-title-$category'),
                          category,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          softWrap: true,
                          style: TextStyle(
                            color: colors.brandBrown,
                            fontFamily: _descriptionFont,
                            fontSize: BulkaTypeScale.body,
                            height: 1.16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                    if (availableCount == 0)
                      Positioned(
                        left: 12,
                        bottom: 12,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 6,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.94),
                            borderRadius: BorderRadius.circular(
                              BulkaRadii.small,
                            ),
                            border: Border.all(
                              color: colors.danger.withValues(alpha: 0.45),
                            ),
                          ),
                          child: Text(
                            'catalog_stop_list'.tr,
                            style: TextStyle(
                              color: colors.danger,
                              fontFamily: _descriptionFont,
                              fontSize: BulkaTypeScale.badge,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildCategoryPage(String category, CartProvider cart) {
    final allProducts = _stopListedLast(
      catalogProductsAlphabetically(
        _allProducts.where((product) => product.category == category),
      ),
    );
    final products = _applyActiveProductFilters(
      allProducts,
      includeSearch: false,
      includeFavorites: false,
    );
    final scheme = Theme.of(context).colorScheme;
    final colors = context.bulkaColors;
    final filterActive = _filterActive;

    return Scaffold(
      key: ValueKey('catalog-category-page-$category'),
      backgroundColor: Colors.white,
      appBar: AppBar(
        toolbarHeight: BulkaLayout.appBarHeight(context),
        automaticallyImplyLeading: false,
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            bottom: Radius.circular(BulkaRadii.card),
          ),
        ),
        leadingWidth: 72,
        leading: Padding(
          padding: const EdgeInsets.only(left: 12),
          child: IconButton(
            key: const ValueKey('catalog-category-back'),
            onPressed: closeCategoryPage,
            tooltip: 'back_tooltip'.tr,
            icon: const Icon(Icons.arrow_back_rounded, size: 25),
            style: IconButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: colors.brandBrown,
              minimumSize: const Size(48, 48),
              side: BorderSide(color: colors.cardBorder),
            ),
          ),
        ),
        title: _BulkaPageTitle(category, color: scheme.onSurface),
        centerTitle: true,
        actions: [
          SizedBox(
            width: 72,
            child: Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Align(
                alignment: Alignment.centerRight,
                child: _buildFilterButton(
                  key: const ValueKey('catalog-category-filter'),
                  filterActive: filterActive,
                  iconOnly: true,
                ),
              ),
            ),
          ),
        ],
      ),
      body: allProducts.isEmpty
          ? _CatalogMessageState(
              icon: Icons.inventory_2_outlined,
              title: 'catalog_empty'.tr,
              subtitle: 'catalog_empty_hint'.tr,
            )
          : CustomScrollView(
              key: ValueKey('catalog-category-list-$category'),
              slivers: [
                if (products.isEmpty)
                  SliverToBoxAdapter(
                    child: _CatalogMessageState(
                      icon: Icons.search_off_rounded,
                      title: 'catalog_empty'.tr,
                      subtitle: 'catalog_empty_hint'.tr,
                    ),
                  )
                else
                  SliverPadding(
                    padding: EdgeInsets.fromLTRB(
                      16,
                      18,
                      16,
                      _catalogContentBottomInset(context),
                    ),
                    sliver: SliverLayoutBuilder(
                      builder: (context, constraints) {
                        const spacing = 14.0;
                        final extent = constraints.crossAxisExtent;
                        final columnCount = extent >= 980
                            ? 4
                            : extent >= 620
                            ? 3
                            : 2;
                        final cardWidth =
                            (extent - spacing * (columnCount - 1)) /
                            columnCount;
                        final textScale = MediaQuery.textScalerOf(
                          context,
                        ).scale(1);
                        return SliverGrid(
                          key: ValueKey('catalog-category-grid-$category'),
                          gridDelegate:
                              SliverGridDelegateWithFixedCrossAxisCount(
                                crossAxisCount: columnCount,
                                mainAxisSpacing: 18,
                                crossAxisSpacing: spacing,
                                mainAxisExtent:
                                    cardWidth + (textScale > 1.2 ? 162 : 122),
                              ),
                          delegate: SliverChildBuilderDelegate((
                            context,
                            index,
                          ) {
                            final product = products[index];
                            return _buildProductCard(
                              product,
                              cart.getQuantity(product.id),
                            );
                          }, childCount: products.length),
                        );
                      },
                    ),
                  ),
              ],
            ),
    );
  }

  Widget _buildCatalogToolsHeader({required bool showCategorySelector}) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    final sortedCategories = _sortedCategories;
    return SizedBox(
      height: showCategorySelector
          ? _CatalogToolsHeaderDelegate.expandedHeight
          : _CatalogToolsHeaderDelegate.compactHeight,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: Row(
              children: [
                Expanded(
                  child: SizedBox(
                    height: 56,
                    child: TextField(
                      key: const ValueKey('catalog-sticky-search'),
                      controller: _searchController,
                      onChanged: (val) =>
                          _updateCatalogState(() => _searchQuery = val),
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
                        hintText: 'catalog_search'.tr,
                        hintStyle: TextStyle(
                          color: colors.mutedText,
                          fontWeight: FontWeight.w400,
                        ),
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
                        fillColor: Colors.white,
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 18,
                        ),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(
                            BulkaRadii.control,
                          ),
                          borderSide: BorderSide.none,
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(
                            BulkaRadii.control,
                          ),
                          borderSide: BorderSide(color: colors.cardBorder),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(
                            BulkaRadii.control,
                          ),
                          borderSide: BorderSide(
                            color: colors.brandGold,
                            width: 1.5,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                IconButton(
                  key: const ValueKey('catalog-favorites-toggle'),
                  onPressed: () {
                    unawaited(BulkaMotion.selection());
                    _updateCatalogState(() => _favoritesOnly = !_favoritesOnly);
                  },
                  tooltip: 'catalog_favorites'.tr,
                  style: IconButton.styleFrom(
                    backgroundColor: _favoritesOnly
                        ? colors.brandBrown
                        : Colors.white,
                    foregroundColor: _favoritesOnly
                        ? Colors.white
                        : colors.brandBrown,
                    minimumSize: const Size(56, 56),
                    tapTargetSize: MaterialTapTargetSize.padded,
                    side: _favoritesOnly
                        ? BorderSide.none
                        : BorderSide(color: colors.cardBorder),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(BulkaRadii.control),
                    ),
                  ),
                  icon: Icon(
                    _favoritesOnly
                        ? Icons.favorite_rounded
                        : Icons.favorite_border_rounded,
                    size: 24,
                  ),
                ),
              ],
            ),
          ),
          if (showCategorySelector)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: SizedBox(
                height: 48,
                child: Row(
                  children: [
                    Expanded(
                      child: _isLoading && sortedCategories.length <= 1
                          ? const _CatalogCategorySkeletonStrip()
                          : ListView.separated(
                              key: const ValueKey('catalog-category-strip'),
                              scrollDirection: Axis.horizontal,
                              itemCount: sortedCategories.length,
                              separatorBuilder: (context, index) =>
                                  const SizedBox(width: 8),
                              itemBuilder: (context, i) {
                                final cat = sortedCategories[i];
                                return _CatalogCategoryChip(
                                  key: ValueKey('catalog-category-chip-$cat'),
                                  label: cat == _catalogAllCategoryKey
                                      ? 'catalog_view_all'.tr
                                      : cat,
                                  imageUrl: _apiCategoryImages[cat],
                                  selected: _selectedCategory == cat,
                                  onTap: () {
                                    unawaited(BulkaMotion.selection());
                                    _updateCatalogState(
                                      () => _selectedCategory = cat,
                                    );
                                  },
                                );
                              },
                            ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildFilterButton({
    required bool filterActive,
    required bool iconOnly,
    Key? key,
  }) {
    final colors = context.bulkaColors;
    final backgroundColor = filterActive ? _bulkaYellow : Colors.white;
    final border = BorderSide(
      color: filterActive ? _bulkaYellow : colors.cardBorder,
    );
    final icon = Badge(
      isLabelVisible: filterActive,
      backgroundColor: _bulkaBrown,
      smallSize: 8,
      child: const Icon(Icons.tune_rounded, size: 22),
    );

    if (iconOnly) {
      return IconButton(
        key: key,
        onPressed: _openFilterModal,
        tooltip: 'catalog_filter'.tr,
        style: IconButton.styleFrom(
          backgroundColor: backgroundColor,
          foregroundColor: _textDark,
          minimumSize: const Size(48, 48),
          tapTargetSize: MaterialTapTargetSize.padded,
          side: border,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(BulkaRadii.control),
          ),
        ),
        icon: icon,
      );
    }

    return SizedBox(
      height: 48,
      child: FilledButton.icon(
        key: key,
        onPressed: _openFilterModal,
        style: FilledButton.styleFrom(
          backgroundColor: backgroundColor,
          foregroundColor: _textDark,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          side: border,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(BulkaRadii.control),
          ),
        ),
        icon: icon,
        label: Text(
          'catalog_filter'.tr,
          maxLines: 1,
          overflow: TextOverflow.fade,
          softWrap: false,
          style: const TextStyle(
            fontFamily: _descriptionFont,
            fontSize: BulkaTypeScale.bodySmall,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}
