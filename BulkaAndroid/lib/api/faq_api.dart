part of '../main.dart';

@immutable
class FaqItem {
  const FaqItem({
    required this.id,
    required this.question,
    required this.answer,
    required this.sortOrder,
  });

  final String id;
  final String question;
  final String answer;
  final int sortOrder;

  factory FaqItem.fromJson(Map<String, dynamic> json) {
    final question = json['question'];
    final answer = json['answer'];
    final id = _asString(json['id']);
    if (id.isEmpty ||
        question is! String ||
        question.trim().isEmpty ||
        answer is! String ||
        answer.trim().isEmpty) {
      throw ApiException('faq_load_error'.tr);
    }
    return FaqItem(
      id: id,
      question: question.trim(),
      answer: answer.trim(),
      sortOrder: _asInt(json['sortOrder']),
    );
  }
}

class _FaqCacheEntry {
  const _FaqCacheEntry(this.items, this.loadedAt);
  final List<FaqItem> items;
  final DateTime loadedAt;
}

extension FaqApi on BulkaApiClient {
  /// Public content has no customer scope. Keep each language for one minute;
  /// explicit refresh bypasses the cache and concurrent reads share a request.
  Future<List<FaqItem>> getPublicFaq({
    String? language,
    bool refresh = false,
  }) async {
    final requested = language ?? AppLang.current;
    final lang = AppLang.supportedCodes.contains(requested) ? requested : 'ru';
    final pending = _faqRequests[lang];
    if (pending != null) return pending;
    final cached = _faqCache[lang];
    if (!refresh &&
        cached != null &&
        DateTime.now().difference(cached.loadedAt) <
            const Duration(minutes: 1)) {
      return cached.items;
    }
    final request = _fetchPublicFaq(lang);
    _faqRequests[lang] = request;
    try {
      final items = await request;
      _faqCache[lang] = _FaqCacheEntry(items, DateTime.now());
      return items;
    } finally {
      if (identical(_faqRequests[lang], request)) _faqRequests.remove(lang);
    }
  }

  Future<List<FaqItem>> _fetchPublicFaq(String lang) async {
    final json = await _request(
      'GET',
      '/api/public/faq?lang=$lang',
      bearerToken: '',
      allowRefresh: false,
      refreshOnUnauthorized: false,
    );
    final rawItems = json['items'];
    if (json['success'] != true || rawItems is! List) {
      throw ApiException('faq_load_error'.tr);
    }
    final items = rawItems.map((raw) => FaqItem.fromJson(_asMap(raw))).toList()
      ..sort((left, right) {
        final order = left.sortOrder.compareTo(right.sortOrder);
        return order == 0 ? left.id.compareTo(right.id) : order;
      });
    return List.unmodifiable(items);
  }
}
