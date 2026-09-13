part of '../main.dart';

extension _CatalogStockController on _CatalogScreenState {
  _LiveRefresh _createStockRefresh() => _LiveRefresh(
    _api,
    {'menu'},
    _refreshStock,
    busy: () => !_menuScopeReady || _activeMenuLoads > 0,
    acceptEvent: (event) =>
        _matchesCatalogBranch(event) &&
        _asMap(event['data'])['inventory'] == true,
  );

  bool _matchesCatalogBranch(Map<String, dynamic> event) {
    final branch = _asString(_asMap(event['data'])['branchId']);
    return branch.isEmpty || branch == _selectedBakeryId;
  }

  Future<void> _refreshStock() async {
    if (!mounted ||
        !_menuScopeReady ||
        _selectedBakeryId.isEmpty ||
        _allProducts.isEmpty ||
        (!TickerMode.of(context) && !_productRouteOpen)) {
      return;
    }
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    if (lifecycle != null && lifecycle != AppLifecycleState.resumed) return;
    final endpoint = _menuEndpoint;
    final revision = _menuLoadRevision;
    final branch = _selectedBakeryId;
    final orderType = _orderType;
    final json = await _api._get(
      Uri(
        path: '/api/public/menu-stock',
        queryParameters: {'branchId': branch, 'orderType': orderType},
      ).toString(),
    );
    if (!mounted || endpoint != _menuEndpoint) return;
    if (revision != _menuLoadRevision) {
      _stockLive.request();
      return;
    }
    if (json['branchId'] != branch ||
        json['orderType'] != orderType ||
        json['products'] is! List) {
      return;
    }
    final rows = {
      for (final row in json['products'] as List)
        _asString(_asMap(row)['id']): _asMap(row),
    };
    final products = _allProducts.map((product) {
      final stock = rows[product.id] ?? <String, dynamic>{};
      final quantity = _productAvailability(stock);
      // Preorders use only the stop list. Display goods without a count remain unavailable.
      final available =
          json['enabled'] == true &&
          (orderType == 'preorder'
              ? stock['isAvailable'] != false
              : stock['isAvailable'] == true &&
                    quantity != null &&
                    quantity > 0);
      return product.withStock(
        quantity: quantity,
        available: available,
        step: stock['quantityStep'] as num? ?? product.quantityStep,
        stockUnit: stock['unit'] as String? ?? product.unit,
      );
    }).toList();
    _syncCartWithMenu(products);
    _updateCatalogState(() => _allProducts = products);
  }
}
