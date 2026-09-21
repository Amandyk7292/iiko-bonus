import 'dart:convert';
import 'package:http/http.dart' as http;
import 'product.dart';

class CatalogService {
  CatalogService({http.Client? client}) : _client = client ?? http.Client();
  final http.Client _client;
  Future<List<Product>> load(String city) async {
    final response = await _client
        .get(
          Uri.https('bulka.com.kz', '/api/pricegenerator/products', {
            'city': city,
          }),
        )
        .timeout(const Duration(seconds: 12));
    if (response.statusCode != 200) {
      throw Exception('Сервер вернул ошибку ${response.statusCode}');
    }
    final body =
        jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    final values = body['products'] as List<dynamic>? ?? const [];
    return values
        .cast<Map<String, dynamic>>()
        .where((json) => json['archived'] != true)
        .map(Product.fromJson)
        .toList(growable: false);
  }
}
