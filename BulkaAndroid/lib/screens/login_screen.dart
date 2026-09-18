part of '../main.dart';

enum _CustomerAuthFlow { login, registration, passwordReset }

class LoginScreen extends StatefulWidget {
  const LoginScreen({
    required this.onLogin,
    required this.onStartRegistration,
    required this.onVerifyRegistration,
    required this.onStartPasswordReset,
    required this.onResetPassword,
    this.onRegister,
    this.onClose,
    this.onAdminLogin = loginAdminPortal,
    this.onOpenAdminPortal,
    super.key,
  });

  final Future<String?> Function(String phone, String password) onLogin;
  final Future<OtpRequestResult> Function(
    String phone,
    String password,
    String token,
  )
  onStartRegistration;
  final Future<String?> Function(String phone, String code)
  onVerifyRegistration;
  final Future<OtpRequestResult> Function(String phone, String token)
  onStartPasswordReset;
  final Future<String?> Function(String phone, String code, String password)
  onResetPassword;
  final Future<String?> Function({
    required String phone,
    required String name,
    String? surname,
    String? gender,
    String? birthdate,
    String? email,
  })?
  onRegister;
  final VoidCallback? onClose;
  final Future<void> Function(String username, String password, String code)
  onAdminLogin;
  final Future<void> Function(BuildContext context)? onOpenAdminPortal;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phoneController = TextEditingController();
  final _otpController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  final _nameController = TextEditingController();
  final _surnameController = TextEditingController();
  final _emailController = TextEditingController();

  _CustomerAuthFlow _flow = _CustomerAuthFlow.login;
  bool _otpStep = false;
  bool _registerStep = false;
  bool _loading = false;
  bool _adminLogin = false;
  bool _passwordVisible = false;
  bool _confirmPasswordVisible = false;
  String? _error;
  String? _selectedGender;
  String? _birthdate;
  bool _termsAccepted = false;
  String? _otpDeliveryPhone;
  bool _otpDeliveryHasLink = false;
  Uri? _otpWhatsappUri;

  void _update(VoidCallback callback) => setState(callback);

  String get _fullPhone => '+7${_phoneController.text}';

  String get _langCode {
    return AppLang.shortLabel(AppLang.current);
  }

  Future<void> _showLanguageBottomSheet() async {
    final code = await showLanguageBottomSheet(
      context,
      initialCode: AppLang.current,
    );
    if (code == null) return;
    await AppLang.setLanguage(code);
    if (!mounted) return;
    setState(() => _error = null);
  }

