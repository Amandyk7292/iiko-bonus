part of '../main.dart';

class _GuestAddressDrafts {
  final List<DeliveryAddress> addresses = [];
  String? selectedId;
}

class AddressRepository {
  const AddressRepository({this.api, this.cacheScope});

  static final Expando<_GuestAddressDrafts> _guestDrafts = Expando();
  static final _anonymousDrafts = _GuestAddressDrafts();

  final BulkaApiClient? api;
  final String? cacheScope;

  String get _scope => cacheScope ?? api?.sessionCacheScope ?? 'guest';
  String get _addressesKey =>
      customerPreferenceKey('delivery_addresses', _scope);
  String get _selectedAddressKey =>
      customerPreferenceKey('selected_delivery_address_id', _scope);
  bool get _syncWithAccount => api?.isAuthenticated == true;
  bool get _temporaryGuest => cacheScope == null && !_syncWithAccount;
  _GuestAddressDrafts get _drafts {
    final client = api;
    if (client == null) return _anonymousDrafts;
    return _guestDrafts[client] ??= _GuestAddressDrafts();
  }

  static bool hasGuestDrafts(BulkaApiClient api) =>
      _guestDrafts[api]?.addresses.isNotEmpty == true;

  static int guestDraftCount(BulkaApiClient api) =>
      _guestDrafts[api]?.addresses.length ?? 0;

  static void discardGuestDrafts(BulkaApiClient api) {
    _guestDrafts[api] = _GuestAddressDrafts();
  }

  static Future<void> removePersistedGuestAddresses(
    SharedPreferences prefs,
  ) async {
    await Future.wait([
      prefs.remove('delivery_addresses_guest'),
      prefs.remove('selected_delivery_address_id_guest'),
    ]);
  }

  static Future<void> adoptGuestDrafts(BulkaApiClient api) async {
    if (!api.isAuthenticated) throw StateError('Customer sign-in is required');
    final drafts = _guestDrafts[api];
    if (drafts == null || drafts.addresses.isEmpty) return;
    final remote = await api.getCustomerAddresses();
    final adopted = <String, DeliveryAddress>{};
    for (final draft in drafts.addresses) {
      final match = remote
          .where(
            (address) =>
                address.location.city.trim().toLowerCase() ==
                    draft.location.city.trim().toLowerCase() &&
                (address.location.latitude - draft.location.latitude).abs() <
                    0.000001 &&
                (address.location.longitude - draft.location.longitude).abs() <
                    0.000001 &&
                address.house.trim() == draft.house.trim() &&
                (address.apartment ?? '').trim() ==
                    (draft.apartment ?? '').trim(),
          )
          .firstOrNull;
      final saved = match ?? await api.createCustomerAddress(draft);
      if (match == null) remote.add(saved);
      adopted[draft.id] = saved;
    }
    final selected = adopted[drafts.selectedId];
    if (selected != null) await api.setDefaultCustomerAddress(selected.id);
    final repository = AddressRepository(api: api);
    final prefs = await SharedPreferences.getInstance();
    await repository._cacheAddresses(prefs, remote);
    if (selected != null) {
      await prefs.setString(repository._selectedAddressKey, selected.id);
    }
    discardGuestDrafts(api);
  }

  Future<List<DeliveryAddress>> loadAddresses() async {
    if (_temporaryGuest) return List<DeliveryAddress>.of(_drafts.addresses);
    final prefs = await SharedPreferences.getInstance();
    if (_syncWithAccount) {
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
    if (_temporaryGuest) return _drafts.selectedId;
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
    if (_temporaryGuest) {
      final drafts = _drafts;
      drafts.addresses.removeWhere((item) => item.id == address.id);
      drafts.addresses.insert(0, address);
      drafts.selectedId = address.id;
      return address;
    }
    final prefs = await SharedPreferences.getInstance();
    final saved = _syncWithAccount
        ? await api!.createCustomerAddress(address)
        : address;
    final cached = _readCachedAddresses(prefs);
    final next = [saved, ...cached.where((item) => item.id != saved.id)];
    await _cacheAddresses(prefs, next);
    await selectAddress(saved.id);
    return saved;
  }

  Future<DeliveryAddress> updateAddress(DeliveryAddress address) async {
    if (_temporaryGuest) {
      final drafts = _drafts;
      final index = drafts.addresses.indexWhere(
        (item) => item.id == address.id,
      );
      if (index >= 0) drafts.addresses[index] = address;
      return address;
    }
    final prefs = await SharedPreferences.getInstance();
    final saved = _syncWithAccount
        ? await api!.updateCustomerAddress(address)
        : address;
    final cached = _readCachedAddresses(prefs);
    final next = [saved, ...cached.where((item) => item.id != saved.id)];
    await _cacheAddresses(prefs, next);
    return saved;
  }

  Future<void> selectAddress(String id) async {
    if (_temporaryGuest) {
      _drafts.selectedId = id;
      return;
    }
    if (_syncWithAccount) await api!.setDefaultCustomerAddress(id);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_selectedAddressKey, id);
  }

  Future<void> deleteAddress(String id) async {
    if (_temporaryGuest) {
      final drafts = _drafts;
      drafts.addresses.removeWhere((item) => item.id == id);
      if (drafts.selectedId == id) {
        drafts.selectedId = drafts.addresses.isEmpty
            ? null
            : drafts.addresses.first.id;
      }
      return;
    }
    if (_syncWithAccount) await api!.deleteCustomerAddress(id);
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
