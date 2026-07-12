part of '../main.dart';

class BulkaBonusApp extends StatefulWidget {
  const BulkaBonusApp({super.key});

  @override
  State<BulkaBonusApp> createState() => _BulkaBonusAppState();
}

class _BulkaBonusAppState extends State<BulkaBonusApp>
    with WidgetsBindingObserver {
  static const _minimumSplashDuration = Durations.extralong1;

  final _api = BulkaApiClient();
  SharedPreferences? _prefs;
  Timer? _refreshTimer;
  bool _profileRefreshInFlight = false;
  bool _booting = true;
  String? _savedPhone;
  String? _accessToken;
  String? _registrationToken;
  Customer? _customer;
  List<BonusTransaction> _transactions = const [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _bootstrap();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _refreshTimer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final phone = _savedPhone;
    if (state == AppLifecycleState.resumed && phone != null) {
      unawaited(_refreshProfile(phone));
      _startProfileRefresh(phone);
    } else if (state != AppLifecycleState.resumed) {
      _refreshTimer?.cancel();
    }
  }

  Future<void> _bootstrap() async {
    // Keep the brand transition stable on warm starts without introducing a
    // multi-second artificial wait that feels like startup lag.
    final minimumSplashDelay = Future<void>.delayed(_minimumSplashDuration);
    final prefs = await SharedPreferences.getInstance();
    final phone = prefs.getString('phone');
    final accessToken = prefs.getString('accessToken');
    final cachedCustomer = _readCustomer(prefs.getString('customer'));
    final cachedTransactions = _readTransactions(
      prefs.getString('transactions'),
    );

    await minimumSplashDelay;
    if (!mounted) return;
    setState(() {
      _prefs = prefs;
      _savedPhone = accessToken == null ? null : phone;
      _accessToken = accessToken;
      _customer = cachedCustomer;
      _transactions = cachedTransactions;
      _booting = false;
    });

    _api.setAccessToken(accessToken);
    if (phone != null && accessToken != null) {
      unawaited(PushNotifications.register(_api));
      await _refreshProfile(phone);
      _startProfileRefresh(phone);
    }
  }

  Future<void> _refreshProfile(String phone) async {
    if (_profileRefreshInFlight) return;
    _profileRefreshInFlight = true;
    try {
      final profile = await _api.getProfile(phone);
      if (!mounted) return;
      if (!profile.exists || profile.customer == null) {
        await _logout();
        return;
      }
      final customer = await _withLatestLoyalty(profile.customer!);
      final changed = await _saveSession(
        phone,
        customer,
        profile.transactions,
        _accessToken!,
      );
      if (!changed || !mounted) return;
      setState(() {
        _customer = customer;
        _transactions = profile.transactions;
      });
    } catch (error) {
      if (error is ApiException && error.statusCode == 401) await _logout();
    } finally {
      _profileRefreshInFlight = false;
    }
  }

  void _startProfileRefresh(String phone) {
    _refreshTimer?.cancel();
    _refreshTimer = Timer.periodic(
      const Duration(seconds: 30),
      (_) => _refreshProfile(phone),
    );
  }

  Future<OtpRequestResult> _requestOtp(String phone, String token) async {
    try {
      return await _api.requestOtp(phone: phone, token: token);
    } catch (error) {
      return OtpRequestResult(error: _userError(error, 'error_send_code'));
    }
  }

  Future<String?> _verifyOtp(String phone, String code) async {
    try {
      final profile = await _api.verifyOtp(phone: phone, code: code);
      if (!profile.exists || profile.customer == null) {
        _registrationToken = profile.registrationToken;
        if (_registrationToken == null) return 'error_registration_missing'.tr;
        return 'NEW_USER';
      }
      final token = profile.accessToken;
      if (token == null) return 'error_session_missing'.tr;
      _accessToken = token;
      _api.setAccessToken(token);
      unawaited(PushNotifications.register(_api));
      final customer = await _withLatestLoyalty(profile.customer!);
      await _saveSession(phone, customer, profile.transactions, token);
      if (!mounted) return null;
      setState(() {
        _savedPhone = phone;
        _customer = customer;
        _transactions = profile.transactions;
      });
      _startProfileRefresh(phone);
      return null;
    } catch (error) {
      return _userError(error, 'error_invalid_code');
    }
  }

  Future<String?> _registerCustomer({
    required String phone,
    required String name,
    String? surname,
    String? gender,
    String? birthdate,
    String? email,
  }) async {
    try {
      final profile = await _api.registerCustomer(
        phone: phone,
        name: name,
        surname: surname,
        gender: gender,
        birthdate: birthdate,
        email: email,
        registrationToken: _registrationToken ?? '',
      );
      if (!profile.exists || profile.customer == null) {
        return 'error_register'.tr;
      }
      final token = profile.accessToken;
      if (token == null) return 'error_session_missing'.tr;
      _accessToken = token;
      _registrationToken = null;
      _api.setAccessToken(token);
      unawaited(PushNotifications.register(_api));
      final customer = await _withLatestLoyalty(profile.customer!);
      await _saveSession(phone, customer, profile.transactions, token);
      if (!mounted) return null;
      setState(() {
        _savedPhone = phone;
        _customer = customer;
        _transactions = profile.transactions;
      });
      _startProfileRefresh(phone);
      return null;
    } catch (error) {
      return _userError(error, 'error_register');
    }
  }

  Future<bool> _saveSession(
    String phone,
    Customer customer,
    List<BonusTransaction> transactions,
    String accessToken,
  ) async {
    final prefs = _prefs ?? await SharedPreferences.getInstance();
    final customerJson = jsonEncode(customer.toJson());
    final transactionsJson = jsonEncode(
      transactions.map((tx) => tx.toJson()).toList(),
    );
    final profileChanged =
        prefs.getString('customer') != customerJson ||
        prefs.getString('transactions') != transactionsJson;

    if (prefs.getString('phone') != phone) {
      await prefs.setString('phone', phone);
    }
    if (prefs.getString('accessToken') != accessToken) {
      await prefs.setString('accessToken', accessToken);
    }
    if (prefs.getString('customer') != customerJson) {
      await prefs.setString('customer', customerJson);
    }
    if (prefs.getString('transactions') != transactionsJson) {
      await prefs.setString('transactions', transactionsJson);
    }
    return profileChanged;
  }

  Future<Customer> _withLatestLoyalty(Customer customer) async {
    if (customer.tier != null && customer.tier!.allTiers.isNotEmpty) {
      return customer;
    }
    try {
      final tier = await _api.getCustomerLoyalty();
      return tier == null ? customer : customer.copyWith(tier: tier);
    } catch (_) {
      return customer;
    }
  }

  Future<void> _logout() async {
    _refreshTimer?.cancel();
    await PushNotifications.unregister(_api);
    final prefs = _prefs ?? await SharedPreferences.getInstance();
    await prefs.remove('phone');
    await prefs.remove('customer');
    await prefs.remove('transactions');
    await prefs.remove('accessToken');
    _api.setAccessToken(null);
    if (!mounted) return;
    setState(() {
      _savedPhone = null;
      _accessToken = null;
      _registrationToken = null;
      _customer = null;
      _transactions = const [];
    });
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<String>(
      valueListenable: appLanguageNotifier,
      builder: (context, lang, child) {
        return MaterialApp(
          debugShowCheckedModeBanner: false,
          title: 'app_title'.tr,
          locale: Locale(lang),
          supportedLocales: const [Locale('ru'), Locale('kk'), Locale('en')],
          localizationsDelegates: const [
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          theme: buildBulkaTheme(),
          home: _AppStage(child: _buildHome()),
        );
      },
    );
  }

  Widget _buildHome() {
    if (_booting) {
      return SplashScreen(
        key: const ValueKey('app-stage-boot'),
        text: 'splash_loading'.tr,
      );
    }
    if (_savedPhone == null) {
      return LoginScreen(
        key: const ValueKey('app-stage-login'),
        onRequestOtp: _requestOtp,
        onVerifyOtp: _verifyOtp,
        onRegister: _registerCustomer,
      );
    }
    final customer = _customer;
    if (customer == null) {
      return SplashScreen(
        key: const ValueKey('app-stage-profile-loading'),
        text: 'splash_loading_profile'.tr,
      );
    }
    return MainShell(
      key: const ValueKey('app-stage-main'),
      api: _api,
      customer: customer,
      transactions: _transactions,
      onLogout: _logout,
      onRefreshProfile: () => _refreshProfile(_savedPhone!),
    );
  }
}

class _AppStage extends StatelessWidget {
  const _AppStage({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Colors.white,
      child: BulkaMotionSwitcher(
        duration: BulkaMotion.standard,
        offset: const Offset(0.025, 0),
        scale: 0.995,
        child: child,
      ),
    );
  }
}

class SplashScreen extends StatefulWidget {
  const SplashScreen({required this.text, super.key});

  final String text;

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;
  bool _reduceMotion = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    );

    _scaleAnimation = Tween<double>(begin: 0.985, end: 1.015).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOutSine),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduceMotion = BulkaMotion.reduced(context);
    if (reduceMotion == _reduceMotion && _controller.isAnimating) return;
    _reduceMotion = reduceMotion;
    if (_reduceMotion) {
      _controller.stop();
      _controller.value = 0.5;
    } else if (!_controller.isAnimating) {
      _controller.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final logo = Image.asset(
      'assets/brand/bulka_logo.png',
      width: 330,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.high,
    );
    return Scaffold(
      backgroundColor: const Color(0xFFFFB300),
      body: Semantics(
        image: true,
        label: widget.text,
        child: Center(
          child: _reduceMotion
              ? logo
              : RepaintBoundary(
                  child: ScaleTransition(scale: _scaleAnimation, child: logo),
                ),
        ),
      ),
    );
  }
}