  @override
  void dispose() {
    _phoneController.dispose();
    _otpController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    _nameController.dispose();
    _surnameController.dispose();
    _emailController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_registerStep) {
      return _buildRegistrationScreen(context);
    }
    return Scaffold(
      body: DecoratedBox(
        decoration: BoxDecoration(color: Theme.of(context).colorScheme.surface),
        child: SafeArea(
          child: Stack(
            children: [
              Center(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 460),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            _buildLanguageBadge(),
                            const Spacer(),
                            if (widget.onClose != null)
                              const SizedBox(width: 48),
                          ],
                        ),
                        const SizedBox(height: 16),
                        const _BrandHeader(),
                        const SizedBox(height: 28),
                        _AuthCard(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              if (_flow == _CustomerAuthFlow.login &&
                                  !_otpStep) ...[
                                _AuthLoginMethodSelector(
                                  admin: _adminLogin,
                                  enabled: !_loading,
                                  onChanged: (admin) {
                                    FocusScope.of(context).unfocus();
                                    setState(() {
                                      _adminLogin = admin;
                                      _error = null;
                                      _passwordController.clear();
                                    });
                                  },
                                ),
                                const SizedBox(height: 22),
                              ],
                              BulkaMotionSwitcher(
                                duration: BulkaMotion.standard,
                                offset: const Offset(0.035, 0),
                                scale: 0.995,
                                child:
                                    _adminLogin &&
                                        _flow == _CustomerAuthFlow.login
                                    ? _AdminPasswordLoginForm(
                                        key: const ValueKey('admin-login'),
                                        onLogin: widget.onAdminLogin,
                                        onAuthenticated: () =>
                                            (widget.onOpenAdminPortal ??
                                            openAdminPortal)(context),
                                        onLoadingChanged: (loading) {
                                          if (mounted) {
                                            setState(() => _loading = loading);
                                          }
                                        },
                                      )
                                    : _otpStep
                                    ? Column(
                                        key: const ValueKey('otp'),
                                        crossAxisAlignment:
                                            CrossAxisAlignment.stretch,
                                        children: _otpCodeStep(context),
                                      )
                                    : Column(
                                        key: const ValueKey('phone'),
                                        crossAxisAlignment:
                                            CrossAxisAlignment.stretch,
                                        children: _phoneStep(context),
                                      ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              if (widget.onClose != null)
                Positioned(
                  top: 12,
                  right: 16,
                  child: IconButton(
                    onPressed: widget.onClose,
                    tooltip: 'close_tooltip'.tr,
                    style: IconButton.styleFrom(
                      minimumSize: const Size(48, 48),
                      backgroundColor: context.bulkaColors.surfaceCream,
                      foregroundColor: context.bulkaColors.brandBrown,
                    ),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BrandHeader extends StatelessWidget {
  const _BrandHeader();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        ColorFiltered(
          colorFilter: ColorFilter.mode(
            context.bulkaColors.brandBrown,
            BlendMode.srcIn,
          ),
          child: Image.asset(
            'assets/brand/bulka_logo.png',
            height: 82,
            fit: BoxFit.contain,
          ),
        ),
        const SizedBox(height: 18),
        Text(
          'login_brand_title'.tr,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Theme.of(context).colorScheme.onSurface,
            fontFamily: _headingFont,
            fontSize: BulkaTypeScale.pageTitle,
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
    final colors = context.bulkaColors;
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        border: Border.all(
          color: colors.cardBorder,
          width: BulkaStrokes.hairline,
        ),
        boxShadow: _softShadow,
      ),
      child: child,
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
  final String? iconAsset;

  const _PrimaryButton({
    required this.onPressed,
    required this.text,
    this.loading = false,
    this.color = _bulkaYellow,
    this.textColor = _textDark,
    this.icon,
    this.iconAsset,
  });

  @override
  Widget build(BuildContext context) {
    return GradientButton(
      onPressed: onPressed,
      loading: loading,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (iconAsset != null) ...[
            Image.asset(
              iconAsset!,
              width: 22,
              height: 22,
              errorBuilder: (_, _, _) => const _WhatsAppVectorIcon(size: 22),
            ),
            const SizedBox(width: 10),
          ] else if (icon != null) ...[
            Icon(icon, size: 24, color: Colors.white),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Text(
              text,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontFamily: _headingFont),
            ),
          ),
        ],
      ),
    );
  }
}

class _WhatsAppVectorIcon extends StatelessWidget {
  final double size;

  const _WhatsAppVectorIcon({this.size = 22});

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: Size(size, size),
      painter: _WhatsAppVectorPainter(),
    );
  }
}

class _WhatsAppVectorPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final double w = size.width;
    final double h = size.height;

    final Paint greenPaint = Paint()
      ..color = const Color(0xFF25D366)
      ..style = PaintingStyle.fill;

    final Path bubblePath = Path();
    bubblePath.addOval(
      Rect.fromCircle(center: Offset(w * 0.52, h * 0.46), radius: w * 0.44),
    );

    final Path tailPath = Path()
      ..moveTo(w * 0.22, h * 0.77)
      ..lineTo(w * 0.08, h * 0.92)
      ..lineTo(w * 0.28, h * 0.85)
      ..close();

    final Path fullBubble = Path.combine(
      PathOperation.union,
      bubblePath,
      tailPath,
    );
    canvas.drawPath(fullBubble, greenPaint);

    final Paint whitePaint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = w * 0.12
      ..strokeCap = StrokeCap.round;

    final Path handsetPath = Path()
      ..moveTo(w * 0.35, h * 0.35)
      ..quadraticBezierTo(w * 0.32, h * 0.45, w * 0.42, h * 0.55)
      ..quadraticBezierTo(w * 0.52, h * 0.65, w * 0.63, h * 0.62);

    canvas.drawPath(handsetPath, whitePaint);

    final Paint whiteFill = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.fill;

    canvas.drawCircle(Offset(w * 0.35, h * 0.35), w * 0.08, whiteFill);
    canvas.drawCircle(Offset(w * 0.63, h * 0.62), w * 0.08, whiteFill);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
