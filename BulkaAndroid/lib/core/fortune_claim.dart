part of '../main.dart';

abstract final class PendingFortuneClaim {
  static const key = 'bulka_pending_fortune_claim_v1';
  static const _storage = SessionStorageBackend();
  static Future<void>? _tail;
  static String? _memoryToken;
  static bool _loaded = false;

  static Future<T> _serialized<T>(Future<T> Function() operation) {
    final previous = _tail;
    final released = Completer<void>();
    _tail = released.future;
    return () async {
      try {
        if (previous != null) await previous;
        return await operation();
      } finally {
        if (identical(_tail, released.future)) _tail = null;
        released.complete();
      }
    }();
  }

  static String? validToken(String? value) =>
      value != null && RegExp(r'^[A-Za-z0-9_-]{32,200}$').hasMatch(value)
      ? value
      : null;

  static String? tokenFromFragment(Uri uri) {
    try {
      final fragment = Uri.splitQueryString(uri.fragment);
      if (Uri(query: uri.fragment).queryParametersAll['fortune']?.length != 1) {
        return null;
      }
      return validToken(fragment['fortune']);
    } on FormatException {
      return null;
    }
  }

  static String? tokenFromUri(Uri uri) {
    final trusted =
        (uri.scheme == 'https' &&
            uri.host == 'bulka.com.kz' &&
            uri.path == '/profile' &&
            !uri.hasPort &&
            uri.userInfo.isEmpty) ||
        (uri.scheme == 'bulka' &&
            uri.host == 'profile' &&
            uri.path.isEmpty &&
            !uri.hasPort &&
            uri.userInfo.isEmpty);
    return trusted ? tokenFromFragment(uri) : null;
  }

  static Future<bool> capture(Uri uri) {
    final token = tokenFromUri(uri);
    if (token == null) return Future<bool>.value(false);
    return _serialized(() async {
      _memoryToken = token;
      _loaded = true;
      try {
        await _storage.write(key: key, value: token);
      } catch (_) {}
      return true;
    });
  }

  static Future<String?> _read() async {
    if (_loaded) return _memoryToken;
    try {
      _memoryToken = validToken(await _storage.read(key: key));
    } catch (_) {}
    _loaded = true;
    return _memoryToken;
  }

  static Future<String?> read() => _serialized(_read);

  static Future<void> clear(String expectedToken) => _serialized(() async {
    if (await _read() != expectedToken) return;
    try {
      await _storage.delete(key: key);
    } catch (_) {}
    _memoryToken = null;
  });
}

String fortuneText(String key) => switch (AppLang.current) {
  'kk' =>
    const {
          'title': 'Менің сыйлықтарым',
          'copy': 'Кодты көшіру',
          'empty': 'Сыйлықтарыңыз осында болады',
          'emptyHint': 'Наубайханада QR сканерлеп, чек тіркеңіз.',
          'claiming': 'Сыйлықты сақтап жатырмыз…',
          'claimError': 'Сыйлықты сақтау мүмкін болмады. Қайталап көріңіз.',
          'loadError': 'Сыйлықтарды жүктеу мүмкін болмады.',
          'retry': 'Қайталау',
          'credited': 'Бонустар есептелді',
          'redeem': '{amount} бонус алу',
          'redeemError': 'Бонустарды есептеу мүмкін болмады. Қайталап көріңіз.',
          'claimed': 'Сыйлық сіздің аккаунтыңызда',
          'active': 'Кассада көрсетіңіз',
          'expired': 'Мерзімі аяқталды',
          'redeemed': 'Алынды',
          'expiry': 'Дейін алыңыз',
          'code': 'Алу коды',
          'terminal': 'Бұл сыйлық енді қолжетімсіз.',
        }[key] ??
        key,
  'en' =>
    const {
          'title': 'My prizes',
          'copy': 'Copy code',
          'empty': 'Your prizes will appear here',
          'emptyHint': 'Scan the QR at a bakery and attach your receipt.',
          'claiming': 'Saving your prize…',
          'claimError': 'Could not save your prize. Please retry.',
          'loadError': 'Could not load prizes.',
          'retry': 'Retry',
          'credited': 'Bonuses credited',
          'redeem': 'Collect {amount} bonuses',
          'redeemError': 'Could not credit bonuses. Please retry.',
          'claimed': 'Your prize is in your account',
          'active': 'Show at the checkout',
          'expired': 'Expired',
          'redeemed': 'Collected',
          'expiry': 'Collect by',
          'code': 'Collection code',
          'terminal': 'This prize is no longer available.',
        }[key] ??
        key,
  _ =>
    const {
          'title': 'Мои призы',
          'copy': 'Скопировать код',
          'empty': 'Ваши подарки будут здесь',
          'emptyHint': 'Сканируйте QR в пекарне и прикрепите чек.',
          'claiming': 'Сохраняем ваш подарок…',
          'claimError': 'Не удалось сохранить подарок. Попробуйте ещё раз.',
          'loadError': 'Не удалось загрузить подарки.',
          'retry': 'Попробовать ещё раз',
          'credited': 'Бонусы начислены',
          'redeem': 'Получить {amount} бонусов',
          'redeemError': 'Не удалось начислить бонусы. Попробуйте ещё раз.',
          'claimed': 'Подарок в вашем аккаунте',
          'active': 'Покажите на кассе',
          'expired': 'Срок истёк',
          'redeemed': 'Получен',
          'expiry': 'Заберите до',
          'code': 'Код получения',
          'terminal': 'Этот подарок больше недоступен.',
        }[key] ??
        key,
};
