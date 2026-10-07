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
  final elapsed = Stopwatch()..start();
  Duration Function()? clock;
  Duration? attemptedAt;
  Duration? retryAt;
  Object? failure;
  Duration get now => clock?.call() ?? elapsed.elapsed;
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
  Object? get walkingSyncFailure => _walkingRuntime.scope == sessionCacheScope
      ? _walkingRuntime.failure
      : null;
  Duration get walkingRefreshDelay {
    final state = _walkingRuntime;
    if (state.scope != sessionCacheScope) {
      return Duration.zero;
    }
    final remaining = state.attemptedAt == null
        ? Duration.zero
        : const Duration(minutes: 1) - (state.now - state.attemptedAt!);
    final rateLimit = _walkingRateLimitDelay;
    final delay = remaining > rateLimit ? remaining : rateLimit;
    return delay > Duration.zero ? delay : Duration.zero;
  }

  Duration get _walkingRateLimitDelay {
    final state = _walkingRuntime;
    if (state.scope != sessionCacheScope || state.retryAt == null) {
      return Duration.zero;
    }
    final remaining = state.retryAt! - state.now;
    return remaining > Duration.zero ? remaining : Duration.zero;
  }

  @visibleForTesting
  void setWalkingClockForTest(Duration Function() clock) {
    _walkingRuntime.clock = clock;
    _walkingRuntime.attemptedAt = null;
    _walkingRuntime.retryAt = null;
  }

  String? get _walkingConsentKey => sessionCacheScope == null
      ? null
      : 'walking_consent_v1_$sessionCacheScope';
  Future<bool> walkingConsent() async {
    final key = _walkingConsentKey;
    final state = _walkingRuntime;
    if (state.scope != sessionCacheScope) {
      state.scope = sessionCacheScope;
      state.attemptedAt = null;
      state.retryAt = null;
      state.failure = null;
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

  Future<void> syncWalking({bool requestPermission = false}) {
    final state = _walkingRuntime;
    if (state.scope != sessionCacheScope) {
      state.scope = sessionCacheScope;
      state.attemptedAt = null;
      state.retryAt = null;
      state.failure = null;
      state.progress.value = null;
    }
    if (state.pending != null) return state.pending!;
    // Timer, route visibility and app resume share one monotonic minute fence.
    // Only a deliberate permission connection may start sooner.
    if (_walkingRateLimitDelay > Duration.zero ||
        (!requestPermission && walkingRefreshDelay > Duration.zero)) {
      return Future.value();
    }
    state.attemptedAt = state.now;
    final revision = _sessionRevision;
    final consentRevision = state.consentRevision;
    Future<void> run() async {
      var todayAccepted = false;
      try {
        await _syncWalkingOnce(
          revision,
          consentRevision,
          requestPermission: requestPermission,
          onTodayAccepted: () => todayAccepted = true,
        );
        if (revision == _sessionRevision &&
            consentRevision == state.consentRevision) {
          state.failure = null;
        }
      } catch (error) {
        if (error is ApiException &&
            error.statusCode == 429 &&
            error.code == 'WALKING_RATE_LIMIT' &&
            revision == _sessionRevision &&
            consentRevision == state.consentRevision) {
          // All callers, including reconnect, respect the server's shared
          // customer limit. A missing header uses the route's five minute window.
          state.retryAt =
              state.now + Duration(seconds: error.retryAfterSeconds ?? 300);
        }
        if (revision == _sessionRevision &&
            consentRevision == state.consentRevision) {
          state.failure = todayAccepted ? null : error;
          // Core Motion may lack an older day's history even when today's
          // signed measurement succeeded. Leave catch-up unfinished for the
          // next scheduled attempt without reporting today's update as failed.
          if (todayAccepted) return;
        }
        rethrow;
      }
    }

    final future = run();
    state.pending = future.whenComplete(() => state.pending = null);
    return state.pending!;
  }

  Future<void> _syncWalkingOnce(
    int revision,
    int consentRevision, {
    bool requestPermission = false,
    required VoidCallback onTodayAccepted,
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
    final previous = _walkingRuntime.progress.value;
    final sameDay = previous?.date == date;
    _walkingRuntime.progress.value = WalkingProgress(
      date: date,
      steps: max(_asInt(today?['steps']), sameDay ? previous!.steps : 0),
      rewarded: today?['credited'] == true || (sameDay && previous!.rewarded),
      deviceRewarded: sameDay && previous!.deviceRewarded,
    );
    if (WalkingRewardsNative.isAndroid) {
      await _syncAndroidWalking(
        status,
        checkSession,
        requestPermission: requestPermission,
        onTodayAccepted: onTodayAccepted,
      );
      return;
    }
    await _syncIOSWalking(status, checkSession, onTodayAccepted);
  }

  Future<void> _syncIOSWalking(
    Map<String, dynamic> status,
    VoidCallback checkSession,
    VoidCallback onTodayAccepted,
  ) async {
    var identity = await WalkingRewardsNative.invoke('identity');
    checkSession();
    var recoveredKey = false;
    var refreshedProof = false;
    var sendingProof = false;
    final completedDays = <String>{};
    while (true) {
      try {
        await _syncIOSWalkingIdentity(
          status,
          identity,
          checkSession,
          completedDays,
          onTodayAccepted,
          (value) {
            sendingProof = value;
          },
        );
        return;
      } on PlatformException catch (error) {
        if (error.code != 'WALKING_DEVICE_ERROR' || recoveredKey) rethrow;
        checkSession();
        final replacement = await WalkingRewardsNative.invoke('identity');
        checkSession();
        // The installed native bridge removes an invalid App Attest key. Only
        // that actual key change permits registration recovery; a generic
        // sensor/network error must never trigger an arbitrary identity reset.
        if (replacement['deviceId'] != identity['deviceId'] ||
            replacement['keyId'] == identity['keyId'] ||
            _asString(replacement['keyId']).isEmpty) {
          rethrow;
        }
        recoveredKey = true;
        identity = replacement;
      } on ApiException catch (error) {
        if (!sendingProof ||
            refreshedProof ||
            error.statusCode != 409 ||
            !const {
              'WALKING_KEY_UNKNOWN',
              'WALKING_PROOF_INVALID',
            }.contains(error.code)) {
          rethrow;
        }
        checkSession();
        refreshedProof = true;
        // An expired challenge, stale assertion counter or lost registration
        // gets one fresh signed measurement. Never replay the rejected proof,
        // reset a counter or bypass server verification.
        final refreshedIdentity = await WalkingRewardsNative.invoke('identity');
        checkSession();
        if (refreshedIdentity['deviceId'] != identity['deviceId']) rethrow;
        identity = refreshedIdentity;
      }
      sendingProof = false;
    }
  }

  Future<void> _syncIOSWalkingIdentity(
    Map<String, dynamic> status,
    Map<String, dynamic> identity,
    VoidCallback checkSession,
    Set<String> completedDays,
    VoidCallback onTodayAccepted,
    void Function(bool) setSendingProof,
  ) async {
    final date = _asString(status['date']);
    final days = (status['days'] as List? ?? []).whereType<Map>().toList();
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
          completedDays.contains(expectedDay) ||
          days.any(
            (d) =>
                d['date'] == expectedDay &&
                offset > 0 &&
                (d['credited'] == true || d['complete'] == true),
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
          completedDays.contains(day) ||
          days.any(
            (d) =>
                d['date'] == day &&
                offset > 0 &&
                (d['credited'] == true || d['complete'] == true),
          )) {
        continue;
      }
      final measured = await WalkingRewardsNative.invoke('measure', {
        ...identity,
        ...period,
        'challenge': proof['challenge'],
      });
      checkSession();
      setSendingProof(true);
      final result = await _post('/api/customer/walking/sync', {
        ...identity,
        'challenge': proof['challenge'],
        ...measured,
      });
      checkSession();
      setSendingProof(false);
      completedDays.add(day);
      if (day == date) {
        onTodayAccepted();
        final previous = _walkingRuntime.progress.value;
        _walkingRuntime.progress.value = WalkingProgress(
          date: day,
          steps: max(_asInt(result['steps']), previous?.steps ?? 0),
          rewarded: result['rewarded'] == true || previous?.rewarded == true,
          deviceRewarded:
              result['deviceRewarded'] == true ||
              previous?.deviceRewarded == true,
        );
      }
    }
  }

  Future<void> _syncAndroidWalking(
    Map<String, dynamic> status,
    VoidCallback checkSession, {
    required bool requestPermission,
    required VoidCallback onTodayAccepted,
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
                offset > 0 &&
                (entry['credited'] == true || entry['complete'] == true),
          )) {
        offsets.add(offset);
      }
    }
    // Today remains measurable after credit. The server updates its count
    // monotonically and keeps the daily reward idempotent.
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
      onTodayAccepted();
      final previous = _walkingRuntime.progress.value;
      _walkingRuntime.progress.value = WalkingProgress(
        date: date,
        steps: max(_asInt(current['steps']), previous?.steps ?? 0),
        rewarded:
            current['rewarded'] == true ||
            current['credited'] == true ||
            previous?.rewarded == true,
        deviceRewarded:
            current['deviceRewarded'] == true ||
            previous?.deviceRewarded == true,
      );
    }
  }
}
