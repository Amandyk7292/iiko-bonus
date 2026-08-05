part of '../main.dart';

extension _CatalogInteractionController on _CatalogScreenState {
  String get _catalogMenuTitle => switch (_orderType) {
    'delivery' => 'catalog_delivery_menu'.tr,
    'preorder' => 'catalog_preorder_menu'.tr,
    _ => 'catalog_pickup_menu'.tr,
  };

  String get _fulfillmentSourceLabel => _orderType == 'delivery'
      ? 'catalog_delivery_address_label'.tr
      : 'catalog_bakery_label'.tr;

  String get _fulfillmentBannerAsset => switch (_orderType) {
    'delivery' => 'assets/order/delivery_banner.jpg',
    'preorder' => 'assets/order/preorder_banner.jpg',
    _ => 'assets/order/pickup_banner.jpg',
  };

  Future<BakeryLocation?> _resolveDeliveryBranch(
    DeliveryAddress address,
  ) async {
    final locations = await _api.getFulfillmentLocations();
    final candidates = <({BakeryLocation branch, double distance})>[];
    for (final branch in locations) {
      if (!branch.active ||
          !branch.deliveryEnabled ||
          branch.latitude == null ||
          branch.longitude == null) {
        continue;
      }
      final distance = distanceBetweenCoordinatesKm(
        firstLatitude: branch.latitude!,
        firstLongitude: branch.longitude!,
        secondLatitude: address.location.latitude,
        secondLongitude: address.location.longitude,
      );
      if (branch.deliveryZoneForDistance(distance) != null) {
        candidates.add((branch: branch, distance: distance));
      }
    }
    candidates.sort((left, right) => left.distance.compareTo(right.distance));
    return candidates.isEmpty ? null : candidates.first.branch;
  }

  List<String> get _sortedCategories {
    final categories =
        _categories
            .where((category) => category != _catalogAllCategoryKey)
            .toSet()
            .toList()
          ..sort(catalogAlphabeticalCompare);
    return [_catalogAllCategoryKey, ...categories];
  }

  List<CatalogProduct> get _filteredProducts {
    final categoryProducts = _allProducts.where(
      (product) =>
          _selectedCategory == _catalogAllCategoryKey ||
          product.category == _selectedCategory,
    );
    return _applyActiveProductFilters(
      categoryProducts,
      includeSearch: true,
      includeFavorites: true,
    );
  }

  bool get _filterActive => _CatalogFilterResult(
    sort: _sort,
    onlyAvailable: _onlyAvailable,
    dietaryTags: _dietaryFilters,
    excludedAllergens: _excludedAllergens,
  ).isActive;

  List<CatalogProduct> _applyActiveProductFilters(
    Iterable<CatalogProduct> source, {
    required bool includeSearch,
    required bool includeFavorites,
  }) {
    final candidates = source.where((p) {
      final matchesAvailability = !_onlyAvailable || !p.isStopListed;
      final matchesFavorite =
          !includeFavorites ||
          !_favoritesOnly ||
          _favoriteProductIds.contains(p.id);
      final normalizedTags = p.dietaryTags.map(normalizeCatalogSearch).toSet();
      final normalizedAllergens = p.allergens
          .map(normalizeCatalogSearch)
          .toSet();
      final matchesDiet = _dietaryFilters.every(
        (tag) => normalizedTags.contains(normalizeCatalogSearch(tag)),
      );
      final avoidsAllergens = _excludedAllergens.every(
        (allergen) =>
            !normalizedAllergens.contains(normalizeCatalogSearch(allergen)),
      );
      return matchesAvailability &&
          matchesFavorite &&
          matchesDiet &&
          avoidsAllergens;
    }).toList();
    final products = !includeSearch || _searchQuery.trim().isEmpty
        ? candidates
        : rankCatalogProducts(candidates, _searchQuery);
    switch (_sort) {
      case _CatalogSort.priceLow:
        products.sort((a, b) {
          final priceComparison = a.price.compareTo(b.price);
          return priceComparison != 0
              ? priceComparison
              : catalogAlphabeticalCompare(a.title, b.title);
        });
        break;
      case _CatalogSort.priceHigh:
        products.sort((a, b) {
          final priceComparison = b.price.compareTo(a.price);
          return priceComparison != 0
              ? priceComparison
              : catalogAlphabeticalCompare(a.title, b.title);
        });
        break;
      case _CatalogSort.menu:
        if (!includeSearch || _searchQuery.trim().isEmpty) {
          products.sort((a, b) => catalogAlphabeticalCompare(a.title, b.title));
        }
        break;
    }
    return _stopListedLast(products);
  }

