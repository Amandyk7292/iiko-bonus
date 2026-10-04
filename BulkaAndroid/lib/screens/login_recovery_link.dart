part of '../main.dart';

extension _LoginRecoveryLink on _LoginScreenState {
  Future<void> _requestRecoveryLink() async {
    if (_loading || _phoneController.text.length != 10) return;
    final revision = ++_authRequestRevision;
    final phone = _fullPhone;
    _update(() {
      _loading = true;
      _error = null;
    });
    final result = await widget.onStartPasswordReset(phone, _newRequestToken());
    if (!mounted ||
        revision != _authRequestRevision ||
        _flow != _CustomerAuthFlow.passwordReset) {
      return;
    }
    final accepted = result.isSuccess && result.isSmsLink;
    _update(() {
      _loading = false;
      _error = accepted ? null : result.error ?? 'error_recovery_link'.tr;
      if (accepted) _recoveryLinkSent = true;
    });
    if (accepted) _scheduleOtpRetry(result.retryAfterSeconds);
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
      onPressed: _loading || _otpRetrySeconds > 0 ? null : _requestRecoveryLink,
      child: Text(
        _otpRetrySeconds > 0
            ? 'otp_resend_countdown'.trArgs({'seconds': '$_otpRetrySeconds'})
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
