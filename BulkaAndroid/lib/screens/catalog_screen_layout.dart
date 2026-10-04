part of '../main.dart';

extension _CatalogScreenLayout on _CatalogScreenState {
  Widget _buildCatalogScreen(BuildContext context, double contentExtent) {
    context.watch<CartProvider>();
    final scheme = Theme.of(context).colorScheme;
    final products = _filteredProducts;
    final needsBakery = _menuScopeReady && _selectedBakeryId.isEmpty;
    final hasSearch = _searchQuery.trim().isNotEmpty;
    final grouped = !hasSearch && !_favoritesOnly;
    final feed = _prepareCatalogFeed(products, contentExtent, grouped: grouped);
    final showCategories =
        !_isLoading &&
        !needsBakery &&
        grouped &&
        feed.categoryOffsets.isNotEmpty;
    final reserveCategories =
        !needsBakery && grouped && (_isLoading || showCategories);
    _catalogHeaderExtent = _catalogToolsHeight(reserveCategories);
    final favoritesEmpty = _favoritesOnly && !hasSearch && !_filterActive;
    final canReset = hasSearch || _favoritesOnly || _filterActive;

    return Scaffold(
      key: const ValueKey('catalog-root'),
      backgroundColor: scheme.surface,
      appBar: AppBar(
        toolbarHeight: BulkaLayout.appBarHeight(context),
        automaticallyImplyLeading: false,
        backgroundColor: scheme.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        centerTitle: true,
        title: _BulkaPageTitle(
          'nav_catalog'.tr,
          key: const ValueKey('catalog-page-title'),
          color: scheme.onSurface,
        ),
      ),
      body: RefreshIndicator(
        color: _bulkaYellow,
        onRefresh: _loadMenu,
        child: CustomScrollView(
          key: const ValueKey('catalog-products-list'),
          controller: _catalogScrollController,
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverPersistentHeader(
              pinned: true,
              delegate: _CatalogToolsHeaderDelegate(
                backgroundColor: scheme.surface,
                height: _catalogHeaderExtent,
                child: _buildCatalogToolsHeader(
                  showCategorySelector: showCategories,
                  loadingCategories: reserveCategories && !showCategories,
                ),
              ),
            ),
            if (!hasSearch && !_favoritesOnly)
              SliverToBoxAdapter(child: _buildCatalogFulfillmentSource()),
            if (hasSearch || _favoritesOnly)
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
                sliver: SliverToBoxAdapter(
                  child: Semantics(
                    header: true,
                    child: Text(
                      hasSearch
                          ? 'catalog_search_results'.tr
                          : 'catalog_favorites'.tr,
                      style: TextStyle(
                        fontFamily: _descriptionFont,
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        color: scheme.onSurface,
                      ),
                    ),
                  ),
                ),
              ),
            if (needsBakery)
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
            else if (products.isEmpty)
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
                      : canReset
                      ? 'catalog_reset_filters'.tr
                      : null,
                  onAction: canReset ? _resetCatalogFilters : null,
                ),
              )
            else
              _buildCatalogFeed(feed),
            if (needsBakery ||
                _isLoading ||
                _loadError != null ||
                products.isEmpty)
              SliverToBoxAdapter(
                child: SizedBox(height: _catalogContentBottomInset(context)),
              ),
          ],
        ),
      ),
    );
  }
}
