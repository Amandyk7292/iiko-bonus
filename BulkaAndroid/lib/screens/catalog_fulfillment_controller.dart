part of '../main.dart';

extension _CatalogFulfillmentController on _CatalogScreenState {
  Future<void> _loadSelectedBakery() async {
    final requestedOrderType = _orderType;
    final prefs = await SharedPreferences.getInstance();
    if (requestedOrderType == 'delivery') {
      DeliveryAddress? address;
      BakeryLocation? branch;
      try {
        address = await AddressRepository(api: _api).loadSelectedAddress();
      } catch (_) {
        address = null;
      }
      try {
        if (address != null) {
          branch = await _resolveDeliveryBranch(address);
        }
      } catch (_) {
        branch = null;
      }
      if (!mounted || requestedOrderType != _orderType) return;
      _updateCatalogState(() {
        _selectedBakery = branch?.displayLabel ?? '';
        _selectedBakeryId = branch?.id ?? '';
        _selectedBakeryLocation = branch;
        _selectedDeliveryAddress = address;
      });
      return;
    }
    final typeKey = 'selected_bakery_location_$requestedOrderType';
    final typeIdKey = 'selected_bakery_location_id_$requestedOrderType';
    final selectedType = prefs.getString('selected_order_type')?.trim() ?? '';
    final selected =
        prefs.getString(typeKey)?.trim() ??
        (selectedType == requestedOrderType
            ? prefs.getString('selected_bakery_location')?.trim()
            : null) ??
        '';
    final selectedId =
        prefs.getString(typeIdKey)?.trim() ??
        (selectedType == requestedOrderType
            ? prefs.getString('selected_bakery_location_id')?.trim()
            : null) ??
        '';
    if (!mounted || requestedOrderType != _orderType) return;
    _updateCatalogState(() {
      _selectedBakery = selected;
      _selectedBakeryId = selectedId;
      _selectedBakeryLocation = null;
      _selectedDeliveryAddress = null;
    });
    // Menu and live branch metadata can load together. Checkout still validates
    // availability and the branch schedule before accepting an order.
    if (selectedId.isNotEmpty) _branchLive.request(immediate: true);
  }

  Future<void> _selectFulfillmentSource() async {
    await _navigationGate.run(() async {
      if (_orderType == 'delivery') {
        final selected = await Navigator.of(context).push<DeliveryAddress>(
          MaterialPageRoute(builder: (_) => AddressSelectionScreen(api: _api)),
        );
        if (!mounted || selected == null) return;
        BakeryLocation? branch;
        try {
          branch = await _resolveDeliveryBranch(selected);
        } catch (_) {
          branch = null;
        }
        if (!mounted) return;
        _updateCatalogState(() {
          _selectedDeliveryAddress = selected;
          _selectedBakery = branch?.displayLabel ?? '';
          _selectedBakeryId = branch?.id ?? '';
          _selectedBakeryLocation = branch;
        });
        await _loadMenu();
        return;
      }
      final selected = await Navigator.of(context).push<String>(
        MaterialPageRoute(
          builder: (_) => LocationsScreen(orderType: _orderType),
        ),
      );
      if (!mounted || selected == null || selected.trim().isEmpty) return;
      final value = selected.trim();
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('selected_bakery_location', value);
      final selectedId =
          prefs.getString('selected_bakery_location_id')?.trim() ?? '';
      if (mounted) {
        BakeryLocation? branch;
        if (selectedId.isNotEmpty) {
          try {
            final locations = await _api.getFulfillmentLocations();
            branch = locations
                .where(
                  (location) =>
                      location.id == selectedId &&
                      location.active &&
                      location.supports(_orderType),
                )
                .firstOrNull;
          } catch (_) {
            // The selected label and id still allow the menu to load offline.
          }
        }
        if (!mounted) return;
        _updateCatalogState(() {
          _selectedBakery = branch?.displayLabel ?? value;
          _selectedBakeryId = branch?.id ?? selectedId;
          _selectedBakeryLocation = branch;
        });
        await _loadMenu();
      }
    });
  }
}
