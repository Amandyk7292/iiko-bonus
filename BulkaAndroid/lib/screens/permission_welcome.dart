part of '../main.dart';

/// Explains access before showing either operating-system permission prompt.
class BulkaPermissionGate extends StatefulWidget {
  const BulkaPermissionGate({
    required this.child,
    this.requestNotifications,
    this.requestLocation,
    super.key,
  });
  final Widget child;
  final Future<bool> Function()? requestNotifications;
  final Future<bool> Function()? requestLocation;
  static const completedKey = 'bulka_permissions_welcome_v1';
  @override
  State<BulkaPermissionGate> createState() => _BulkaPermissionGateState();
}

class _BulkaPermissionGateState extends State<BulkaPermissionGate> {
  bool? _completed;
  bool _busy = false, _saving = false;
  bool? _notifications, _location;
  String? _error;
  String _copy(String ru, String kk, String en) => switch (AppLang.current) {
    'kk' => kk,
    'en' => en,
    _ => ru,
  };

  @override
  void initState() {
    super.initState();
    unawaited(_restore());
  }

  Future<void> _restore() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (mounted) {
        setState(
          () => _completed =
              prefs.getBool(BulkaPermissionGate.completedKey) ?? false,
        );
      }
    } catch (_) {
      if (mounted) setState(() => _completed = false);
    }
  }

  Future<bool> _requestNotifications() async {
    await PushNotifications.initialize();
    final settings = await FirebaseMessaging.instance.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    await (await SharedPreferences.getInstance()).setBool(
      PushNotifications._permissionPromptedKey,
      true,
    );
    return settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional;
  }

  Future<bool> _requestLocation() async {
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    return permission == LocationPermission.whileInUse ||
        permission == LocationPermission.always;
  }

  Future<void> _request(bool notifications) async {
    if (_busy || _saving) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final granted = await (notifications
          ? widget.requestNotifications ?? _requestNotifications
          : widget.requestLocation ?? _requestLocation)();
      if (mounted) {
        setState(() {
          if (notifications) {
            _notifications = granted;
          } else {
            _location = granted;
          }
        });
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = _copy(
            'Не удалось открыть запрос. Можно настроить доступ позже.',
            'Сұрауды ашу мүмкін болмады. Рұқсатты кейін баптауға болады.',
            'Could not open the request. You can set up access later.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _finish() async {
    if (_busy || _saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final prefs = await SharedPreferences.getInstance();
      if (!await prefs.setBool(BulkaPermissionGate.completedKey, true)) {
        throw StateError('Preference not saved');
      }
      if (mounted) setState(() => _completed = true);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = _copy(
            'Не удалось сохранить. Попробуйте ещё раз.',
            'Сақтау мүмкін болмады. Қайталап көріңіз.',
            'Could not save. Please try again.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _card({
    required IconData icon,
    required String title,
    required String description,
    required bool notifications,
    required bool? granted,
  }) {
    return Builder(
      builder: (context) => AnimatedSwitcher(
        duration: BulkaMotion.duration(
          context,
          const Duration(milliseconds: 300),
        ),
        switchInCurve: Curves.easeOutCubic,
        switchOutCurve: Curves.easeInOutCubic,
        layoutBuilder: (current, previous) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [...previous, ?current],
        ),
        transitionBuilder: (child, animation) => AnimatedBuilder(
          animation: animation,
          child: child,
          builder: (context, child) => animation.value == 1
              ? child!
              : SizeTransition(
                  sizeFactor: animation,
                  axisAlignment: -1,
                  child: FadeTransition(opacity: animation, child: child),
                ),
        ),
        child: granted == true
            ? const SizedBox.shrink(key: ValueKey('granted'))
            : Container(
                key: ValueKey(
                  notifications ? 'notifications-card' : 'location-card',
                ),
                margin: const EdgeInsets.only(bottom: 16),
                padding: const EdgeInsets.all(22),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(28),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x12532B16),
                      blurRadius: 24,
                      offset: Offset(0, 8),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFF1CC),
                          borderRadius: BorderRadius.circular(18),
                        ),
                        child: Icon(icon, color: _textDark, size: 28),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w600,
                        color: _textDark,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      description,
                      style: const TextStyle(fontSize: 16, height: 1.5),
                    ),
                    const SizedBox(height: 18),
                    if (granted == false) ...[
                      Text(
                        _copy(
                          'Можно включить позже в настройках телефона.',
                          'Кейін телефон баптауларында қосуға болады.',
                          'You can enable this later in your phone settings.',
                        ),
                        textAlign: TextAlign.center,
                      ),
                      TextButton(
                        onPressed: _busy || _saving
                            ? null
                            : () async {
                                await Geolocator.openAppSettings();
                              },
                        child: Text(
                          _copy(
                            'Открыть настройки',
                            'Баптауларды ашу',
                            'Open settings',
                          ),
                        ),
                      ),
                    ] else
                      FilledButton(
                        key: ValueKey(
                          notifications
                              ? 'permission-notifications'
                              : 'permission-location',
                        ),
                        onPressed: _busy || _saving
                            ? null
                            : () => _request(notifications),
                        style: FilledButton.styleFrom(
                          backgroundColor: const Color(0xFFFFB300),
                          foregroundColor: _textDark,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 18,
                            vertical: 16,
                          ),
                        ),
                        child: Text(
                          _copy('Разрешить', 'Рұқсат беру', 'Allow'),
                          textAlign: TextAlign.center,
                        ),
                      ),
                  ],
                ),
              ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_completed == true) return widget.child;
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: buildBulkaTheme(),
      locale: Locale(AppLang.current),
      supportedLocales: const [Locale('ru'), Locale('kk'), Locale('en')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      builder: _buildBulkaAppViewport,
      home: _completed == null
          ? SplashScreen(text: 'splash_loading'.tr)
          : Scaffold(
              backgroundColor: Colors.white,
              body: SafeArea(
                child: Align(
                  alignment: Alignment.topCenter,
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 520),
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(24, 30, 24, 24),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            _copy(
                              'Bulka рядом',
                              'Bulka әрдайым жақын',
                              'Bulka, close by',
                            ),
                            key: const ValueKey('permission-welcome-title'),
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              fontSize: 30,
                              fontWeight: FontWeight.w600,
                              color: _textDark,
                            ),
                          ),
                          const SizedBox(height: 10),
                          Text(
                            _copy(
                              'Настройте удобные возможности приложения',
                              'Қолданбаны өзіңізге ыңғайлы етіп баптаңыз',
                              'Make the app work for you',
                            ),
                            textAlign: TextAlign.center,
                            style: const TextStyle(fontSize: 16, height: 1.5),
                          ),
                          const SizedBox(height: 28),
                          _card(
                            icon: Icons.notifications_active_outlined,
                            title: _copy(
                              'Всё о вашем заказе',
                              'Тапсырысыңыз туралы',
                              'Order updates',
                            ),
                            description: _copy(
                              'Сообщим, когда заказ будет готов, и напомним о бонусах.',
                              'Тапсырыс дайын болғанда хабарлап, бонустар туралы еске саламыз.',
                              'Know when your order is ready and get reminders about your bonuses.',
                            ),
                            notifications: true,
                            granted: _notifications,
                          ),
                          _card(
                            icon: Icons.near_me_outlined,
                            title: _copy(
                              'Пекарни рядом',
                              'Жақын наубайханалар',
                              'Nearby bakeries',
                            ),
                            description: _copy(
                              'Найдём ближайшую пекарню и поможем указать адрес доставки. Только при использовании приложения.',
                              'Жақын наубайхананы тауып, жеткізу мекенжайын таңдауға көмектесеміз. Тек қолданбаны пайдаланғанда.',
                              'Find a nearby bakery and choose your delivery address. Only while using the app.',
                            ),
                            notifications: false,
                            granted: _location,
                          ),
                          if (_busy || _saving) const LinearProgressIndicator(),
                          if (_error != null)
                            Padding(
                              padding: const EdgeInsets.all(12),
                              child: Text(_error!, textAlign: TextAlign.center),
                            ),
                          const SizedBox(height: 8),
                          OutlinedButton(
                            key: const ValueKey('permissions-continue'),
                            onPressed: _busy || _saving ? null : _finish,
                            style: OutlinedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(
                                vertical: 18,
                                horizontal: 20,
                              ),
                            ),
                            child: Text(
                              _copy(
                                'Перейти в Bulka',
                                'Bulka-ға өту',
                                'Continue to Bulka',
                              ),
                              textAlign: TextAlign.center,
                            ),
                          ),
                          const SizedBox(height: 12),
                          Text(
                            _copy(
                              'Можно продолжить и оформить заказ без разрешений.',
                              'Рұқсаттарды өткізіп жіберуге болады. Қолданба оларсыз да жұмыс істейді.',
                              'Permissions are optional. You can order without them.',
                            ),
                            textAlign: TextAlign.center,
                            style: const TextStyle(fontSize: 13, height: 1.5),
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
