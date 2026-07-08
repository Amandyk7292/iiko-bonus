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
    final cachedCustomer = _readCustomer(prefs.getString('customer'));
    final cachedTransactions = _readTransactions(
      prefs.getString('transactions'),
    );

    if (!mounted) return;
    setState(() {
      _prefs = prefs;
      _savedPhone = phone;
      _customer = cachedCustomer;
      _transactions = cachedTransactions;
      _booting = false;
    });

    if (phone != null) {
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
      await _saveSession(phone, profile.customer!, profile.transactions);
      setState(() {
        _customer = profile.customer;
        _transactions = profile.transactions;
      });
    } catch (_) {
      // Keep cached profile when network is unavailable.
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
        return 'Профиль не найден';
      }
      await _saveSession(phone, profile.customer!, profile.transactions);
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

  Future<void> _saveSession(
    String phone,
    Customer customer,
    List<BonusTransaction> transactions,
  ) async {
    final prefs = _prefs ?? await SharedPreferences.getInstance();
    await prefs.setString('phone', phone);
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
    if (!mounted) return;
    setState(() {
      _savedPhone = null;
      _customer = null;
      _transactions = const [];
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Bulka Bonus',
      theme: buildBulkaTheme(),
      home: _buildHome(),
    );
  }

  Widget _buildHome() {
    if (_booting) {
      return const SplashScreen(text: 'Загрузка...');
    }
    if (_savedPhone == null) {
      return LoginScreen(onRequestOtp: _requestOtp, onVerifyOtp: _verifyOtp);
    }
    final customer = _customer;
    if (customer == null) {
      return const SplashScreen(text: 'Загрузка профиля...');
    }
    return MainShell(
      api: _api,
      customer: customer,
      transactions: _transactions,
      onLogout: _logout,
    );
  }
}

class SplashScreen extends StatelessWidget {
  const SplashScreen({required this.text, super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(color: _bulkaYellow),
            const SizedBox(height: 16),
            Text(text, style: const TextStyle(color: _textDark)),
          ],
        ),
      ),
    );
  }
}
