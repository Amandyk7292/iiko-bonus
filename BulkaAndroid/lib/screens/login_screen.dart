part of '../main.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({
    required this.onRequestOtp,
    required this.onVerifyOtp,
    this.onRegister,
    super.key,
  });

  final Future<String?> Function(String phone, String token) onRequestOtp;
  final Future<String?> Function(String phone, String code) onVerifyOtp;
  final Future<String?> Function({
    required String phone,
    required String name,
    String? surname,
    String? gender,
    String? birthdate,
    String? email,
  })? onRegister;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phoneController = TextEditingController();
  final _otpController = TextEditingController();
  final _nameController = TextEditingController();
  final _surnameController = TextEditingController();

  bool _otpStep = false;
  bool _registerStep = false;
  bool _loading = false;
  String? _error;
  String _selectedLang = 'Русский';
  String? _selectedGender;
  String? _birthdate;
  bool _termsAccepted = false;

  @override
  void initState() {
    super.initState();
    _selectedLang = AppLang.nameFromCode(AppLang.current);
  }

  String get _langCode {
    return AppLang.shortLabel(AppLang.current);
  }

  void _showLanguageBottomSheet() {
    String tempLang = _selectedLang;

    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            final languages = ['Русский', 'Қазақша', 'English'];

            return Container(
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
              ),
              padding: const EdgeInsets.fromLTRB(24, 20, 24, 32),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const SizedBox(width: 36),
                      Text(
                        'select_lang_title'.tr,
                        style: const TextStyle(
                          color: Color(0xFF231007),
                          fontFamily: _headingFont,
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      InkWell(
                        onTap: () => Navigator.pop(context),
                        borderRadius: BorderRadius.circular(20),
                        child: Container(
                          width: 32,
                          height: 32,
                          decoration: const BoxDecoration(
                            color: Color(0xFFEADBBE),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.close_rounded,
                            color: Colors.white,
                            size: 18,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  ...languages.map((lang) {
                    final isSelected = tempLang == lang;
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: InkWell(
                        onTap: () {
                          setModalState(() {
                            tempLang = lang;
                          });
                        },
                        borderRadius: BorderRadius.circular(16),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 20,
                            vertical: 16,
                          ),
                          decoration: BoxDecoration(
                            color: isSelected
                                ? const Color(0xFFFAFAF7)
                                : Colors.transparent,
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(
                              color: isSelected
                                  ? const Color(0xFF6D3317)
                                  : const Color(0xFFEADBBE),
                              width: isSelected ? 1.5 : 1,
                            ),
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                lang,
                                style: TextStyle(
                                  color: isSelected
                                      ? const Color(0xFF6D3317)
                                      : const Color(0xFF231007),
                                  fontSize: 16,
                                  fontWeight: isSelected
                                      ? FontWeight.w700
                                      : FontWeight.w500,
                                ),
                              ),
                              if (isSelected)
                                const Icon(
                                  Icons.check_circle_rounded,
                                  color: Color(0xFF6D3317),
                                  size: 22,
                                ),
                            ],
                          ),
                        ),
                      ),
                    );
                  }),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: ElevatedButton(
                      onPressed: () async {
                        await AppLang.setLanguage(
                          AppLang.codeFromName(tempLang),
                        );
                        if (!context.mounted) return;
                        setState(() {
                          _selectedLang = tempLang;
                        });
                        Navigator.pop(context);
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFDEC588),
                        foregroundColor: Colors.white,
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(22),
                        ),
                      ),
                      child: Text(
                        'apply_btn'.tr,
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  @override
  void dispose() {
    _phoneController.dispose();
    _otpController.dispose();
    _nameController.dispose();
    _surnameController.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    if (_phoneController.text.length != 10 || _loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    final phone = '7${_phoneController.text}';
    final chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    final rng = Random();
    final token = List.generate(12, (_) => chars[rng.nextInt(chars.length)]).join();
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
    if (error == 'NEW_USER') {
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
    setState(() {
      _loading = true;
      _error = null;
    });

    final registerFn = widget.onRegister;
    String? error;
    if (registerFn != null) {
      error = await registerFn(
        phone: '7${_phoneController.text}',
        name: name,
        surname: _surnameController.text.trim(),
        gender: _selectedGender,
        birthdate: _birthdate,
      );
    }

    if (!mounted) return;
    setState(() {
      _loading = false;
      _error = error;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_registerStep) {
      return _buildRegistrationScreen(context);
    }
    return Scaffold(
      body: DecoratedBox(
        decoration: const BoxDecoration(color: Colors.white),
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
              Positioned(
                top: 12,
                left: 16,
                child: _buildLanguageBadge(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRegistrationScreen(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Color(0xFF6D3317)),
          onPressed: () {
            setState(() {
              _registerStep = false;
              _error = null;
            });
          },
        ),
        title: Text(
          'reg_title'.tr,
          style: const TextStyle(
            color: Color(0xFF6D3317),
            fontSize: 18,
            fontWeight: FontWeight.w700,
          ),
        ),
        centerTitle: true,
        actions: [
          _buildLanguageBadge(),
          const SizedBox(width: 16),
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
                      border: Border.all(color: const Color(0xFFDEC588), width: 2),
                    ),
                    padding: const EdgeInsets.all(12),
                    child: Image.asset('assets/brand/bulka_logo.png'),
                  ),
                ),
                const SizedBox(height: 24),
                Text(
                  'reg_gender_label'.tr,
                  style: const TextStyle(
                    color: Color(0xFF6D3317),
                    fontSize: 15,
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
                Row(
                  children: [
                    Expanded(
                      child: _buildRegTextField(
                        controller: _nameController,
                        hint: 'reg_name_hint'.tr,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _buildRegTextField(
                        controller: _surnameController,
                        hint: 'reg_surname_hint'.tr,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                _buildDateField(context),
                const SizedBox(height: 12),
                _buildReadOnlyPhoneField(),
                const SizedBox(height: 20),
                GestureDetector(
                  onTap: () {
                    setState(() => _termsAccepted = !_termsAccepted);
                  },
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Container(
                        width: 24,
                        height: 24,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: _termsAccepted
                              ? const Color(0xFF6D3317)
                              : const Color(0xFFFAF6F2),
                          border: Border.all(
                            color: const Color(0xFF6D3317),
                            width: 1.5,
                          ),
                        ),
                        child: _termsAccepted
                            ? const Icon(Icons.check, size: 16, color: Colors.white)
                            : null,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'reg_terms_checkbox'.tr,
                          style: const TextStyle(
                            color: Color(0xFF6D3317),
                            fontSize: 13.5,
                            height: 1.3,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF0F0),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.redAccent.withValues(alpha: 0.4)),
                    ),
                    child: Text(
                      _error!,
                      style: const TextStyle(
                        color: Colors.redAccent,
                        fontSize: 13,
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
                      borderRadius: BorderRadius.circular(24),
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
                            color: Colors.white,
                            fontSize: 16,
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
    return GestureDetector(
      onTap: () => setState(() => _selectedGender = value),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 22,
            height: 22,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: selected ? const Color(0xFF6D3317) : const Color(0xFFFAF6F2),
              border: Border.all(color: const Color(0xFF6D3317), width: 1.5),
            ),
            child: selected
                ? Center(
                    child: Container(
                      width: 10,
                      height: 10,
                      decoration: const BoxDecoration(
                        shape: BoxShape.circle,
                        color: Colors.white,
                      ),
                    ),
                  )
                : null,
          ),
          const SizedBox(width: 8),
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFF6D3317),
              fontSize: 14.5,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRegTextField({
    required TextEditingController controller,
    required String hint,
    TextInputType? keyboardType,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFFAF6F2),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFEADBBE)),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: TextField(
        controller: controller,
        keyboardType: keyboardType,
        style: const TextStyle(color: Color(0xFF6D3317), fontSize: 15),
        decoration: InputDecoration(
          border: InputBorder.none,
          hintText: hint,
          hintStyle: TextStyle(
            color: const Color(0xFF6D3317).withValues(alpha: 0.45),
            fontSize: 14.5,
          ),
        ),
      ),
    );
  }

  Widget _buildDateField(BuildContext context) {
    return GestureDetector(
      onTap: () async {
        final picked = await showDatePicker(
          context: context,
          initialDate: DateTime(2000, 1, 1),
          firstDate: DateTime(1930),
          lastDate: DateTime.now(),
          builder: (context, child) {
            return Theme(
              data: Theme.of(context).copyWith(
                colorScheme: const ColorScheme.light(
                  primary: Color(0xFF6D3317),
                  onPrimary: Colors.white,
                  onSurface: Color(0xFF6D3317),
                ),
              ),
              child: child!,
            );
          },
        );
        if (picked != null) {
          final day = picked.day.toString().padLeft(2, '0');
          final month = picked.month.toString().padLeft(2, '0');
          final year = picked.year;
          setState(() {
            _birthdate = '$day.$month.$year';
          });
        }
      },
      child: Container(
        decoration: BoxDecoration(
          color: const Color(0xFFFAF6F2),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFFEADBBE)),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        child: Text(
          _birthdate ?? 'reg_dob_hint'.tr,
          style: TextStyle(
            color: _birthdate != null
                ? const Color(0xFF6D3317)
                : const Color(0xFF6D3317).withValues(alpha: 0.45),
            fontSize: 15,
          ),
        ),
      ),
    );
  }

  Widget _buildReadOnlyPhoneField() {
    final phoneText = _phoneController.text.startsWith('7')
        ? _phoneController.text
        : '7${_phoneController.text}';
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFFAF6F2),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFEADBBE)),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      child: Text(
        phoneText,
        style: const TextStyle(
          color: Color(0xFF6D3317),
          fontSize: 15,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Widget _buildLanguageBadge() {
    return InkWell(
      onTap: _showLanguageBottomSheet,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: const Color(0xFF6D3317).withValues(alpha: 0.25)),
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
            const Icon(
              Icons.language_rounded,
              color: Color(0xFF6D3317),
              size: 18,
            ),
            const SizedBox(width: 6),
            Text(
              _langCode,
              style: const TextStyle(
                color: Color(0xFF6D3317),
                fontSize: 14,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _phoneStep(BuildContext context) {
    return [
      _AuthStepHeader(
        step: 'login_step_1'.tr,
        title: 'login_phone_title'.tr,
        subtitle: 'login_phone_sub'.tr,
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
          label: 'phone_label'.tr,
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
            text: 'open_telegram'.tr,
            icon: Icons.near_me_rounded,
            color: const Color(0xFF2CA5E0),
            textColor: Colors.white,
            onPressed: () => _openTelegram(context),
          ),
        ],
      ],
      const SizedBox(height: 26),
      _PrimaryButton(
        text: 'get_code_whatsapp'.tr,
        iconAsset: 'assets/brand/whatsapp.png',
        loading: _loading,
        onPressed: _phoneController.text.length == 10 ? _sendCode : null,
      ),
    ];
  }

  List<Widget> _otpCodeStep(BuildContext context) {
    final phone = '+7 ${_phoneController.text}';
    return [
      _AuthStepHeader(
        step: 'login_step_2'.tr,
        title: 'confirm_phone_title'.tr,
        subtitle: 'code_sent_whatsapp'.tr,
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
                    '${'code_for'.tr}$phone',
                    style: const TextStyle(
                      color: _textDark,
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'enter_4_digits'.tr,
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
        'valid_few_mins'.tr,
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
        text: 'login_btn'.tr,
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
        Image.asset(
          'assets/brand/bulka_logo.png',
          height: 70,
          fit: BoxFit.contain,
        ),
        const SizedBox(height: 16),
        Text(
          'login_brand_title'.tr,
          textAlign: TextAlign.center,
          style: const TextStyle(
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
              errorBuilder: (_, __, ___) => const _WhatsAppVectorIcon(size: 22),
            ),
            const SizedBox(width: 10),
          ] else if (icon != null) ...[
            Icon(icon, size: 24, color: Colors.white),
            const SizedBox(width: 8),
          ],
          Text(text),
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

    final Path fullBubble =
        Path.combine(PathOperation.union, bubblePath, tailPath);
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
