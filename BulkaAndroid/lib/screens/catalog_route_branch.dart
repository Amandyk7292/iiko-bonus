part of '../main.dart';

extension _CatalogRouteBranch on _CatalogScreenState {
  Uri _routeProductUri(CatalogProduct product) =>
      _CatalogScreenState._productClientUri(product).replace(
        queryParameters: _requestedRouteBranch.isEmpty
            ? null
            : {'branch': _selectedBakeryId},
      );

  String get _requestedRouteBranch =>
      _orderType == 'delivery' ||
          _pendingClientUri == null ||
          productIdFromClientUri(_pendingClientUri!) == null
      ? ''
      : _pendingClientUri!.queryParameters['branch']?.trim() ?? '';

  Future<bool> _prepareRequestedBranch() async {
    if (_requestedRouteBranch.isEmpty ||
        _requestedRouteBranch == _selectedBakeryId) {
      return true;
    }
    final current = _routeBranchFlight;
    if (current != null) return current;
    final uri = _pendingClientUri!;
    final flight = _selectRequestedBranch(uri);
    _routeBranchFlight = flight;
    try {
      return await flight;
    } finally {
      if (identical(flight, _routeBranchFlight)) _routeBranchFlight = null;
      if (mounted &&
          _pendingClientUri != uri &&
          _requestedRouteBranch.isNotEmpty) {
        _menuLive.request(immediate: true);
      }
    }
  }

  Future<bool> _selectRequestedBranch(Uri uri) async {
    final id = uri.queryParameters['branch']!.trim();
    final orderType = _orderType;
    bool current() =>
        mounted && _pendingClientUri == uri && _orderType == orderType;
    void dismissLink() {
      _pendingClientUri = Uri(path: '/catalog');
      publishClientRoute(_pendingClientUri!, replace: true);
      _updateCatalogState(() => _isLoading = false);
    }

    try {
      final branches = await _api.getFulfillmentLocations();
      if (!mounted || !current()) return false;
      final branch = branches
          .where(
            (value) =>
                value.id == id && value.active && value.supports(orderType),
          )
          .firstOrNull;
      if (branch == null) {
        dismissLink();
        ScaffoldMessenger.of(context).showSnackBar(
          bulkaSnackBar(content: Text('catalog_link_branch_unavailable'.tr)),
        );
        return true;
      }
      final cart = context.read<CartProvider>();
      await cart.restored;
      if (!mounted || !current()) return false;
      if (cart.items.isNotEmpty) {
        final accepted = await showDialog<bool>(
          context: context,
          animationStyle: BulkaMotion.reduced(context)
              ? AnimationStyle.noAnimation
              : null,
          builder: (dialogContext) => BulkaActionDialog(
            title: Text(
              'catalog_link_branch_title'.trArgs({
                'branch': branch.displayLabel,
              }),
            ),
            content: Text('catalog_link_branch_cart'.tr),
            actions: [
              TextButton(
                key: const ValueKey('catalog-link-branch-cancel'),
                onPressed: () => Navigator.pop(dialogContext, false),
                child: Text('cancel_btn'.tr),
              ),
              FilledButton(
                key: const ValueKey('catalog-link-branch-confirm'),
                onPressed: () => Navigator.pop(dialogContext, true),
                child: Text('catalog_link_branch_confirm'.tr),
              ),
            ],
          ),
        );
        if (!mounted || !current()) return false;
        if (accepted != true) {
          dismissLink();
          return true;
        }
      }
      final prefs = await SharedPreferences.getInstance();
      if (!mounted || !current()) return false;
      await Future.wait([
        prefs.setString('selected_bakery_location_id_$orderType', id),
        prefs.setString(
          'selected_bakery_location_$orderType',
          branch.displayLabel,
        ),
        prefs.setString('selected_bakery_location_id', id),
        prefs.setString('selected_bakery_location', branch.displayLabel),
      ]);
      if (!mounted || !current()) return false;
      _updateCatalogState(() {
        _selectedBakeryId = id;
        _selectedBakery = branch.displayLabel;
        _selectedBakeryLocation = branch;
        _allProducts = const [];
        _liveProducts.value = const {};
        _categories = const [_catalogAllCategoryKey];
        _openedCategory = null;
        _apiCategoryImages = const {};
        _isLoading = true;
        _usingCachedMenu = false;
        _loadError = null;
        _menuLoadRevision++;
      });
      return true;
    } catch (error) {
      if (current()) {
        _updateCatalogState(() {
          _isLoading = false;
          _loadError = localizeErrorMessage(error);
        });
      }
      return false;
    }
  }
}
