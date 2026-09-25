part of '../main.dart';

bool _sameJsonValue(Object? left, Object? right) {
  if (identical(left, right) || left == right) return true;
  if (left is List && right is List) {
    if (left.length != right.length) return false;
    for (var i = 0; i < left.length; i++) {
      if (!_sameJsonValue(left[i], right[i])) return false;
    }
    return true;
  }
  if (left is Map && right is Map) {
    if (left.length != right.length) return false;
    for (final key in left.keys) {
      if (!right.containsKey(key) || !_sameJsonValue(left[key], right[key])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

SnackBar bulkaSnackBar({
  Key? key,
  required Widget content,
  Color? backgroundColor,
  double? elevation,
  EdgeInsetsGeometry? margin,
  EdgeInsetsGeometry? padding,
  double? width,
  ShapeBorder? shape,
  HitTestBehavior? hitTestBehavior,
  SnackBarBehavior? behavior,
  SnackBarAction? action,
  double? actionOverflowThreshold,
  bool? showCloseIcon,
  Color? closeIconColor,
  Duration duration = const Duration(seconds: 4),
  bool? persist,
  Animation<double>? animation,
  VoidCallback? onVisible,
  DismissDirection? dismissDirection,
  Clip clipBehavior = Clip.hardEdge,
}) {
  return SnackBar(
    key: key,
    content: Builder(
      builder: (snackContext) {
        void dismiss() =>
            ScaffoldMessenger.maybeOf(snackContext)?.hideCurrentSnackBar();

        return GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: dismiss,
          onVerticalDragEnd: (details) {
            if ((details.primaryVelocity ?? 0).abs() >= 80) dismiss();
          },
          child: content,
        );
      },
    ),
    backgroundColor: backgroundColor,
    elevation: elevation,
    margin: margin,
    padding: padding,
    width: width,
    shape: shape,
    hitTestBehavior: hitTestBehavior,
    behavior: behavior,
    action: action,
    actionOverflowThreshold: actionOverflowThreshold,
    showCloseIcon: showCloseIcon,
    closeIconColor: closeIconColor,
    duration: duration,
    persist: persist,
    animation: animation,
    onVisible: onVisible,
    dismissDirection: dismissDirection ?? DismissDirection.horizontal,
    clipBehavior: clipBehavior,
  );
}

/// Prevents a rapid second tap from starting the same asynchronous UI action
/// while the first route, dialog, sheet, or request is still active.
class _AsyncActionGate {
  bool _active = false;

  Future<void> run(Future<void> Function() action) async {
    if (_active) return;
    _active = true;
    try {
      await action();
    } finally {
      _active = false;
    }
  }
}

final ValueNotifier<Uri> clientRouteNotifier = ValueNotifier<Uri>(
  currentClientUri(),
);

enum PaymentReturnNotice { cancelled }

@visibleForTesting
PaymentReturnNotice? paymentReturnNoticeFromUri(Uri uri) {
  final path = uri.path.replaceFirst(RegExp(r'/+$'), '');
  if (path != '/orders') return null;

  String? queryValue(String key) {
    for (final entry in uri.queryParameters.entries) {
      if (entry.key.toLowerCase() == key.toLowerCase()) return entry.value;
    }
    return null;
  }

  if ((queryValue('payment') ?? '').toLowerCase() != 'forte') return null;
  final orderId = queryValue('order') ?? '';
  if (!RegExp(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    caseSensitive: false,
  ).hasMatch(orderId)) {
    return null;
  }

  final status = (queryValue('status') ?? '').toLowerCase().replaceAll(
    RegExp('[^a-z]'),
    '',
  );
  if (const {
    'cancelled',
    'canceled',
    'cancelledbyuser',
    'canceledbyuser',
  }.contains(status)) {
    return PaymentReturnNotice.cancelled;
  }
  return null;
}

Uri normalizedClientUri(Uri uri) {
  final path = uri.path.isEmpty ? '/' : uri.path;
  return Uri(
    path: path,
    queryParameters: uri.queryParameters.isEmpty ? null : uri.queryParameters,
    fragment: uri.fragment.isEmpty ? null : uri.fragment,
  );
}

void publishClientRoute(Uri uri, {bool replace = false}) {
  if (!kIsWeb) return;
  final normalized = normalizedClientUri(uri);
  final current = normalizedClientUri(clientRouteNotifier.value);
  if (current.toString() == normalized.toString()) return;
  if (replace) {
    replaceClientUri(normalized);
  } else {
    pushClientUri(normalized);
  }
  clientRouteNotifier.value = normalized;
}

void applyExternalClientRoute(Uri uri) {
  final normalized = normalizedClientUri(uri);
  if (normalizedClientUri(clientRouteNotifier.value).toString() ==
      normalized.toString()) {
    return;
  }
  clientRouteNotifier.value = normalized;
}

String formatUiInteger(BuildContext context, int value) {
  return MaterialLocalizations.of(context).formatDecimal(value);
}

String formatUiDate(BuildContext context, DateTime value) {
  return MaterialLocalizations.of(context).formatShortDate(value.toLocal());
}

String formatUiTime(BuildContext context, DateTime value) {
  return MaterialLocalizations.of(context).formatTimeOfDay(
    TimeOfDay.fromDateTime(value.toLocal()),
    alwaysUse24HourFormat: MediaQuery.alwaysUse24HourFormatOf(context),
  );
}

String formatUiDateTime(BuildContext context, DateTime value) {
  return '${formatUiDate(context, value)} · ${formatUiTime(context, value)}';
}

double distanceBetweenCoordinatesKm({
  required double firstLatitude,
  required double firstLongitude,
  required double secondLatitude,
  required double secondLongitude,
}) {
  const earthRadiusKm = 6371.0;
  double radians(double degrees) => degrees * pi / 180;
  final latitudeDelta = radians(secondLatitude - firstLatitude);
  final longitudeDelta = radians(secondLongitude - firstLongitude);
  final value =
      pow(sin(latitudeDelta / 2), 2) +
      cos(radians(firstLatitude)) *
          cos(radians(secondLatitude)) *
          pow(sin(longitudeDelta / 2), 2);
  return earthRadiusKm * 2 * atan2(sqrt(value), sqrt(1 - value));
}

InputDecoration _inputDecoration({
  required BuildContext context,
  required String label,
  String? prefix,
  String? helper,
  String? error,
  IconData? icon,
}) {
  final colors = context.bulkaColors;
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
      color: error == null ? colors.mutedText : colors.danger,
    ),
    helperStyle: TextStyle(
      color: colors.mutedText,
      fontSize: BulkaTypeScale.caption,
    ),
    prefixStyle: TextStyle(
      fontFamily: _headingFont,
      color: Theme.of(context).colorScheme.onSurface,
      fontSize: BulkaTypeScale.titleSmall,
      fontWeight: FontWeight.w700,
      letterSpacing: 0.5,
      height: 1.25,
    ),
    enabledBorder: OutlineInputBorder(
      borderSide: BorderSide(
        color: error == null ? colors.cardBorder : colors.danger,
        width: error == null ? BulkaStrokes.hairline : 2,
      ),
      borderRadius: BorderRadius.circular(BulkaRadii.control),
    ),
    focusedBorder: OutlineInputBorder(
      borderSide: BorderSide(
        color: error == null ? colors.brandGold : colors.danger,
        width: 2,
      ),
      borderRadius: BorderRadius.circular(BulkaRadii.control),
    ),
    errorBorder: OutlineInputBorder(
      borderSide: const BorderSide(color: _errorRed),
      borderRadius: BorderRadius.circular(BulkaRadii.control),
    ),
    focusedErrorBorder: OutlineInputBorder(
      borderSide: const BorderSide(color: _errorRed, width: 2),
      borderRadius: BorderRadius.circular(BulkaRadii.control),
    ),
  );
}

Future<void> _openExternalUrl(
  BuildContext context,
  Uri uri,
  String error, {
  bool sameWindowOnWeb = false,
}) async {
  if (sameWindowOnWeb && kIsWeb) {
    navigateCurrentWindow(uri);
    return;
  }
  final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
  if (!opened && context.mounted) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(bulkaSnackBar(content: Text(error)));
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
