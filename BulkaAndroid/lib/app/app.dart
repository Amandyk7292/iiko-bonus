part of '../main.dart';

class BulkaBonusApp extends StatefulWidget {
  const BulkaBonusApp({super.key});

  @override
  State<BulkaBonusApp> createState() => _BulkaBonusAppState();
}

class _BulkaBonusAppState extends State<BulkaBonusApp> {
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
    final prefs = await SharedPreferences.getInstance();
    final phone = prefs.getString('phone');
    final accessToken = prefs.getString('accessToken');
    final cachedCustomer = _readCustomer(prefs.getString('customer'));
    final cachedTransactions = _readTransactions(
      prefs.getString('transactions'),
    );

    final minSplashDelay = Future.delayed(const Duration(milliseconds: 2200));

    if (!mounted) return;
    await minSplashDelay;
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
      await _saveSession(
        phone,
        profile.customer!,
        profile.transactions,
        _accessToken!,
      );
      setState(() {
        _customer = profile.customer;
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

  Future<String?> _requestOtp(String phone, String token) async {
    try {
      await _api.requestOtp(phone: phone, token: token);
      return null;
    } catch (error) {
      return _userError(error, 'Ошибка при отправке кода');
    }
  }

  Future<String?> _verifyOtp(String phone, String code) async {
    try {
      final profile = await _api.verifyOtp(phone: phone, code: code);
      if (!profile.exists || profile.customer == null) {
        _registrationToken = profile.registrationToken;
        if (_registrationToken == null) return 'Сервер не выдал регистрацию';
        return 'NEW_USER';
      }
      final token = profile.accessToken;
      if (token == null) return 'Сервер не выдал сессию';
      _accessToken = token;
      _api.setAccessToken(token);
      await _saveSession(phone, profile.customer!, profile.transactions, token);
      if (!mounted) return null;
      setState(() {
        _savedPhone = phone;
        _customer = profile.customer;
        _transactions = profile.transactions;
      });
      _startProfileRefresh(phone);
      return null;
    } catch (error) {
      return _userError(error, 'Неверный код');
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
        return 'Ошибка при регистрации';
      }
      final token = profile.accessToken;
      if (token == null) return 'Сервер не выдал сессию';
      _accessToken = token;
      _registrationToken = null;
      _api.setAccessToken(token);
      await _saveSession(phone, profile.customer!, profile.transactions, token);
      if (!mounted) return null;
      setState(() {
        _savedPhone = phone;
        _customer = profile.customer;
        _transactions = profile.transactions;
      });
      _startProfileRefresh(phone);
      return null;
    } catch (error) {
      return _userError(error, 'Ошибка при регистрации');
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
          title: 'Bulka пекарня',
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

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat(reverse: true);

    _scaleAnimation = Tween<double>(
      begin: 0.92,
      end: 1.08,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFFB300),
      body: Center(
        child: ScaleTransition(
          scale: _scaleAnimation,
          child: Image.asset(
            'assets/brand/bulka_logo.png',
            width: 330,
            fit: BoxFit.contain,
          ),
        ),
      ),
    );
  }
}
