import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class CartItem {
  final String id;
  final String cartKey;
  final String name;
  final int price;
  final int basePrice;
  final String imageUrl;
  final bool isStopListed;
  final Map<String, dynamic>? configuration;
  final List<Map<String, dynamic>> modifiers;
  int quantity;

  CartItem({
    required this.id,
    String? cartKey,
    required this.name,
    required this.price,
    int? basePrice,
    required this.imageUrl,
    this.isStopListed = false,
    this.configuration,
    this.modifiers = const [],
    this.quantity = 1,
  }) : cartKey = cartKey ?? id,
       basePrice = basePrice ?? price;

  int get total => price * quantity;

  Map<String, dynamic> toJson() => {
    'id': id,
    'cartKey': cartKey,
    'name': name,
    'price': price,
    'basePrice': basePrice,
    'imageUrl': imageUrl,
    'isStopListed': isStopListed,
    'quantity': quantity,
    'configuration': configuration,
    'modifiers': modifiers,
  };

  Map<String, dynamic> toOrderPayload() => {
    'id': id,
    'quantity': quantity,
    if (configuration != null) 'configuration': configuration,
    if (modifiers.isNotEmpty) 'modifiers': modifiers,
  };

  factory CartItem.fromJson(Map<String, dynamic> json) => CartItem(
    id: json['id']?.toString() ?? '',
    cartKey: json['cartKey']?.toString(),
    name: json['name']?.toString() ?? '',
    price: (json['price'] as num?)?.toInt() ?? 0,
    basePrice: (json['basePrice'] as num?)?.toInt(),
    imageUrl: json['imageUrl']?.toString() ?? '',
    isStopListed: json['isStopListed'] == true,
    configuration: json['configuration'] is Map
        ? Map<String, dynamic>.from(json['configuration'])
        : null,
    modifiers: json['modifiers'] is List
        ? (json['modifiers'] as List)
              .whereType<Map>()
              .map((value) => Map<String, dynamic>.from(value))
              .toList()
        : const [],
    quantity: ((json['quantity'] as num?)?.toInt() ?? 1).clamp(1, 99).toInt(),
  );
}

class CartProductSnapshot {
  const CartProductSnapshot({
    required this.id,
    required this.name,
    required this.price,
    required this.imageUrl,
    required this.isStopListed,
  });

  final String id;
  final String name;
  final int price;
  final String imageUrl;
  final bool isStopListed;
}

class CartProvider extends ChangeNotifier {
  CartProvider() {
    unawaited(_restore());
  }

  static const _storageKey = 'bulka_cart_v1';
  static const maxItemQuantity = 99;
  final Map<String, CartItem> _items = {};
  final Completer<void> _restoreCompleter = Completer<void>();
  Map<String, CartProductSnapshot>? _latestMenu;
  bool _restored = false;

  Map<String, CartItem> get items => {..._items};
  bool get isRestored => _restored;
  Future<void> get restored => _restoreCompleter.future;

  int get itemCount =>
      _items.values.fold(0, (sum, item) => sum + item.quantity);

  int get totalAmount => _items.values.fold(0, (sum, item) => sum + item.total);

  static String configuredCartKey(
    String productId,
    Map<String, dynamic>? configuration,
    List<Map<String, dynamic>> modifiers,
  ) {
    final payload = jsonEncode({
      'configuration': configuration,
      'modifiers': modifiers,
    });
    final selection = base64Url.encode(utf8.encode(payload));
    return '$productId::$selection';
  }

  static CartItem copyItem(CartItem item, {int? quantity}) => CartItem(
    id: item.id,
    cartKey: item.cartKey,
    name: item.name,
    price: item.price,
    basePrice: item.basePrice,
    imageUrl: item.imageUrl,
    isStopListed: item.isStopListed,
    configuration: item.configuration == null
        ? null
        : Map<String, dynamic>.from(item.configuration!),
    modifiers: item.modifiers
        .map((value) => Map<String, dynamic>.from(value))
        .toList(growable: false),
    quantity: quantity ?? item.quantity,
  );

  int getQuantity(String productId) {
    return _items.values
        .where((item) => item.id == productId)
        .fold(0, (sum, item) => sum + item.quantity);
  }

  void addConfiguredItem({
    required String productId,
    required String name,
    required int basePrice,
    required int unitPrice,
    required String imageUrl,
    Map<String, dynamic>? configuration,
    List<Map<String, dynamic>> modifiers = const [],
    int quantity = 1,
  }) {
    final key = configuredCartKey(productId, configuration, modifiers);
    final current = _items[key];
    if (current != null) {
      current.quantity = (current.quantity + quantity).clamp(1, 99);
    } else {
      _items[key] = CartItem(
        id: productId,
        cartKey: key,
        name: name,
        price: unitPrice,
        basePrice: basePrice,
        imageUrl: imageUrl,
        configuration: configuration,
        modifiers: modifiers,
        quantity: quantity.clamp(1, 99),
      );
    }
    notifyListeners();
    unawaited(_save());
  }

