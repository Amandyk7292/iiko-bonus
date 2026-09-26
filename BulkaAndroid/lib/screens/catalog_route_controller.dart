part of '../main.dart';

extension _CatalogRouteController on _CatalogScreenState {
  void cancelPendingProductNavigation() {
    if (!_productRouteOpen &&
        _pendingClientUri != null &&
        productIdFromClientUri(_pendingClientUri!) != null) {
      _pendingClientUri = _openedCategory == null
          ? Uri(path: '/catalog')
          : _CatalogScreenState._categoryClientUri(_openedCategory!);
    }
  }

  void applyClientUri(Uri uri) {
    _pendingClientUri = normalizedClientUri(uri);
    if (_menuScopeReady &&
        ((_requestedRouteBranch.isNotEmpty &&
                _requestedRouteBranch != _selectedBakeryId) ||
            (!_isLoading &&
                _allProducts.isEmpty &&
                productIdFromClientUri(uri) != null))) {
      unawaited(_loadMenu());
      return;
    }
    _applyPendingClientUri();
  }

  void _applyPendingClientUri() {
    if (!mounted ||
        _isLoading ||
        _allProducts.isEmpty ||
        (_requestedRouteBranch.isNotEmpty &&
            _requestedRouteBranch != _selectedBakeryId)) {
      return;
    }
    final uri = _pendingClientUri;
    if (uri == null) return;
    final segments = uri.pathSegments
        .where((value) => value.isNotEmpty)
        .toList();
    if (segments.isEmpty || !{'catalog', 'p'}.contains(segments.first)) {
      if (_productRouteOpen) unawaited(Navigator.of(context).maybePop());
      if (_openedCategory != null) {
        _updateCatalogState(() => _openedCategory = null);
      }
      return;
    }

    final productId = productIdFromClientUri(uri);
    if (productId != null) {
      CatalogProduct? product;
      for (final candidate in _allProducts) {
        if (candidate.id == productId) {
          product = candidate;
          break;
        }
      }
      if (product == null) {
        _pendingClientUri = Uri(path: '/catalog');
        publishClientRoute(_pendingClientUri!, replace: true);
        if (_openedCategory != null) {
          _updateCatalogState(() => _openedCategory = null);
        }
        return;
      }
      if (_openedCategory != product.category) {
        _updateCatalogState(() => _openedCategory = product!.category);
      }
      if (!_productRouteOpen) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && !_productRouteOpen && _pendingClientUri == uri) {
            unawaited(_openProductDetails(product!, updateClientRoute: false));
          }
        });
        WidgetsBinding.instance.ensureVisualUpdate();
      }
      return;
    }

    if (_productRouteOpen) unawaited(Navigator.of(context).maybePop());
    if (segments.length >= 3 && segments[1] == 'category') {
      final requested = segments[2];
      String? category;
      for (final candidate in _categories) {
        if (candidate == _catalogAllCategoryKey) continue;
        if (candidate == requested ||
            candidate.toLowerCase() == requested.toLowerCase()) {
          category = candidate;
          break;
        }
      }
      if (category != null && _openedCategory != category) {
        _updateCatalogState(() => _openedCategory = category);
      }
      return;
    }
    if (_openedCategory != null) {
      _updateCatalogState(() => _openedCategory = null);
    }
  }

  Future<void> _openProductDetails(
    CatalogProduct product, {
    bool updateClientRoute = true,
  }) async {
    CatalogProduct? nextProduct;
    var closeButtonPressed = false;
    final originCategory = _openedCategory;
    await _navigationGate.run(() async {
      _api.trackEvent(
        'product_view',
        productId: product.id,
        branchId: _selectedBakeryId,
        properties: {'category': product.category},
      );
      _productRouteOpen = true;
      // Keep background menu refreshes on the route the user just opened.
      _pendingClientUri = _routeProductUri(product);
      publishClientRoute(
        _routeProductUri(product),
        replace: !updateClientRoute,
      );
      try {
        final route = BulkaPageRoute<CatalogProduct>(
          reduceMotion: BulkaMotion.reduced(context),
          builder: (_) => ProductDetailsScreen(
            api: _api,
            branchId: _selectedBakeryId,
            product: product,
            liveProducts: _liveProducts,
            initialQuantity: context.read<CartProvider>().getQuantity(
              product.id,
            ),
            onQuantityChanged: _setProductQuantity,
            onOpenRelatedProduct: (related) =>
                Navigator.of(context).pop(related),
            onClose: () {
              closeButtonPressed = true;
              Navigator.of(context).pop();
            },
            initialFavorite: _favoriteProductIds.contains(product.id),
            onToggleFavorite: () => _toggleFavorite(product),
            onRequireAuth: widget.onRequireAuth,
            orderType: _orderType,
            hasSelectedOrderType: widget.hasSelectedOrderType,
            onEnsureOrderTypeSelected: () => _ensureOrderTypeSelected(product),
          ),
        );
        nextProduct = await Navigator.of(context).push<CatalogProduct>(route);
        await route.completed;
        // Retire the product intent as soon as pop starts. Browser history is
        // not updated on native platforms and must not be our source of truth.
        if (_productPendingFulfillment == null &&
            nextProduct == null &&
            (closeButtonPressed ||
                (_pendingClientUri != null &&
                    productIdFromClientUri(_pendingClientUri!) ==
                        product.id))) {
          _pendingClientUri = originCategory == null
              ? Uri(path: '/catalog')
              : _CatalogScreenState._categoryClientUri(originCategory);
          if (mounted && _openedCategory != originCategory) {
            _updateCatalogState(() => _openedCategory = originCategory);
          }
          publishClientRoute(_pendingClientUri!, replace: true);
        }
      } finally {
        _productRouteOpen = false;
      }
    });
    if (mounted && nextProduct != null) {
      await _openProductDetails(nextProduct!);
    }
  }
}
