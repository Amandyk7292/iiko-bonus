part of '../main.dart';

class WalkingProgress {
  const WalkingProgress({
    required this.date,
    required this.steps,
    required this.rewarded,
    this.deviceRewarded = false,
  });
  final String date;
  final int steps;
  final bool rewarded;
  final bool deviceRewarded;
}

class _WalkingRuntime {
  final progress = ValueNotifier<WalkingProgress?>(null);
  Future<void>? pending;
  DateTime? attemptedAt;
  String? scope;
  final declinedScopes = <String>{};
  int consentRevision = 0;
}

final _walkingRuntimes = Expando<_WalkingRuntime>();

extension WalkingRewardsApi on BulkaApiClient {
  _WalkingRuntime get _walkingRuntime =>
      _walkingRuntimes[this] ??= _WalkingRuntime();
  ValueNotifier<WalkingProgress?> get walkingProgress =>
      _walkingRuntime.progress;
  String? get _walkingConsentKey => sessionCacheScope == null
      ? null
      : 'walking_consent_v1_$sessionCacheScope';
  Future<bool> walkingConsent() async {
    final key = _walkingConsentKey;
    final state = _walkingRuntime;
    if (state.scope != sessionCacheScope) {
      state.scope = sessionCacheScope;
      state.attemptedAt = null;
      state.progress.value = null;
    }
    if (state.declinedScopes.contains(sessionCacheScope)) return false;
    return key != null &&
        (await SharedPreferences.getInstance()).getBool(key) == true;
  }

  Future<void> setWalkingConsent(bool enabled) async {
    final key = _walkingConsentKey;
    if (key == null || !isAuthenticated) return;
    final sessionRevision = _sessionRevision;
    _walkingRuntime.consentRevision++;
    if (!enabled) _walkingRuntime.declinedScopes.add(sessionCacheScope!);
    // Stop immediately even if persisting the opt-out fails. The in-memory
    // consent fence also blocks a late proof and future sync in this session.
    final stop = !enabled && WalkingRewardsNative.isAndroid
        ? WalkingRewardsNative.stop()
        : Future<void>.value();
    Future<bool> writeConsent() async =>
        (await SharedPreferences.getInstance()).setBool(key, enabled);
    final results = await Future.wait<Object?>([writeConsent(), stop]);
    final stored = results.first == true;
    if (_sessionRevision != sessionRevision || !isAuthenticated) {
      throw ApiException(
        'error_session_changed'.tr,
        code: 'SESSION_IDENTITY_CHANGED',
      );
    }
    if (!stored) throw StateError('Walking consent could not be saved');
    if (enabled) _walkingRuntime.declinedScopes.remove(sessionCacheScope);
    if (!enabled && WalkingRewardsNative.isAndroid) {
      _walkingRuntime.progress.value = null;
      _walkingRuntime.attemptedAt = null;
    }
  }

  Future<void> autoSyncWalking() async {
    try {
      if (!WalkingRewardsNative.isSupportedPlatform ||
          !isAuthenticated ||
          !await walkingConsent()) {
        return;
      }
      final capability = await WalkingRewardsNative.capabilities();
      if (capability['supported'] != true ||
          capability['authorized'] != true ||
          capability['requiresPlayServicesUpdate'] == true) {
        return;
      }
      await syncWalking();
    } catch (_) {
      /* Retry after a later resume; never fabricate a count. */
    }
  }

  Future<void> syncWalking({
    bool force = false,
    bool requestPermission = false,
  }) {
    final state = _walkingRuntime;
    if (state.scope != sessionCacheScope) {
      state.scope = sessionCacheScope;
      state.attemptedAt = null;
      state.progress.value = null;
    }
    if (state.pending != null) return state.pending!;
    final throttle = WalkingRewardsNative.isAndroid
        ? Duration(minutes: force ? 2 : 15)
        : const Duration(minutes: 2);
    if ((!force || WalkingRewardsNative.isAndroid) &&
        !requestPermission &&
        state.attemptedAt != null &&
        DateTime.now().difference(state.attemptedAt!) < throttle) {
      return Future.value();
    }
    state.attemptedAt = DateTime.now();
    final future = _syncWalkingOnce(
      _sessionRevision,
      state.consentRevision,
      requestPermission: requestPermission,
    );
    state.pending = future.whenComplete(() => state.pending = null);
    return state.pending!;
  }

