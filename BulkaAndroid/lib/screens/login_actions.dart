part of '../main.dart';

extension _LoginScreenActions on _LoginScreenState {
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
      _update(() => _error = 'auth_password_required'.tr);
      return;
    }
    _update(() {
      _loading = true;
      _error = null;
    });
    final error = await widget.onLogin(_fullPhone, _passwordController.text);
    if (!mounted) return;
    _update(() {
      _loading = false;
      _error = error;
    });
  }

  Future<void> _startWhatsAppConfirmation() async {
    if (_phoneController.text.length != 10 || _loading) return;
    if (_flow == _CustomerAuthFlow.registration) {
      final passwordError = _passwordValidationError(confirm: true);
      if (passwordError != null) {
        _update(() => _error = passwordError);
        return;
      }
    }
    _update(() {
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
    _update(() => _loading = false);
    if (result.isSuccess) {
      final phoneHint = result.whatsappPhone?.trim();
      _update(() {
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
        _update(() {
          _otpDeliveryHasLink = true;
          _otpWhatsappUri = uri;
        });
        if (!kIsWeb) {
          _openExternalUrl(context, uri, 'error_open_whatsapp'.tr).ignore();
        }
      }
    } else {
      _update(() => _error = result.error ?? 'error_send_code'.tr);
    }
  }

  Future<void> _verifyRegistration() async {
    if (_otpController.text.length != 4 || _loading) return;
    _update(() {
      _loading = true;
      _error = null;
    });
    final error = await widget.onVerifyRegistration(
      _fullPhone,
      _otpController.text,
    );
    if (!mounted) return;
    if (error == null) {
      _update(() {
        _loading = false;
        _error = null;
        _registerStep = true;
      });
      return;
    }
    _update(() {
      _loading = false;
      _error = error;
    });
  }

  Future<void> _completePasswordReset() async {
    if (_otpController.text.length != 4 || _loading) return;
    final passwordError = _passwordValidationError(confirm: true);
    if (passwordError != null) {
      _update(() => _error = passwordError);
      return;
    }
    _update(() {
      _loading = true;
      _error = null;
    });
    final error = await widget.onResetPassword(
      _fullPhone,
      _otpController.text,
      _passwordController.text,
    );
    if (!mounted) return;
    _update(() {
      _loading = false;
      _error = error;
    });
  }

  void _selectFlow(_CustomerAuthFlow flow) {
    _update(() {
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
      _update(() => _error = 'reg_err_name'.tr);
      return;
    }
    if (!_termsAccepted) {
      _update(() => _error = 'reg_err_terms'.tr);
      return;
    }
    final email = _emailController.text.trim();
    if (email.isNotEmpty &&
        !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) {
      _update(() => _error = 'invalid_email'.tr);
      return;
    }
    _update(() {
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
    _update(() {
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
}
