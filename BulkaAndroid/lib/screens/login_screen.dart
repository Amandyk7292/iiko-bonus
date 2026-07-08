part of '../main.dart';

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
            colors: [Colors.white, Color(0xFFFFF2CD), Color(0xFFFFB300)],
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
        title: 'Подтвердите ваш номер',
        subtitle: 'Код отправлен через WhatsApp.',
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
      Directionality(
        textDirection: TextDirection.ltr,
        child: Pinput(
          length: 4,
          controller: _otpController,
          hapticFeedbackType: HapticFeedbackType.lightImpact,
          onChanged: (value) {
            setState(() => _error = null);
          },
          onCompleted: (pin) {
            if (pin.length == 4) {
              _verify();
            }
          },
          defaultPinTheme: PinTheme(
            width: 64,
            height: 64,
            textStyle: const TextStyle(
              fontSize: 30,
              color: _textDark,
              fontWeight: FontWeight.w900,
            ),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: _bulkaBrown.withValues(alpha: 0.3)),
              boxShadow: [
                BoxShadow(
                  color: _bulkaBrown.withValues(alpha: 0.05),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
          ),
          focusedPinTheme: PinTheme(
            width: 64,
            height: 64,
            textStyle: const TextStyle(
              fontSize: 30,
              color: _textDark,
              fontWeight: FontWeight.w900,
            ),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: _bulkaBrown, width: 2),
              boxShadow: [
                BoxShadow(
                  color: _bulkaBrown.withValues(alpha: 0.15),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
          ),
          errorPinTheme: PinTheme(
            width: 64,
            height: 64,
            textStyle: const TextStyle(
              fontSize: 30,
              color: Colors.red,
              fontWeight: FontWeight.w900,
            ),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.red, width: 2),
            ),
          ),
          forceErrorState: _error != null,
        ),
      ),
      const SizedBox(height: 8),
      Text(
        'Действует несколько минут',
        style: TextStyle(
          color: _textDark.withValues(alpha: 0.5),
          fontSize: 12,
        ),
        textAlign: TextAlign.center,
      ),
      if (_error != null) ...[
        const SizedBox(height: 10),
        _InlineAlert(message: _error!, icon: Icons.error_rounded),
      ],
      const SizedBox(height: 26),
      _PrimaryButton(
        text: 'Войти',
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
        Image.asset(
          'assets/brand/bulka_logo.png',
          height: 70,
          fit: BoxFit.contain,
        ),
        const SizedBox(height: 16),
        const Text(
          'Регистрация/Вход',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: _textDark,
            fontFamily: _headingFont,
            fontSize: 28,
            fontWeight: FontWeight.w400,
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
  final VoidCallback? onPressed;
  final String text;
  final bool loading;
  final Color color;
  final Color textColor;
  final IconData? icon;

  const _PrimaryButton({
    required this.onPressed,
    required this.text,
    this.loading = false,
    this.color = _bulkaYellow,
    this.textColor = _textDark,
    this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return GradientButton(
      onPressed: onPressed,
      loading: loading,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 24, color: Colors.white),
            const SizedBox(width: 8),
          ],
          Text(text),
        ],
      ),
    );
  }
}
