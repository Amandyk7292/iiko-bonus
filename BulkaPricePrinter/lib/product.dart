class Product {
  const Product({
    required this.id,
    required this.name,
    required this.composition,
    required this.price,
    required this.expiry,
    required this.expiryUnit,
    required this.barcode,
  });
  final String id, name, composition, price, expiryUnit, barcode;
  final int expiry;
  factory Product.fromJson(Map<String, dynamic> json) => Product(
    id: '${json['id'] ?? ''}',
    name: '${json['name'] ?? ''}',
    composition: '${json['composition'] ?? ''}',
    price: '${json['price'] ?? ''}',
    expiry: int.tryParse('${json['expiry'] ?? 0}') ?? 0,
    expiryUnit: '${json['expiryUnit'] ?? 'days'}',
    barcode: '${json['barcode'] ?? ''}'.replaceAll(RegExp(r'\D'), ''),
  );
}
