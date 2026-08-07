part of '../main.dart';

String localizeErrorMessage(
  Object? error, {
  String fallbackKey = 'error_generic',
}) {
  final code = error is ApiException ? error.code : null;
  switch (code) {
    case 'INVALID_CREDENTIALS':
      return 'error_login'.tr;
    case 'ACCOUNT_NOT_FOUND':
      return 'auth_account_not_found'.tr;
    case 'PASSWORD_SETUP_REQUIRED':
      return 'auth_password_setup_required'.tr;
    case 'ACCOUNT_EXISTS':
      return 'auth_account_exists'.tr;
    case 'INVALID_PASSWORD':
      return 'auth_password_rules'.tr;
    case 'ONLINE_ORDERING_DISABLED':
      return 'checkout_online_ordering_disabled'.tr;
    case 'SESSION_IDENTITY_CHANGED':
      return 'error_session_changed'.tr;
    case 'INVALID_OTP':
    case 'OTP_EXPIRED':
    case 'OTP_ATTEMPTS_EXCEEDED':
    case 'WRONG_OTP_PURPOSE':
      return 'error_invalid_code'.tr;
  }
  final raw = error is ApiException ? error.message : (error?.toString() ?? '');
  final value = raw.toLowerCase();
  if (value.contains('city') || value.contains('город')) {
    return 'error_load_cities'.tr;
  }
  if (value.contains('send') && value.contains('code') ||
      value.contains('отправ') && value.contains('код')) {
    return 'error_send_code'.tr;
  }
  if (value.contains('invalid code') ||
      value.contains('wrong code') ||
      value.contains('неверн') && value.contains('код')) {
    return 'error_invalid_code'.tr;
  }
  if (value.contains('registr')) return 'error_register'.tr;
  if (value.contains('session') || value.contains('сесси')) {
    return 'error_session_missing'.tr;
  }
  if (value.contains('delet') || value.contains('удал')) {
    return 'error_delete_account'.tr;
  }
  if (value.contains('sav') || value.contains('сохран')) {
    return 'error_save'.tr;
  }
  if (value.contains('whatsapp')) return 'error_open_whatsapp'.tr;
  if (value.contains('telegram')) return 'error_open_telegram'.tr;
  if (value.contains('wallet')) return 'wallet_unavailable'.tr;
  if (value.contains('network') ||
      value.contains('socket') ||
      value.contains('timeout') ||
      value.contains('сет')) {
    return 'error_network'.tr;
  }
  return fallbackKey.tr;
}

void showApiErrorSnackBar(
  BuildContext context,
  Object error, {
  String fallbackKey = 'error_generic',
}) {
  final message = localizeErrorMessage(error, fallbackKey: fallbackKey);
  final supportCode = error is ApiException ? error.supportCode : null;
  final messenger = ScaffoldMessenger.of(context);
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        behavior: SnackBarBehavior.floating,
        content: Semantics(
          liveRegion: true,
          child: Text(
            supportCode == null
                ? message
                : '$message\n${'support_code'.trArgs({'code': supportCode})}',
          ),
        ),
        action: supportCode == null
            ? null
            : SnackBarAction(
                label: 'copy_support_code'.tr,
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: supportCode));
                  messenger.showSnackBar(
                    SnackBar(content: Text('support_code_copied'.tr)),
                  );
                },
              ),
      ),
    );
}
