part of '../main.dart';

extension CustomerPaymentReceiptApi on BulkaApiClient {
  Future<PaymentReceipt> getPaymentReceipt(String url) async {
    final base = Uri.parse(_apiBaseUrl);
    final candidate = Uri.tryParse(url);
    if (candidate == null ||
        !candidate.hasAuthority ||
        candidate.origin != base.origin ||
        !RegExp(
          r'^/payment-receipts/[a-fA-F0-9-]{36}$',
        ).hasMatch(candidate.path)) {
      throw ApiException('receipt_load_error'.tr);
    }
    final uri = candidate.replace(
      queryParameters: {...candidate.queryParameters, 'lang': AppLang.current},
    );
    // The signed receipt URL authorizes this request. Never send a session token
    // or follow a redirect from it to a different host.
    final request = http.Request('GET', uri)
      ..followRedirects = false
      ..headers.addAll({
        'Accept': 'application/json',
        'Accept-Language': AppLang.current,
      });
    final response = await http.Response.fromStream(
      await _client.send(request).timeout(const Duration(seconds: 20)),
    ).timeout(const Duration(seconds: 20));
    if (response.statusCode != 200) throw ApiException('receipt_load_error'.tr);
    final result = _asMap(jsonDecode(utf8.decode(response.bodyBytes)));
    final receipt = _asMap(result['receipt']);
    if (result['success'] != true || receipt.isEmpty) {
      throw ApiException('receipt_load_error'.tr);
    }
    return PaymentReceipt.fromJson(receipt);
  }
}
