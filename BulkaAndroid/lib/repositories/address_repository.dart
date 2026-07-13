part of '../main.dart';

class AddressRepository {
  const AddressRepository({this.api});

  final BulkaApiClient? api;

  static const _addressesKey = 'delivery_addresses';
  static const _selectedAddressKey = 'selected_delivery_address_id';

  Future<List<DeliveryAddress>> loadAddresses() async {
    final prefs = await SharedPreferences.getInstance();
    if (api != null) {
      try {
        final remote = await api!.getCustomerAddresses();
        await _cacheAddresses(prefs, remote);
        for (final address in remote) {
          if (address.isDefault) {
            await prefs.setString(_selectedAddressKey, address.id);
            break;
          }
        }
        return remote;
      } catch (_) {
        final cached = _readCachedAddresses(prefs);
        if (cached.isNotEmpty) return cached;
        rethrow;
      }
    }
    return _readCachedAddresses(prefs);
  }

  List<DeliveryAddress> _readCachedAddresses(SharedPreferences prefs) {
    final rawItems = prefs.getStringList(_addressesKey) ?? const [];
    final addresses = <DeliveryAddress>[];
    for (final raw in rawItems) {
      try {
        final address = DeliveryAddress.fromJson(_asMap(jsonDecode(raw)));
        if (address.id.isNotEmpty &&
            address.location.address.isNotEmpty &&
            address.hasValidCoordinates) {
          addresses.add(address);
        }
      } catch (_) {
        // A single stale cache entry must not block the address list.
      }
    }
    return addresses;
  }

  Future<void> _cacheAddresses(
    SharedPreferences prefs,
    List<DeliveryAddress> addresses,
  ) async {
    await prefs.setStringList(
      _addressesKey,
      addresses.map((item) => jsonEncode(item.toJson())).toList(),
    );
  }

  Future<String?> loadSelectedAddressId() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_selectedAddressKey);
  }

  Future<DeliveryAddress?> loadSelectedAddress() async {
    final addresses = await loadAddresses();
    final selectedId = await loadSelectedAddressId();
    if (addresses.isEmpty) return null;
    for (final address in addresses) {
      if (address.id == selectedId || address.isDefault) return address;
    }
    return addresses.first;
  }

  Future<DeliveryAddress> saveAddress(DeliveryAddress address) async {
    final prefs = await SharedPreferences.getInstance();
    final saved = api == null
        ? address
        : await api!.createCustomerAddress(address);
    final cached = _readCachedAddresses(prefs);
    final next = [saved, ...cached.where((item) => item.id != saved.id)];
    await _cacheAddresses(prefs, next);
    await selectAddress(saved.id);
    return saved;
  }

  Future<DeliveryAddress> updateAddress(DeliveryAddress address) async {
    final prefs = await SharedPreferences.getInstance();
    final saved = api == null
        ? address
        : await api!.updateCustomerAddress(address);
    final cached = _readCachedAddresses(prefs);
    final next = [saved, ...cached.where((item) => item.id != saved.id)];
    await _cacheAddresses(prefs, next);
    return saved;
  }

  Future<void> selectAddress(String id) async {
    if (api != null) await api!.setDefaultCustomerAddress(id);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_selectedAddressKey, id);
  }

  Future<void> deleteAddress(String id) async {
    if (api != null) await api!.deleteCustomerAddress(id);
    final prefs = await SharedPreferences.getInstance();
    final cached = _readCachedAddresses(prefs);
    final remaining = cached.where((item) => item.id != id).toList();
    await _cacheAddresses(prefs, remaining);
    if (prefs.getString(_selectedAddressKey) == id) {
      if (remaining.isEmpty) {
        await prefs.remove(_selectedAddressKey);
      } else {
        await prefs.setString(_selectedAddressKey, remaining.first.id);
      }
    }
  }
}
