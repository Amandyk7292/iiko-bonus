part of '../main.dart';

enum _StepChallengeState {
  disconnected,
  loading,
  ready,
  denied,
  unavailable,
  error,
}

class _VerifiedSteps {
  const _VerifiedSteps({
    required this.steps,
    required this.sources,
    required this.checkedAt,
  });
  final int steps;
  final List<String> sources;
  final DateTime checkedAt;
}

int verifiedStepTotal(Iterable<HealthDataPoint> points) {
  var total = 0.0;
  for (final point in points) {
    if (point.recordingMethod != RecordingMethod.automatic &&
        point.recordingMethod != RecordingMethod.active) {
      continue;
    }
    final value = point.value;
    if (value is NumericHealthValue && value.numericValue > 0) {
      total += value.numericValue.toDouble();
    }
  }
  return total.round().clamp(0, 1000000);
}

class _StepChallengeService {
  _StepChallengeService({Health? health}) : _health = health ?? Health();
  final Health _health;

  Future<_VerifiedSteps> readToday({required bool requestPermission}) async {
    if (kIsWeb || !(io.Platform.isIOS || io.Platform.isAndroid)) {
      throw const _HealthUnavailable();
    }
    await _health.configure();
    if (io.Platform.isAndroid) {
      if (!await _health.isHealthConnectAvailable()) {
        throw const _HealthUnavailable();
      }
      final activity = await Permission.activityRecognition.status;
      if (!activity.isGranted && requestPermission) {
        final result = await Permission.activityRecognition.request();
        if (!result.isGranted) throw const _HealthDenied();
      } else if (!activity.isGranted) {
        throw const _HealthDenied();
      }
    }
    const types = [HealthDataType.STEPS];
    final hasAccess = await _health.hasPermissions(
      types,
      permissions: const [HealthDataAccess.READ],
    );
    if (hasAccess != true) {
      if (!requestPermission ||
          !await _health.requestAuthorization(
            types,
            permissions: const [HealthDataAccess.READ],
          )) {
        throw const _HealthDenied();
      }
    }
    final now = DateTime.now();
    final start = DateTime(now.year, now.month, now.day);
    final points = await _health.getHealthDataFromTypes(
      types: types,
      startTime: start,
      endTime: now,
      recordingMethodsToFilter: const [
        RecordingMethod.manual,
        RecordingMethod.unknown,
      ],
    );
    final sources = <String>{};
    for (final point in points) {
      if (point.recordingMethod != RecordingMethod.automatic &&
          point.recordingMethod != RecordingMethod.active) {
        continue;
      }
      final source = point.sourceName.trim();
      if (source.isNotEmpty) sources.add(source);
    }
    return _VerifiedSteps(
      // HealthKit's statistics query applies Apple's source priority and avoids
      // double-counting overlapping iPhone and Watch samples. Android needs the
      // raw recording method so unknown/manual entries can be excluded.
      steps: io.Platform.isIOS
          ? (await _health.getTotalStepsInInterval(
                      start,
                      now,
                      includeManualEntry: false,
                    ) ??
                    0)
                .clamp(0, 1000000)
                .toInt()
          : verifiedStepTotal(points),
      sources: sources.toList()..sort(),
      checkedAt: now,
    );
  }
}

class _HealthDenied implements Exception {
  const _HealthDenied();
}

class _HealthUnavailable implements Exception {
  const _HealthUnavailable();
}

class ChallengesScreen extends StatefulWidget {
  const ChallengesScreen({required this.customerId, super.key});
  final String customerId;
  @override
  State<ChallengesScreen> createState() => _ChallengesScreenState();
}

