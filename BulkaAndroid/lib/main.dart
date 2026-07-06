import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:qr_flutter/qr_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

const _apiBaseUrl = String.fromEnvironment(
  'BULKA_API_BASE_URL',
  defaultValue: 'https://iiko-bonus.onrender.com',
);

const _bulkaYellow = Color(0xFFE8A11A);
const _bulkaBrown = Color(0xFF5A2E1E);
const _milkyBackground = Color(0xFFFFF7EA);
const _lightCard = Color(0xFFFFFFFF);
const _lightCardHighlight = Color(0xFFFFE8C2);
const _textDark = Color(0xFF2D1A12);
const _cocoa = Color(0xFF3B2117);
const _caramel = Color(0xFFC66A25);
const _cream = Color(0xFFFFFBF4);
const _almond = Color(0xFFF7D9A8);
const _sage = Color(0xFF6E7F57);
const _errorRed = Color(0xFFD14343);
const _successGreen = Color(0xFF2F8A55);

const _softShadow = [
  BoxShadow(color: Color(0x1F5A2E1E), blurRadius: 24, offset: Offset(0, 14)),
];

void main() {
  runApp(const BulkaBonusApp());
}

ThemeData buildBulkaTheme() {
  return ThemeData(
    useMaterial3: true,
    colorScheme: const ColorScheme.light(
      primary: _bulkaYellow,
      onPrimary: _textDark,
      secondary: _bulkaBrown,
      onSecondary: Colors.white,
      surface: _lightCard,
      onSurface: _textDark,
      surfaceContainerHighest: _lightCardHighlight,
      error: _errorRed,
    ),
    scaffoldBackgroundColor: _milkyBackground,
    fontFamily: 'Roboto',
    appBarTheme: const AppBarTheme(
      centerTitle: false,
      elevation: 0,
      backgroundColor: Colors.transparent,
      foregroundColor: _textDark,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: TextStyle(
        color: _textDark,
        fontSize: 22,
        fontWeight: FontWeight.w900,
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 56),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      ),
    ),
  );
}

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

class LoginScreen extends StatefulWidget {
  const LoginScreen({
    required this.onRequestOtp,
    required this.onVerifyOtp,
    super.key,
  });

  final Future<String?> Function(String phone, String token) onRequestOtp;
  final Future<String?> Function(String phone, String code) onVerifyOtp;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phoneController = TextEditingController();
  final _otpController = TextEditingController();
  bool _otpStep = false;
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _phoneController.dispose();
    _otpController.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    if (_phoneController.text.length != 10 || _loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    final phone = '7${_phoneController.text}';
    final token = (100000 + Random().nextInt(900000)).toString();
    final error = await widget.onRequestOtp(phone, token);
    if (!mounted) return;
    setState(() => _loading = false);
    if (error == null) {
      setState(() {
        _otpStep = true;
        _otpController.clear();
      });
      await _openExternalUrl(
        context,
        Uri.parse(
          'https://wa.me/77008317499?text=${Uri.encodeComponent('Код $token')}',
        ),
        'Не удалось открыть WhatsApp',
      );
    } else {
      setState(() => _error = error);
    }
  }

