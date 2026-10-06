part of '../main.dart';

String _walkingText(String ru, String kk) => AppLang.current == 'kk' ? kk : ru;

class WalkingRewardsCard extends StatefulWidget {
  const WalkingRewardsCard({
    required this.api,
    required this.onReward,
    super.key,
  });
  final BulkaApiClient api;
  final Future<void> Function() onReward;
  @override
  State<WalkingRewardsCard> createState() => _WalkingRewardsCardState();
}

class _WalkingRewardsCardState extends State<WalkingRewardsCard>
    with WidgetsBindingObserver {
  bool _supported = false;
  bool _consent = false;
  bool _busy = false;
  bool _disconnecting = false;
  bool _failed = false;
  bool _permission = false;
  bool _requiresPlayServicesUpdate = false;
  String? _failureMessage;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_load());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_load());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _load() async {
    if (_busy) return;
    final session = widget.api.sessionCacheScope;
    final capabilities = await WalkingRewardsNative.capabilities();
    final consent = await widget.api.walkingConsent();
    if (!mounted || session != widget.api.sessionCacheScope || _busy) return;
    setState(() {
      _supported = capabilities['supported'] == true;
      _consent = consent;
      _requiresPlayServicesUpdate =
          capabilities['requiresPlayServicesUpdate'] == true;
      if (WalkingRewardsNative.isAndroid) {
        _permission =
            consent &&
            capabilities['authorized'] != true &&
            !_requiresPlayServicesUpdate;
        _failed = _permission;
      }
    });
    if (_supported &&
        consent &&
        !_requiresPlayServicesUpdate &&
        (!WalkingRewardsNative.isAndroid ||
            capabilities['authorized'] == true)) {
      await _sync(force: !WalkingRewardsNative.isAndroid);
    }
  }

  Future<void> _connect() async {
    if (_busy) return;
    final session = widget.api.sessionCacheScope;
    final allowed = await showModalBottomSheet<bool>(
      context: context,
      builder: (context) => SafeArea(
        child: SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _walkingText('Шаги за бонусы', 'Қадамдар үшін бонустар'),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 12),
                Text(
                  WalkingRewardsNative.isAndroid
                      ? _walkingText(
                          'После подключения телефон считает шаги в фоне. Bulka получает число шагов за день и дату для начисления бонусов. Отключить можно здесь.',
                          'Қосылғаннан кейін телефон қадамдарды фондық режимде санайды. Bulka бонус есептеу үшін күндік қадам санын және күнін алады. Осы жерден өшіруге болады.',
                        )
                      : _walkingText(
                          'Разрешите доступ к шагомеру iPhone. Для начисления Bulka получит число шагов и дату. Ручные записи и маршруты не передаются.',
                          'iPhone қадам санағышына рұқсат беріңіз. Бонус есептеу үшін Bulka қадам санын және күнін алады. Қолмен енгізілген жазбалар мен бағыттар жіберілмейді.',
                        ),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: () => Navigator.pop(context, true),
                  child: Text(
                    _walkingText(
                      'Разрешить и подключить',
                      'Рұқсат беру және қосу',
                    ),
                  ),
                ),
                TextButton(
                  onPressed: () => Navigator.pop(context, false),
                  child: Text(_walkingText('Не сейчас', 'Қазір емес')),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    if (allowed != true ||
        !mounted ||
        session != widget.api.sessionCacheScope) {
      return;
    }
    try {
      await widget.api.setWalkingConsent(true);
      if (!mounted || session != widget.api.sessionCacheScope) return;
      setState(() => _consent = true);
      await _sync(requestPermission: WalkingRewardsNative.isAndroid);
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
  }

  Future<void> _sync({
    bool force = true,
    bool requestPermission = false,
  }) async {
    if (_busy) return;
    final session = widget.api.sessionCacheScope;
    bool isCurrent() =>
        mounted &&
        session == widget.api.sessionCacheScope &&
        _consent &&
        !_disconnecting;
    setState(() {
      _busy = true;
      _failed = false;
      _permission = false;
      _failureMessage = null;
    });
    try {
      await widget.api.syncWalking(
        force: force,
        requestPermission: requestPermission,
      );
      // A balance refresh cannot turn an accepted step measurement into a
      // failed sync. Keep the confirmed progress if this separate read fails.
      if (isCurrent()) {
        try {
          await widget.onReward();
        } catch (_) {}
      }
    } on PlatformException catch (error) {
      if (isCurrent()) {
        setState(() {
          _failed = true;
          _permission = error.code == 'WALKING_PERMISSION';
          _requiresPlayServicesUpdate =
              error.code == 'WALKING_PLAY_SERVICES_UPDATE';
          if (error.code == 'WALKING_BUSY') {
            _failureMessage = _walkingText(
              WalkingRewardsNative.isAndroid
                  ? 'Проверка ещё идёт. Повторите позже.'
                  : 'Проверка iPhone ещё идёт. Повторите чуть позже.',
              WalkingRewardsNative.isAndroid
                  ? 'Тексеру жүріп жатыр. Кейін қайталаңыз.'
                  : 'iPhone тексеріліп жатыр. Сәл кейін қайталаңыз.',
            );
          }
        });
      }
    } on TimeoutException {
      if (isCurrent()) {
        setState(() {
          _failed = true;
          _failureMessage = _walkingText(
            'Проверка заняла слишком долго. Повторите чуть позже.',
            'Тексеру ұзаққа созылды. Сәл кейін қайталаңыз.',
          );
        });
      }
    } catch (_) {
      if (isCurrent()) setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _busy = _disconnecting);
    }
  }

  Future<void> _disconnect() async {
    if (_disconnecting || (_busy && !WalkingRewardsNative.isAndroid)) return;
    final session = widget.api.sessionCacheScope;
    setState(() {
      _disconnecting = true;
      _busy = true;
      _failed = false;
      _permission = false;
    });
    try {
      await widget.api.setWalkingConsent(false);
      if (mounted && session == widget.api.sessionCacheScope) {
        setState(() => _consent = false);
      }
    } catch (_) {
      if (mounted && session == widget.api.sessionCacheScope) {
        setState(() {
          _failed = true;
          _failureMessage = _walkingText(
            'Не удалось отключить шагомер. Повторите.',
            'Қадам санағышы өшірілмеді. Қайталаңыз.',
          );
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _disconnecting = false;
          _busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_supported) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: ValueListenableBuilder<WalkingProgress?>(
            valueListenable: widget.api.walkingProgress,
            builder: (context, progress, _) => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.directions_walk),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        _walkingText(
                          '10 000 шагов в день',
                          'Күніне 10 000 қадам',
                        ),
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  _walkingText('+1 000 бонусов', '+1 000 бонус'),
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                if (_consent) ...[
                  const SizedBox(height: 12),
                  LinearProgressIndicator(
                    value: ((progress?.steps ?? 0) / 10000).clamp(0.0, 1.0),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '${(progress?.steps ?? 0).toString().replaceAllMapped(RegExp(r"\B(?=(\d{3})+(?!\d))"), (_) => " ")} / 10 000',
                  ),
                  if (progress?.rewarded == true)
                    Row(
                      children: [
                        const Icon(
                          Icons.check_circle,
                          color: _successGreen,
                          size: 18,
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            _walkingText(
                              '1 000 бонусов начислено',
                              '1 000 бонус есептелді',
                            ),
                            style: const TextStyle(color: _successGreen),
                          ),
                        ),
                      ],
                    ),
                  if (progress?.deviceRewarded == true)
                    Text(
                      _walkingText(
                        'Награда на этом телефоне уже получена сегодня',
                        'Бұл телефонда бүгінгі сыйақы алынды',
                      ),
                    ),
                ],
                if (_failed)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      _permission
                          ? _walkingText(
                              WalkingRewardsNative.isAndroid
                                  ? 'Разрешите доступ к шагам в настройках телефона'
                                  : 'Разрешите «Движение и фитнес» в настройках iPhone',
                              WalkingRewardsNative.isAndroid
                                  ? 'Телефон баптауларында қадамдарға рұқсат беріңіз'
                                  : 'iPhone баптауларында «Қозғалыс және фитнес» рұқсатын беріңіз',
                            )
                          : _failureMessage ??
                                _walkingText(
                                  'Не удалось обновить шаги. Попробуйте ещё раз.',
                                  'Қадамдар жаңартылмады. Қайталап көріңіз.',
                                ),
                    ),
                  ),
                const SizedBox(height: 8),
                if (_busy)
                  const LinearProgressIndicator()
                else if (_requiresPlayServicesUpdate) ...[
                  Text(
                    _walkingText(
                      'Обновите сервисы Google Play для шагомера',
                      'Қадам санағышы үшін Google Play қызметтерін жаңартыңыз',
                    ),
                  ),
                  TextButton(
                    onPressed: WalkingRewardsNative.openSettings,
                    child: Text(
                      _walkingText(
                        'Обновить сервисы Google Play',
                        'Google Play қызметтерін жаңарту',
                      ),
                    ),
                  ),
                ] else if (!_consent)
                  FilledButton(
                    onPressed: _connect,
                    child: Text(
                      _walkingText(
                        'Подключить шагомер',
                        'Қадам санағышын қосу',
                      ),
                    ),
                  )
                else if (_permission)
                  Wrap(
                    spacing: 12,
                    children: [
                      TextButton(
                        onPressed: WalkingRewardsNative.openSettings,
                        child: Text(
                          _walkingText('Открыть настройки', 'Баптауларды ашу'),
                        ),
                      ),
                      if (WalkingRewardsNative.isAndroid)
                        FilledButton(
                          onPressed: _connect,
                          child: Text(
                            _walkingText(
                              'Подключить шагомер',
                              'Қадам санағышын қосу',
                            ),
                          ),
                        ),
                    ],
                  )
                else
                  Wrap(
                    alignment: WrapAlignment.spaceBetween,
                    spacing: 12,
                    children: [
                      TextButton(
                        onPressed: _sync,
                        child: Text(_walkingText('Обновить', 'Жаңарту')),
                      ),
                      if (!WalkingRewardsNative.isAndroid)
                        TextButton(
                          onPressed: _disconnect,
                          child: Text(_walkingText('Отключить', 'Өшіру')),
                        ),
                    ],
                  ),
                if (WalkingRewardsNative.isAndroid && _consent)
                  TextButton(
                    onPressed: _disconnecting ? null : _disconnect,
                    child: Text(_walkingText('Отключить', 'Өшіру')),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
