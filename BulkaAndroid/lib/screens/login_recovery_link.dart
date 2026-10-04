part of '../main.dart';

extension _LoginRecoveryLink on _LoginScreenState {
  static const _retryKey = 'password_reset_retry_until_v1';

  int get _recoveryRetrySeconds {
    final deadline = _recoveryRetryUntil[_fullPhone];
    if (deadline == null) return 0;
    final millis =
        deadline - widget.passwordResetClock().millisecondsSinceEpoch;
    return ((millis + 999) ~/ 1000).clamp(0, 86400);
  }

  String get _recoveryRetryLabel {
    final seconds = _recoveryRetrySeconds;
    if (seconds <= 60) {
      return 'otp_resend_countdown'.trArgs({'seconds': seconds});
    }
    final minutes = (seconds + 59) ~/ 60;
    return minutes >= 60
        ? 'auth_recovery_retry_hours'.trArgs({
            'hours': minutes ~/ 60,
            'minutes': minutes % 60,
          })
        : 'auth_recovery_retry_minutes'.trArgs({'minutes': minutes});
  }

  Map<String, int> _readRecoveryRetry(SharedPreferences prefs) {
    final raw = prefs.getString(_retryKey);
    if (raw == null) return {};
    final now = widget.passwordResetClock().millisecondsSinceEpoch;
    final stored = _asMap(jsonDecode(raw));
    return {
      for (final entry in stored.entries)
        if (RegExp(r'^\+7\d{10}$').hasMatch(entry.key) &&
            entry.value is num &&
            (entry.value as num).isFinite &&
            (entry.value as num) > now)
          entry.key: (entry.value as num).toInt(),
    };
  }

  Future<void> _restoreRecoveryRetry() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (!mounted) return;
      for (final entry in _readRecoveryRetry(prefs).entries) {
        _recoveryRetryUntil[entry.key] = max(
          _recoveryRetryUntil[entry.key] ?? 0,
          entry.value,
        );
      }
    } catch (_) {
      // The server still enforces the limit when local storage is unavailable.
    } finally {
      if (mounted) {
        _update(() => _recoveryRetryLoaded = true);
        _syncRecoveryRetry();
      }
    }
  }

  void _rememberRecoveryRetry(String phone, int seconds) {
    if (seconds <= 0) return;
    final deadline = widget
        .passwordResetClock()
        .add(Duration(seconds: seconds.clamp(1, 86400)))
        .millisecondsSinceEpoch;
    _recoveryRetryUntil[phone] = max(_recoveryRetryUntil[phone] ?? 0, deadline);
    unawaited(_persistRecoveryRetry());
    _syncRecoveryRetry();
  }

  Future<void> _persistRecoveryRetry() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      Map<String, int> saved;
      try {
        saved = _readRecoveryRetry(prefs);
      } catch (_) {
        saved = {};
      }
      final now = widget.passwordResetClock().millisecondsSinceEpoch;
      for (final entry in _recoveryRetryUntil.entries) {
        if (entry.value > now) {
          saved[entry.key] = max(saved[entry.key] ?? 0, entry.value);
        }
      }
      await prefs.setString(_retryKey, jsonEncode(saved));
    } catch (_) {
      // Retain the server deadline in memory if persistence temporarily fails.
    }
  }

  void _syncRecoveryRetry() {
    _recoveryRetryTimer?.cancel();
    if (!mounted || _flow != _CustomerAuthFlow.passwordReset) return;
    final seconds = _recoveryRetrySeconds;
    if (seconds == 0) return;
    final nextTick = seconds > 60 ? (seconds - 1) % 60 + 1 : 1;
    _recoveryRetryTimer = Timer(Duration(seconds: nextTick), () {
      if (!mounted) return;
      _update(() {});
      _syncRecoveryRetry();
    });
  }

  Future<void> _requestRecoveryLink() async {
    if (_loading ||
        !_recoveryRetryLoaded ||
        _recoveryRetrySeconds > 0 ||
        _phoneController.text.length != 10) {
      return;
    }
    final revision = ++_authRequestRevision;
    final phone = _fullPhone;
    _update(() {
      _loading = true;
      _error = null;
    });
    OtpRequestResult result;
    try {
      result = await widget.onStartPasswordReset(phone, _newRequestToken());
    } catch (error) {
      final limited =
          error is ApiException &&
          error.statusCode == 429 &&
          error.code == 'PASSWORD_RESET_RATE_LIMITED';
      result = OtpRequestResult(
        error: limited
            ? 'auth_recovery_limit'.tr
            : localizeErrorMessage(error, fallbackKey: 'error_recovery_link'),
        errorCode: limited ? error.code : null,
        retryAfterSeconds: limited ? error.retryAfterSeconds ?? 0 : 0,
      );
    }
    final accepted = result.isSuccess && result.isSmsLink;
    if (accepted || result.isPasswordResetRateLimited) {
      _rememberRecoveryRetry(phone, result.retryAfterSeconds);
    }
    if (!mounted ||
        revision != _authRequestRevision ||
        _flow != _CustomerAuthFlow.passwordReset) {
      return;
    }
    _update(() {
      _loading = false;
      _error = accepted
          ? null
          : result.isPasswordResetRateLimited
          ? 'auth_recovery_limit'.tr
          : result.error ?? 'error_recovery_link'.tr;
      if (accepted) _recoveryLinkSent = true;
    });
  }

  List<Widget> _recoveryLinkStep(BuildContext context) => [
    _AuthStepHeader(
      step: 'auth_recovery_badge'.tr,
      title: 'auth_recovery_link_title'.tr,
      subtitle: 'auth_recovery_link_sent'.tr,
    ),
    const SizedBox(height: 20),
    Text(
      '+7 ${_phoneController.text}',
      style: TextStyle(
        fontFamily: _headingFont,
        color: Theme.of(context).colorScheme.onSurface,
        fontSize: BulkaTypeScale.body,
        fontWeight: FontWeight.w700,
      ),
    ),
    const SizedBox(height: 12),
    Text(
      'auth_recovery_link_expiry'.tr,
      style: TextStyle(
        color: context.bulkaColors.mutedText,
        fontSize: BulkaTypeScale.bodySmall,
        height: 1.4,
      ),
    ),
    if (_error != null) ...[
      const SizedBox(height: 14),
      _InlineAlert(message: _error!, icon: Icons.info_outline_rounded),
    ],
    const SizedBox(height: 22),
    TextButton(
      key: const ValueKey('recovery-link-resend-button'),
      onPressed: _loading || !_recoveryRetryLoaded || _recoveryRetrySeconds > 0
          ? null
          : _requestRecoveryLink,
      child: Text(
        _recoveryRetrySeconds > 0
            ? _recoveryRetryLabel
            : 'auth_recovery_link_resend'.tr,
        textAlign: TextAlign.center,
      ),
    ),
    TextButton(
      key: const ValueKey('recovery-link-change-phone'),
      onPressed: _changeOtpPhone,
      child: Text('change_phone_btn'.tr),
    ),
    TextButton(
      key: const ValueKey('recovery-link-back'),
      onPressed: () => _selectFlow(_CustomerAuthFlow.login),
      child: Text('auth_back_to_login'.tr),
    ),
  ];
}
