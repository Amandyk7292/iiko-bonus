part of '../main.dart';

/// The handoff is a public, expiring cart draft, never a customer credential.
String? chatGptCartTokenFromUri(Uri uri) {
  final values = uri.queryParametersAll['chatgptCart'];
  if (values == null || values.length != 1) return null;
  final token = values.single;
  return token.length <= 8192 &&
          RegExp(r'^bc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$').hasMatch(token)
      ? token
      : null;
}

Uri withoutChatGptCartToken(Uri uri) {
  final query = Map<String, List<String>>.from(uri.queryParametersAll)
    ..remove('chatgptCart');
  return Uri(
    path: uri.path.isEmpty ? '/' : uri.path,
    queryParameters: query.isEmpty ? null : query,
    fragment: uri.fragment.isEmpty ? null : uri.fragment,
  );
}

abstract final class PendingChatGptCartLink {
  static ({String? token, Uri route})? _pending;
  static bool _processing = false;
  static bool get isPending => _pending != null || _processing;

  /// Capture only in memory and scrub the URL before any catalog navigation.
  static bool capture(Uri uri, {bool replaceBrowserUrl = kIsWeb}) {
    if (!uri.queryParametersAll.containsKey('chatgptCart')) return false;
    final clean = withoutChatGptCartToken(uri);
    _pending = (token: chatGptCartTokenFromUri(uri), route: clean);
    if (replaceBrowserUrl) replaceClientUri(clean);
    applyExternalClientRoute(clean);
    return true;
  }

  static ({String? token, Uri route})? take() {
    final value = _pending;
    _pending = null;
    if (value != null) _processing = true;
    return value;
  }

  static void finish() => _processing = false;

  @visibleForTesting
  static void clear() {
    _pending = null;
    _processing = false;
  }
}

String _chatGptCartText(String ru, String kk, String en) =>
    switch (AppLang.current) {
      'kk' => kk,
      'en' => en,
      _ => ru,
    };

String _chatGptCartError(String? code) => switch (code) {
  'ONLINE_ORDERING_DISABLED' => _chatGptCartText(
    'Онлайн-заказы временно недоступны. Попробуйте позже.',
    'Онлайн тапсырыстар уақытша қолжетімсіз. Кейінірек көріңіз.',
    'Online ordering is temporarily unavailable. Please try again later.',
  ),
  'CHATGPT_CART_EXPIRED' => _chatGptCartText(
    'Ссылка на корзину истекла. Создайте новую в ChatGPT.',
    'Себет сілтемесінің мерзімі аяқталды. ChatGPT-те жаңасын жасаңыз.',
    'This cart link has expired. Create a new one in ChatGPT.',
  ),
  'CHATGPT_CART_UNAVAILABLE' => _chatGptCartText(
    'Товары или варианты изменились. Обновите корзину в ChatGPT.',
    'Тауарлар немесе нұсқалар өзгерді. ChatGPT-тегі себетті жаңартыңыз.',
    'Products or options have changed. Update your cart in ChatGPT.',
  ),
  'CHATGPT_CART_CHANGED' => _chatGptCartText(
    'Корзина изменилась. Откройте ссылку ещё раз и проверьте товары.',
    'Себет өзгерді. Сілтемені қайта ашып, тауарларды тексеріңіз.',
    'The cart has changed. Reopen the link and review its items.',
  ),
  _ => _chatGptCartText(
    'Не удалось открыть корзину. Создайте новую ссылку в ChatGPT.',
    'Себетті ашу мүмкін болмады. ChatGPT-те жаңа сілтеме жасаңыз.',
    'Could not open this cart. Create a new link in ChatGPT.',
  ),
};

String _chatGptOptionTitle(Object? value) {
  if (value is Map) {
    return _asString(value[AppLang.current] ?? value['ru'] ?? value['en']);
  }
  return _asString(value);
}

class ChatGptCartDraft {
  const ChatGptCartDraft({
    required this.branch,
    required this.orderType,
    required this.items,
    required this.expiresAt,
    required this.requiresSelection,
    required this.itemSubtotal,
  });

  final BakeryLocation branch;
  final String orderType;
  final List<ChatGptCartDraftItem> items;
  final DateTime expiresAt;
  final bool requiresSelection;
  final int? itemSubtotal;

  factory ChatGptCartDraft.fromJson(Map<String, dynamic> json) {
    final branchJson = _asMap(json['branch']);
    final orderType = _asString(json['orderType']);
    final expiresAt = DateTime.tryParse(_asString(json['expiresAt']));
    final raw = json['items'];
    if (json['version'] != 1 ||
        json['currency'] != 'KZT' ||
        branchJson['id'] is! String ||
        _asString(branchJson['id']).trim().isEmpty ||
        !const {'pickup', 'delivery', 'preorder'}.contains(orderType) ||
        expiresAt == null ||
        raw is! List ||
        raw.isEmpty ||
        raw.length > 40) {
      throw ApiException(_chatGptCartError(null), code: 'CHATGPT_CART_INVALID');
    }
    final items = raw
        .map((value) => ChatGptCartDraftItem.fromJson(_asMap(value)))
        .toList(growable: false);
    if (items.map((value) => value.cartItem.cartKey).toSet().length !=
        items.length) {
      throw ApiException(_chatGptCartError(null), code: 'CHATGPT_CART_INVALID');
    }
    final requiresSelection =
        json['requiresSelection'] == true ||
        items.any((item) => item.requiresSelection);
    final subtotal = json['itemSubtotal'];
    if (!requiresSelection &&
        (subtotal is! num ||
            !subtotal.isFinite ||
            subtotal != subtotal.round() ||
            subtotal !=
                items.fold<int>(
                  0,
                  (sum, value) => sum + value.cartItem.total,
                ))) {
      throw ApiException(_chatGptCartError(null), code: 'CHATGPT_CART_INVALID');
    }
    return ChatGptCartDraft(
      branch: BakeryLocation.fromJson(branchJson),
      orderType: orderType,
      items: List.unmodifiable(items),
      expiresAt: expiresAt,
      requiresSelection: requiresSelection,
      itemSubtotal: subtotal is num ? subtotal.round() : null,
    );
  }

