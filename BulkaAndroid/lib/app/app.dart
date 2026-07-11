part of '../main.dart';

class BulkaBonusApp extends StatefulWidget {
  const BulkaBonusApp({super.key});

  @override
  State<BulkaBonusApp> createState() => _BulkaBonusAppState();
}

class _BulkaBonusAppState extends State<BulkaBonusApp> {
  static const _minimumSplashDuration = Duration(milliseconds: 2200);

  final _api = BulkaApiClient();
  SharedPreferences? _prefs;
  Timer? _refreshTimer;
  bool _booting = true;
  String? _savedPhone;
  String? _accessToken;
  String? _registrationToken;
  Customer? _customer;
  List<BonusTransaction> _transactions = const [];

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    // Keep the branded Flutter splash on screen long enough to be perceived.
    // Without this guard a warm start can resolve SharedPreferences in a single
    // frame and jump straight to LoginScreen, which looks as if splash vanished.
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
      await _refreshProfile(phone);
      _startProfileRefresh(phone);
    }
  }

  Future<void> _refreshProfile(String phone) async {
    try {
      final profile = await _api.getProfile(phone);
      if (!mounted) return;
      if (!profile.exists || profile.customer == null) {
        await _logout();
        return;
      }
      final customer = await _withLatestLoyalty(profile.customer!);
      await _saveSession(phone, customer, profile.transactions, _accessToken!);
      setState(() {
        _customer = customer;
        _transactions = profile.transactions;
      });
    } catch (error) {
      if (error is ApiException && error.statusCode == 401) await _logout();
    }
  }

  void _startProfileRefresh(String phone) {
    _refreshTimer?.cancel();
    _refreshTimer = Timer.periodic(
      const Duration(seconds: 5),
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

  Future<void> _saveSession(
    String phone,
    Customer customer,
    List<BonusTransaction> transactions,
    String accessToken,
  ) async {
    final prefs = _prefs ?? await SharedPreferences.getInstance();
    await prefs.setString('phone', phone);
    await prefs.setString('accessToken', accessToken);
    await prefs.setString('customer', jsonEncode(customer.toJson()));
    await prefs.setString(
      'transactions',
      jsonEncode(transactions.map((tx) => tx.toJson()).toList()),
    );
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
          home: _buildHome(),
        );
      },
    );
  }

  Widget _buildHome() {
    if (_booting) {
      return SplashScreen(text: 'splash_loading'.tr);
    }
    if (_savedPhone == null) {
      return LoginScreen(
        onRequestOtp: _requestOtp,
        onVerifyOtp: _verifyOtp,
        onRegister: _registerCustomer,
      );
    }
    final customer = _customer;
    if (customer == null) {
      return SplashScreen(text: 'splash_loading_profile'.tr);
    }
    return MainShell(
      api: _api,
      customer: customer,
      transactions: _transactions,
      onLogout: _logout,
      onRefreshProfile: () => _refreshProfile(_savedPhone!),
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
      duration: const Duration(milliseconds: 1500),
    );

    _scaleAnimation = Tween<double>(
      begin: 0.92,
      end: 1.08,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));
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
    );
    return Scaffold(
      backgroundColor: const Color(0xFFFFB300),
      body: Semantics(
        image: true,
        label: widget.text,
        child: Center(
          child: _reduceMotion
              ? logo
              : ScaleTransition(scale: _scaleAnimation, child: logo),
        ),
      ),
    );
  }
}
