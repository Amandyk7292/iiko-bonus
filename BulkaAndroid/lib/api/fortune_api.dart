part of '../main.dart';

extension FortuneCustomerApi on BulkaApiClient {
  Future<Map<String, dynamic>> claimFortunePrize(String claimToken) async {
    final result = await _post('/api/customer/fortune/claim', {
      'claimToken': claimToken,
    });
    final prize = _asMap(result['prize']);
    if (result['success'] != true || prize.isEmpty) {
      throw ApiException(_messageFrom(result, fortuneText('claimError')));
    }
    return prize;
  }

  Future<List<Map<String, dynamic>>> getFortunePrizes() async {
    final result = await _get('/api/customer/fortune/prizes');
    if (result['success'] != true || result['items'] is! List) {
      throw ApiException(_messageFrom(result, fortuneText('loadError')));
    }
    return (result['items'] as List).map(_asMap).toList(growable: false);
  }

  Future<Map<String, dynamic>> redeemFortuneBonus(String id) async {
    final result = await _post(
      '/api/customer/fortune/prizes/${Uri.encodeComponent(id)}/redeem',
      const {},
    );
    final prize = _asMap(result['prize']);
    if (result['success'] != true || prize.isEmpty) {
      throw ApiException(_messageFrom(result, fortuneText('redeemError')));
    }
    return prize;
  }
}
