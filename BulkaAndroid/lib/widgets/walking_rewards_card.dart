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
  Timer? _pollTimer;
  bool _loading = false;
  bool _visible = false;
  bool _foreground = true;
  bool _inViewport = true;
  ScrollPosition? _scrollPosition;
  bool _viewportCheckScheduled = false;
  String? _sessionScope;
  int _revision = 0;

  bool get _canRefresh =>
      mounted &&
      _visible &&
      _foreground &&
      _inViewport &&
      widget.api.isAuthenticated;

  @override
  void initState() {
    super.initState();
    _sessionScope = widget.api.sessionCacheScope;
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    _foreground = lifecycle == null || lifecycle == AppLifecycleState.resumed;
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final position = Scrollable.maybeOf(context)?.position;
    if (!identical(position, _scrollPosition)) {
      _scrollPosition?.removeListener(_scheduleViewportCheck);
      _scrollPosition = position;
      _scrollPosition?.addListener(_scheduleViewportCheck);
    }
    _scheduleViewportCheck();
    final visible =
        TickerMode.of(context) && (ModalRoute.isCurrentOf(context) ?? true);
    if (visible == _visible) return;
    _visible = visible;
    _updatePolling();
    if (_canRefresh) unawaited(_load());
  }

  @override
  void didUpdateWidget(covariant WalkingRewardsCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.api, widget.api) ||
        _sessionScope != widget.api.sessionCacheScope) {
      _sessionScope = widget.api.sessionCacheScope;
      _revision++;
      _supported = false;
      _consent = false;
      _failed = false;
      _busy = false;
      _disconnecting = false;
      _updatePolling();
      if (_canRefresh) unawaited(_load());
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _updatePolling();
    if (_canRefresh) unawaited(_load());
  }

  void _updatePolling() {
    if (!_canRefresh ||
        !_supported ||
        !_consent ||
        _disconnecting ||
        _busy ||
        _loading) {
      _pollTimer?.cancel();
      _pollTimer = null;
      return;
    }
    final remaining = widget.api.walkingRefreshDelay;
    _pollTimer ??= Timer(
      remaining > Duration.zero ? remaining : const Duration(minutes: 1),
      () {
        _pollTimer = null;
        if (_canRefresh) unawaited(_load());
      },
    );
  }

  void _scheduleViewportCheck() {
    if (_viewportCheckScheduled) return;
    _viewportCheckScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _viewportCheckScheduled = false;
      if (!mounted) return;
      final box = context.findRenderObject();
      if (box is! RenderBox ||
          !box.attached ||
          !box.hasSize ||
          box.size.isEmpty) {
        return;
      }
      final visible = (box.localToGlobal(Offset.zero) & box.size).overlaps(
        Offset.zero & MediaQuery.sizeOf(context),
      );
      if (visible == _inViewport) return;
      _inViewport = visible;
      _updatePolling();
      if (_canRefresh) unawaited(_load());
    });
  }

  @override
  void dispose() {
    _revision++;
    _pollTimer?.cancel();
    _scrollPosition?.removeListener(_scheduleViewportCheck);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _load() async {
    if (_busy || _loading || !_canRefresh) return;
    _loading = true;
    final revision = _revision;
    final api = widget.api;
    final session = widget.api.sessionCacheScope;
    bool isCurrent() =>
        _canRefresh &&
        revision == _revision &&
        identical(api, widget.api) &&
        session == api.sessionCacheScope;
    try {
      final capabilities = await WalkingRewardsNative.capabilities();
      final consent = await api.walkingConsent();
      if (!isCurrent() || _busy) return;
      setState(() {
        _supported = capabilities['supported'] == true;
        _consent = consent;
        _requiresPlayServicesUpdate =
            capabilities['requiresPlayServicesUpdate'] == true;
        _permission =
            consent &&
            capabilities['authorized'] != true &&
            !_requiresPlayServicesUpdate;
        if (_permission) _failed = true;
      });
      _updatePolling();
      if (_supported &&
          consent &&
          !_requiresPlayServicesUpdate &&
          capabilities['authorized'] == true) {
        await _sync();
      }
    } catch (_) {
      if (isCurrent()) setState(() => _failed = true);
    } finally {
      _loading = false;
      if (mounted) {
        _updatePolling();
        _scheduleViewportCheck();
        if (revision != _revision && _canRefresh) unawaited(_load());
      }
    }
  }

  Future<void> _connect() async {
    if (_busy || !_canRefresh) return;
    final revision = _revision;
    final api = widget.api;
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
        revision != _revision ||
        !identical(api, widget.api) ||
        session != widget.api.sessionCacheScope) {
      return;
    }
    try {
      await api.setWalkingConsent(true);
      if (!mounted ||
          revision != _revision ||
          !identical(api, widget.api) ||
          session != widget.api.sessionCacheScope) {
        return;
      }
      setState(() => _consent = true);
      _updatePolling();
      await _sync(requestPermission: true, connecting: true);
    } catch (_) {
      if (mounted && revision == _revision && identical(api, widget.api)) {
        setState(() => _failed = true);
      }
    }
  }

  Future<void> _sync({
    bool requestPermission = false,
    bool connecting = false,
  }) async {
    // The confirmed consent sheet may still cover the route as it closes.
    final canConnect =
        connecting &&
        mounted &&
        _foreground &&
        _inViewport &&
        widget.api.isAuthenticated;
    if (_busy || (!_canRefresh && !canConnect) || !_consent || _disconnecting) {
      return;
    }
    final revision = _revision;
    final api = widget.api;
    final session = widget.api.sessionCacheScope;
    final previous = api.walkingProgress.value;
    bool isCurrent() =>
        mounted &&
        revision == _revision &&
        identical(api, widget.api) &&
        session == widget.api.sessionCacheScope &&
        _consent &&
        !_disconnecting;
    setState(() {
      _busy = true;
      _failed = false;
      _permission = false;
      _failureMessage = null;
    });
    _updatePolling();
    try {
      await api.syncWalking(requestPermission: requestPermission);
      // A throttled call shares the last outcome. Reopening the card must not
      // clear a failure before a real native/server sync has succeeded.
      final failure = api.walkingSyncFailure;
      if (failure != null) throw failure;
      // A balance refresh cannot turn an accepted step measurement into a
      // failed sync. Keep the confirmed progress if this separate read fails.
      final progress = api.walkingProgress.value;
      if (isCurrent() &&
          progress?.rewarded == true &&
          (previous?.date != progress?.date || previous?.rewarded != true)) {
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
                  ? 'Проверка ещё идёт. Шаги обновятся автоматически.'
                  : 'Проверка iPhone ещё идёт. Шаги обновятся автоматически.',
              WalkingRewardsNative.isAndroid
                  ? 'Тексеру жүріп жатыр. Қадамдар автоматты жаңартылады.'
                  : 'iPhone тексеріліп жатыр. Қадамдар автоматты жаңартылады.',
            );
          }
        });
      }
    } on TimeoutException {
      if (isCurrent()) {
        setState(() {
          _failed = true;
          _failureMessage = _walkingText(
            'Проверка заняла больше времени. Шаги обновятся автоматически.',
            'Тексеру ұзаққа созылды. Қадамдар автоматты жаңартылады.',
          );
        });
      }
    } catch (_) {
      if (isCurrent()) setState(() => _failed = true);
    } finally {
      if (mounted && revision == _revision) {
        setState(() => _busy = _disconnecting);
        _updatePolling();
      }
    }
  }

  Future<void> _disconnect() async {
    if (_disconnecting || (_busy && !WalkingRewardsNative.isAndroid)) return;
    final revision = _revision;
    final session = widget.api.sessionCacheScope;
    setState(() {
      _disconnecting = true;
      _busy = true;
      _failed = false;
      _permission = false;
    });
    _updatePolling();
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
        _updatePolling();
      }
    } finally {
      if (mounted && revision == _revision) {
        setState(() {
          _disconnecting = false;
          _busy = false;
        });
        _updatePolling();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_supported || !widget.api.isAuthenticated) {
      return const SizedBox.shrink();
    }
    final colors = context.bulkaColors;
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: DecoratedBox(
        key: const ValueKey('walking-rewards-card'),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              colors.surfaceCream,
              Color.lerp(colors.surfaceCream, colors.brandGold, 0.07)!,
            ],
          ),
          borderRadius: BorderRadius.circular(BulkaRadii.card),
          border: Border.all(
            color: colors.cardBorder,
            width: BulkaStrokes.hairline,
          ),
          boxShadow: BulkaShadows.card,
        ),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: ValueListenableBuilder<WalkingProgress?>(
            valueListenable: widget.api.walkingProgress,
            builder: (context, progress, _) => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Wrap(
                  alignment: WrapAlignment.spaceBetween,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 12,
                  runSpacing: 8,
                  children: [
                    Text(
                      _walkingText('Сегодня', 'Бүгін'),
                      style: TextStyle(
                        color: colors.mutedText,
                        fontFamily: _headingFont,
                        fontSize: BulkaTypeScale.bodySmall,
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        color: colors.brandGold.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(BulkaRadii.pill),
                      ),
                      child: Text.rich(
                        TextSpan(
                          text:
                              '+${_walkingNumber(progress?.rewardAmount ?? 100)} ',
                          style: const TextStyle(fontFamily: _headingFont),
                          children: [
                            TextSpan(
                              text: _walkingText('бонусов', 'бонус'),
                              style: const TextStyle(
                                fontFamily: _descriptionFont,
                              ),
                            ),
                          ],
                        ),
                        style: TextStyle(
                          color: colors.brandBrown,
                          fontSize: BulkaTypeScale.bodySmall,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                LayoutBuilder(
                  builder: (context, constraints) {
                    final scale = MediaQuery.textScalerOf(context).scale(1);
                    final stacked = constraints.maxWidth < 290 || scale > 1.3;
                    final diameter = stacked
                        ? min(constraints.maxWidth, 168.0 * max(1, scale))
                        : 148.0;
                    final ring = _WalkingProgressRing(
                      progress: _consent ? progress : null,
                      diameter: diameter,
                    );
                    final description = Column(
                      crossAxisAlignment: stacked
                          ? CrossAxisAlignment.center
                          : CrossAxisAlignment.start,
                      children: [
                        Text(
                          _walkingText(
                            'Шаги за бонусы',
                            'Қадамдар үшін бонустар',
                          ),
                          textAlign: stacked
                              ? TextAlign.center
                              : TextAlign.start,
                          style: TextStyle(
                            color: colors.brandBrown,
                            fontFamily: _headingFont,
                            fontSize: BulkaTypeScale.title,
                            height: 1.15,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          _walkingText(
                            '10 000 шагов в день',
                            'Күніне 10 000 қадам',
                          ),
                          textAlign: stacked
                              ? TextAlign.center
                              : TextAlign.start,
                          style: TextStyle(
                            color: colors.mutedText,
                            fontSize: BulkaTypeScale.bodySmall,
                            height: 1.4,
                          ),
                        ),
                      ],
                    );
                    if (stacked) {
                      return Column(
                        children: [
                          ring,
                          const SizedBox(height: 16),
                          description,
                        ],
                      );
                    }
                    return Row(
                      children: [
                        ring,
                        const SizedBox(width: 20),
                        Expanded(child: description),
                      ],
                    );
                  },
                ),
                if (_consent &&
                    (progress?.rewarded == true ||
                        progress?.deviceRewarded == true)) ...[
                  const SizedBox(height: 16),
                  Semantics(
                    liveRegion: true,
                    child: Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: colors.success.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(BulkaRadii.control),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(
                            Icons.check_circle,
                            color: colors.success,
                            size: 20,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              progress?.rewarded == true
                                  ? _walkingText(
                                      '${_walkingNumber(progress!.creditedAmount)} бонусов начислено',
                                      '${_walkingNumber(progress.creditedAmount)} бонус есептелді',
                                    )
                                  : _walkingText(
                                      'Награда на этом телефоне уже получена сегодня',
                                      'Бұл телефонда бүгінгі сыйақы алынды',
                                    ),
                              style: TextStyle(
                                color: colors.success,
                                fontSize: BulkaTypeScale.bodySmall,
                                height: 1.35,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
                if (_failed) ...[
                  const SizedBox(height: 12),
                  Semantics(
                    liveRegion: true,
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
                                  'Не удалось обновить шаги. Обновим автоматически.',
                                  'Қадамдар жаңартылмады. Автоматты жаңартылады.',
                                ),
                      style: TextStyle(
                        color: colors.mutedText,
                        fontSize: BulkaTypeScale.bodySmall,
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                if (_requiresPlayServicesUpdate) ...[
                  Text(
                    _walkingText(
                      'Обновите сервисы Google Play для шагомера',
                      'Қадам санағышы үшін Google Play қызметтерін жаңартыңыз',
                    ),
                    style: TextStyle(
                      color: colors.mutedText,
                      fontSize: BulkaTypeScale.bodySmall,
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
                    onPressed: _busy ? null : _connect,
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
                    runSpacing: 8,
                    children: [
                      TextButton(
                        onPressed: WalkingRewardsNative.openSettings,
                        child: Text(
                          _walkingText('Открыть настройки', 'Баптауларды ашу'),
                        ),
                      ),
                      if (WalkingRewardsNative.isAndroid)
                        FilledButton(
                          onPressed: _busy ? null : _connect,
                          child: Text(
                            _walkingText(
                              'Подключить шагомер',
                              'Қадам санағышын қосу',
                            ),
                          ),
                        ),
                    ],
                  ),
                if (_consent)
                  LayoutBuilder(
                    builder: (context, constraints) {
                      final caption = Text(
                        _busy
                            ? _walkingText(
                                'Обновляем шаги…',
                                'Қадамдар жаңартылуда…',
                              )
                            : _walkingText(
                                'Шаги обновляются автоматически',
                                'Қадамдар автоматты жаңартылады',
                              ),
                        style: TextStyle(
                          color: colors.mutedText,
                          fontSize: BulkaTypeScale.caption,
                          height: 1.4,
                        ),
                      );
                      final disconnect = TextButton(
                        onPressed:
                            _disconnecting ||
                                (_busy && !WalkingRewardsNative.isAndroid)
                            ? null
                            : _disconnect,
                        child: Text(_walkingText('Отключить', 'Өшіру')),
                      );
                      if (MediaQuery.textScalerOf(context).scale(1) > 1.3) {
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            caption,
                            Align(
                              alignment: Alignment.centerRight,
                              child: disconnect,
                            ),
                          ],
                        );
                      }
                      return Row(
                        children: [
                          Expanded(child: caption),
                          const SizedBox(width: 8),
                          disconnect,
                        ],
                      );
                    },
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

String _walkingNumber(int steps) => steps.toString().replaceAllMapped(
  RegExp(r'\B(?=(\d{3})+(?!\d))'),
  (_) => ' ',
);

class _WalkingProgressRing extends StatelessWidget {
  const _WalkingProgressRing({required this.progress, required this.diameter});
  final WalkingProgress? progress;
  final double diameter;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final steps = progress?.steps;
    return Semantics(
      label: _walkingText('Шаги сегодня', 'Бүгінгі қадамдар'),
      value: steps == null
          ? _walkingText('Пока нет данных', 'Деректер әлі жоқ')
          : '${_walkingNumber(steps)} / 10 000',
      excludeSemantics: true,
      child: TweenAnimationBuilder<double>(
        key: ValueKey(('walking-progress-animation', progress?.date)),
        tween: Tween(
          begin: (steps ?? 0).toDouble(),
          end: (steps ?? 0).toDouble(),
        ),
        duration: BulkaMotion.duration(context, BulkaMotion.standard),
        curve: BulkaMotion.standardCurve,
        builder: (context, displayed, _) => SizedBox.square(
          dimension: diameter,
          child: CustomPaint(
            key: const ValueKey('walking-progress-ring'),
            painter: _WalkingRingPainter(
              progress: (displayed / 10000).clamp(0.0, 1.0),
              track: colors.brandGold.withValues(alpha: 0.13),
              start: colors.brandGold,
              end: colors.priceGold,
            ),
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.directions_walk,
                      size: 24,
                      color: colors.brandBrown,
                    ),
                    const SizedBox(height: 6),
                    Text(
                      steps == null ? '—' : _walkingNumber(displayed.round()),
                      key: const ValueKey('walking-step-count'),
                      style: TextStyle(
                        color: colors.brandBrown,
                        fontFamily: _headingFont,
                        fontSize: BulkaTypeScale.titleLarge,
                        height: 1.1,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '/ 10 000',
                      style: TextStyle(
                        color: colors.mutedText,
                        fontSize: BulkaTypeScale.caption,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _WalkingRingPainter extends CustomPainter {
  const _WalkingRingPainter({
    required this.progress,
    required this.track,
    required this.start,
    required this.end,
  });
  final double progress;
  final Color track;
  final Color start;
  final Color end;

  @override
  void paint(Canvas canvas, Size size) {
    final bounds = (Offset.zero & size).deflate(5);
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 8
      ..strokeCap = StrokeCap.round;
    canvas.drawOval(bounds, paint..color = track);
    if (progress > 0) {
      paint.color = Colors.white;
      paint.shader = SweepGradient(
        colors: [start, end],
        transform: const GradientRotation(-pi / 2),
      ).createShader(bounds);
      canvas.drawArc(bounds, -pi / 2, 2 * pi * progress, false, paint);
    }
  }

  @override
  bool shouldRepaint(_WalkingRingPainter oldDelegate) =>
      progress != oldDelegate.progress ||
      track != oldDelegate.track ||
      start != oldDelegate.start ||
      end != oldDelegate.end;
}
