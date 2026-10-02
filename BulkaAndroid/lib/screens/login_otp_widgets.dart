part of '../main.dart';

extension _LoginOtpWidgets on _LoginScreenState {
  List<Widget> _otpCodeStep(BuildContext context) {
    final phone = '+7 ${_phoneController.text}';
    final isRegistration = _flow == _CustomerAuthFlow.registration;
    return [
      _AuthStepHeader(
        step: isRegistration
            ? 'auth_registration_verify_badge'.tr
            : 'auth_recovery_verify_badge'.tr,
        title: _otpIsAutomatic
            ? 'auth_automatic_verify_title'.tr
            : isRegistration
            ? 'auth_registration_verify_title'.tr
            : 'auth_recovery_verify_title'.tr,
        subtitle: _otpIsAutomatic
            ? (_otpChannel == 'sms'
                  ? 'code_sent_sms'.tr
                  : 'code_sent_whatsapp'.tr)
            : _otpDeliveryHasLink
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
                    'enter_code_digits'.trArgs({'count': '$_otpCodeLength'}),
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
            final pinSize =
                ((constraints.maxWidth -
                            separatorWidth * (_otpCodeLength - 1)) /
                        _otpCodeLength)
                    .clamp(24.0, 64.0);
            final pinTextStyle = TextStyle(
              fontFamily: _headingFont,
              fontSize: min(BulkaTypeScale.pageTitle, pinSize * 0.48),
              color: Theme.of(context).colorScheme.onSurface,
              fontWeight: FontWeight.w700,
            );
            return Pinput(
              key: const ValueKey('auth-otp-field'),
              length: _otpCodeLength,
              controller: _otpController,
              separatorBuilder: (_) => const SizedBox(width: separatorWidth),
              hapticFeedbackType: HapticFeedbackType.lightImpact,
              onChanged: (value) {
                _update(() => _error = null);
              },
              onCompleted: (pin) {
                if (pin.length == _otpCodeLength && isRegistration) {
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
        _otpIsAutomatic ? 'otp_valid_five_minutes'.tr : 'valid_few_mins'.tr,
        style: TextStyle(
          color: context.bulkaColors.mutedText,
          fontSize: BulkaTypeScale.caption,
        ),
        textAlign: TextAlign.center,
      ),
      if (_otpIsAutomatic)
        TextButton(
          key: const ValueKey('otp-resend-button'),
          onPressed: _loading || _otpRetrySeconds > 0
              ? null
              : _startPhoneConfirmation,
          child: Text(
            _otpRetrySeconds > 0
                ? 'otp_resend_countdown'.trArgs({
                    'seconds': '$_otpRetrySeconds',
                  })
                : 'otp_resend'.tr,
          ),
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
        onPressed: _otpController.text.length == _otpCodeLength
            ? isRegistration
                  ? _verifyRegistration
                  : _completePasswordReset
            : null,
      ),
      const SizedBox(height: 14),
      TextButton(
        onPressed: () {
          _otpRetryTimer?.cancel();
          _update(() {
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
