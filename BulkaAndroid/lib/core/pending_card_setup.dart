part of '../main.dart';

abstract final class PendingCardSetupStore {
  static final _createFlights = <String, Future<Map<String, dynamic>>>{};
  static final _cancelFlights = <String, Future<Map<String, dynamic>>>{};
  // Legacy SharedPreferences updates its cache before confirming the platform
  // write. Retain the operation if that write fails so cache eviction cannot
  // permit a second binding in the same process.
  static final _unacknowledgedIds = <String, String>{};
  static const _cancelTimeout = Duration(seconds: 8);
  static const _storageTimeout = Duration(seconds: 2);

  static String _key(BulkaApiClient api) =>
      customerPreferenceKey('pending_card_setup_v1', api.sessionCacheScope);
  static String _cancelKey(BulkaApiClient api) => customerPreferenceKey(
    'pending_card_setup_cancel_v1',
    api.sessionCacheScope,
  );

  static VoidCallback _sessionFence(BulkaApiClient api) {
    final owner = api.sessionCacheScope;
    final revision = api._sessionRevision;
    return () {
      if (owner != api.sessionCacheScope || revision != api._sessionRevision) {
        throw ApiException(
          'error_session_changed'.tr,
          code: 'SESSION_IDENTITY_CHANGED',
        );
      }
    };
  }

  static Future<String?> load(BulkaApiClient api) async {
    final key = _key(api);
    final checkSession = _sessionFence(api);
    final prefs = await SharedPreferences.getInstance();
    checkSession();
    return _pendingId(prefs, key);
  }

  static String? _pendingId(SharedPreferences prefs, String key) =>
      _unacknowledgedIds[key] ?? prefs.getString(key);

  static Future<void> _requireWrite(Future<bool> write) async {
    try {
      if (!await write.timeout(_storageTimeout)) throw _cancellationUnknown();
    } catch (_) {
      throw _cancellationUnknown();
    }
  }

  static Future<void> save(BulkaApiClient api, String id) async {
    final key = _key(api);
    final checkSession = _sessionFence(api);
    final prefs = await SharedPreferences.getInstance();
    checkSession();
    final current = _pendingId(prefs, key);
    if (current != null && current != id) throw _cancellationUnknown();
    try {
      await _requireWrite(prefs.setString(key, id));
    } catch (_) {
      _unacknowledgedIds[key] = id;
      checkSession();
      rethrow;
    }
    checkSession();
    if (_unacknowledgedIds[key] == id) _unacknowledgedIds.remove(key);
  }

  static Future<void> clear(BulkaApiClient api, String id) async {
    final key = _key(api);
    final cancelKey = _cancelKey(api);
    final checkSession = _sessionFence(api);
    final prefs = await SharedPreferences.getInstance();
    checkSession();
    final ownsPending = _pendingId(prefs, key) == id;
    final ownsIntent = prefs.getString(cancelKey) == id;
    if (!ownsPending && !ownsIntent) return;
    if (ownsPending) _unacknowledgedIds[key] = id;
    try {
      if (ownsPending) await _requireWrite(prefs.remove(key));
      checkSession();
      if (ownsIntent) await _requireWrite(prefs.remove(cancelKey));
    } catch (_) {
      if (ownsPending) _unacknowledgedIds[key] = id;
      checkSession();
      rethrow;
    }
    checkSession();
    if (_unacknowledgedIds[key] == id) _unacknowledgedIds.remove(key);
  }

  static Future<void> markCancellationRequested(
    BulkaApiClient api,
    String id,
  ) async {
    final key = _key(api);
    final cancelKey = _cancelKey(api);
    final checkSession = _sessionFence(api);
    final prefs = await SharedPreferences.getInstance();
    checkSession();
    final current = _pendingId(prefs, key);
    if (current != null && current != id) return;
    // Persist the operation first: a crash between the writes must still
    // reconcile it before creating another card-verification hold.
    try {
      if (_unacknowledgedIds[key] == id || prefs.getString(key) != id) {
        await _requireWrite(prefs.setString(key, id));
      }
      checkSession();
      await _requireWrite(prefs.setString(cancelKey, id));
    } catch (_) {
      _unacknowledgedIds[key] = id;
      checkSession();
      rethrow;
    }
    checkSession();
  }