class _ChallengesScreenState extends State<ChallengesScreen> {
  static const target = 10000;
  late final _StepChallengeService _service;
  _StepChallengeState _state = _StepChallengeState.disconnected;
  _VerifiedSteps? _result;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _service = _StepChallengeService();
    unawaited(_restoreConnection());
  }

  String get _permissionKey =>
      'challenge_health_connected_${widget.customerId}';

  Future<void> _restoreConnection() async {
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getBool(_permissionKey) == true) {
      await _load(requestPermission: false);
    }
  }

  Future<void> _load({required bool requestPermission}) async {
    if (_state == _StepChallengeState.loading) return;
    setState(() {
      _state = _StepChallengeState.loading;
      _error = '';
    });
    try {
      final result = await _service.readToday(
        requestPermission: requestPermission,
      );
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_permissionKey, true);
      if (!mounted) return;
      setState(() {
        _result = result;
        _state = _StepChallengeState.ready;
      });
    } on _HealthDenied {
      if (mounted) setState(() => _state = _StepChallengeState.denied);
    } on _HealthUnavailable {
      if (mounted) setState(() => _state = _StepChallengeState.unavailable);
    } catch (error) {
      if (mounted) {
        setState(() {
          _state = _StepChallengeState.error;
          _error = localizeErrorMessage(error);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final steps = _result?.steps ?? 0;
    final progress = (steps / target).clamp(0.0, 1.0);
    final completed = steps >= target;
    return Scaffold(
      appBar: AppBar(title: _BulkaPageTitle('challenges_title'.tr)),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () => _load(requestPermission: false),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 40),
            children: [
              Text(
                'challenges_heading'.tr,
                style: const TextStyle(
                  fontFamily: _headingFont,
                  fontSize: 28,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'challenges_description'.tr,
                style: TextStyle(color: colors.mutedText, height: 1.45),
              ),
              const SizedBox(height: 22),
              Container(
                key: const ValueKey('daily-steps-challenge'),
                padding: const EdgeInsets.all(22),
                decoration: BoxDecoration(
                  color: colors.surfaceCream,
                  borderRadius: BorderRadius.circular(26),
                  border: Border.all(
                    color: completed
                        ? const Color(0xFF3B7B60)
                        : colors.cardBorder,
                    width: completed ? 2 : 1,
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 52,
                          height: 52,
                          decoration: BoxDecoration(
                            color: colors.brandGold.withValues(alpha: .18),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            Icons.directions_walk_rounded,
                            color: colors.brandBrown,
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'challenge_steps_title'.tr,
                                style: const TextStyle(
                                  fontFamily: _headingFont,
                                  fontSize: 19,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              Text(
                                'challenge_steps_daily'.tr,
                                style: TextStyle(color: colors.mutedText),
                              ),
                            ],
                          ),
                        ),
                        if (completed)
                          const Icon(
                            Icons.check_circle_rounded,
                            color: Color(0xFF3B7B60),
                            size: 30,
                          ),
                      ],
                    ),
                    const SizedBox(height: 24),
                    Text(
                      '$steps / $target',
                      style: const TextStyle(
                        fontFamily: _headingFont,
                        fontSize: 30,
                        fontWeight: FontWeight.w800,
                        fontFeatures: [FontFeature.tabularFigures()],
                      ),
                    ),
                    const SizedBox(height: 10),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(99),
                      child: LinearProgressIndicator(
                        value: progress,
                        minHeight: 12,
                        backgroundColor: colors.cardBorder,
                        color: completed
                            ? const Color(0xFF3B7B60)
                            : colors.brandGold,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      completed
                          ? 'challenge_completed'.tr
                          : 'challenge_steps_left'.trArgs({
                              'count': max(0, target - steps),
                            }),
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    if (_result != null) ...[
                      const SizedBox(height: 8),
                      Text(
                        'challenge_checked_at'.trArgs({
                          'time': formatUiTime(context, _result!.checkedAt),
                        }),
                        style: TextStyle(color: colors.mutedText, fontSize: 13),
                      ),
                      if (_result!.sources.isNotEmpty)
                        Text(
                          'challenge_sources'.trArgs({
                            'sources': _result!.sources.take(3).join(', '),
                          }),
                          style: TextStyle(
                            color: colors.mutedText,
                            fontSize: 13,
                          ),
                        ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: colors.disabledSurface,
                  borderRadius: BorderRadius.circular(18),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.verified_user_outlined,
                      color: colors.brandBrown,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'challenge_manual_excluded'.tr,
                        style: const TextStyle(height: 1.4),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              if (_state == _StepChallengeState.loading)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.all(20),
                    child: CircularProgressIndicator(),
                  ),
                )
              else if (_state == _StepChallengeState.unavailable)
                _ChallengeMessage(
                  icon: Icons.mobile_off_rounded,
                  text: 'challenge_health_unavailable'.tr,
                )
              else if (_state == _StepChallengeState.denied)
                _ChallengeMessage(
                  icon: Icons.lock_outline_rounded,
                  text: 'challenge_health_denied'.tr,
                )
              else if (_state == _StepChallengeState.error)
                _ChallengeMessage(
                  icon: Icons.error_outline_rounded,
                  text: _error.isEmpty ? 'error_network'.tr : _error,
                )
              else
                FilledButton.icon(
                  key: const ValueKey('connect-health-steps'),
                  onPressed: () => _load(requestPermission: _result == null),
                  icon: Icon(
                    _result == null
                        ? Icons.favorite_outline_rounded
                        : Icons.refresh_rounded,
                  ),
                  label: Text(
                    _result == null
                        ? 'challenge_connect_health'.tr
                        : 'refresh_btn'.tr,
                  ),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(54),
                  ),
                ),
              if (const {
                _StepChallengeState.denied,
                _StepChallengeState.error,
              }.contains(_state)) ...[
                const SizedBox(height: 10),
                OutlinedButton(
                  onPressed: () => _load(requestPermission: true),
                  child: Text('retry_btn'.tr),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _ChallengeMessage extends StatelessWidget {
  const _ChallengeMessage({required this.icon, required this.text});
  final IconData icon;
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 12),
    child: Row(
      children: [
        Icon(icon),
        const SizedBox(width: 10),
        Expanded(child: Text(text)),
      ],
    ),
  );
}
