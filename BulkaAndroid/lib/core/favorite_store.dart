part of '../main.dart';

abstract final class FavoriteStore {
  static const _guestKey = 'guest_favorites_v1';

  static Future<Set<String>> loadGuest() async {
    final prefs = await SharedPreferences.getInstance();
    return (prefs.getStringList(_guestKey) ?? const [])
        .map((value) => value.trim())
        .where((value) => value.isNotEmpty)
        .toSet();
  }

  static Future<void> setGuest(String productId, bool favorite) async {
    final prefs = await SharedPreferences.getInstance();
    final values = await loadGuest();
    favorite ? values.add(productId) : values.remove(productId);
    await prefs.setStringList(_guestKey, values.toList()..sort());
  }

  static Future<Set<String>> mergeIntoAccount(
    BulkaApiClient api,
    Set<String> remote,
  ) async {
    final guest = await loadGuest();
    if (guest.isEmpty) return remote;
    final merged = {...remote, ...guest};
    try {
      await Future.wait(guest.map((id) => api.setFavorite(id, true)));
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_guestKey);
    } catch (_) {
      // Keep the local set so synchronization can retry on the next connection.
    }
    return merged;
  }
}
