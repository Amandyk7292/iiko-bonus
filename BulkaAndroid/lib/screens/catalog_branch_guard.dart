part of '../main.dart';

extension _CatalogBranchGuard on _CatalogScreenState {
  Future<bool> _ensureSelectedBranchOpen() async {
    if (_orderType == 'preorder' || _selectedBakeryId.isEmpty) return true;
    var branch = _selectedBakeryLocation;
    if (branch == null || branch.id != _selectedBakeryId) {
      try {
        final locations = await _api.getFulfillmentLocations();
        branch = locations
            .where(
              (location) =>
                  location.id == _selectedBakeryId &&
                  location.active &&
                  location.supports(_orderType),
            )
            .firstOrNull;
        if (mounted && branch != null) {
          _updateCatalogState(() => _selectedBakeryLocation = branch);
        }
      } catch (_) {
        return true;
      }
    }
    if (!mounted || branch == null) return true;
    final hours = bakeryHoursToday(branch, DateTime.now());
    if (hours.open != false) return true;
    await showBranchClosedSheet(context, branch: branch, hours: hours.label);
    return false;
  }
}
