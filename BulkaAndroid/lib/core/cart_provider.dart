import 'package:flutter/material.dart';

class CartItem {
  final String id;
  final String name;
  final int price;
  final String imageUrl;
  final bool isStopListed;
  int quantity;

  CartItem({
    required this.id,
    required this.name,
    required this.price,
    required this.imageUrl,
    this.isStopListed = false,
    this.quantity = 1,
  });

  int get total => price * quantity;
}

class CartProvider extends ChangeNotifier {
  final Map<String, CartItem> _items = {};

  Map<String, CartItem> get items => {..._items};

  int get itemCount => _items.values.fold(0, (sum, item) => sum + item.quantity);

  int get totalAmount => _items.values.fold(0, (sum, item) => sum + item.total);

  int getQuantity(String productId) {
    return _items[productId]?.quantity ?? 0;
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
      _items[productId]!.quantity += 1;
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
  }

  void setQuantity(String productId, int quantity) {
    if (!_items.containsKey(productId)) return;
    if (quantity <= 0) {
      _items.remove(productId);
    } else {
      _items[productId]!.quantity = quantity;
    }
    notifyListeners();
  }

  void removeItem(String productId) {
    _items.remove(productId);
    notifyListeners();
  }

  void clear() {
    _items.clear();
    notifyListeners();
  }
}
