part of '../main.dart';

extension _CatalogRouteController on _CatalogScreenState {
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
        publishClientRoute(Uri(path: '/catalog'), replace: true);
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
          if (mounted && !_productRouteOpen) {
            unawaited(_openProductDetails(product!, updateClientRoute: false));
          }
        });
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
}
