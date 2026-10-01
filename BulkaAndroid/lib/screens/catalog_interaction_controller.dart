part of '../main.dart';

extension _CatalogInteractionController on _CatalogScreenState {
  String get _catalogMenuTitle => switch (_orderType) {
    'delivery' => 'catalog_delivery_menu'.tr,
    'preorder' => 'catalog_preorder_menu'.tr,
    _ => 'catalog_pickup_menu'.tr,
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
      if (distance.isFinite) {
        candidates.add((branch: branch, distance: distance));
      }
    }
    candidates.sort((left, right) => left.distance.compareTo(right.distance));
    return candidates.isEmpty ? null : candidates.first.branch;
  }

  List<CatalogProduct> get _filteredProducts {
    return _applyActiveProductFilters(
      _allProducts,
      includeSearch: true,
      includeFavorites: true,
    );
  }

  bool get _filterActive => _CatalogFilterResult(
    sort: _sort,
    dietaryTags: _dietaryFilters,
    excludedAllergens: _excludedAllergens,
  ).isActive;

  List<CatalogProduct> _applyActiveProductFilters(
    Iterable<CatalogProduct> source, {
    required bool includeSearch,
    required bool includeFavorites,
  }) {
    final candidates = source.where((p) {
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
      return matchesFavorite && matchesDiet && avoidsAllergens;
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
      final result = await showModalBottomSheet<_CatalogFilterResult>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        clipBehavior: Clip.antiAlias,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        sheetAnimationStyle: BulkaMotion.sheetStyle(context),
        builder: (sheetContext) => FractionallySizedBox(
          heightFactor: 0.9,
          child: _CatalogFilterScreen(
            initialSort: _sort,
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
        _dietaryFilters = result.dietaryTags;
        _excludedAllergens = result.excludedAllergens;
      });
    });
  }

  void _clearSearch() {
    _searchDebounce?.cancel();
    _searchController.clear();
    _updateCatalogState(() => _searchQuery = '');
  }

  void _resetCatalogFilters() {
    _searchDebounce?.cancel();
    _searchController.clear();
    _updateCatalogState(() {
      _searchQuery = '';
      _sort = _CatalogSort.menu;
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
    _pendingCategoryScroll = _catalogAllCategoryKey;
    _scheduleCatalogScrollSync();
    _pendingClientUri = Uri(path: '/catalog');
    publishClientRoute(_pendingClientUri!, replace: true);
    return true;
  }

  void _navigateToCatalogCategory(String category) {
    if (category.trim().isEmpty) return;
    FocusScope.of(context).unfocus();
    BulkaMotion.selection();
    _updateCatalogState(() {
      _openedCategory = category == _catalogAllCategoryKey ? null : category;
    });
    _pendingCategoryScroll = category;
    _scheduleCatalogScrollSync();
    _pendingClientUri = _openedCategory == null
        ? Uri(path: '/catalog')
        : _CatalogScreenState._categoryClientUri(category);
    publishClientRoute(_pendingClientUri!);
  }

  Future<bool> _ensureOrderTypeSelected(CatalogProduct product) async {
    if (widget.hasSelectedOrderType) return true;
    if (_orderTypeDialogOpen || !mounted) return false;
    _orderTypeDialogOpen = true;
    final chooseOrderType = await showDialog<bool>(
      context: context,
      animationStyle: BulkaMotion.reduced(context)
          ? AnimationStyle.noAnimation
          : null,
      builder: (dialogContext) => BulkaActionDialog(
        scrollable: true,
        content: SizedBox(
          width: double.maxFinite,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              OutlinedButton(
                key: const ValueKey('catalog-order-type-required-cancel'),
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: _bulkaBrown, width: 1.5),
                ),
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: Text(
                  'catalog_continue_browsing'.tr,
                  textAlign: TextAlign.center,
                ),
              ),
              const SizedBox(height: 12),
              FilledButton(
                key: const ValueKey('catalog-order-type-required-ok'),
                onPressed: () => Navigator.of(dialogContext).pop(true),
                child: Text(
                  'catalog_select_order_type_ok'.tr,
                  textAlign: TextAlign.center,
                ),
              ),
            ],
          ),
        ),
      ),
    );
    _orderTypeDialogOpen = false;
    if (chooseOrderType == true && mounted) {
      _productPendingFulfillment = product.id;
      if (_productRouteOpen) Navigator.of(context).pop();
      closeCategoryPage();
      widget.onRequestOrderType?.call();
    }
    return false;
  }

  void _resumeProductAfterFulfillment() {
    final productId = _productPendingFulfillment;
    if (productId == null ||
        !widget.hasSelectedOrderType ||
        _selectedBakeryId.isEmpty) {
      return;
    }
    // Resume only after a fresh branch menu arrives; never add an item using
    // availability or prices from the city-wide preview.
    _productPendingFulfillment = null;
    CatalogProduct? product;
    for (final candidate in _allProducts) {
      if (candidate.id == productId) {
        product = candidate;
        break;
      }
    }
    if (product == null || product.isStopListed) {
      ScaffoldMessenger.of(context).showSnackBar(
        bulkaSnackBar(content: Text('catalog_selected_product_unavailable'.tr)),
      );
      return;
    }
    _pendingClientUri = _CatalogScreenState._productClientUri(product);
    publishClientRoute(_pendingClientUri!);
  }

  Future<void> _setProductQuantity(CatalogProduct product, num quantity) async {
    if (product.isStopListed) return;
    final cart = context.read<CartProvider>();
    final previous = cart.getQuantity(product.id);
    var requested = quantity;
    if (requested != previous && await _productRequiresDetails(product)) {
      if (mounted) await _openProductDetails(product);
      return;
    }
    if (requested > previous && !await _ensureOrderTypeSelected(product)) {
      return;
    }
    if (!mounted) return;
    if (requested > previous && !await _ensureSelectedBranchOpen()) return;
    if (!mounted) return;
    if (previous == 0 && requested > 0 && product.quantityStep < 1) {
      final selectedWeight = await showCatalogWeightPicker(
        context,
        product: product,
      );
      if (!mounted || selectedWeight == null) return;
      requested = selectedWeight;
    }
    final next = requested.clamp(0, _catalogProductQuantityLimit(product));
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
          quantityStep: product.quantityStep,
          unit: product.unit,
          quantity: next,
        );
        _api.trackEvent(
          'add_to_cart',
          productId: product.id,
          branchId: _selectedBakeryId,
          properties: {'price': product.price},
        );
      }
      if (previous > 0) cart.setQuantity(product.id, next);
    }
    unawaited(
      next > previous && previous == 0
          ? BulkaMotion.lightImpact()
          : BulkaMotion.selection(),
    );
  }

  double _catalogContentBottomInset(BuildContext context) =>
      BulkaLayout.bottomNavContentInset(context);
}