  void ensureUnexpired() {
    if (!expiresAt.isAfter(DateTime.now())) {
      throw ApiException(
        _chatGptCartError('CHATGPT_CART_EXPIRED'),
        code: 'CHATGPT_CART_EXPIRED',
      );
    }
  }

  String get reviewIdentity => jsonEncode({
    'branch': branch.id,
    'orderType': orderType,
    'items': items.map((item) => item.cartItem.toJson()).toList(),
    'requiresSelection': requiresSelection,
    'itemSubtotal': itemSubtotal,
  });
}

class ChatGptCartDraftItem {
  const ChatGptCartDraftItem({
    required this.cartItem,
    required this.requiresSelection,
    this.selectedOptions = const {},
  });
  final CartItem cartItem;
  final bool requiresSelection;
  final Map<String, dynamic> selectedOptions;

  factory ChatGptCartDraftItem.fromJson(Map<String, dynamic> json) {
    final product = _asMap(json['product']);
    final id = _asString(json['id']);
    final name = _asString(product['name'] ?? product['title']);
    final quantity = json['quantity'];
    final step = json['quantityStep'];
    final price = json['price'];
    final basePrice = json['basePrice'];
    final unit = _asString(json['unit']);
    if (id.trim().isEmpty ||
        id != _asString(product['id']) ||
        name.trim().isEmpty ||
        product['isAvailable'] == false ||
        quantity is! num ||
        step is! num ||
        !quantity.isFinite ||
        !step.isFinite ||
        step < 0.001 ||
        step > CartProvider.maxItemQuantity ||
        quantity < step ||
        quantity > CartProvider.maxItemQuantity ||
        (quantity / step - (quantity / step).round()).abs() > 0.000001 ||
        normalizedProductQuantity(quantity) != quantity ||
        price is! num ||
        !price.isFinite ||
        price <= 0 ||
        price != price.round() ||
        basePrice is! num ||
        !basePrice.isFinite ||
        basePrice <= 0 ||
        basePrice != basePrice.round() ||
        unit.isEmpty ||
        unit.length > 12) {
      throw ApiException(_chatGptCartError(null), code: 'CHATGPT_CART_INVALID');
    }
    final configuration = json['configuration'] is Map
        ? Map<String, dynamic>.from(json['configuration'])
        : null;
    final rawModifiers = json['modifiers'];
    if (rawModifiers != null &&
        (rawModifiers is! List || rawModifiers.any((value) => value is! Map))) {
      throw ApiException(_chatGptCartError(null), code: 'CHATGPT_CART_INVALID');
    }
    final modifiers = (rawModifiers as List? ?? const [])
        .map((value) => Map<String, dynamic>.from(value as Map))
        .toList(growable: false);
    final item = CartItem(
      id: id,
      cartKey: configuration != null || modifiers.isNotEmpty
          ? CartProvider.configuredCartKey(id, configuration, modifiers)
          : id,
      name: name,
      price: price.round(),
      basePrice: basePrice.round(),
      imageUrl: _asString(product['imageUrl']),
      configuration: configuration,
      modifiers: modifiers,
      quantity: quantity,
      quantityStep: step,
      unit: unit,
    );
    if (json['lineTotal'] != item.total) {
      throw ApiException(_chatGptCartError(null), code: 'CHATGPT_CART_INVALID');
    }
    return ChatGptCartDraftItem(
      cartItem: item,
      requiresSelection: json['requiresSelection'] == true,
      selectedOptions: _asMap(json['selectedOptions']),
    );
  }
}

extension ChatGptCartApi on BulkaApiClient {
  Future<ChatGptCartDraft> resolveChatGptCart(String token) async {
    // Keep the opaque token out of URL, logs, local storage and auth headers.
    final response = await _client
        .post(
          _uri('/api/public/chatgpt-cart/resolve'),
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': AppLang.current,
          },
          body: jsonEncode({'token': token}),
        )
        .timeout(const Duration(seconds: 15));
    final decoded = jsonDecode(utf8.decode(response.bodyBytes));
    final json = _asMap(decoded);
    if (response.statusCode != 200 || json['success'] != true) {
      final code = _asString(json['code'] ?? json['errorCode']);
      throw ApiException(
        _chatGptCartError(code),
        statusCode: response.statusCode,
        code: code,
      );
    }
    final draft = ChatGptCartDraft.fromJson(_asMap(json['draft']));
    draft.ensureUnexpired();
    return draft;
  }
}
