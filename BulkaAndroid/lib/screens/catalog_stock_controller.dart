part of '../main.dart';

extension _CatalogStockController on _CatalogScreenState {
  bool _matchesCatalogBranch(Map<String, dynamic> event) {
    final profile = _asString(_asMap(event['data'])['profileKey']);
    if (profile.isNotEmpty &&
        _menuProfileKey.isNotEmpty &&
        profile != _menuProfileKey) {
      return false;
    }
    final branch = _asString(_asMap(event['data'])['branchId']);
    return branch.isEmpty || branch == _selectedBakeryId;
  }
}