  Future<void> _verify() async {
    if (_otpController.text.length != 4 || _loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    final error = await widget.onVerifyOtp(
      '7${_phoneController.text}',
      _otpController.text,
    );
    if (!mounted) return;
    setState(() {
      _loading = false;
      _error = error;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [_milkyBackground, Color(0xFFFFE4B9), Color(0xFFFFF8EE)],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 24, 20, 32),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 460),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const _BrandHeader(),
                    const SizedBox(height: 28),
                    _AuthCard(
                      child: AnimatedSwitcher(
                        duration: const Duration(milliseconds: 240),
                        switchInCurve: Curves.easeOutCubic,
                        switchOutCurve: Curves.easeInCubic,
                        child: _otpStep
                            ? Column(
                                key: const ValueKey('otp'),
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: _otpCodeStep(context),
                              )
                            : Column(
                                key: const ValueKey('phone'),
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: _phoneStep(context),
                              ),
                      ),
                    ),
                    const SizedBox(height: 18),
                    Text(
                      'Свежие бонусы, персональные предложения и QR-карта всегда под рукой.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: _textDark.withValues(alpha: 0.62),
                        fontSize: 13,
                        height: 1.45,
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

  List<Widget> _phoneStep(BuildContext context) {
    return [
      const _AuthStepHeader(
        step: 'Шаг 1 из 2',
        title: 'Вход по номеру',
        subtitle: 'Укажите номер, привязанный к карте гостя Bulka.',
      ),
      const SizedBox(height: 22),
      TextField(
        controller: _phoneController,
        keyboardType: TextInputType.phone,
        maxLength: 10,
        textInputAction: TextInputAction.done,
        style: const TextStyle(
          color: _textDark,
          fontSize: 18,
          fontWeight: FontWeight.w800,
        ),
        onChanged: (value) {
          final digits = value.onlyDigits.take(10).join();
          if (digits != value) {
            _phoneController.value = TextEditingValue(
              text: digits,
              selection: TextSelection.collapsed(offset: digits.length),
            );
          }
          setState(() => _error = null);
        },
        decoration: _inputDecoration(
          label: 'Номер телефона',
          prefix: '+7 ',
          helper: '10 цифр без +7',
          error: _error,
          icon: Icons.phone_rounded,
        ),
      ),
      if (_error != null) ...[
        const SizedBox(height: 10),
        _InlineAlert(message: _error!, icon: Icons.info_rounded),
        if (_error!.toLowerCase().contains('telegram')) ...[
          const SizedBox(height: 14),
          _PrimaryButton(
            text: 'ОТКРЫТЬ TELEGRAM',
            icon: Icons.near_me_rounded,
            color: const Color(0xFF2CA5E0),
            textColor: Colors.white,
            onPressed: () => _openTelegram(context),
          ),
        ],
      ],
      const SizedBox(height: 26),
      _PrimaryButton(
        text: 'Получить код в WhatsApp',
        icon: Icons.sms_rounded,
        loading: _loading,
        onPressed: _phoneController.text.length == 10 ? _sendCode : null,
      ),
    ];
  }

  List<Widget> _otpCodeStep(BuildContext context) {
    final phone = '+7 ${_phoneController.text}';
    return [
      const _AuthStepHeader(
        step: 'Шаг 2 из 2',
        title: 'Введите код',
        subtitle:
            'Код отправлен через WhatsApp. Если удобнее, можно получить его в Telegram.',
      ),
      const SizedBox(height: 18),
      Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: _almond.withValues(alpha: 0.28),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: _almond.withValues(alpha: 0.6)),
        ),
        child: Row(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: const BoxDecoration(
                color: _cocoa,
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.lock_rounded,
                color: Colors.white,
                size: 20,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Код для $phone',
                    style: const TextStyle(
                      color: _textDark,
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Введите 4 цифры из сообщения',
                    style: TextStyle(
                      color: _textDark.withValues(alpha: 0.62),
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      const SizedBox(height: 22),
      TextField(
        controller: _otpController,
        keyboardType: TextInputType.number,
        maxLength: 4,
        textAlign: TextAlign.center,
        textInputAction: TextInputAction.done,
        style: const TextStyle(
          color: _textDark,
          fontSize: 30,
          fontWeight: FontWeight.w900,
          letterSpacing: 12,
        ),
        onChanged: (value) {
          final digits = value.onlyDigits.take(4).join();
          if (digits != value) {
            _otpController.value = TextEditingValue(
              text: digits,
              selection: TextSelection.collapsed(offset: digits.length),
            );
          }
          setState(() => _error = null);
        },
        decoration: _inputDecoration(
          label: 'Код подтверждения',
          helper: 'Действует несколько минут',
          error: _error,
          icon: Icons.password_rounded,
        ),
      ),
      if (_error != null) ...[
        const SizedBox(height: 10),
        _InlineAlert(message: _error!, icon: Icons.error_rounded),
      ],
      const SizedBox(height: 26),
      _PrimaryButton(
        text: 'Войти в Bulka Bonus',
        icon: Icons.arrow_forward_rounded,
        loading: _loading,
        onPressed: _otpController.text.length == 4 ? _verify : null,
      ),
      const SizedBox(height: 14),
      TextButton(
        onPressed: () {
          setState(() {
            _otpStep = false;
            _error = null;
          });
        },
        child: const Text(
          'Изменить номер',
          style: TextStyle(color: _bulkaBrown),
        ),
      ),
    ];
  }
}

class _BrandHeader extends StatelessWidget {
  const _BrandHeader();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          width: 76,
          height: 76,
          decoration: BoxDecoration(
            color: _cocoa,
            borderRadius: BorderRadius.circular(24),
            boxShadow: _softShadow,
          ),
          child: const Center(
            child: Text(
              'B',
              style: TextStyle(
                color: _almond,
                fontSize: 38,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),
        const Text(
          'Bulka Bonus',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: _textDark,
            fontSize: 34,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'карта гостя любимой пекарни',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: _textDark.withValues(alpha: 0.58),
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

class _AuthCard extends StatelessWidget {
  const _AuthCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: _cream.withValues(alpha: 0.94),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: Colors.white.withValues(alpha: 0.9)),
        boxShadow: _softShadow,
      ),
      child: child,
    );
  }
}

class _AuthStepHeader extends StatelessWidget {
  const _AuthStepHeader({
    required this.step,
    required this.title,
    required this.subtitle,
  });

  final String step;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          decoration: BoxDecoration(
            color: _sage.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Text(
            step,
            style: const TextStyle(
              color: _sage,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
        const SizedBox(height: 14),
        Text(
          title,
          style: const TextStyle(
            color: _textDark,
            fontSize: 26,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          subtitle,
          style: TextStyle(
            color: _textDark.withValues(alpha: 0.64),
            fontSize: 15,
            height: 1.45,
          ),
        ),
      ],
    );
  }
}

class _InlineAlert extends StatelessWidget {
  const _InlineAlert({required this.message, required this.icon});

  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: _errorRed.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _errorRed.withValues(alpha: 0.22)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: _errorRed, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: _errorRed,
                fontSize: 13,
                height: 1.35,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PrimaryButton extends StatelessWidget {
  const _PrimaryButton({
    required this.text,
    required this.onPressed,
    this.loading = false,
    this.color = _bulkaYellow,
    this.textColor = _textDark,
    this.icon,
  });

  final String text;
  final VoidCallback? onPressed;
  final bool loading;
  final Color color;
  final Color textColor;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 58,
      child: FilledButton(
        onPressed: loading ? null : onPressed,
        style: FilledButton.styleFrom(
          backgroundColor: color,
          foregroundColor: textColor,
          disabledBackgroundColor: color.withValues(alpha: 0.38),
          elevation: onPressed == null ? 0 : 4,
          shadowColor: _caramel.withValues(alpha: 0.28),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
          ),
        ),
        child: loading
            ? SizedBox(
                height: 24,
                width: 24,
                child: CircularProgressIndicator(
                  strokeWidth: 2.5,
                  color: textColor,
                ),
              )
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (icon != null) ...[
                    Icon(icon, size: 20),
                    const SizedBox(width: 10),
                  ],
                  Flexible(
                    child: Text(
                      text,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontWeight: FontWeight.w900,
                        fontSize: 15,
                      ),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

class MainShell extends StatefulWidget {
  const MainShell({
    required this.api,
    required this.customer,
    required this.transactions,
    required this.onLogout,
    super.key,
  });

  final BulkaApiClient api;
  final Customer customer;
  final List<BonusTransaction> transactions;
  final Future<void> Function() onLogout;

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final pages = [
      HomeScreen(
        api: widget.api,
        customer: widget.customer,
        onProfileTap: _openProfile,
      ),
      OrdersScreen(transactions: widget.transactions),
    ];

    return Scaffold(
      extendBody: true,
      body: IndexedStack(index: _tab, children: pages),
      bottomNavigationBar: FloatingNavBar(
        selectedIndex: _tab,
        onChanged: (index) => setState(() => _tab = index),
      ),
    );
  }

  Future<void> _openProfile() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (routeContext) => ProfileScreen(
          customer: widget.customer,
          onBack: () => Navigator.of(routeContext).maybePop(),
          onLogout: () async {
            Navigator.of(routeContext).pop();
            await widget.onLogout();
          },
        ),
      ),
    );
  }
}

class FloatingNavBar extends StatelessWidget {
  const FloatingNavBar({
    required this.selectedIndex,
    required this.onChanged,
    super.key,
  });

  final int selectedIndex;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final items = [
      _NavItem('Главная', Icons.home, Icons.home_outlined),
      _NavItem('Мои заказы', Icons.person, Icons.person_outline),
    ];

    return SafeArea(
      minimum: const EdgeInsets.fromLTRB(16, 0, 16, 24),
      child: Container(
        decoration: BoxDecoration(
          color: _cream.withValues(alpha: 0.96),
          borderRadius: BorderRadius.circular(28),
          border: Border.all(color: Colors.white.withValues(alpha: 0.85)),
          boxShadow: _softShadow,
        ),
        child: Material(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(28),
          child: Padding(
            padding: const EdgeInsets.all(8),
            child: Row(
              children: [
                for (var i = 0; i < items.length; i++)
                  Expanded(
                    child: _NavButton(
                      item: items[i],
                      selected: i == selectedIndex,
                      onTap: () => onChanged(i),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _NavButton extends StatelessWidget {
  const _NavButton({
    required this.item,
    required this.selected,
    required this.onTap,
  });

  final _NavItem item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected ? _cocoa : _textDark.withValues(alpha: 0.44);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(32),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOutCubic,
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: selected
              ? _almond.withValues(alpha: 0.55)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(22),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(selected ? item.selectedIcon : item.icon, color: color),
            const SizedBox(height: 4),
            Text(
              item.title,
              style: TextStyle(
                color: color,
                fontSize: 10,
                fontWeight: selected ? FontWeight.w800 : FontWeight.w400,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({
    required this.api,
    required this.customer,
    required this.onProfileTap,
    super.key,
  });

  final BulkaApiClient api;
  final Customer customer;
  final VoidCallback onProfileTap;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<PromoStory> _stories = const [];
  List<NewsItem> _news = const [];
  Set<String> _viewedStoryGroups = const {};

  @override
  void initState() {
    super.initState();
    _loadViewedStoryGroups();
    _loadFeed();
  }

  Future<void> _loadViewedStoryGroups() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(() {
      _viewedStoryGroups =
          (prefs.getStringList('viewed_story_groups') ?? const []).toSet();
    });
  }

  Future<void> _loadFeed() async {
    final results = await Future.wait([
      widget.api.getStories().catchError((_) => <PromoStory>[]),
      widget.api.getNews().catchError((_) => <NewsItem>[]),
    ]);
    if (!mounted) return;
    setState(() {
      _stories = results[0] as List<PromoStory>;
      _news = results[1] as List<NewsItem>;
    });
  }

  @override
  Widget build(BuildContext context) {
    final customer = widget.customer;
    final colors = _CardPalette.fromTier(customer.tier?.name ?? '');
    final storyGroups = _groupStories(_stories);

    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFFFFF0D6), _milkyBackground],
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: LayoutBuilder(
          builder: (context, constraints) {
            return SingleChildScrollView(
              key: const PageStorageKey('home-scroll'),
              padding: const EdgeInsets.only(bottom: 132),
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: constraints.maxHeight),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 20,
                        vertical: 24,
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          InkWell(
                            borderRadius: BorderRadius.circular(32),
                            onTap: widget.onProfileTap,
                            child: Row(
                              children: [
                                Container(
                                  width: 52,
                                  height: 52,
                                  decoration: const BoxDecoration(
                                    color: _cocoa,
                                    shape: BoxShape.circle,
                                  ),
                                  child: const Icon(
                                    Icons.person,
                                    color: _almond,
                                    size: 26,
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'Добро пожаловать,',
                                      style: TextStyle(
                                        color: _textDark.withValues(
                                          alpha: 0.58,
                                        ),
                                        fontSize: 12,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    Text(
                                      customer.name,
                                      style: const TextStyle(
                                        color: _textDark,
                                        fontSize: 18,
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                          IconButton(
                            onPressed: () {},
                            style: IconButton.styleFrom(
                              backgroundColor: _cream,
                              foregroundColor: _cocoa,
                              minimumSize: const Size(48, 48),
                            ),
                            icon: const Icon(Icons.notifications_rounded),
                          ),
                        ],
                      ),
                    ),
                    if (storyGroups.isNotEmpty)
                      SizedBox(
                        height: 140,
                        child: ListView.separated(
                          padding: const EdgeInsets.symmetric(horizontal: 20),
                          scrollDirection: Axis.horizontal,
                          itemCount: storyGroups.length,
                          separatorBuilder: (_, _) => const SizedBox(width: 12),
                          itemBuilder: (context, index) {
                            final group = storyGroups[index];
                            return StoryTile(
                              group: group,
                              viewed: _viewedStoryGroups.contains(group.id),
                              onTap: () => _openStoryGroup(group),
                            );
                          },
                        ),
                      ),
                    if (storyGroups.isNotEmpty) const SizedBox(height: 24),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: _GuestCard(
                        customer: customer,
                        palette: colors,
                        onQrTap: () => showDialog<void>(
                          context: context,
                          builder: (_) =>
                              QrDialog(api: widget.api, customer: customer),
                        ),
                      ),
                    ),
                    if (_news.isNotEmpty) ...[
                      const SizedBox(height: 24),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        child: NewsFeed(news: _news),
                      ),
                    ],
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  List<StoryGroup> _groupStories(List<PromoStory> stories) {
    final byGroup = <String, List<PromoStory>>{};
    for (final story in stories) {
      byGroup.putIfAbsent(story.groupId, () => []).add(story);
    }
    final groups =
        byGroup.entries.map((entry) {
          final items = [...entry.value]
            ..sort((a, b) {
              final byOrder = a.sortOrder.compareTo(b.sortOrder);
              if (byOrder != 0) return byOrder;
              return a.id.compareTo(b.id);
            });
          final first = items.first;
          return StoryGroup(
            id: entry.key,
            title: first.groupTitle.isNotEmpty ? first.groupTitle : first.title,
            coverUrl: first.groupCoverUrl.isNotEmpty
                ? first.groupCoverUrl
                : first.imageUrl,
            stories: items,
          );
        }).toList()..sort(
          (a, b) => a.stories.first.id.compareTo(b.stories.first.id),
        );
    return groups;
  }

  Future<void> _openStoryGroup(StoryGroup group) async {
    await showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'Story',
      barrierColor: Colors.black,
      pageBuilder: (_, _, _) =>
          StoryViewer(stories: group.stories, initialIndex: 0),
    );
    await _markStoryGroupViewed(group.id);
  }

  Future<void> _markStoryGroupViewed(String groupId) async {
    if (_viewedStoryGroups.contains(groupId)) return;
    final next = {..._viewedStoryGroups, groupId};
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList('viewed_story_groups', next.toList());
    if (!mounted) return;
    setState(() => _viewedStoryGroups = next);
  }
}

class _GuestCard extends StatelessWidget {
  const _GuestCard({
    required this.customer,
    required this.palette,
    required this.onQrTap,
  });

  final Customer customer;
  final _CardPalette palette;
  final VoidCallback onQrTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 220,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        boxShadow: _softShadow,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [palette.start, palette.end],
        ),
      ),
      child: Stack(
        children: [
          Positioned(
            left: -36,
            top: -36,
            child: Container(
              width: 132,
              height: 132,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.white.withValues(alpha: 0.13),
              ),
            ),
          ),
          Positioned(
            right: -20,
            bottom: -42,
            child: Text(
              '${customer.cashbackPercent}%',
              style: TextStyle(
                color: palette.watermark,
                fontSize: 140,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'КАРТА ГОСТЯ',
                          style: TextStyle(
                            color: palette.subText,
                            fontSize: 14,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '${formatMoney(customer.balance)} ₸',
                          style: TextStyle(
                            color: palette.mainText,
                            fontSize: 36,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                    _CashbackChip(
                      text: '${customer.cashbackPercent}% КЭШБЭК',
                      textColor: palette.chipText,
                      faded: palette.isSilver,
                    ),
                  ],
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            (customer.tier?.name ?? 'СТАТУС').toUpperCase(),
                            style: TextStyle(
                              color: palette.mainText,
                              fontSize: 16,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Потрачено: ${formatMoney(customer.totalSpent)} ₸',
                            style: TextStyle(
                              color: palette.subText,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                    FilledButton(
                      onPressed: onQrTap,
                      style: FilledButton.styleFrom(
                        backgroundColor: Colors.white.withValues(
                          alpha: palette.isSilver ? 0.8 : 1,
                        ),
                        foregroundColor: palette.chipText,
                        minimumSize: const Size(0, 44),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 18,
                          vertical: 10,
                        ),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.qr_code_2_rounded, size: 18),
                          SizedBox(width: 8),
                          Text(
                            'Мой QR',
                            style: TextStyle(fontWeight: FontWeight.w900),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CashbackChip extends StatelessWidget {
  const _CashbackChip({
    required this.text,
    required this.textColor,
    required this.faded,
  });

  final String text;
  final Color textColor;
  final bool faded;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: faded ? 0.8 : 1),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: textColor,
          fontSize: 12,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class QrDialog extends StatefulWidget {
  const QrDialog({required this.api, required this.customer, super.key});

  final BulkaApiClient api;
  final Customer customer;

  @override
  State<QrDialog> createState() => _QrDialogState();
}

class _QrDialogState extends State<QrDialog> {
  Timer? _timer;
  int _timeRemaining = 300;
  int? _loadedWindow;
  String? _token;
  String? _error;

  @override
  void initState() {
    super.initState();
    _tick();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _tick() async {
    final now = DateTime.now().millisecondsSinceEpoch;
    final window = now ~/ 300000;
    setState(() => _timeRemaining = 300 - ((now % 300000) ~/ 1000));
    if (_loadedWindow == window && _token != null) return;
    try {
      final token = await widget.api.getQrToken(widget.customer.phone);
      if (!mounted) return;
      setState(() {
        _token = token;
        _loadedWindow = window;
        _error = null;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'QR временно недоступен');
    }
  }

  @override
  Widget build(BuildContext context) {
    final minutes = (_timeRemaining ~/ 60).toString().padLeft(2, '0');
    final seconds = (_timeRemaining % 60).toString().padLeft(2, '0');
    final isApple = defaultTargetPlatform == TargetPlatform.iOS;
    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
      backgroundColor: _cream,
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      child: Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'МОЙ QR',
                  style: TextStyle(
                    color: _textDark,
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  style: IconButton.styleFrom(
                    backgroundColor: _almond.withValues(alpha: 0.35),
                    foregroundColor: _cocoa,
                  ),
                  icon: const Icon(Icons.close_rounded),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Container(
              width: 216,
              height: 216,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(28),
                border: Border.all(color: _almond.withValues(alpha: 0.45)),
                boxShadow: [
                  BoxShadow(
                    color: _cocoa.withValues(alpha: 0.12),
                    blurRadius: 22,
                    offset: const Offset(0, 12),
                  ),
                ],
              ),
              alignment: Alignment.center,
              child: _token == null
                  ? const CircularProgressIndicator(color: _bulkaYellow)
                  : QrImageView(
                      data: _token!,
                      size: 200,
                      backgroundColor: Colors.white,
                    ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(
                _error!,
                style: const TextStyle(color: Color(0xFFE53935), fontSize: 12),
              ),
            ],
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: _almond.withValues(alpha: 0.28),
                borderRadius: BorderRadius.circular(18),
              ),
              child: Column(
                children: [
                  Text(
                    'Динамический код обновится через',
                    style: TextStyle(
                      color: _textDark.withValues(alpha: 0.58),
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '$minutes:$seconds',
                    style: const TextStyle(
                      color: _textDark,
                      fontSize: 24,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            _PrimaryButton(
              text: isApple
                  ? 'Добавить в Apple Wallet'
                  : 'Добавить в Google Wallet',
              icon: Icons.account_balance_wallet_rounded,
              color: const Color(0xFF1F1F1F),
              textColor: Colors.white,
              onPressed: _openWallet,
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openWallet() async {
    try {
      final uri = defaultTargetPlatform == TargetPlatform.iOS
          ? Uri.parse(await widget.api.createWalletUrl(widget.customer.phone))
          : Uri.parse(
              '$_apiBaseUrl/api/wallet/google/direct?phone=${widget.customer.phone}',
            );
      if (!mounted) return;
      await _openExternalUrl(context, uri, 'Не удалось открыть Wallet');
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Wallet временно недоступен')),
      );
    }
  }
}

class StoryGroup {
  const StoryGroup({
    required this.id,
    required this.title,
    required this.coverUrl,
    required this.stories,
  });

  final String id;
  final String title;
  final String coverUrl;
  final List<PromoStory> stories;
}

class StoryTile extends StatelessWidget {
  const StoryTile({
    required this.group,
    required this.viewed,
    required this.onTap,
    super.key,
  });

  final StoryGroup group;
  final bool viewed;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        width: 110,
        height: 140,
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: viewed ? Colors.grey.shade400 : _bulkaYellow,
            width: 2,
          ),
        ),
        child: Stack(
          fit: StackFit.expand,
          children: [
            ColorFiltered(
              colorFilter: viewed
                  ? const ColorFilter.matrix([
                      0.2126,
                      0.7152,
                      0.0722,
                      0,
                      0,
                      0.2126,
                      0.7152,
                      0.0722,
                      0,
                      0,
                      0.2126,
                      0.7152,
                      0.0722,
                      0,
                      0,
                      0,
                      0,
                      0,
                      1,
                      0,
                    ])
                  : const ColorFilter.mode(Colors.transparent, BlendMode.dst),
              child: _NetworkImage(url: group.coverUrl, fit: BoxFit.cover),
            ),
            if (viewed) ColoredBox(color: Colors.black.withValues(alpha: 0.22)),
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.black.withValues(alpha: 0.6),
                    Colors.transparent,
                    Colors.black.withValues(alpha: 0.3),
                  ],
                ),
              ),
            ),
            Positioned(
              left: 8,
              right: 8,
              top: 8,
              child: Text(
                group.title,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class StoryViewer extends StatefulWidget {
  const StoryViewer({
    required this.stories,
    required this.initialIndex,
    super.key,
  });

  final List<PromoStory> stories;
  final int initialIndex;

  @override
  State<StoryViewer> createState() => _StoryViewerState();
}

class _StoryViewerState extends State<StoryViewer>
    with TickerProviderStateMixin {
  late int _index;
  late AnimationController _controller;
  late AnimationController _cubeController;
  int? _targetIndex;
  bool _forward = true;

  @override
  void initState() {
    super.initState();
    _index = widget.initialIndex;
    _controller = AnimationController(vsync: this)
      ..addStatusListener((status) {
        if (status == AnimationStatus.completed) _next();
      });
    _cubeController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 460),
    );
    _play();
  }

  @override
  void dispose() {
    _controller.dispose();
    _cubeController.dispose();
    super.dispose();
  }

  void _play() {
    final duration = Duration(seconds: max(widget.stories[_index].duration, 3));
    _controller
      ..duration = duration
      ..reset()
      ..forward();
  }

  void _next() {
    if (_cubeController.isAnimating) return;
    if (_index < widget.stories.length - 1) {
      _goTo(_index + 1, forward: true);
    } else {
      Navigator.of(context).maybePop();
    }
  }

  void _previous() {
    if (_cubeController.isAnimating) return;
    if (_index > 0) {
      _goTo(_index - 1, forward: false);
    } else {
      Navigator.of(context).maybePop();
    }
  }

  Future<void> _goTo(int nextIndex, {required bool forward}) async {
    _controller.stop();
    setState(() {
      _targetIndex = nextIndex;
      _forward = forward;
    });
    await _cubeController.forward(from: 0);
    if (!mounted) return;
    setState(() {
      _index = nextIndex;
      _targetIndex = null;
    });
    _cubeController.reset();
    _play();
  }

  @override
  Widget build(BuildContext context) {
    final story = widget.stories[_index];
    final targetStory = _targetIndex == null
        ? null
        : widget.stories[_targetIndex!];
    return Scaffold(
      backgroundColor: Colors.black,
      body: GestureDetector(
        onVerticalDragUpdate: (details) {
          if (details.delta.dy > 12) Navigator.of(context).maybePop();
        },
        child: Stack(
          fit: StackFit.expand,
          children: [
            AnimatedBuilder(
              animation: _cubeController,
              builder: (context, _) => _StoryCubeStage(
                current: story,
                target: targetStory,
                progress: _cubeController.value,
                forward: _forward,
              ),
            ),
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.black.withValues(alpha: 0.7),
                    Colors.transparent,
                    Colors.transparent,
                    Colors.black.withValues(alpha: 0.8),
                  ],
                ),
              ),
            ),
            Row(
              children: [
                Expanded(
                  flex: 3,
                  child: GestureDetector(
                    behavior: HitTestBehavior.translucent,
                    onTap: _previous,
                  ),
                ),
                Expanded(
                  flex: 7,
                  child: GestureDetector(
                    behavior: HitTestBehavior.translucent,
                    onTap: _next,
                  ),
                ),
              ],
            ),
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    AnimatedBuilder(
                      animation: _controller,
                      builder: (_, _) => Row(
                        children: [
                          for (var i = 0; i < widget.stories.length; i++)
                            Expanded(
                              child: Padding(
                                padding: EdgeInsets.only(
                                  right: i == widget.stories.length - 1 ? 0 : 4,
                                ),
                                child: LinearProgressIndicator(
                                  value: i < _index
                                      ? 1
                                      : i == _index
                                      ? _controller.value
                                      : 0,
                                  minHeight: 3,
                                  color: Colors.white,
                                  backgroundColor: Colors.white.withValues(
                                    alpha: 0.3,
                                  ),
                                  borderRadius: BorderRadius.circular(2),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Container(
                          width: 32,
                          height: 32,
                          decoration: const BoxDecoration(
                            color: _bulkaBrown,
                            shape: BoxShape.circle,
                          ),
                          alignment: Alignment.center,
                          child: const Text(
                            'B',
                            style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            story.title,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 15,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        IconButton(
                          onPressed: () => Navigator.of(context).maybePop(),
                          icon: const Icon(
                            Icons.close,
                            color: Colors.white,
                            size: 28,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            if ((story.description ?? '').isNotEmpty)
              Positioned(
                left: 20,
                right: 20,
                bottom: 40,
                child: SafeArea(
                  top: false,
                  child: Text(
                    story.description!,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 15,
                      height: 1.45,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _StoryCubeStage extends StatelessWidget {
  const _StoryCubeStage({
    required this.current,
    required this.target,
    required this.progress,
    required this.forward,
  });

  final PromoStory current;
  final PromoStory? target;
  final double progress;
  final bool forward;

  @override
  Widget build(BuildContext context) {
    final next = target;
    if (next == null) {
      return _NetworkImage(url: current.contentUrl, fit: BoxFit.cover);
    }

    final eased = Curves.easeInOutCubic.transform(progress.clamp(0, 1));
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final height = constraints.maxHeight;
        final half = width / 2;
        return Stack(
          fit: StackFit.expand,
          children: [
            _NetworkImage(url: current.contentUrl, fit: BoxFit.cover),
            if (forward) ...[
              Positioned(
                right: 0,
                top: 0,
                bottom: 0,
                width: half,
                child: ColoredBox(
                  color: Colors.black.withValues(alpha: 0.42 * eased),
                ),
              ),
              _CubeHalfFace(
                story: current,
                side: _StoryHalf.left,
                width: width,
                height: height,
                angle: -eased * pi / 2,
                transformAlignment: Alignment.centerRight,
              ),
              _CubeHalfFace(
                story: next,
                side: _StoryHalf.right,
                width: width,
                height: height,
                angle: (1 - eased) * pi / 2,
                transformAlignment: Alignment.centerLeft,
              ),
            ] else ...[
              Positioned(
                left: 0,
                top: 0,
                bottom: 0,
                width: half,
                child: ColoredBox(
                  color: Colors.black.withValues(alpha: 0.42 * eased),
                ),
              ),
              _CubeHalfFace(
                story: current,
                side: _StoryHalf.right,
                width: width,
                height: height,
                angle: eased * pi / 2,
                transformAlignment: Alignment.centerLeft,
              ),
              _CubeHalfFace(
                story: next,
                side: _StoryHalf.left,
                width: width,
                height: height,
                angle: -(1 - eased) * pi / 2,
                transformAlignment: Alignment.centerRight,
              ),
            ],
            Center(
              child: Container(
                width: 2,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.12),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.28),
                      blurRadius: 18,
                    ),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

enum _StoryHalf { left, right }

class _CubeHalfFace extends StatelessWidget {
  const _CubeHalfFace({
    required this.story,
    required this.side,
    required this.width,
    required this.height,
    required this.angle,
    required this.transformAlignment,
  });

  final PromoStory story;
  final _StoryHalf side;
  final double width;
  final double height;
  final double angle;
  final Alignment transformAlignment;

  @override
  Widget build(BuildContext context) {
    final isLeft = side == _StoryHalf.left;
    final matrix = Matrix4.identity()
      ..setEntry(3, 2, 0.0012)
      ..rotateY(angle);

    return Positioned(
      left: isLeft ? 0 : width / 2,
      top: 0,
      width: width / 2,
      height: height,
      child: ClipRect(
        child: Transform(
          alignment: transformAlignment,
          transform: matrix,
          child: Align(
            alignment: isLeft ? Alignment.centerLeft : Alignment.centerRight,
            child: SizedBox(
              width: width,
              height: height,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  _NetworkImage(url: story.contentUrl, fit: BoxFit.cover),
                  DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: isLeft
                            ? Alignment.centerRight
                            : Alignment.centerLeft,
                        end: isLeft
                            ? Alignment.centerLeft
                            : Alignment.centerRight,
                        colors: [
                          Colors.black.withValues(alpha: 0.16),
                          Colors.transparent,
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class NewsFeed extends StatelessWidget {
  const NewsFeed({required this.news, super.key});

  final List<NewsItem> news;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Новости',
          style: TextStyle(
            color: _textDark,
            fontSize: 22,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 14),
        for (final item in news) ...[
          NewsCard(item: item),
          const SizedBox(height: 14),
        ],
      ],
    );
  }
}

class NewsCard extends StatelessWidget {
  const NewsCard({required this.item, super.key});

  final NewsItem item;

  @override
  Widget build(BuildContext context) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: _cream,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: Colors.white.withValues(alpha: 0.9)),
        boxShadow: [
          BoxShadow(
            color: _cocoa.withValues(alpha: 0.08),
            blurRadius: 18,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (item.imageUrl.isNotEmpty)
            SizedBox(
              height: 260,
              width: double.infinity,
              child: _NetworkImage(url: item.imageUrl, fit: BoxFit.cover),
            ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.title,
                  style: const TextStyle(
                    color: _textDark,
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                if ((item.description ?? '').isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    item.description!,
                    style: TextStyle(
                      color: _textDark.withValues(alpha: 0.68),
                      fontSize: 14,
                      height: 1.42,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class OrdersScreen extends StatelessWidget {
  const OrdersScreen({required this.transactions, super.key});

  final List<BonusTransaction> transactions;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Мои заказы',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
      ),
      body: transactions.isEmpty
          ? Center(
              child: Container(
                margin: const EdgeInsets.all(24),
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: _cream,
                  borderRadius: BorderRadius.circular(24),
                  boxShadow: _softShadow,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.receipt_long_rounded,
                      color: _caramel,
                      size: 38,
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'У вас пока нет заказов',
                      style: TextStyle(
                        color: _textDark,
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'История начислений появится после покупки.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: _textDark.withValues(alpha: 0.58),
                        fontSize: 14,
                      ),
                    ),
                  ],
                ),
              ),
            )
          : ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 132),
              itemBuilder: (_, index) =>
                  TransactionCard(transaction: transactions[index]),
              separatorBuilder: (_, _) => const SizedBox(height: 12),
              itemCount: transactions.length,
            ),
    );
  }
}

class TransactionCard extends StatelessWidget {
  const TransactionCard({required this.transaction, super.key});

  final BonusTransaction transaction;

  @override
  Widget build(BuildContext context) {
    final earning = transaction.isEarning;
    final color = earning ? _successGreen : _errorRed;
    final prefix = earning ? '+' : '-';
    return Card(
      color: _cream,
      elevation: 0,
      shadowColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: _almond.withValues(alpha: 0.45)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.12),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    earning
                        ? Icons.keyboard_arrow_up_rounded
                        : Icons.keyboard_arrow_down_rounded,
                    color: color,
                    size: 22,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    transaction.label,
                    style: const TextStyle(
                      color: _textDark,
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                Text(
                  '$prefix${formatMoney(transaction.amount)} ₸',
                  style: TextStyle(
                    color: color,
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
            if ((transaction.orderTotal ?? 0) > 0) ...[
              const SizedBox(height: 8),
              Text(
                'Сумма чека: ${formatMoney(transaction.orderTotal!)} ₸',
                style: TextStyle(
                  color: _textDark.withValues(alpha: 0.7),
                  fontSize: 14,
                ),
              ),
            ],
            const SizedBox(height: 4),
            Text(
              formatDateTime(transaction.timestamp),
              style: TextStyle(
                color: _textDark.withValues(alpha: 0.5),
                fontSize: 12,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({
    required this.customer,
    required this.onBack,
    required this.onLogout,
    super.key,
  });

  final Customer customer;
  final VoidCallback onBack;
  final Future<void> Function() onLogout;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Мой профиль'),
        leading: IconButton(
          onPressed: onBack,
          icon: const Icon(Icons.arrow_back_rounded),
        ),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 16),
              Row(
                children: [
                  Container(
                    width: 64,
                    height: 64,
                    decoration: const BoxDecoration(
                      color: _cocoa,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.person, color: _almond, size: 40),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          customer.name,
                          style: const TextStyle(
                            color: _textDark,
                            fontSize: 24,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        Text(
                          '+${customer.phone}',
                          style: TextStyle(
                            color: _textDark.withValues(alpha: 0.7),
                            fontSize: 16,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 32),
              Row(
                children: [
                  Expanded(
                    child: StatCard(
                      title: 'Покупок на',
                      value: '${formatMoney(customer.totalSpent)} ₸',
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: StatCard(
                      title: 'Кэшбэк',
                      value: '${customer.cashbackPercent}%',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 32),
              const Text(
                'Настройки',
                style: TextStyle(
                  color: _textDark,
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 16),
              SettingTile(title: 'Служба поддержки', onTap: () {}),
              SettingTile(title: 'О приложении', onTap: () {}),
              SettingTile(
                title: 'Выйти из аккаунта',
                color: const Color(0xFFE53935),
                onTap: () => onLogout(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class StatCard extends StatelessWidget {
  const StatCard({required this.title, required this.value, super.key});

  final String title;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: _cream,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: _almond.withValues(alpha: 0.45)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Text(
              title,
              style: TextStyle(
                color: _textDark.withValues(alpha: 0.6),
                fontSize: 12,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              value,
              style: const TextStyle(
                color: _caramel,
                fontSize: 18,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class SettingTile extends StatelessWidget {
  const SettingTile({
    required this.title,
    required this.onTap,
    this.color = _textDark,
    super.key,
  });

  final String title;
  final VoidCallback onTap;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          color: _cream,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: _almond.withValues(alpha: 0.35)),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                title,
                style: TextStyle(
                  color: color,
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            Icon(
              Icons.chevron_right_rounded,
              color: color.withValues(alpha: 0.55),
            ),
          ],
        ),
      ),
    );
  }
}

class _NetworkImage extends StatelessWidget {
  const _NetworkImage({required this.url, required this.fit});

  final String url;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) {
    if (url.isEmpty) return const ColoredBox(color: _lightCardHighlight);
    return Image.network(
      url,
      fit: fit,
      errorBuilder: (_, _, _) => const ColoredBox(color: _lightCardHighlight),
      loadingBuilder: (context, child, progress) {
        if (progress == null) return child;
        return const ColoredBox(
          color: _lightCardHighlight,
          child: Center(child: CircularProgressIndicator(color: _bulkaYellow)),
        );
      },
    );
  }
}

class BulkaApiClient {
  BulkaApiClient({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  Uri _uri(String path) {
    final base = _apiBaseUrl.endsWith('/')
        ? _apiBaseUrl.substring(0, _apiBaseUrl.length - 1)
        : _apiBaseUrl;
    return Uri.parse('$base$path');
  }

  Future<ProfileResponse> getProfile(String phone) async {
    final json = await _post('/api/guest/profile', {
      'phone': phone,
      'name': '',
      'register': false,
    });
    return ProfileResponse.fromJson(json);
  }

  Future<void> requestOtp({
    required String phone,
    required String token,
  }) async {
    final json = await _post('/api/auth/request-otp', {
      'phone': phone,
      'token': token,
    });
    if (json['success'] != true) {
      throw ApiException(_messageFrom(json, 'Ошибка при отправке кода'));
    }
  }

  Future<ProfileResponse> verifyOtp({
    required String phone,
    required String code,
  }) async {
    final json = await _post('/api/auth/verify-otp', {
      'phone': phone,
      'code': code,
    });
    final response = ProfileResponse.fromJson(json);
    if (!response.success) {
      throw ApiException(response.message ?? response.error ?? 'Неверный код');
    }
    return response;
  }

  Future<String> getQrToken(String phone) async {
    final json = await _post('/api/guest/qr-token', {'phone': phone});
    final token = _asString(json['token']);
    if (json['success'] == true && token.isNotEmpty) return token;
    throw ApiException(_messageFrom(json, 'QR временно недоступен'));
  }

  Future<String> createWalletUrl(String phone) async {
    final json = await _post('/api/wallet/token', {'phone': phone});
    final url = _asString(json['url']);
    if (url.isNotEmpty) return url;
    throw ApiException(_messageFrom(json, 'Wallet временно недоступен'));
  }

  Future<List<PromoStory>> getStories() async {
    final json = await _get('/api/guest/stories');
    final stories = json['stories'];
    if (json['success'] == true && stories is List) {
      return stories.map((item) => PromoStory.fromJson(_asMap(item))).toList();
    }
    return const [];
  }

  Future<List<NewsItem>> getNews() async {
    final json = await _get('/api/guest/news');
    final news = json['news'];
    if (json['success'] == true && news is List) {
      return news.map((item) => NewsItem.fromJson(_asMap(item))).toList();
    }
    return const [];
  }

  Future<Map<String, dynamic>> _get(String path) async {
    final response = await _client.get(_uri(path));
    return _decode(response);
  }

  Future<Map<String, dynamic>> _post(
    String path,
    Map<String, dynamic> body,
  ) async {
    final response = await _client.post(
      _uri(path),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(body),
    );
    return _decode(response);
  }

  Map<String, dynamic> _decode(http.Response response) {
    final text = utf8.decode(response.bodyBytes);
    final decoded = text.isEmpty ? <String, dynamic>{} : jsonDecode(text);
    final json = _asMap(decoded);
    if (response.statusCode >= 400) {
      throw ApiException(_messageFrom(json, 'Ошибка сети'));
    }
    return json;
  }
}

class ApiException implements Exception {
  ApiException(this.message);

  final String message;

  @override
  String toString() => message;
}

class ProfileResponse {
  const ProfileResponse({
    required this.success,
    required this.exists,
    required this.customer,
    required this.transactions,
    this.error,
    this.message,
  });

  final bool success;
  final bool exists;
  final Customer? customer;
  final List<BonusTransaction> transactions;
  final String? error;
  final String? message;

  factory ProfileResponse.fromJson(Map<String, dynamic> json) {
    final transactions = json['transactions'];
    return ProfileResponse(
      success: json['success'] != false,
      exists: json['exists'] == true,
      customer: json['customer'] is Map
          ? Customer.fromJson(_asMap(json['customer']))
          : null,
      transactions: transactions is List
          ? transactions
                .map((item) => BonusTransaction.fromJson(_asMap(item)))
                .toList()
          : const [],
      error: _nullableString(json['error']),
      message: _nullableString(json['message']),
    );
  }
}

class Customer {
  const Customer({
    required this.id,
    required this.name,
    required this.phone,
    required this.balance,
    required this.totalSpent,
    required this.createdAt,
    required this.isVip,
    required this.cashbackPercent,
    required this.vipThreshold,
    required this.tier,
  });

  final String id;
  final String name;
  final String phone;
  final double balance;
  final double totalSpent;
  final String createdAt;
  final bool isVip;
  final int cashbackPercent;
  final int vipThreshold;
  final Tier? tier;

  factory Customer.fromJson(Map<String, dynamic> json) {
    return Customer(
      id: _asString(json['id']),
      name: _asString(json['name'], fallback: 'Гость'),
      phone: _asString(json['phone']),
      balance: _asDouble(json['balance']),
      totalSpent: _asDouble(json['total_spent'] ?? json['totalSpent']),
      createdAt: _asString(json['created_at'] ?? json['createdAt']),
      isVip: json['isVip'] == true || json['is_vip'] == true,
      cashbackPercent: _asInt(
        json['cashbackPercent'] ?? json['cashback_percent'],
      ),
      vipThreshold: _asInt(json['vipThreshold'] ?? json['vip_threshold']),
      tier: json['tier'] is Map ? Tier.fromJson(_asMap(json['tier'])) : null,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'phone': phone,
    'balance': balance,
    'total_spent': totalSpent,
    'created_at': createdAt,
    'isVip': isVip,
    'cashbackPercent': cashbackPercent,
    'vipThreshold': vipThreshold,
    'tier': tier?.toJson(),
  };
}

class Tier {
  const Tier({
    required this.name,
    required this.percent,
    required this.remaining,
    required this.progress,
    this.nextTier,
    this.nextTh,
  });

  final String name;
  final int percent;
  final String? nextTier;
  final int? nextTh;
  final double remaining;
  final double progress;

  factory Tier.fromJson(Map<String, dynamic> json) {
    return Tier(
      name: _asString(json['name']),
      percent: _asInt(json['percent']),
      nextTier: _nullableString(json['nextTier'] ?? json['next_tier']),
      nextTh: _nullableInt(json['nextTh'] ?? json['next_th']),
      remaining: _asDouble(json['remaining']),
      progress: _asDouble(json['progress']),
    );
  }

  Map<String, dynamic> toJson() => {
    'name': name,
    'percent': percent,
    'nextTier': nextTier,
    'nextTh': nextTh,
    'remaining': remaining,
    'progress': progress,
  };
}

class BonusTransaction {
  const BonusTransaction({
    required this.id,
    required this.customerId,
    required this.type,
    required this.amount,
    required this.timestamp,
    this.orderId,
    this.orderTotal,
  });

  final String id;
  final String customerId;
  final String? orderId;
  final String type;
  final double amount;
  final double? orderTotal;
  final String timestamp;

  bool get isEarning =>
      type.toLowerCase().contains('deposit') || type.toLowerCase() == 'earning';

  String get label {
    switch (type) {
      case 'deposit':
        return 'Начисление кэшбэка';
      case 'manual_deposit':
        return 'Подарок / Начисление';
      case 'withdrawal':
        return 'Оплата бонусами';
      case 'manual_withdrawal':
        return 'Ручное списание';
      case 'expiration':
        return 'Сгорание бонусов';
      default:
        return isEarning ? 'Начисление бонусов' : 'Списание бонусов';
    }
  }

  factory BonusTransaction.fromJson(Map<String, dynamic> json) {
    return BonusTransaction(
      id: _asString(json['id']),
      customerId: _asString(json['customer_id'] ?? json['customerId']),
      orderId: _nullableString(json['order_id'] ?? json['orderId']),
      type: _asString(json['type']),
      amount: _asDouble(json['amount']),
      orderTotal: _nullableDouble(json['order_total'] ?? json['orderTotal']),
      timestamp: _asString(json['timestamp']),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'customer_id': customerId,
    'order_id': orderId,
    'type': type,
    'amount': amount,
    'order_total': orderTotal,
    'timestamp': timestamp,
  };
}

class PromoStory {
  const PromoStory({
    required this.id,
    required this.title,
    required this.imageUrl,
    required this.contentUrl,
    required this.groupId,
    required this.groupTitle,
    required this.groupCoverUrl,
    this.sortOrder = 0,
    this.description,
    this.duration = 15,
  });

  final int id;
  final String title;
  final String imageUrl;
  final String contentUrl;
  final String groupId;
  final String groupTitle;
  final String groupCoverUrl;
  final int sortOrder;
  final String? description;
  final int duration;

  factory PromoStory.fromJson(Map<String, dynamic> json) {
    final image = _asString(json['coverUrl'] ?? json['cover_url']);
    final id = _asInt(json['id']);
    final title = _asString(json['title']);
    return PromoStory(
      id: id,
      title: title,
      imageUrl: image,
      contentUrl: _asString(
        json['contentUrl'] ?? json['content_url'],
        fallback: image,
      ),
      groupId: _asString(
        json['groupId'] ?? json['group_id'] ?? json['groupid'],
        fallback: id.toString(),
      ),
      groupTitle: _asString(
        json['groupTitle'] ?? json['group_title'] ?? json['grouptitle'],
        fallback: title,
      ),
      groupCoverUrl: _asString(
        json['groupCoverUrl'] ??
            json['group_coverurl'] ??
            json['group_cover_url'],
        fallback: image,
      ),
      sortOrder: _asInt(json['sortOrder'] ?? json['sort_order']),
      description: _nullableString(json['description']),
      duration: _asInt(json['duration'], fallback: 15),
    );
  }
}

class NewsItem {
  const NewsItem({
    required this.id,
    required this.title,
    required this.imageUrl,
    this.description,
  });

  final int id;
  final String title;
  final String imageUrl;
  final String? description;

  factory NewsItem.fromJson(Map<String, dynamic> json) {
    return NewsItem(
      id: _asInt(json['id']),
      title: _asString(json['title']),
      imageUrl: _asString(
        json['imageUrl'] ?? json['imageurl'] ?? json['image_url'],
      ),
      description: _nullableString(json['description']),
    );
  }
}

class _NavItem {
  const _NavItem(this.title, this.selectedIcon, this.icon);

  final String title;
  final IconData selectedIcon;
  final IconData icon;
}

class _CardPalette {
  const _CardPalette({
    required this.start,
    required this.end,
    required this.chipText,
    required this.mainText,
    required this.subText,
    required this.watermark,
    this.isSilver = false,
  });

  final Color start;
  final Color end;
  final Color chipText;
  final Color mainText;
  final Color subText;
  final Color watermark;
  final bool isSilver;

  factory _CardPalette.fromTier(String tierName) {
    final name = tierName.toLowerCase();
    if (name.contains('платина')) {
      return _CardPalette(
        start: const Color(0xFF434343),
        end: Colors.black,
        chipText: const Color(0xFF212121),
        mainText: Colors.white,
        subText: Colors.white.withValues(alpha: 0.8),
        watermark: Colors.white.withValues(alpha: 0.15),
      );
    }
    if (name.contains('золото')) {
      return _CardPalette(
        start: const Color(0xFFE5A52C),
        end: const Color(0xFFB85D20),
        chipText: _caramel,
        mainText: Colors.white,
        subText: Colors.white.withValues(alpha: 0.9),
        watermark: Colors.white.withValues(alpha: 0.15),
      );
    }
    if (name.contains('серебро')) {
      return _CardPalette(
        start: const Color(0xFFEEEEEE),
        end: const Color(0xFF9E9E9E),
        chipText: const Color(0xFF424242),
        mainText: const Color(0xFF212121),
        subText: const Color(0xFF424242),
        watermark: Colors.black.withValues(alpha: 0.1),
        isSilver: true,
      );
    }
    if (name.contains('бронза')) {
      return _CardPalette(
        start: const Color(0xFFD7CCC8),
        end: const Color(0xFF8D6E63),
        chipText: const Color(0xFF5D4037),
        mainText: Colors.white,
        subText: Colors.white.withValues(alpha: 0.9),
        watermark: Colors.white.withValues(alpha: 0.15),
      );
    }
    return _CardPalette(
      start: const Color(0xFFE8A11A),
      end: const Color(0xFF8A431F),
      chipText: _caramel,
      mainText: Colors.white,
      subText: Colors.white.withValues(alpha: 0.9),
      watermark: Colors.white.withValues(alpha: 0.15),
    );
  }
}

InputDecoration _inputDecoration({
  required String label,
  String? prefix,
  String? helper,
  String? error,
  IconData? icon,
}) {
  return InputDecoration(
    labelText: label,
    prefixText: prefix,
    helperText: error == null ? helper : null,
    counterText: '',
    errorText: null,
    filled: true,
    fillColor: Colors.white,
    contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 18),
    prefixIcon: icon == null ? null : Icon(icon, color: _caramel),
    labelStyle: TextStyle(
      color: error == null ? _textDark.withValues(alpha: 0.62) : _errorRed,
    ),
    helperStyle: TextStyle(
      color: _textDark.withValues(alpha: 0.5),
      fontSize: 12,
    ),
    prefixStyle: const TextStyle(
      color: _textDark,
      fontSize: 18,
      fontWeight: FontWeight.w900,
    ),
    enabledBorder: OutlineInputBorder(
      borderSide: BorderSide(color: _almond.withValues(alpha: 0.8)),
      borderRadius: BorderRadius.circular(18),
    ),
    focusedBorder: OutlineInputBorder(
      borderSide: const BorderSide(color: _caramel, width: 2),
      borderRadius: BorderRadius.circular(18),
    ),
    errorBorder: OutlineInputBorder(
      borderSide: const BorderSide(color: _errorRed),
      borderRadius: BorderRadius.circular(18),
    ),
    focusedErrorBorder: OutlineInputBorder(
      borderSide: const BorderSide(color: _errorRed, width: 2),
      borderRadius: BorderRadius.circular(18),
    ),
  );
}

Future<void> _openTelegram(BuildContext context) async {
  final opened = await launchUrl(
    Uri.parse('tg://resolve?domain=bulkawallet_bot'),
    mode: LaunchMode.externalApplication,
  );
  if (!opened && context.mounted) {
    await _openExternalUrl(
      context,
      Uri.parse('https://t.me/bulkawallet_bot'),
      'Не удалось открыть Telegram',
    );
  }
}

Future<void> _openExternalUrl(
  BuildContext context,
  Uri uri,
  String error,
) async {
  final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
  if (!opened && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error)));
  }
}

String _userError(Object error, String fallback) {
  if (error is ApiException && error.message.isNotEmpty) return error.message;
  return fallback;
}

String _messageFrom(Map<String, dynamic> json, String fallback) {
  return _asString(json['message'] ?? json['error'], fallback: fallback);
}

Customer? _readCustomer(String? raw) {
  if (raw == null) return null;
  try {
    return Customer.fromJson(_asMap(jsonDecode(raw)));
  } catch (_) {
    return null;
  }
}

List<BonusTransaction> _readTransactions(String? raw) {
  if (raw == null) return const [];
  try {
    final decoded = jsonDecode(raw);
    if (decoded is! List) return const [];
    return decoded
        .map((item) => BonusTransaction.fromJson(_asMap(item)))
        .toList();
  } catch (_) {
    return const [];
  }
}

String formatMoney(double value) {
  if (value % 1 == 0) return value.toInt().toString();
  return value.toStringAsFixed(2);
}

String formatDateTime(String value) {
  try {
    final date = DateTime.parse(value).toLocal();
    const months = [
      'янв',
      'фев',
      'мар',
      'апр',
      'мая',
      'июн',
      'июл',
      'авг',
      'сен',
      'окт',
      'ноя',
      'дек',
    ];
    final day = date.day.toString().padLeft(2, '0');
    final month = months[date.month - 1];
    final hour = date.hour.toString().padLeft(2, '0');
    final minute = date.minute.toString().padLeft(2, '0');
    return '$day $month ${date.year}, $hour:$minute';
  } catch (_) {
    return value;
  }
}

Map<String, dynamic> _asMap(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) {
    return value.map((key, value) => MapEntry(key.toString(), value));
  }
  return <String, dynamic>{};
}

String _asString(Object? value, {String fallback = ''}) {
  if (value == null) return fallback;
  final text = value.toString();
  return text.isEmpty ? fallback : text;
}

String? _nullableString(Object? value) {
  if (value == null) return null;
  final text = value.toString();
  return text.isEmpty ? null : text;
}

double _asDouble(Object? value, {double fallback = 0}) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value) ?? fallback;
  return fallback;
}

double? _nullableDouble(Object? value) {
  if (value == null) return null;
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value);
  return null;
}

int _asInt(Object? value, {int fallback = 0}) {
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value) ?? fallback;
  return fallback;
}

int? _nullableInt(Object? value) {
  if (value == null) return null;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value);
  return null;
}

extension on String {
  Iterable<String> get onlyDigits sync* {
    for (final rune in runes) {
      final char = String.fromCharCode(rune);
      if (RegExp(r'\d').hasMatch(char)) yield char;
    }
  }
}
