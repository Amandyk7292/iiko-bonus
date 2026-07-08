part of '../main.dart';

class AddressRepository {
  const AddressRepository();

  static const _addressesKey = 'delivery_addresses';
  static const _selectedAddressKey = 'selected_delivery_address_id';

  Future<List<DeliveryAddress>> loadAddresses() async {
    final prefs = await SharedPreferences.getInstance();
    final rawItems = prefs.getStringList(_addressesKey) ?? const [];
    final addresses = <DeliveryAddress>[];
    for (final raw in rawItems) {
      try {
        addresses.add(DeliveryAddress.fromJson(_asMap(jsonDecode(raw))));
      } catch (_) {
        // Ignore broken local entries, keep address screen usable.
      }
    }
    return addresses;
  }

  Future<String?> loadSelectedAddressId() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_selectedAddressKey);
  }

  Future<void> saveAddress(DeliveryAddress address) async {
    final prefs = await SharedPreferences.getInstance();
    final addresses = await loadAddresses();
    final next = [address, ...addresses.where((item) => item.id != address.id)];
    await prefs.setStringList(
      _addressesKey,
      next.map((item) => jsonEncode(item.toJson())).toList(),
    );
    await prefs.setString(_selectedAddressKey, address.id);
  }

  Future<void> selectAddress(String id) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_selectedAddressKey, id);
  }
}