  List<CatalogProduct> _stopListedLast(Iterable<CatalogProduct> source) =>
      catalogProductsWithStopListLast(source);

  List<String> get _searchSuggestions => catalogSearchSuggestions(
    _allProducts.where(
      (product) =>
          _selectedCategory == _catalogAllCategoryKey ||
          product.category == _selectedCategory,
    ),
    _searchQuery,
  );

  List<String> get _availableDietaryTags =>
      _allProducts
          .expand((product) => product.dietaryTags)
          .where(_isDietaryFilterTag)
          .toSet()
          .toList()
        ..sort();

  List<String> get _availableAllergens =>
      _allProducts.expand((product) => product.allergens).toSet().toList()
        ..sort();

  Future<void> _openFilterModal() async {
    await _navigationGate.run(() async {
      final result = await Navigator.of(context).push<_CatalogFilterResult>(
        MaterialPageRoute(
          builder: (_) => _CatalogFilterScreen(
            initialSort: _sort,
            initialOnlyAvailable: _onlyAvailable,
            dietaryTags: _availableDietaryTags,
            allergens: _availableAllergens,
            initialDietaryTags: _dietaryFilters,
            initialExcludedAllergens: _excludedAllergens,
          ),
        ),
      );
      if (!mounted || result == null) return;
      _updateCatalogState(() {
        _sort = result.sort;
        _onlyAvailable = result.onlyAvailable;
        _dietaryFilters = result.dietaryTags;
        _excludedAllergens = result.excludedAllergens;
      });
    });
  }

  void _clearSearch() {
    _searchController.clear();
    _updateCatalogState(() => _searchQuery = '');
  }

  void _resetCatalogFilters() {
    _searchController.clear();
    _updateCatalogState(() {
      _searchQuery = '';
      _selectedCategory = _catalogAllCategoryKey;
      _sort = _CatalogSort.menu;
      _onlyAvailable = false;
      _dietaryFilters = const {};
      _excludedAllergens = const {};
      _favoritesOnly = false;
    });
  }

  bool closeCategoryPage() {
    if (_openedCategory == null) return false;
    _updateCatalogState(() {
      _openedCategory = null;
    });
    publishClientRoute(Uri(path: '/catalog'), replace: true);
    return true;
  }

  void _openCategoryPage(String category) {
    if (category.trim().isEmpty) return;
    BulkaMotion.selection();
    _updateCatalogState(() {
      _openedCategory = category;
    });
    publishClientRoute(_CatalogScreenState._categoryClientUri(category));
  }

  List<MapEntry<String, List<CatalogProduct>>> get _categoryGroups {
    final grouped = <String, List<CatalogProduct>>{};
    for (final category in _categories) {
      if (category == _catalogAllCategoryKey) continue;
      grouped.putIfAbsent(category, () => <CatalogProduct>[]);
    }
    for (final product in _allProducts) {
      grouped
          .putIfAbsent(product.category, () => <CatalogProduct>[])
          .add(product);
    }
    final entries = grouped.entries
        .where((entry) => entry.value.isNotEmpty)
        .map(
          (entry) => MapEntry(
            entry.key,
            _stopListedLast(catalogProductsAlphabetically(entry.value)),
          ),
        )
        .toList();
    entries.sort(
      (left, right) => catalogAlphabeticalCompare(left.key, right.key),
    );
    return entries;
  }