  void addItem({
    required String productId,
    required String name,
    required int price,
    required String imageUrl,
    bool isStopListed = false,
  }) {
    if (isStopListed) return;
    if (_items.containsKey(productId)) {
      _items[productId]!.quantity = (_items[productId]!.quantity + 1).clamp(
        1,
        maxItemQuantity,
      );
    } else {
      _items[productId] = CartItem(
        id: productId,
        name: name,
        price: price,
        imageUrl: imageUrl,
        isStopListed: isStopListed,
      );
    }
    notifyListeners();
    unawaited(_save());
  }

  void setQuantity(String productId, int quantity) {
    final item = _items[productId];
    if (item == null) return;
    if (item.isStopListed && quantity > item.quantity) return;
    if (quantity <= 0) {
      _items.remove(productId);
    } else {
      _items[productId]!.quantity = quantity.clamp(1, maxItemQuantity);
    }
    notifyListeners();
    unawaited(_save());
  }

  void removeItem(String productId) {
    _items.remove(productId);
    notifyListeners();
    unawaited(_save());
  }

  void clear() {
    _items.clear();
    notifyListeners();
    unawaited(_save());
  }

  Future<void> clearAndWait() async {
    _items.clear();
    notifyListeners();
    await _save();
  }

  void replaceWithItems(Iterable<CartItem> items) {
    final next = <String, CartItem>{};
    for (final item in items) {
      if (item.id.trim().isEmpty || item.quantity <= 0) continue;
      final copy = copyItem(
        item,
        quantity: item.quantity.clamp(1, maxItemQuantity),
      );
      next[copy.cartKey] = copy;
    }
    _items
      ..clear()
      ..addAll(next);
    _applyLatestMenu();
    notifyListeners();
    unawaited(_save());
  }

  void mergeItems(Iterable<CartItem> items) {
    final next = {
      for (final entry in _items.entries) entry.key: copyItem(entry.value),
    };
    for (final item in items) {
      if (item.id.trim().isEmpty || item.quantity <= 0) continue;
      final current = next[item.cartKey];
      if (current == null) {
        next[item.cartKey] = copyItem(
          item,
          quantity: item.quantity.clamp(1, maxItemQuantity),
        );
      } else {
        current.quantity = (current.quantity + item.quantity).clamp(
          1,
          maxItemQuantity,
        );
      }
    }
    _items
      ..clear()
      ..addAll(next);
    _applyLatestMenu();
    notifyListeners();
    unawaited(_save());
  }

  void reconcileMenu(Iterable<CartProductSnapshot> products) {
    _latestMenu = {for (final product in products) product.id: product};
    if (!_applyLatestMenu()) return;
    notifyListeners();
    unawaited(_save());
  }

  bool _applyLatestMenu() {
    final menu = _latestMenu;
    if (menu == null || _items.isEmpty) return false;
    var changed = false;
    for (final entry in _items.entries.toList()) {
      final current = entry.value;
      final latest = menu[current.id];
      final next = latest == null
          ? CartItem(
              id: current.id,
              cartKey: current.cartKey,
              name: current.name,
              price: current.price,
              basePrice: current.basePrice,
              imageUrl: current.imageUrl,
              isStopListed: true,
              quantity: current.quantity,
              configuration: current.configuration,
              modifiers: current.modifiers,
            )
          : CartItem(
              id: current.id,
              cartKey: current.cartKey,
              name: latest.name,
              price: latest.price + (current.price - current.basePrice),
              basePrice: latest.price,
              imageUrl: latest.imageUrl,
              isStopListed: latest.isStopListed,
              quantity: current.quantity,
              configuration: current.configuration,
              modifiers: current.modifiers,
            );
      if (current.name != next.name ||
          current.price != next.price ||
          current.imageUrl != next.imageUrl ||
          current.isStopListed != next.isStopListed) {
        _items[entry.key] = next;
        changed = true;
      }
    }
    return changed;
  }

  Future<void> _restore() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_storageKey);
    try {
      if (raw == null || _items.isNotEmpty) return;
      final decoded = jsonDecode(raw);
      if (decoded is! List) return;
      for (final value in decoded) {
        if (value is! Map) continue;
        final item = CartItem.fromJson(Map<String, dynamic>.from(value));
        if (item.id.isNotEmpty && item.price > 0) {
          _items[item.cartKey] = item;
        }
      }
      _applyLatestMenu();
    } catch (_) {
      await prefs.remove(_storageKey);
    } finally {
      _restored = true;
      if (!_restoreCompleter.isCompleted) _restoreCompleter.complete();
      notifyListeners();
    }
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _storageKey,
      jsonEncode(_items.values.map((item) => item.toJson()).toList()),
    );
  }
}
