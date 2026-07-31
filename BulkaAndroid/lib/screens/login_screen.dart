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
  bool _passwordVisible = false;
  bool _confirmPasswordVisible = false;
  String? _error;
  String? _selectedGender;
  String? _birthdate;
  bool _termsAccepted = false;
  String? _otpDeliveryPhone;
  bool _otpDeliveryHasLink = false;
  Uri? _otpWhatsappUri;

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

  String _newRequestToken() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    final rng = Random.secure();
    return List.generate(16, (_) => chars[rng.nextInt(chars.length)]).join();
  }

  String? _passwordValidationError({bool confirm = false}) {
    final password = _passwordController.text;
    if (password.length < 8 ||
        !RegExp(r'[\p{L}]', unicode: true).hasMatch(password) ||
        !RegExp(r'[0-9]').hasMatch(password)) {
      return 'auth_password_rules'.tr;
    }
    if (utf8.encode(password).length > 72) return 'auth_password_too_long'.tr;
    if (confirm && password != _confirmPasswordController.text) {
      return 'auth_passwords_mismatch'.tr;
    }
    return null;
  }

  Future<void> _login() async {
    if (_phoneController.text.length != 10 || _loading) return;
    if (_passwordController.text.isEmpty) {
      setState(() => _error = 'auth_password_required'.tr);
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    final error = await widget.onLogin(_fullPhone, _passwordController.text);
    if (!mounted) return;
    setState(() {
      _loading = false;
      _error = error;
    });
  }

  Future<void> _startWhatsAppConfirmation() async {
    if (_phoneController.text.length != 10 || _loading) return;
    if (_flow == _CustomerAuthFlow.registration) {
      final passwordError = _passwordValidationError(confirm: true);
      if (passwordError != null) {
        setState(() => _error = passwordError);
        return;
      }
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    final token = _newRequestToken();

    // Bypass popup blockers on Web by opening the URL synchronously
    // before the async API request. The backend uses the same token.
    if (kIsWeb) {
      final waUri = Uri.parse(
        'https://wa.me/77008317499?text=%D0%BA%D0%BE%D0%B4%20$token',
      );
      launchUrl(waUri, mode: LaunchMode.externalApplication).ignore();
    }

    final result = _flow == _CustomerAuthFlow.registration
        ? await widget.onStartRegistration(
            _fullPhone,
            _passwordController.text,
            token,
          )
        : await widget.onStartPasswordReset(_fullPhone, token);
    if (!mounted) return;
    setState(() => _loading = false);
    if (result.isSuccess) {
      final phoneHint = result.whatsappPhone?.trim();
      setState(() {
        _otpStep = true;
        _otpController.clear();
        _otpDeliveryPhone = phoneHint;
        _otpDeliveryHasLink = false;
        _otpWhatsappUri = null;
      });
      final rawUrl = result.whatsappUrl?.trim();
      final uri = rawUrl == null || rawUrl.isEmpty
          ? null
          : Uri.tryParse(rawUrl);
      if (uri != null && uri.hasScheme && mounted) {
        setState(() {
          _otpDeliveryHasLink = true;
          _otpWhatsappUri = uri;
        });
        if (!kIsWeb) {
          _openExternalUrl(context, uri, 'error_open_whatsapp'.tr).ignore();
        }
      }
    } else {
      setState(() => _error = result.error ?? 'error_send_code'.tr);
    }
  }

  Future<void> _verifyRegistration() async {
    if (_otpController.text.length != 4 || _loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    final error = await widget.onVerifyRegistration(
      _fullPhone,
      _otpController.text,
    );
    if (!mounted) return;
    if (error == null) {
      setState(() {
        _loading = false;
        _error = null;
        _registerStep = true;
      });
      return;
    }
    setState(() {
      _loading = false;
      _error = error;
    });
  }

  Future<void> _completePasswordReset() async {
    if (_otpController.text.length != 4 || _loading) return;
    final passwordError = _passwordValidationError(confirm: true);
    if (passwordError != null) {
      setState(() => _error = passwordError);
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    final error = await widget.onResetPassword(
      _fullPhone,
      _otpController.text,
      _passwordController.text,
    );
    if (!mounted) return;
    setState(() {
      _loading = false;
      _error = error;
    });
  }

  void _selectFlow(_CustomerAuthFlow flow) {
    setState(() {
      _flow = flow;
      _otpStep = false;
      _registerStep = false;
      _loading = false;
      _error = null;
      _otpController.clear();
      _passwordController.clear();
      _confirmPasswordController.clear();
      _otpWhatsappUri = null;
      _otpDeliveryPhone = null;
      _otpDeliveryHasLink = false;
    });
  }

  Future<void> _submitRegister() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'reg_err_name'.tr);
      return;
    }
    if (!_termsAccepted) {
      setState(() => _error = 'reg_err_terms'.tr);
      return;
    }
    final email = _emailController.text.trim();
    if (email.isNotEmpty &&
        !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) {
      setState(() => _error = 'invalid_email'.tr);
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });

    final registerFn = widget.onRegister;
    String? error;
    if (registerFn != null) {
      error = await registerFn(
        phone: _fullPhone,
        name: name,
        surname: _surnameController.text.trim(),
        gender: _selectedGender,
        birthdate: _birthdateForApi,
        email: email.isEmpty ? null : email,
      );
    } else {
      error = 'registration_unavailable'.tr;
    }

    if (!mounted) return;
    setState(() {
      _loading = false;
      _error = error;
    });
  }

  String? get _birthdateForApi {
    final value = _birthdate;
    if (value == null || value.isEmpty) return null;
    final parts = value.split('.');
    if (parts.length != 3) return value;
    return '${parts[2]}-${parts[1]}-${parts[0]}';
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
                  padding: const EdgeInsets.fromLTRB(20, 48, 20, 32),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 460),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const _BrandHeader(),
                        const SizedBox(height: 28),
                        _AuthCard(
                          child: BulkaMotionSwitcher(
                            duration: BulkaMotion.standard,
                            offset: const Offset(0.035, 0),
                            scale: 0.995,
                            child: _otpStep
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
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              Positioned(top: 12, left: 16, child: _buildLanguageBadge()),
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

  Widget _buildRegistrationScreen(BuildContext context) {
    final sideWidth = widget.onClose == null ? 88.0 : 140.0;
    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.surface,
      appBar: AppBar(
        toolbarHeight: BulkaLayout.appBarHeight(context),
        backgroundColor: Theme.of(context).colorScheme.surface,
        elevation: 0,
        leadingWidth: sideWidth,
        leading: Align(
          alignment: Alignment.centerLeft,
          child: IconButton(
            icon: Icon(
              Icons.arrow_back_ios_new_rounded,
              color: context.bulkaColors.brandBrown,
            ),
            onPressed: () {
              setState(() {
                _registerStep = false;
                _error = null;
              });
            },
            tooltip: 'back_tooltip'.tr,
          ),
        ),
        title: _BulkaPageTitle(
          'reg_title'.tr,
          color: Theme.of(context).colorScheme.onSurface,
        ),
        centerTitle: true,
        actions: [
          SizedBox(
            width: sideWidth,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                _buildLanguageBadge(),
                if (widget.onClose != null)
                  IconButton(
                    onPressed: widget.onClose,
                    tooltip: 'close_tooltip'.tr,
                    icon: const Icon(Icons.close_rounded),
                  ),
              ],
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 8),
                Center(
                  child: Container(
                    width: 96,
                    height: 96,
                    decoration: BoxDecoration(
                      color: const Color(0xFFFAF6F2),
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: const Color(0xFFDEC588),
                        width: 2,
                      ),
                    ),
                    padding: const EdgeInsets.all(12),
                    child: Image.asset('assets/brand/bulka_logo.png'),
                  ),
                ),
                const SizedBox(height: 24),
                Text(
                  'reg_gender_label'.tr,
                  style: TextStyle(
                    fontFamily: _headingFont,
                    color: Theme.of(context).colorScheme.onSurface,
                    fontSize: BulkaTypeScale.body,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(child: _buildGenderOption('m', 'reg_male'.tr)),
                    const SizedBox(width: 16),
                    Expanded(child: _buildGenderOption('f', 'reg_female'.tr)),
                  ],
                ),
                const SizedBox(height: 16),
                LayoutBuilder(
                  builder: (context, constraints) {
                    final textScale = MediaQuery.textScalerOf(context).scale(1);
                    final stackFields =
                        constraints.maxWidth < 360 || textScale > 1.2;
                    final nameField = _buildRegTextField(
                      controller: _nameController,
                      label: 'reg_name_hint'.tr,
                      errorText: _error == 'reg_err_name'.tr ? _error : null,
                      autofillHints: const [AutofillHints.givenName],
                      textInputAction: TextInputAction.next,
                    );
                    final surnameField = _buildRegTextField(
                      controller: _surnameController,
                      label: 'reg_surname_hint'.tr,
                      autofillHints: const [AutofillHints.familyName],
                      textInputAction: TextInputAction.next,
                    );
                    if (stackFields) {
                      return Column(
                        children: [
                          nameField,
                          const SizedBox(height: 12),
                          surnameField,
                        ],
                      );
                    }
                    return Row(
                      children: [
                        Expanded(child: nameField),
                        const SizedBox(width: 12),
                        Expanded(child: surnameField),
                      ],
                    );
                  },
                ),
                const SizedBox(height: 12),
                _buildDateField(context),
                const SizedBox(height: 12),
                _buildRegTextField(
                  controller: _emailController,
                  label: 'reg_email_hint'.tr,
                  helperText: 'reg_email_helper'.tr,
                  errorText: _error == 'invalid_email'.tr ? _error : null,
                  keyboardType: TextInputType.emailAddress,
                  autofillHints: const [AutofillHints.email],
                  textInputAction: TextInputAction.next,
                ),
                const SizedBox(height: 12),
                _buildReadOnlyPhoneField(),
                const SizedBox(height: 20),
                CheckboxListTile(
                  value: _termsAccepted,
                  onChanged: (value) {
                    setState(() => _termsAccepted = value ?? false);
                  },
                  title: Text(
                    'reg_terms_checkbox'.tr,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.onSurface,
                      fontSize: BulkaTypeScale.bodySmall,
                      height: 1.3,
                    ),
                  ),
                  controlAffinity: ListTileControlAffinity.leading,
                  contentPadding: EdgeInsets.zero,
                  visualDensity: VisualDensity.compact,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(BulkaRadii.control),
                  ),
                ),
                Wrap(
                  alignment: WrapAlignment.center,
                  spacing: 4,
                  children: [
                    TextButton(
                      onPressed: () => launchUrl(
                        bulkaLegalPageUri('public-offer'),
                        mode: LaunchMode.platformDefault,
                      ),
                      child: Text('legal_public_offer'.tr),
                    ),
                    TextButton(
                      onPressed: () => launchUrl(
                        bulkaLegalPageUri('terms'),
                        mode: LaunchMode.platformDefault,
                      ),
                      child: Text('legal_terms'.tr),
                    ),
                    TextButton(
                      onPressed: () => launchUrl(
                        bulkaLegalPageUri('privacy'),
                        mode: LaunchMode.platformDefault,
                      ),
                      child: Text('legal_privacy'.tr),
                    ),
                  ],
                ),
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 10,
                    ),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF0F0),
                      borderRadius: BorderRadius.circular(BulkaRadii.control),
                      border: Border.all(
                        color: Colors.redAccent.withValues(alpha: 0.4),
                      ),
                    ),
                    child: Text(
                      _error!,
                      style: const TextStyle(
                        color: Colors.redAccent,
                        fontSize: BulkaTypeScale.bodySmall,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 28),
                ElevatedButton(
                  onPressed: _loading ? null : _submitRegister,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFDEC588),
                    foregroundColor: const Color(0xFF6D3317),
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(BulkaRadii.card),
                    ),
                    elevation: 0,
                  ),
                  child: _loading
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.5,
                            color: Color(0xFF6D3317),
                          ),
                        )
                      : Text(
                          'reg_next_btn'.tr,
                          style: const TextStyle(
                            fontFamily: _headingFont,
                            color: _textDark,
                            fontSize: BulkaTypeScale.body,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildGenderOption(String value, String label) {
    final selected = _selectedGender == value;
    final colors = context.bulkaColors;
    return Semantics(
      button: true,
      selected: selected,
      inMutuallyExclusiveGroup: true,
      label: label,
      child: Material(
        color: selected ? colors.surfaceCream : Colors.transparent,
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        child: InkWell(
          onTap: () => setState(() => _selectedGender = value),
          borderRadius: BorderRadius.circular(BulkaRadii.control),
          child: Container(
            constraints: const BoxConstraints(minHeight: 48),
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Row(
              children: [
                Icon(
                  selected
                      ? Icons.radio_button_checked_rounded
                      : Icons.radio_button_unchecked_rounded,
                  color: colors.brandBrown,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    label,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.onSurface,
                      fontSize: BulkaTypeScale.bodySmall,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildRegTextField({
    required TextEditingController controller,
    required String label,
    String? helperText,
    String? errorText,
    TextInputType? keyboardType,
    Iterable<String>? autofillHints,
    TextInputAction? textInputAction,
  }) {
    return TextField(
      controller: controller,
      keyboardType: keyboardType,
      autofillHints: autofillHints,
      textInputAction: textInputAction,
      autocorrect: keyboardType != TextInputType.emailAddress,
      style: TextStyle(
        color: Theme.of(context).colorScheme.onSurface,
        fontSize: BulkaTypeScale.body,
      ),
      decoration: InputDecoration(
        labelText: label,
        helperText: helperText,
        errorText: errorText,
      ),
    );
  }

  Widget _buildDateField(BuildContext context) {
    return TextFormField(
      initialValue: _birthdate,
      keyboardType: TextInputType.number,
      inputFormatters: [
        TextInputFormatter.withFunction((oldValue, newValue) {
          var text = newValue.text.replaceAll(RegExp(r'[^0-9]'), '');
          if (text.length > 8) text = text.substring(0, 8);
          var formatted = '';
          for (int i = 0; i < text.length; i++) {
            if (i == 2 || i == 4) formatted += '.';
            formatted += text[i];
          }
          return TextEditingValue(
            text: formatted,
            selection: TextSelection.collapsed(offset: formatted.length),
          );
        }),
      ],
      onChanged: (val) => setState(() => _birthdate = val),
      style: TextStyle(
        color: Theme.of(context).colorScheme.onSurface,
        fontSize: BulkaTypeScale.body,
      ),
      decoration: InputDecoration(
        labelText: 'reg_dob_hint'.tr,
        helperText: 'birthdate_example'.tr,
        suffixIcon: const Icon(Icons.calendar_today_rounded, size: 20),
      ),
    );
  }

  Widget _buildReadOnlyPhoneField() {
    final phoneText = _fullPhone;
    return Semantics(
      readOnly: true,
      textField: true,
      label: 'reg_phone_label'.tr,
      value: phoneText,
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: 'reg_phone_label'.tr,
          helperText: 'reg_phone_helper'.tr,
          suffixIcon: const Icon(Icons.lock_outline_rounded, size: 20),
        ),
        child: Text(
          phoneText,
          style: TextStyle(
            color: Theme.of(context).colorScheme.onSurface,
            fontSize: BulkaTypeScale.body,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }

  Widget _buildLanguageBadge() {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    return Tooltip(
      message: 'language_tooltip'.tr,
      child: InkWell(
        onTap: _showLanguageBottomSheet,
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            color: scheme.surface,
            borderRadius: BorderRadius.circular(BulkaRadii.control),
            border: Border.all(color: colors.cardBorder),
            boxShadow: const [
              BoxShadow(
                color: Color(0x0A000000),
                blurRadius: 8,
                offset: Offset(0, 2),
              ),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.language_rounded, color: colors.brandBrown, size: 18),
              const SizedBox(width: 6),
              Text(
                _langCode,
                style: TextStyle(
                  fontFamily: _headingFont,
                  color: colors.brandBrown,
                  fontSize: BulkaTypeScale.bodySmall,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _phoneStep(BuildContext context) {
    final isLogin = _flow == _CustomerAuthFlow.login;
    final isRegistration = _flow == _CustomerAuthFlow.registration;
    return [
      _AuthStepHeader(
        step: isLogin
            ? 'auth_login_badge'.tr
            : isRegistration
            ? 'auth_registration_badge'.tr
            : 'auth_recovery_badge'.tr,
        title: isLogin
            ? 'auth_login_title'.tr
            : isRegistration
            ? 'auth_registration_title'.tr
            : 'auth_recovery_title'.tr,
        subtitle: isLogin
            ? 'auth_login_subtitle'.tr
            : isRegistration
            ? 'auth_registration_subtitle'.tr
            : 'auth_recovery_subtitle'.tr,
      ),
      const SizedBox(height: 22),
      TextField(
        key: const ValueKey('auth-phone-field'),
        controller: _phoneController,
        keyboardType: TextInputType.phone,
        autofillHints: const [AutofillHints.telephoneNumberNational],
        maxLength: 10,
        textInputAction: _flow == _CustomerAuthFlow.passwordReset
            ? TextInputAction.done
            : TextInputAction.next,
        style: TextStyle(
          fontFamily: _headingFont,
          color: Theme.of(context).colorScheme.onSurface,
          fontSize: BulkaTypeScale.titleSmall,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.5,
          height: 1.25,
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
          context: context,
          label: 'phone_label'.tr,
          prefix: '+7 ',
          error: _error,
          icon: Icons.phone_rounded,
        ),
      ),
      if (_flow != _CustomerAuthFlow.passwordReset) ...[
        const SizedBox(height: 14),
        _buildPasswordField(
          controller: _passwordController,
          label: 'auth_password_label'.tr,
          confirm: false,
          newPassword: isRegistration,
        ),
      ],
      if (isRegistration) ...[
        const SizedBox(height: 14),
        _buildPasswordField(
          controller: _confirmPasswordController,
          label: 'auth_password_confirm'.tr,
          confirm: true,
          newPassword: true,
        ),
        const SizedBox(height: 8),
        Text(
          'auth_password_rules'.tr,
          style: TextStyle(
            color: context.bulkaColors.mutedText,
            fontSize: BulkaTypeScale.caption,
            height: 1.35,
          ),
        ),
      ],
      if (_error != null) ...[
        const SizedBox(height: 10),
        _InlineAlert(message: _error!, icon: Icons.info_rounded),
      ],
      const SizedBox(height: 26),
      _PrimaryButton(
        text: isLogin
            ? 'auth_login_button'.tr
            : isRegistration
            ? 'auth_confirm_whatsapp'.tr
            : 'auth_recovery_button'.tr,
        iconAsset: isLogin ? null : 'assets/brand/whatsapp.png',
        icon: isLogin ? Icons.login_rounded : null,
        loading: _loading,
        onPressed: _phoneController.text.length == 10
            ? isLogin
                  ? _login
                  : _startWhatsAppConfirmation
            : null,
      ),
      const SizedBox(height: 10),
      if (isLogin) ...[
        TextButton(
          key: const ValueKey('forgot-password-button'),
          onPressed: () => _selectFlow(_CustomerAuthFlow.passwordReset),
          child: Text('auth_forgot_password'.tr),
        ),
        Row(
          children: [
            const Expanded(child: Divider()),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Text(
                'auth_or'.tr,
                style: TextStyle(
                  color: context.bulkaColors.mutedText,
                  fontSize: BulkaTypeScale.caption,
                ),
              ),
            ),
            const Expanded(child: Divider()),
          ],
        ),
        const SizedBox(height: 10),
        OutlinedButton(
          key: const ValueKey('create-account-button'),
          onPressed: () => _selectFlow(_CustomerAuthFlow.registration),
          child: Text('auth_create_account'.tr),
        ),
        AdminPortalLoginButton(enabled: !_loading),
      ] else ...[
        TextButton.icon(
          onPressed: () => _selectFlow(_CustomerAuthFlow.login),
          icon: const Icon(Icons.arrow_back_rounded, size: 18),
          label: Text('auth_back_to_login'.tr),
        ),
      ],
    ];
  }

  Widget _buildPasswordField({
    required TextEditingController controller,
    required String label,
    required bool confirm,
    required bool newPassword,
  }) {
    final visible = confirm ? _confirmPasswordVisible : _passwordVisible;
    return TextField(
      key: ValueKey(
        confirm ? 'auth-confirm-password-field' : 'auth-password-field',
      ),
      controller: controller,
      obscureText: !visible,
      enableSuggestions: false,
      autocorrect: false,
      autofillHints: [
        newPassword ? AutofillHints.newPassword : AutofillHints.password,
      ],
      textInputAction: confirm ? TextInputAction.done : TextInputAction.next,
      onChanged: (_) => setState(() => _error = null),
      onSubmitted: (_) {
        if (_flow == _CustomerAuthFlow.login) _login();
        if (_flow == _CustomerAuthFlow.registration && confirm) {
          _startWhatsAppConfirmation();
        }
      },
      decoration:
          _inputDecoration(
            context: context,
            label: label,
            error: _error,
            icon: Icons.lock_outline_rounded,
          ).copyWith(
            suffixIcon: IconButton(
              tooltip: visible
                  ? 'auth_hide_password'.tr
                  : 'auth_show_password'.tr,
              onPressed: () {
                setState(() {
                  if (confirm) {
                    _confirmPasswordVisible = !visible;
                  } else {
                    _passwordVisible = !visible;
                  }
                });
              },
              icon: Icon(
                visible
                    ? Icons.visibility_off_rounded
                    : Icons.visibility_rounded,
              ),
            ),
          ),
    );
  }

  List<Widget> _otpCodeStep(BuildContext context) {
    final phone = '+7 ${_phoneController.text}';
    final isRegistration = _flow == _CustomerAuthFlow.registration;
    return [
      _AuthStepHeader(
        step: isRegistration
            ? 'auth_registration_verify_badge'.tr
            : 'auth_recovery_verify_badge'.tr,
        title: isRegistration
            ? 'auth_registration_verify_title'.tr
            : 'auth_recovery_verify_title'.tr,
        subtitle: _otpDeliveryHasLink
            ? 'code_sent_whatsapp'.tr
            : (_otpDeliveryPhone ?? '').isNotEmpty
            ? 'whatsapp_phone_instruction'.trArgs({'phone': _otpDeliveryPhone})
            : 'whatsapp_fallback_instruction'.tr,
      ),
      if (_otpWhatsappUri != null) ...[
        const SizedBox(height: 4),
        TextButton.icon(
          onPressed: () => _openExternalUrl(
            context,
            _otpWhatsappUri!,
            'error_open_whatsapp'.tr,
          ),
          icon: const Icon(Icons.open_in_new_rounded, size: 18),
          label: Text('open_whatsapp'.tr),
        ),
      ],
      const SizedBox(height: 18),
      Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: _almond.withValues(alpha: 0.28),
          borderRadius: BorderRadius.circular(BulkaRadii.control),
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
                    '${'code_for'.tr}$phone',
                    style: TextStyle(
                      fontFamily: _headingFont,
                      color: Theme.of(context).colorScheme.onSurface,
                      fontSize: BulkaTypeScale.body,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'enter_4_digits'.tr,
                    style: TextStyle(
                      color: context.bulkaColors.mutedText,
                      fontSize: BulkaTypeScale.bodySmall,
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
        child: LayoutBuilder(
          builder: (context, constraints) {
            const separatorWidth = 8.0;
            final pinSize = ((constraints.maxWidth - separatorWidth * 3) / 4)
                .clamp(44.0, 64.0);
            final pinTextStyle = TextStyle(
              fontFamily: _headingFont,
              fontSize: min(BulkaTypeScale.pageTitle, pinSize * 0.48),
              color: Theme.of(context).colorScheme.onSurface,
              fontWeight: FontWeight.w700,
            );
            return Pinput(
              key: const ValueKey('auth-otp-field'),
              length: 4,
              controller: _otpController,
              separatorBuilder: (_) => const SizedBox(width: separatorWidth),
              hapticFeedbackType: HapticFeedbackType.lightImpact,
              onChanged: (value) {
                setState(() => _error = null);
              },
              onCompleted: (pin) {
                if (pin.length == 4 && isRegistration) {
                  _verifyRegistration();
                }
              },
              defaultPinTheme: PinTheme(
                width: pinSize,
                height: pinSize,
                textStyle: pinTextStyle,
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(BulkaRadii.control),
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
                width: pinSize,
                height: pinSize,
                textStyle: pinTextStyle,
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(BulkaRadii.control),
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
                width: pinSize,
                height: pinSize,
                textStyle: pinTextStyle.copyWith(color: _authErrorRed),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(BulkaRadii.control),
                  border: Border.all(color: _authErrorRed, width: 2),
                ),
              ),
              forceErrorState: _error != null,
            );
          },
        ),
      ),
      const SizedBox(height: 8),
      Text(
        'valid_few_mins'.tr,
        style: TextStyle(
          color: context.bulkaColors.mutedText,
          fontSize: BulkaTypeScale.caption,
        ),
        textAlign: TextAlign.center,
      ),
      if (!isRegistration) ...[
        const SizedBox(height: 20),
        _buildPasswordField(
          controller: _passwordController,
          label: 'auth_new_password'.tr,
          confirm: false,
          newPassword: true,
        ),
        const SizedBox(height: 14),
        _buildPasswordField(
          controller: _confirmPasswordController,
          label: 'auth_password_confirm'.tr,
          confirm: true,
          newPassword: true,
        ),
        const SizedBox(height: 8),
        Text(
          'auth_password_rules'.tr,
          style: TextStyle(
            color: context.bulkaColors.mutedText,
            fontSize: BulkaTypeScale.caption,
            height: 1.35,
          ),
        ),
      ],
      if (_error != null) ...[
        const SizedBox(height: 10),
        _InlineAlert(message: _error!, icon: Icons.error_rounded),
      ],
      const SizedBox(height: 26),
      _PrimaryButton(
        text: isRegistration
            ? 'auth_continue_registration'.tr
            : 'auth_save_new_password'.tr,
        icon: Icons.arrow_forward_rounded,
        loading: _loading,
        onPressed: _otpController.text.length == 4
            ? isRegistration
                  ? _verifyRegistration
                  : _completePasswordReset
            : null,
      ),
      const SizedBox(height: 14),
      TextButton(
        onPressed: () {
          setState(() {
            _otpStep = false;
            _error = null;
            _otpController.clear();
            if (_flow == _CustomerAuthFlow.passwordReset) {
              _passwordController.clear();
              _confirmPasswordController.clear();
            }
          });
        },
        child: Text(
          'change_phone_btn'.tr,
          style: const TextStyle(color: _bulkaBrown),
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
        border: Border.all(color: colors.cardBorder),
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
            borderRadius: BorderRadius.circular(BulkaRadii.pill),
          ),
          child: Text(
            step,
            style: const TextStyle(
              fontFamily: _headingFont,
              color: _sage,
              fontSize: BulkaTypeScale.caption,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        const SizedBox(height: 14),
        Text(
          title,
          style: TextStyle(
            fontFamily: _headingFont,
            color: Theme.of(context).colorScheme.onSurface,
            fontSize: BulkaTypeScale.titleLarge,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          subtitle,
          style: TextStyle(
            color: context.bulkaColors.mutedText,
            fontSize: BulkaTypeScale.body,
            height: 1.45,
          ),
        ),
      ],
    );
  }
}

const _authErrorRed = Color(0xFF982A24);

class _InlineAlert extends StatelessWidget {
  const _InlineAlert({required this.message, required this.icon});

  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      label: message,
      child: ExcludeSemantics(
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: _authErrorRed.withValues(alpha: 0.09),
            borderRadius: BorderRadius.circular(BulkaRadii.control),
            border: Border.all(color: _authErrorRed.withValues(alpha: 0.38)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, color: _authErrorRed, size: 20),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  message,
                  style: const TextStyle(
                    color: _authErrorRed,
                    fontSize: BulkaTypeScale.bodySmall,
                    height: 1.35,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),
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
            child: Text(text, maxLines: 1, overflow: TextOverflow.ellipsis),
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
