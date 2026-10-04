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
    this.onChildLogin,
    this.onClose,
    this.onAdminLogin = loginAdminPortal,
    this.onOpenAdminPortal,
    this.onLookupCashierInvite,
    this.onScanCashierInvite,
    this.startRegistration = false,
    super.key,
  });

  final Future<String?> Function(String phone, String password) onLogin;
  final Future<String?> Function(String login, String password)? onChildLogin;
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
    String? cashierInviteToken,
  })?
  onRegister;
  final VoidCallback? onClose;
  final Future<void> Function(String username, String password, String code)
  onAdminLogin;
  final Future<void> Function(BuildContext context)? onOpenAdminPortal;
  final Future<CashierInviteDetails> Function(String token)?
  onLookupCashierInvite;
  final Future<String?> Function()? onScanCashierInvite;
  final bool startRegistration;

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
  int _authRequestRevision = 0;
  bool _adminLogin = false;
  bool _childLogin = false;
  bool _passwordVisible = false;
  bool _confirmPasswordVisible = false;
  String? _error;
  String? _selectedGender;
  String? _birthdate;
  String? _cashierInviteToken;
  bool _cashierInviteChecking = false;
  bool _termsAccepted = false;
  String? _otpDeliveryPhone;
  bool _otpDeliveryHasLink = false;
  Uri? _otpWhatsappUri;
  bool _otpIsAutomatic = false;
  String _otpChannel = 'whatsapp';
  int _otpCodeLength = 4;
  int _otpRetrySeconds = 0;
  Timer? _otpRetryTimer;

  @override
  void initState() {
    super.initState();
    if (widget.startRegistration) _flow = _CustomerAuthFlow.registration;
  }

  void _update(VoidCallback callback) {
    final previousError = _error;
    setState(callback);
    if (_error != null && _error != previousError) {
      unawaited(BulkaMotion.error());
    }
  }

  void _selectFlow(_CustomerAuthFlow flow) {
    _authRequestRevision++;
    _otpRetryTimer?.cancel();
    _update(() {
      _flow = flow;
      _otpStep = false;
      _registerStep = false;
      _cashierInviteToken = null;
      _cashierInviteChecking = false;
      _loading = false;
      _error = null;
      _otpController.clear();
      _passwordController.clear();
      _confirmPasswordController.clear();
      _otpWhatsappUri = null;
      _otpDeliveryPhone = null;
      _otpDeliveryHasLink = false;
      _otpIsAutomatic = false;
      _otpCodeLength = 4;
      _otpRetrySeconds = 0;
    });
  }

  void _changeOtpPhone() {
    _authRequestRevision++;
    _otpRetryTimer?.cancel();
    _update(() {
      _loading = false;
      _otpStep = false;
      _otpRetrySeconds = 0;
      _error = null;
      _otpController.clear();
      if (_flow == _CustomerAuthFlow.passwordReset) {
        _passwordController.clear();
        _confirmPasswordController.clear();
      }
    });
  }

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
    _otpRetryTimer?.cancel();
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
    if (_childLogin && widget.onChildLogin != null) {
      return FamilyChildLoginScreen(
        onLogin: widget.onChildLogin!,
        onBack: () => setState(() => _childLogin = false),
        onClose: widget.onClose,
      );
    }
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
          Flexible(
            child: Text(
              text,
              textAlign: TextAlign.center,
              style: const TextStyle(fontFamily: _headingFont),
            ),
          ),
        ],
      ),
    );
  }
}
