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

  Future<void> _startPhoneConfirmation() async {
    if (_phoneController.text.length != 10 || _loading) return;
    if (_flow == _CustomerAuthFlow.registration) {
      final passwordError = _passwordValidationError(confirm: true);
      if (passwordError != null) {
        _update(() => _error = passwordError);
        return;
      }
    }
    final revision = ++_authRequestRevision;
    final flow = _flow;
    final phone = _fullPhone;
    _update(() {
      _loading = true;
      _error = null;
    });
    final token = _newRequestToken();

    final result = flow == _CustomerAuthFlow.registration
        ? await widget.onStartRegistration(
            phone,
            _passwordController.text,
            token,
          )
        : await widget.onStartPasswordReset(phone, token);
    if (!mounted || revision != _authRequestRevision || flow != _flow) return;
    _update(() => _loading = false);
    if (flow == _CustomerAuthFlow.registration &&
        result.isSuccess &&
        (!result.isAutomatic ||
            result.channel != 'sms' ||
            result.codeLength != 6)) {
      _changeOtpPhone();
      _update(() => _error = 'error_send_code'.tr);
      return;
    }
    if (result.isSuccess) {
      final phoneHint = flow == _CustomerAuthFlow.registration
          ? null
          : result.whatsappPhone?.trim();
      _update(() {
        _otpStep = true;
        _otpController.clear();
        _otpDeliveryPhone = phoneHint;
        _otpDeliveryHasLink = false;
        _otpWhatsappUri = null;
        _otpIsAutomatic = result.isAutomatic;
        _otpChannel = result.channel == 'sms' ? 'sms' : 'whatsapp';
        _otpCodeLength = result.codeLength == 6 ? 6 : 4;
      });
      _scheduleOtpRetry(result.isAutomatic ? result.retryAfterSeconds : 0);
      final rawUrl =
          flow == _CustomerAuthFlow.registration || result.isAutomatic
          ? null
          : result.whatsappUrl?.trim();
      final uri = rawUrl == null || rawUrl.isEmpty
          ? null
          : Uri.tryParse(rawUrl);
      if (uri != null &&
          uri.scheme == 'https' &&
          uri.host == 'wa.me' &&
          mounted) {
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

  void _scheduleOtpRetry(int seconds) {
    _otpRetryTimer?.cancel();
    _update(() => _otpRetrySeconds = seconds.clamp(0, 86400));
    if (_otpRetrySeconds == 0) return;
    _otpRetryTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted || _otpRetrySeconds <= 1) timer.cancel();
      if (mounted) {
        _update(() => _otpRetrySeconds = max(0, _otpRetrySeconds - 1));
      }
    });
  }

  Future<void> _verifyRegistration() async {
    if (_otpController.text.length != _otpCodeLength || _loading) return;
    final revision = ++_authRequestRevision;
    _update(() {
      _loading = true;
      _error = null;
    });
    final error = await widget.onVerifyRegistration(
      _fullPhone,
      _otpController.text,
    );
    if (!mounted || revision != _authRequestRevision) return;
    if (error == null) {
      _otpRetryTimer?.cancel();
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
    if (_otpController.text.length != _otpCodeLength || _loading) return;
    final passwordError = _passwordValidationError(confirm: true);
    if (passwordError != null) {
      _update(() => _error = passwordError);
      return;
    }
    final revision = ++_authRequestRevision;
    _update(() {
      _loading = true;
      _error = null;
    });
    final error = await widget.onResetPassword(
      _fullPhone,
      _otpController.text,
      _passwordController.text,
    );
    if (!mounted || revision != _authRequestRevision) return;
    _update(() {
      _loading = false;
      _error = error;
    });
  }

  Future<void> _submitRegister() async {
    if (_loading || _cashierInviteChecking) return;
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
        cashierInviteToken: _cashierInviteToken,
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
