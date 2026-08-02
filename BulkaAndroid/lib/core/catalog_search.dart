part of '../main.dart';

String normalizeCatalogSearch(String value) => value
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replaceAll(RegExp(r'[^a-zа-я0-9әғқңөұүһі]+', caseSensitive: false), ' ')
    .replaceAll(RegExp(r'\s+'), ' ')
    .trim();

int catalogEditDistance(String first, String second, {int maximum = 3}) {
  final left = normalizeCatalogSearch(first);
  final right = normalizeCatalogSearch(second);
  if (left == right) return 0;
  if ((left.length - right.length).abs() > maximum) return maximum + 1;
  var previous = List<int>.generate(right.length + 1, (index) => index);
  List<int>? beforePrevious;
  for (var row = 1; row <= left.length; row++) {
    final current = List<int>.filled(right.length + 1, 0)..[0] = row;
    var rowMinimum = current[0];
    for (var column = 1; column <= right.length; column++) {
      final cost = left.codeUnitAt(row - 1) == right.codeUnitAt(column - 1)
          ? 0
          : 1;
      current[column] = min(
        min(current[column - 1] + 1, previous[column] + 1),
        previous[column - 1] + cost,
      );
      if (row > 1 &&
          column > 1 &&
          left.codeUnitAt(row - 1) == right.codeUnitAt(column - 2) &&
          left.codeUnitAt(row - 2) == right.codeUnitAt(column - 1)) {
        current[column] = min(current[column], beforePrevious![column - 2] + 1);
      }
      rowMinimum = min(rowMinimum, current[column]);
    }
    if (rowMinimum > maximum) return maximum + 1;
    beforePrevious = previous;
    previous = current;
  }
  return previous.last;
}

int _catalogTokenScore(String queryToken, String candidate) {
  if (candidate == queryToken) return 34;
  if (candidate.startsWith(queryToken)) return 26;
  if (candidate.contains(queryToken)) return 18;
  final tolerance = queryToken.length >= 7
      ? 2
      : queryToken.length >= 4
      ? 1
      : 0;
  if (tolerance == 0 ||
      (candidate.length - queryToken.length).abs() > tolerance) {
    return 0;
  }
  final distance = catalogEditDistance(
    queryToken,
    candidate,
    maximum: tolerance,
  );
  return distance <= tolerance ? 15 - distance * 3 : 0;
}

int catalogSearchScore(CatalogProduct product, String rawQuery) {
  final query = normalizeCatalogSearch(rawQuery);
  if (query.isEmpty) return 1;
  final title = normalizeCatalogSearch(product.title);
  final primary = normalizeCatalogSearch(
    '${product.title} ${product.category}',
  );
  final secondary = normalizeCatalogSearch(
    [
      product.description,
      product.ingredients,
      ...product.allergens,
      ...product.dietaryTags,
      ...product.searchKeywords,
    ].join(' '),
  );
  var score = 0;
  if (title == query) score += 160;
  if (title.startsWith(query)) score += 90;
  if (title.contains(query)) score += 65;
  if (primary.contains(query)) score += 35;
  if (secondary.contains(query)) score += 20;

  final candidates = '$primary $secondary'
      .split(' ')
      .where((word) => word.isNotEmpty)
      .toSet();
  for (final token in query.split(' ').where((word) => word.isNotEmpty)) {
    var best = 0;
    for (final candidate in candidates) {
      best = max(best, _catalogTokenScore(token, candidate));
    }
    if (best == 0) return 0;
    score += best;
  }
  return score;
}

List<CatalogProduct> rankCatalogProducts(
  Iterable<CatalogProduct> products,
  String query,
) {
  final ranked =
      products
          .map(
            (product) =>
                (product: product, score: catalogSearchScore(product, query)),
          )
          .where((entry) => entry.score > 0)
          .toList()
        ..sort(
          (left, right) => right.score.compareTo(left.score) != 0
              ? right.score.compareTo(left.score)
              : catalogAlphabeticalCompare(
                  left.product.title,
                  right.product.title,
                ),
        );
  return ranked.map((entry) => entry.product).toList();
}

List<String> catalogSearchSuggestions(
  Iterable<CatalogProduct> products,
  String query, {
  int limit = 3,
}) {
  final normalized = normalizeCatalogSearch(query);
  if (normalized.length < 2) return const [];
  return rankCatalogProducts(products, query)
      .map((product) => product.title)
      .where((title) => normalizeCatalogSearch(title) != normalized)
      .toSet()
      .take(limit)
      .toList();
}
