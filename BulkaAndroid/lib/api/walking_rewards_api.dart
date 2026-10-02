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
    return key != null &&
        (await SharedPreferences.getInstance()).getBool(key) == true;
  }

  Future<void> setWalkingConsent(bool enabled) async {
    final key = _walkingConsentKey;
    if (key == null || !isAuthenticated) return;
    _walkingRuntime.consentRevision++;
    await (await SharedPreferences.getInstance()).setBool(key, enabled);
  }

  Future<void> autoSyncWalking() async {
    try {
      if (!WalkingRewardsNative.isIOS ||
          !isAuthenticated ||
          !await walkingConsent()) {
        return;
      }
      final capability = await WalkingRewardsNative.capabilities();
      if (capability['supported'] != true || capability['authorized'] != true) {
        return;
      }
      await syncWalking();
    } catch (_) {
      /* Retry after a later resume; never fabricate a count. */
    }
  }

  Future<void> syncWalking({bool force = false}) {
    final state = _walkingRuntime;
    if (state.scope != sessionCacheScope) {
      state.scope = sessionCacheScope;
      state.attemptedAt = null;
      state.progress.value = null;
    }
    if (state.pending != null) return state.pending!;
    if (!force &&
        state.attemptedAt != null &&
        DateTime.now().difference(state.attemptedAt!) <
            const Duration(minutes: 2)) {
      return Future.value();
    }
    state.attemptedAt = DateTime.now();
    final future = _syncWalkingOnce(_sessionRevision, state.consentRevision);
    state.pending = future.whenComplete(() => state.pending = null);
    return state.pending!;
  }

  Future<void> _syncWalkingOnce(int revision, int consentRevision) async {
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

    if (!WalkingRewardsNative.isIOS || !await walkingConsent()) return;
    checkSession();
    final status = await _get('/customer/walking');
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
    final identity = await WalkingRewardsNative.invoke('identity');
    checkSession();
    var proof = await _post('/customer/walking/challenge', {
      ...identity,
      'purpose': 'steps',
      'dayOffset': 0,
    });
    checkSession();
    if (proof['registered'] != true) {
      final registration = await _post('/customer/walking/challenge', {
        ...identity,
        'purpose': 'register',
      });
      checkSession();
      final attestation = await WalkingRewardsNative.invoke('attest', {
        ...identity,
        'challenge': registration['challenge'],
      });
      checkSession();
      await _post('/customer/walking/device', {
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
        proof = await _post('/customer/walking/challenge', {
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
      final result = await _post('/customer/walking/sync', {
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
}
