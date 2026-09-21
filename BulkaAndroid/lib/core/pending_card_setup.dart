part of '../main.dart';

abstract final class PendingCardSetupStore {
  static String _key(BulkaApiClient api) =>
      customerPreferenceKey('pending_card_setup_v1', api.sessionCacheScope);

  static Future<String?> load(BulkaApiClient api) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_key(api));
  }

  static Future<void> save(BulkaApiClient api, String id) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key(api), id);
  }

  static Future<void> clear(BulkaApiClient api, String id) async {
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getString(_key(api)) == id) await prefs.remove(_key(api));
  }

  static Future<Map<String, dynamic>> createOrResume(BulkaApiClient api) async {
    final session = api.sessionCacheScope;
    final pending = await load(api);
    if (session != api.sessionCacheScope) {
      throw ApiException(
        'error_session_changed'.tr,
        code: 'SESSION_IDENTITY_CHANGED',
      );
    }
    Map<String, dynamic> result;
    try {
      result = pending == null
          ? await api.createForteCardSetup()
          : await api.resumeForteCardSetup(pending);
    } on ApiException catch (error) {
      if (session == api.sessionCacheScope &&
          pending != null &&
          error.statusCode == 404 &&
          error.code == 'FORTE_WIDGET_CARD_SETUP_NOT_FOUND') {
        await clear(api, pending);
      }
      rethrow;
    }
    if (session != api.sessionCacheScope) {
      throw ApiException(
        'error_session_changed'.tr,
        code: 'SESSION_IDENTITY_CHANGED',
      );
    }
    final id = (result['operationId'] ?? pending ?? '').toString();
    final status = (result['paymentStatus'] ?? result['status'] ?? 'pending')
        .toString();
    if (id.isNotEmpty) {
      if (status == 'paid' || isTerminalForteFailure(status)) {
        await clear(api, id);
      } else {
        await save(api, id);
      }
    }
    return result;
  }
}