  Future<bool> _ensureOrderTypeSelected() async {
    if (widget.hasSelectedOrderType) return true;
    if (_orderTypeDialogOpen || !mounted) return false;
    _orderTypeDialogOpen = true;
    final openHome = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => Dialog(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        insetPadding: const EdgeInsets.symmetric(horizontal: 24),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(BulkaRadii.card),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'catalog_select_order_type_first'.tr,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontFamily: _headingFont,
                  color: _textDark,
                  fontSize: BulkaTypeScale.title,
                  height: 1.35,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: FilledButton(
                  key: const ValueKey('catalog-order-type-required-ok'),
                  onPressed: () => Navigator.of(dialogContext).pop(true),
                  style: FilledButton.styleFrom(
                    backgroundColor: _bulkaYellow,
                    foregroundColor: _textDark,
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(BulkaRadii.control),
                    ),
                  ),
                  child: Text(
                    'catalog_select_order_type_ok'.tr,
                    style: const TextStyle(
                      fontFamily: _headingFont,
                      fontSize: BulkaTypeScale.body,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    _orderTypeDialogOpen = false;
    if (openHome == true && mounted) {
      closeCategoryPage();
      widget.onRequestOrderType?.call();
    }
    return false;
  }

  Future<void> _setProductQuantity(CatalogProduct product, int quantity) async {
    if (product.isStopListed) return;
    final next = quantity.clamp(0, _catalogProductQuantityLimit(product));
    final cart = context.read<CartProvider>();
    final previous = cart.getQuantity(product.id);
    if (next != previous && await _productRequiresDetails(product)) {
      if (mounted) await _openProductDetails(product);
      return;
    }
    if (next > previous && !await _ensureOrderTypeSelected()) return;
    if (!mounted) return;
    if (next <= 0) {
      cart.removeItem(product.id);
      if (previous > 0) {
        _api.trackEvent(
          'remove_from_cart',
          productId: product.id,
          branchId: _selectedBakeryId,
        );
      }
    } else {
      if (previous == 0) {
        cart.addItem(
          productId: product.id,
          name: product.title,
          price: product.price,
          imageUrl: product.imageUrl,
          isStopListed: product.isStopListed,
        );
        _api.trackEvent(
          'add_to_cart',
          productId: product.id,
          branchId: _selectedBakeryId,
          properties: {'price': product.price},
        );
      }
      cart.setQuantity(product.id, next);
    }
    unawaited(
      next > previous && previous == 0
          ? BulkaMotion.lightImpact()
          : BulkaMotion.selection(),
    );
  }

  double _catalogContentBottomInset(BuildContext context) =>
      BulkaLayout.bottomNavContentInset(context);

  Future<void> _openProductDetails(
    CatalogProduct product, {
    bool updateClientRoute = true,
  }) async {
    await _navigationGate.run(() async {
      _api.trackEvent(
        'product_view',
        productId: product.id,
        branchId: _selectedBakeryId,
        properties: {'category': product.category},
      );
      if (updateClientRoute) {
        publishClientRoute(_CatalogScreenState._productClientUri(product));
      }
      _productRouteOpen = true;
      try {
        await Navigator.of(context).push<void>(
          MaterialPageRoute(
            settings: RouteSettings(name: '/catalog/product/${product.id}'),
            builder: (_) => ProductDetailsScreen(
              api: _api,
              product: product,
              liveProducts: _liveProducts,
              initialQuantity: context.read<CartProvider>().getQuantity(
                product.id,
              ),
              onQuantityChanged: _setProductQuantity,
              initialFavorite: _favoriteProductIds.contains(product.id),
              onToggleFavorite: () => _toggleFavorite(product),
              hasSelectedOrderType: widget.hasSelectedOrderType,
              onEnsureOrderTypeSelected: _ensureOrderTypeSelected,
            ),
          ),
        );
      } finally {
        _productRouteOpen = false;
        final current = normalizedClientUri(clientRouteNotifier.value);
        final currentSegments = current.pathSegments
            .where((value) => value.isNotEmpty)
            .toList();
        if (currentSegments.length >= 2 &&
            currentSegments.first == 'catalog' &&
            currentSegments[1] == 'product') {
          publishClientRoute(
            _CatalogScreenState._categoryClientUri(product.category),
            replace: true,
          );
        }
      }
    });
  }
}
