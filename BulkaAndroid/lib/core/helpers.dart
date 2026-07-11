part of '../main.dart';

InputDecoration _inputDecoration({
  required String label,
  String? prefix,
  String? helper,
  String? error,
  IconData? icon,
}) {
  return InputDecoration(
    labelText: label,
    prefixText: prefix,
    helperText: error == null ? helper : null,
    counterText: '',
    errorText: null,
    filled: true,
    fillColor: Colors.white,
    contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 18),
    prefixIcon: icon == null ? null : Icon(icon, color: _caramel),
    labelStyle: TextStyle(
      color: error == null ? _textDark.withValues(alpha: 0.62) : _errorRed,
    ),
    helperStyle: TextStyle(
      color: _textDark.withValues(alpha: 0.5),
      fontSize: 12,
    ),
    prefixStyle: const TextStyle(
      color: _textDark,
      fontSize: 18,
      fontWeight: FontWeight.w700,
      letterSpacing: 0.5,
      height: 1.25,
    ),
    enabledBorder: OutlineInputBorder(
      borderSide: BorderSide(color: _almond.withValues(alpha: 0.8)),
      borderRadius: BorderRadius.circular(18),
    ),
    focusedBorder: OutlineInputBorder(
      borderSide: const BorderSide(color: _caramel, width: 2),
      borderRadius: BorderRadius.circular(18),
    ),
    errorBorder: OutlineInputBorder(
      borderSide: const BorderSide(color: _errorRed),
      borderRadius: BorderRadius.circular(18),
    ),
    focusedErrorBorder: OutlineInputBorder(
      borderSide: const BorderSide(color: _errorRed, width: 2),
      borderRadius: BorderRadius.circular(18),
    ),
  );
}

Future<void> _openTelegram(BuildContext context) async {
  final opened = await launchUrl(
    Uri.parse('tg://resolve?domain=bulkawallet_bot'),
    mode: LaunchMode.externalApplication,
  );
  if (!opened && context.mounted) {
    await _openExternalUrl(
      context,
      Uri.parse('https://t.me/bulkawallet_bot'),
      'error_open_telegram'.tr,
    );
  }
}

Future<void> _openExternalUrl(
  BuildContext context,
  Uri uri,
  String error,
) async {
  final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
  if (!opened && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error)));
  }
}

String _userError(Object error, String fallbackKey) {
  return localizeErrorMessage(error, fallbackKey: fallbackKey);
}

String _messageFrom(Map<String, dynamic> json, String fallback) {
  return _asString(json['message'] ?? json['error'], fallback: fallback);
}

Customer? _readCustomer(String? raw) {
  if (raw == null) return null;
  try {
    return Customer.fromJson(_asMap(jsonDecode(raw)));
  } catch (_) {
    return null;
  }
}

List<BonusTransaction> _readTransactions(String? raw) {
  if (raw == null) return const [];
  try {
    final decoded = jsonDecode(raw);
    if (decoded is! List) return const [];
    return decoded
        .map((item) => BonusTransaction.fromJson(_asMap(item)))
        .toList();
  } catch (_) {
    return const [];
  }
}

String formatMoney(double value) {
  if (value % 1 == 0) return value.toInt().toString();
  return value.toStringAsFixed(2);
}

String formatGroupedNumber(double value) {
  final rounded = value.round().abs().toString();
  final separator = AppLang.current == 'en' ? ',' : ' ';
  final buffer = StringBuffer(value < 0 ? '-' : '');
  for (var index = 0; index < rounded.length; index++) {
    if (index > 0 && (rounded.length - index) % 3 == 0) {
      buffer.write(separator);
    }
    buffer.write(rounded[index]);
  }
  return buffer.toString();
}

List<String> _getLocalizedMonths() {
  final lang = appLanguageNotifier.value;
  if (lang == 'kk') {
    return [
      'қаң',
      'ақп',
      'нау',
      'сәу',
      'мам',
      'мау',
      'шіл',
      'там',
      'қыр',
      'қаз',
      'қар',
      'жел',
    ];
  }
  if (lang == 'en') {
    return [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
  }
  return [
    'янв',
    'фев',
    'мар',
    'апр',
    'мая',
    'июн',
    'июл',
    'авг',
    'сен',
    'окт',
    'ноя',
    'дек',
  ];
}

String formatDateTime(String value) {
  try {
    final date = DateTime.parse(value).toLocal();
    final months = _getLocalizedMonths();
    final day = date.day.toString().padLeft(2, '0');
    final month = months[date.month - 1];
    final hour = date.hour.toString().padLeft(2, '0');
    final minute = date.minute.toString().padLeft(2, '0');
    return '$day $month ${date.year}, $hour:$minute';
  } catch (_) {
    return value;
  }
}

String formatShortDate(String value) {
  try {
    final date = DateTime.parse(value).toLocal();
    final months = _getLocalizedMonths();
    return '${date.day} ${months[date.month - 1]}';
  } catch (_) {
    return value;
  }
}

Map<String, dynamic> _asMap(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) {
    return value.map((key, value) => MapEntry(key.toString(), value));
  }
  return <String, dynamic>{};
}

String _asString(Object? value, {String fallback = ''}) {
  if (value == null) return fallback;
  final text = value.toString();
  return text.isEmpty ? fallback : text;
}

String? _nullableString(Object? value) {
  if (value == null) return null;
  final text = value.toString();
  return text.isEmpty ? null : text;
}

double _asDouble(Object? value, {double fallback = 0}) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value) ?? fallback;
  return fallback;
}

double? _nullableDouble(Object? value) {
  if (value == null) return null;
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value);
  return null;
}

int _asInt(Object? value, {int fallback = 0}) {
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value) ?? fallback;
  return fallback;
}

int? _nullableInt(Object? value) {
  if (value == null) return null;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value);
  return null;
}

extension on String {
  Iterable<String> get onlyDigits sync* {
    for (final rune in runes) {
      final char = String.fromCharCode(rune);
      if (RegExp(r'\d').hasMatch(char)) yield char;
    }
  }
}