  Future<void> _syncWalkingOnce(
    int revision,
    int consentRevision, {
    bool requestPermission = false,
  }) async {
    void checkSession() {
      if (_sessionRevision != revision ||
          !isAuthenticated ||
          consentRevision != _walkingRuntime.consentRevision) {
        throw ApiException(
          'error_session_changed'.tr,
          code: 'SESSION_IDENTITY_CHANGED',
        );
      }
    }

    if (!WalkingRewardsNative.isSupportedPlatform || !await walkingConsent()) {
      return;
    }
    checkSession();
    if (WalkingRewardsNative.isAndroid) {
      final capability = await WalkingRewardsNative.capabilities();
      checkSession();
      if (capability['supported'] != true) return;
      if (capability['requiresPlayServicesUpdate'] == true) {
        throw PlatformException(code: 'WALKING_PLAY_SERVICES_UPDATE');
      }
      if (capability['authorized'] != true && !requestPermission) {
        throw PlatformException(code: 'WALKING_PERMISSION');
      }
    }
    final status = await _get('/api/customer/walking');
    checkSession();
    if (status['enabled'] != true) return;
    final date = _asString(status['date']);
    final days = (status['days'] as List? ?? []).whereType<Map>().toList();
    final today = days.where((day) => day['date'] == date).firstOrNull;
    _walkingRuntime.progress.value = WalkingProgress(
      date: date,
      steps: _asInt(today?['steps']),
      rewarded: today?['credited'] == true,
    );
    if (WalkingRewardsNative.isAndroid) {
      await _syncAndroidWalking(
        status,
        checkSession,
        requestPermission: requestPermission,
      );
      return;
    }
    final identity = await WalkingRewardsNative.invoke('identity');
    checkSession();
    var proof = await _post('/api/customer/walking/challenge', {
      ...identity,
      'purpose': 'steps',
      'dayOffset': 0,
    });
    checkSession();
    if (proof['registered'] != true) {
      final registration = await _post('/api/customer/walking/challenge', {
        ...identity,
        'purpose': 'register',
      });
      checkSession();
      final attestation = await WalkingRewardsNative.invoke('attest', {
        ...identity,
        'challenge': registration['challenge'],
      });
      checkSession();
      await _post('/api/customer/walking/device', {
        ...identity,
        'challenge': registration['challenge'],
        ...attestation,
      });
      checkSession();
    }
    for (var offset = 0; offset <= 6; offset++) {
      final expectedDay = DateTime.parse(
        '${date}T00:00:00Z',
      ).subtract(Duration(days: offset)).toIso8601String().substring(0, 10);
      if (expectedDay.compareTo(_asString(status['startsOn'])) < 0 ||
          days.any(
            (d) =>
                d['date'] == expectedDay &&
                (d['credited'] == true ||
                    (offset > 0 && d['complete'] == true)),
          )) {
        continue;
      }
      if (offset > 0) {
        proof = await _post('/api/customer/walking/challenge', {
          ...identity,
          'purpose': 'steps',
          'dayOffset': offset,
        });
      }
      checkSession();
      final period = Map<String, dynamic>.from(proof['period'] as Map);
      final day = _asString(period['date']);
      if (day.compareTo(_asString(status['startsOn'])) < 0 ||
          days.any(
            (d) =>
                d['date'] == day &&
                (d['credited'] == true ||
                    (offset > 0 && d['complete'] == true)),
          )) {
        continue;
      }
      final measured = await WalkingRewardsNative.invoke('measure', {
        ...identity,
        ...period,
        'challenge': proof['challenge'],
      });
      checkSession();
      final result = await _post('/api/customer/walking/sync', {
        ...identity,
        'challenge': proof['challenge'],
        ...measured,
      });
      checkSession();
      if (day == date) {
        _walkingRuntime.progress.value = WalkingProgress(
          date: day,
          steps: _asInt(result['steps']),
          rewarded: result['rewarded'] == true,
          deviceRewarded: result['deviceRewarded'] == true,
        );
      }
    }
  }

  Future<void> _syncAndroidWalking(
    Map<String, dynamic> status,
    VoidCallback checkSession, {
    required bool requestPermission,
  }) async {
    final date = _asString(status['date']);
    final startsOn = _asString(status['startsOn']);
    final days = (status['days'] as List? ?? []).whereType<Map>().toList();
    final offsets = <int>[];
    for (var offset = 0; offset <= 6; offset++) {
      final day = DateTime.parse(
        '${date}T00:00:00Z',
      ).subtract(Duration(days: offset)).toIso8601String().substring(0, 10);
      if (day.compareTo(startsOn) >= 0 &&
          !days.any(
            (entry) =>
                entry['date'] == day &&
                (entry['credited'] == true ||
                    (offset > 0 && entry['complete'] == true)),
          )) {
        offsets.add(offset);
      }
    }
    // Reconnecting after today's reward must still start local recording for
    // tomorrow. The server handles this explicit reconnect idempotently.
    if (offsets.isEmpty && requestPermission && date.compareTo(startsOn) >= 0) {
      offsets.add(0);
    }
    if (offsets.isEmpty) return;
    final identity = await WalkingRewardsNative.invoke('identity');
    checkSession();
    // Platform is explicit; the existing iOS requests keep their original shape.
    final androidIdentity = {...identity, 'platform': 'android'};
    final proof = await _post('/api/customer/walking/challenge', {
      ...androidIdentity,
      'purpose': 'steps',
      'dayOffsets': offsets,
    });
    checkSession();
    if (proof['registered'] != true) {
      final registration = await _post('/api/customer/walking/challenge', {
        ...androidIdentity,
        'purpose': 'register',
      });
      checkSession();
      final attestation = await WalkingRewardsNative.invoke('attest', {
        ...androidIdentity,
        'challenge': registration['challenge'],
      });
      checkSession();
      await _post('/api/customer/walking/device', {
        ...androidIdentity,
        'challenge': registration['challenge'],
        ...attestation,
      });
      checkSession();
    }
    final periods = (proof['periods'] as List? ?? [])
        .whereType<Map>()
        .map((period) => Map<String, dynamic>.from(period))
        .toList();
    if (periods.isEmpty || periods.length > 7) {
      throw ApiException(
        'Invalid walking challenge',
        code: 'INVALID_API_RESPONSE',
      );
    }
    final measured = await WalkingRewardsNative.invoke('measureBatch', {
      ...androidIdentity,
      'challenge': proof['challenge'],
      'periods': periods,
      'requestPermission': requestPermission,
    });
    checkSession();
    final result = await _post('/api/customer/walking/sync', {
      ...androidIdentity,
      'challenge': proof['challenge'],
      'payload': measured['payload'],
      'assertion': measured['assertion'],
    });
    checkSession();
    final current = (result['days'] as List? ?? [])
        .whereType<Map>()
        .where((day) => day['date'] == date)
        .firstOrNull;
    if (current != null) {
      _walkingRuntime.progress.value = WalkingProgress(
        date: date,
        steps: _asInt(current['steps']),
        rewarded: current['rewarded'] == true || current['credited'] == true,
        deviceRewarded: current['deviceRewarded'] == true,
      );
    }
  }
}
