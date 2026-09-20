part of '../main.dart';

extension _CatalogScreenLayout on _CatalogScreenState {
  Widget _buildCatalogScreen(BuildContext context) {
    final cart = context.watch<CartProvider>();
    final openedCategory = _openedCategory;
    if (openedCategory != null) {
      return BulkaMotionSwitcher(
        duration: BulkaMotion.emphasized,
        offset: const Offset(0.025, 0),
        child: KeyedSubtree(
          key: ValueKey('catalog-category-$openedCategory'),
          child: _buildCategoryPage(openedCategory, cart),
        ),
      );
    }
    final scheme = Theme.of(context).colorScheme;
    final visibleProducts = _filteredProducts;
    final filterActive = _filterActive;
    final categoryGroups = _categoryGroups;
    final needsBakerySelection = _menuScopeReady && _selectedBakeryId.isEmpty;
    final hasSearchQuery = _searchQuery.trim().isNotEmpty;
    final browseByCategory =
        !hasSearchQuery &&
        _selectedCategory == _catalogAllCategoryKey &&
        !_favoritesOnly &&
        !filterActive &&
        categoryGroups.isNotEmpty;
    final showCategorySelector =
        !_isLoading && !needsBakerySelection && !browseByCategory;
    final favoritesEmpty =
        _favoritesOnly &&
        !hasSearchQuery &&
        _selectedCategory == _catalogAllCategoryKey &&
        !filterActive;
    final branchName = _selectedBakeryLocation?.name.trim() ??
        _selectedBakery.split(',').first.trim();
    final fulfillmentSourceText = _orderType == 'delivery'
        ? (_selectedDeliveryAddress?.displayAddress ??
              'checkout_select_delivery_address'.tr)
        : (branchName.isEmpty ? 'catalog_action'.tr : branchName);
    final sourceCaption = _orderType == 'delivery'
        ? '$_fulfillmentSourceLabel: $fulfillmentSourceText'
        : fulfillmentSourceText;

    return BulkaMotionSwitcher(
      duration: BulkaMotion.emphasized,
      offset: const Offset(0.025, 0),
      child: KeyedSubtree(
        key: const ValueKey('catalog-root'),
        child: Scaffold(
          backgroundColor: scheme.surface,
          appBar: AppBar(
            toolbarHeight: BulkaLayout.appBarHeight(context),
            automaticallyImplyLeading: false,
            backgroundColor: scheme.surface,
            surfaceTintColor: Colors.transparent,
            elevation: 0,
            title: _BulkaPageTitle(
              'nav_catalog'.tr,
              key: const ValueKey('catalog-page-title'),
              color: scheme.onSurface,
            ),
            centerTitle: true,
          ),
          body: Stack(
            children: [
              RefreshIndicator(
                color: _bulkaYellow,
                onRefresh: _loadMenu,
                child: CustomScrollView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  slivers: [
                    SliverPersistentHeader(
                      pinned: true,
                      delegate: _CatalogToolsHeaderDelegate(
                        backgroundColor: scheme.surface,
                        height: showCategorySelector
                            ? _CatalogToolsHeaderDelegate.expandedHeight
                            : _CatalogToolsHeaderDelegate.compactHeight,
                        child: _buildCatalogToolsHeader(
                          showCategorySelector: showCategorySelector,
                        ),
                      ),
                    ),

                    SliverToBoxAdapter(
                      child: Column(
                        children: [
                          if (!hasSearchQuery) ...[
                            const SizedBox(height: 14),

                            // Location Banner (Самовывоз/Адрес)
                            Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 16,
                              ),
                              child: Semantics(
                                button: true,
                                label:
                                    '$_catalogMenuTitle. $sourceCaption',
                                child: BulkaPressScale(
                                  child: Material(
                                    color: Colors.transparent,
                                    child: InkWell(
                                      onTap: _selectFulfillmentSource,
                                      borderRadius: BorderRadius.circular(
                                        BulkaRadii.control,
                                      ),
                                      child: Ink(
                                        key: ValueKey(
                                          'catalog-fulfillment-banner-$_orderType',
                                        ),
                                        decoration: BoxDecoration(
                                          color: const Color(0xFFFFE1A0),
                                          image: DecorationImage(
                                            image: AssetImage(
                                              _fulfillmentBannerAsset,
                                            ),
                                            fit: BoxFit.cover,
                                            alignment: Alignment.centerRight,
                                          ),
                                          borderRadius: BorderRadius.circular(
                                            BulkaRadii.control,
                                          ),
                                          boxShadow: const [
                                            BoxShadow(
                                              color: Color(0x1F9D6210),
                                              blurRadius: 18,
                                              offset: Offset(0, 8),
                                            ),
                                          ],
                                        ),
                                        child: Ink(
                                          padding: const EdgeInsets.fromLTRB(
                                            18,
                                            18,
                                            12,
                                            18,
                                          ),
                                          decoration: BoxDecoration(
                                            gradient: const LinearGradient(
                                              colors: [
                                                Color(0xFFFDF4E2),
                                                Color(0xF2FDF4E2),
                                                Color(0x00FDF4E2),
                                              ],
                                              stops: [0, 0.54, 0.82],
                                              begin: Alignment.centerLeft,
                                              end: Alignment.centerRight,
                                            ),
                                            borderRadius: BorderRadius.circular(
                                              BulkaRadii.control,
                                            ),
                                          ),
                                          child: ConstrainedBox(
                                            constraints: const BoxConstraints(
                                              minHeight: 128,
                                            ),
                                            child: Row(
                                              children: [
                                                Expanded(
                                                  child: Column(
                                                    mainAxisAlignment:
                                                        MainAxisAlignment
                                                            .center,
                                                    crossAxisAlignment:
                                                        CrossAxisAlignment
                                                            .start,
                                                    children: [
                                                      Text(
                                                        _catalogMenuTitle,
                                                        style: const TextStyle(
                                                          fontFamily:
                                                              _headingFont,
                                                          fontSize:
                                                              BulkaTypeScale
                                                                  .titleSmall,
                                                          fontWeight:
                                                              FontWeight.w700,
                                                          height: 1.18,
                                                          color: _textDark,
                                                        ),
                                                      ),
                                                      const SizedBox(height: 9),
                                                      Row(
                                                        crossAxisAlignment:
                                                            CrossAxisAlignment
                                                                .start,
                                                        children: [
                                                          const Padding(
                                                            padding:
                                                                EdgeInsets.only(
                                                                  top: 1,
                                                                ),
                                                            child: Icon(
                                                              Icons
                                                                  .location_on_rounded,
                                                              color: _textDark,
                                                              size: 18,
                                                            ),
                                                          ),
                                                          const SizedBox(
                                                            width: 5,
                                                          ),
                                                          Expanded(
                                                            child: Text(
                                                              sourceCaption,
                                                              softWrap: true,
                                                              style: const TextStyle(
                                                                fontFamily:
                                                                    _descriptionFont,
                                                                color:
                                                                    _textDark,
                                                                fontWeight:
                                                                    FontWeight
                                                                        .w600,
                                                                fontSize:
                                                                    BulkaTypeScale
                                                                        .bodySmall,
                                                                height: 1.3,
                                                              ),
                                                            ),
                                                          ),
                                                        ],
                                                      ),
                                                    ],
                                                  ),
                                                ),
                                                const SizedBox(width: 76),
                                                Container(
                                                  width: 44,
                                                  height: 44,
                                                  decoration: BoxDecoration(
                                                    color: Colors.white
                                                        .withValues(
                                                          alpha: 0.88,
                                                        ),
                                                    shape: BoxShape.circle,
                                                    border: Border.all(
                                                      color: Colors.white,
                                                    ),
                                                  ),
                                                  child: const Icon(
                                                    Icons.chevron_right_rounded,
                                                    color: _textDark,
                                                    size: 25,
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ],

                          if (_isLoading || browseByCategory)
                            const SizedBox(height: 24)
                          else ...[
                            SizedBox(height: hasSearchQuery ? 16 : 22),
                            Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 16,
                              ),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      hasSearchQuery
                                          ? 'catalog_search_results'.tr
                                          : _favoritesOnly
                                          ? 'catalog_favorites'.tr
                                          : _selectedCategory ==
                                                _catalogAllCategoryKey
                                          ? 'catalog_all_categories'.tr
                                          : _selectedCategory,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        fontFamily: _descriptionFont,
                                        fontSize: BulkaTypeScale.title,
                                        fontWeight: FontWeight.w700,
                                        color: scheme.onSurface,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  _buildFilterButton(
                                    key: const ValueKey(
                                      'catalog-results-filter',
                                    ),
                                    filterActive: filterActive,
                                    iconOnly: false,
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(height: 12),
                          ],
                        ],
                      ),
                    ),

                    // Product List
                    if (needsBakerySelection)
                      SliverToBoxAdapter(
                        child: _CatalogMessageState(
                          key: const ValueKey('catalog-select-bakery-state'),
                          title: 'catalog_select_bakery_title'.tr,
                          subtitle: 'catalog_sub'.tr,
                          actionLabel: 'catalog_action'.tr,
                          actionIcon: Icons.location_on_outlined,
                          onAction: _selectFulfillmentSource,
                        ),
                      )
                    else if (_isLoading)
                      const SliverToBoxAdapter(child: _CatalogSkeletonCatalog())
                    else if (_loadError != null)
                      SliverToBoxAdapter(
                        child: _CatalogMessageState(
                          icon: Icons.cloud_off_rounded,
                          title: 'catalog_load_failed'.tr,
                          subtitle: 'error_network'.tr,
                          actionLabel: 'catalog_retry'.tr,
                          onAction: _loadMenu,
                        ),
                      )
                    else if (visibleProducts.isEmpty)
                      SliverToBoxAdapter(
                        child: _CatalogMessageState(
                          icon: favoritesEmpty
                              ? Icons.favorite_border_rounded
                              : Icons.search_off_rounded,
                          title: favoritesEmpty
                              ? 'catalog_favorites_empty'.tr
                              : 'catalog_empty'.tr,
                          subtitle: favoritesEmpty
                              ? 'catalog_favorites_empty_hint'.tr
                              : 'catalog_empty_hint'.tr,
                          actionLabel: favoritesEmpty
                              ? 'catalog_browse_menu'.tr
                              : _searchQuery.isNotEmpty ||
                                    _selectedCategory !=
                                        _catalogAllCategoryKey ||
                                    filterActive
                              ? 'catalog_reset_filters'.tr
                              : null,
                          onAction: favoritesEmpty
                              ? _resetCatalogFilters
                              : _searchQuery.isNotEmpty ||
                                    _selectedCategory !=
                                        _catalogAllCategoryKey ||
                                    filterActive
                              ? _resetCatalogFilters
                              : null,
                        ),
                      )
                    else if (browseByCategory)
                      SliverPadding(
                        padding: EdgeInsets.fromLTRB(
                          16,
                          0,
                          16,
                          _catalogContentBottomInset(context),
                        ),
                        sliver: SliverLayoutBuilder(
                          builder: (context, constraints) {
                            const spacing = 14.0;
                            final extent = constraints.crossAxisExtent;
                            final largeText =
                                MediaQuery.textScalerOf(context).scale(1) > 1.3;
                            final columnCount = largeText && extent < 620
                                ? 1
                                : extent >= 980
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
                            var titleHeight = 0.0;
                            for (final group in categoryGroups) {
                              final painter = TextPainter(
                                text: TextSpan(
                                  text: group.key,
                                  style: const TextStyle(
                                    fontFamily: _descriptionFont,
                                    fontSize: BulkaTypeScale.body,
                                    height: 1.16,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                textDirection: Directionality.of(context),
                                textScaler: MediaQuery.textScalerOf(context),
                              )..layout(maxWidth: max(1, cardWidth - 32));
                              titleHeight = max(titleHeight, painter.height);
                              painter.dispose();
                            }
                            return SliverGrid(
                              key: const ValueKey('catalog-category-grid'),
                              gridDelegate:
                                  SliverGridDelegateWithFixedCrossAxisCount(
                                    crossAxisCount: columnCount,
                                    mainAxisSpacing: spacing,
                                    crossAxisSpacing: spacing,
                                    mainAxisExtent: max(
                                      cardWidth + (textScale > 1.2 ? 24 : 0),
                                      titleHeight + 88,
                                    ),
                                  ),
                              delegate: SliverChildBuilderDelegate((
                                context,
                                index,
                              ) {
                                final group = categoryGroups[index];
                                return _buildCategoryGridCard(
                                  group.key,
                                  group.value,
                                );
                              }, childCount: categoryGroups.length),
                            );
                          },
                        ),
                      )
                    else
                      SliverPadding(
                        padding: EdgeInsets.fromLTRB(
                          16,
                          4,
                          16,
                          _catalogContentBottomInset(context),
                        ),
                        sliver: SliverLayoutBuilder(
                          builder: (context, constraints) {
                            const maxCardWidth = 235.0;
                            const crossSpacing = 12.0;
                            final columnCount = max(
                              1,
                              ((constraints.crossAxisExtent + crossSpacing) /
                                      (maxCardWidth + crossSpacing))
                                  .ceil(),
                            ).toInt();
                            return _buildProductRows(
                              visibleProducts,
                              columnCount,
                              crossSpacing,
                            );
                          },
                        ),
                      ),
                    if (needsBakerySelection ||
                        _isLoading ||
                        _loadError != null ||
                        visibleProducts.isEmpty)
                      SliverToBoxAdapter(
                        child: SizedBox(
                          height: _catalogContentBottomInset(context),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