  static Future<bool> isCancellationRequested(
    BulkaApiClient api,
    String id,
  ) async {
    final key = _cancelKey(api);
    final checkSession = _sessionFence(api);
    final prefs = await SharedPreferences.getInstance();
    checkSession();
    return prefs.getString(key) == id;
  }

  static ApiException _cancellationUnknown() => ApiException(
    'card_setup_cancel_error'.tr,
    code: 'CARD_SETUP_CANCEL_UNAVAILABLE',
  );

  static bool _savedOrPaid(Map<String, dynamic> result) =>
      result['cardSaved'] == true ||
      (result['paymentStatus'] ?? result['status']).toString().toLowerCase() ==
          'paid';

  static Future<Map<String, dynamic>> cancel(BulkaApiClient api, String id) {
    final key = '${_key(api)}:$id';
    final checkSession = _sessionFence(api);
    final running = _cancelFlights[key];
    if (running != null) {
      return running.then((result) {
        checkSession();
        return result;
      });
    }
    late final Future<Map<String, dynamic>> flight;
    flight = _cancel(api, id, checkSession).whenComplete(() {
      if (identical(_cancelFlights[key], flight)) _cancelFlights.remove(key);
    });
    _cancelFlights[key] = flight;
    return flight;
  }

  static Future<Map<String, dynamic>> _cancel(
    BulkaApiClient api,
    String id,
    VoidCallback checkSession,
  ) async {
    await markCancellationRequested(api, id);
    checkSession();
    Map<String, dynamic> result;
    try {
      result = await api.cancelForteCardSetup(id).timeout(_cancelTimeout);
    } on ApiException catch (error) {
      checkSession();
      if (error.code == 'SESSION_IDENTITY_CHANGED') rethrow;
      if (error.statusCode != 404 ||
          error.code != 'FORTE_WIDGET_CARD_SETUP_NOT_FOUND') {
        throw _cancellationUnknown();
      }
      result = {
        'success': true,
        'operationId': id,
        'status': 'cancelled',
        'paymentStatus': 'cancelled',
        'cancelled': true,
        'canResume': false,
      };
    } on TimeoutException {
      checkSession();
      throw _cancellationUnknown();
    } catch (_) {
      checkSession();
      throw _cancellationUnknown();
    }
    checkSession();
    if (result['success'] != true || result['operationId'] != id) {
      throw _cancellationUnknown();
    }
    final status = (result['paymentStatus'] ?? result['status'] ?? '')
        .toString()
        .toLowerCase();
    if (result['cancelled'] != true &&
        !_savedOrPaid(result) &&
        !isTerminalForteFailure(status)) {
      throw _cancellationUnknown();
    }
    await clear(api, id);
    checkSession();
    if (_savedOrPaid(result)) {
      return {
        ...result,
        'paymentStatus': 'paid',
        'status': 'paid',
        'canResume': false,
      };
    }
    return result;
  }

  static Future<Map<String, dynamic>> createOrResume(BulkaApiClient api) {
    final key = _key(api);
    final checkSession = _sessionFence(api);
    final running = _createFlights[key];
    if (running != null) {
      return running.then((result) {
        checkSession();
        return result;
      });
    }
    late final Future<Map<String, dynamic>> flight;
    flight = _createFresh(api, checkSession).whenComplete(() {
      if (identical(_createFlights[key], flight)) _createFlights.remove(key);
    });
    _createFlights[key] = flight;
    return flight;
  }

  static Future<Map<String, dynamic>> _createFresh(
    BulkaApiClient api,
    VoidCallback checkSession,
  ) async {
    final pending = await load(api);
    checkSession();
    // A retained operation belongs to an exited flow. Never reopen its bank
    // redirect; retire it before showing a fresh card form.
    if (pending != null) {
      final cancelled = await cancel(api, pending);
      checkSession();
      if (_savedOrPaid(cancelled)) return cancelled;
    }
    final result = await api.createForteCardSetup();
    checkSession();
    final id = (result['operationId'] ?? '').toString();
    final status = (result['paymentStatus'] ?? result['status'] ?? 'pending')
        .toString()
        .toLowerCase();
    if (id.isNotEmpty) {
      if (_savedOrPaid(result) ||
          result['cancelled'] == true ||
          isTerminalForteFailure(status)) {
        await clear(api, id);
      } else {
        await save(api, id);
      }
    }
    checkSession();
    return result;
  }
}
