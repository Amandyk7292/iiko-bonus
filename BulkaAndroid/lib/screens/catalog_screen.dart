part of '../main.dart';

const _catalogAllCategoryKey = '__all_categories__';

String? _catalogCategoryFallbackAsset(String category) {
  final normalized = normalizeCatalogSearch(category);
  if (normalized.contains('блин') ||
      normalized.contains('бауыр') ||
      normalized.contains('құймақ') ||
      normalized.contains('pancake') ||
      normalized.contains('baursak')) {
    return 'assets/categories/category_pancakes_baursak.webp';
  }
  if (normalized.contains('печень') || normalized.contains('cookie')) {
    return 'assets/categories/category_cookies.webp';
  }
  if (normalized.contains('торт') ||
      normalized.contains('cake') ||
      normalized.contains('десерт') ||
      normalized.contains('dessert') ||
      normalized.contains('кондитер') ||
      normalized.contains('кулич')) {
    return 'assets/categories/category_cake.webp';
  }
  if (normalized.contains('хлеб') ||
      normalized.contains('нан') ||
      normalized.contains('булоч') ||
      normalized.contains('тоқаш') ||
      normalized.contains('круас') ||
      normalized.contains('выпеч') ||
      normalized.contains('bread') ||
      normalized.contains('bun') ||
      normalized.contains('pastry') ||
      normalized.contains('bakery')) {
    return 'assets/order/pickup_banner.jpg';
  }
  return null;
}

@immutable
class ProductStorageCondition {
  const ProductStorageCondition({
    required this.temperature,
    required this.durationValue,
    required this.durationUnit,
  });

  final String temperature;
  final int durationValue;
  final String durationUnit;
}

List<ProductStorageCondition> productStorageConditionsFromJson(dynamic value) {
  final source = value is List ? value : const [];
  return source
      .take(2)
      .map((raw) {
        final condition = _asMap(raw);
        final temperature = _asString(condition['temperature']).trim();
        final durationRaw =
            condition['durationValue'] ?? condition['duration_value'];
        final durationValue = durationRaw is num
            ? durationRaw.round()
            : int.tryParse('$durationRaw') ?? 0;
        final durationUnit = _asString(
          condition['durationUnit'] ?? condition['duration_unit'],
        ).trim();
        if (temperature.isEmpty ||
            durationValue <= 0 ||
            !const {'hours', 'days', 'months'}.contains(durationUnit)) {
          return null;
        }
        return ProductStorageCondition(
          temperature: temperature,
          durationValue: durationValue,
          durationUnit: durationUnit,
        );
      })
      .whereType<ProductStorageCondition>()
      .toList();
}

String productStorageDurationLabel(ProductStorageCondition condition) {
  final value = condition.durationValue;
  final language = appLanguageNotifier.value;
  final form = language == 'ru'
      ? (value % 10 == 1 && value % 100 != 11
            ? 'one'
            : value % 10 >= 2 &&
                  value % 10 <= 4 &&
                  (value % 100 < 12 || value % 100 > 14)
            ? 'few'
            : 'many')
      : language == 'en' && value == 1
      ? 'one'
      : 'many';
  return 'catalog_storage_${condition.durationUnit}_$form'.trArgs({
    'count': value,
  });
}

class CatalogProduct {
  const CatalogProduct({
    required this.id,
    required this.title,
    required this.price,
    required this.category,
    required this.imageUrl,
    required this.inStockCount,
    required this.preparationMinutes,
    this.description = '',
    this.isStopListed = false,
    this.ingredients = '',
    this.allergens = const [],
    this.dietaryTags = const [],
    this.searchKeywords = const [],
    this.weightGrams,
    this.caloriesKcal,
    this.proteinGrams,
    this.fatGrams,
    this.carbsGrams,
    this.storageConditions = const [],
  });

  final String id;
  final String title;
  final int price;
  final String category;
  final String imageUrl;
  final int? inStockCount;
  final int preparationMinutes;
  final String description;
  final bool isStopListed;
  final String ingredients;
  final List<String> allergens;
  final List<String> dietaryTags;
  final List<String> searchKeywords;
  final int? weightGrams;
  final double? caloriesKcal;
  final double? proteinGrams;
  final double? fatGrams;
  final double? carbsGrams;
  final List<ProductStorageCondition> storageConditions;

  bool get hasNutrition =>
      caloriesKcal != null ||
      proteinGrams != null ||
      fatGrams != null ||
      carbsGrams != null;
}

String _catalogDisplayName(dynamic value) {
  final text = value.toString().trim().replaceAll(RegExp(r'\s+'), ' ');
  if (text.isEmpty || text == text.toLowerCase()) return text;
  final letters = RegExp(
    r'[A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]',
  ).allMatches(text).length;
  if (letters < 4 || text != text.toUpperCase()) return text;

  final lower = text.toLowerCase();
  final firstLetter = RegExp(
    r'[A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]',
  ).firstMatch(lower);
  if (firstLetter == null) return lower;
  final index = firstLetter.start;
  return lower.replaceRange(index, index + 1, lower[index].toUpperCase());
}

String _catalogFactCode(String value) =>
    value.trim().toLowerCase().replaceAll(RegExp(r'[\s-]+'), '_');

String? _allergenIconName(String value) => switch (_catalogFactCode(value)) {
  'gluten' || 'глютен' => 'gluten',
  'milk' || 'молоко' || 'сүт' => 'milk',
  'egg' || 'eggs' || 'яйцо' || 'яйца' || 'жұмыртқа' => 'egg',
  'nuts' || 'tree_nuts' || 'орехи' || 'жаңғақтар' => 'nuts',
  'peanut' || 'peanuts' || 'арахис' || 'жержаңғақ' => 'peanut',
  'sesame' || 'кунжут' || 'күнжіт' => 'sesame',
  'soy' || 'соя' => 'soy',
  _ => null,
};

String? _productMarkIconName(String value) => switch (_catalogFactCode(value)) {
  'halal' || 'халяль' => 'halal',
  'eac' => 'eac',
  'iso' => 'iso',
  'traces_nuts_sesame' ||
  'может_содержать_следы_орехов_и_кунжута' ||
  'возможны_следы_орехов_и_кунжута' => 'traces-nuts-sesame',
  'not_for_under_3' || 'не_рекомендуется_детям_до_3_лет' => 'under-3',
  'vegetarian' || 'вегетарианское' => 'vegetarian',
  'vegan' || 'веганское' => 'vegan',
  'sugar_free' || 'без_сахара' => 'sugar-free',
  'lactose_free' || 'без_лактозы' => 'lactose-free',
  _ => null,
};

bool _isDietaryFilterTag(String value) => !{
  'eac',
  'iso',
  'traces_nuts_sesame',
  'может_содержать_следы_орехов_и_кунжута',
  'возможны_следы_орехов_и_кунжута',
  'not_for_under_3',
  'не_рекомендуется_детям_до_3_лет',
}.contains(_catalogFactCode(value));

List<CatalogProduct> catalogProductsWithStopListLast(
  Iterable<CatalogProduct> products,
) => [
  ...products.where((product) => !product.isStopListed),
  ...products.where((product) => product.isStopListed),
];

const _catalogAlphabet = <String, int>{
  'а': 10,
  'ә': 11,
  'б': 12,
  'в': 13,
  'г': 14,
  'ғ': 15,
  'д': 16,
  'е': 17,
  'ё': 18,
  'ж': 19,
  'з': 20,
  'и': 21,
  'й': 22,
  'к': 23,
  'қ': 24,
  'л': 25,
  'м': 26,
  'н': 27,
  'ң': 28,
  'о': 29,
  'ө': 30,
  'п': 31,
  'р': 32,
  'с': 33,
  'т': 34,
  'у': 35,
  'ұ': 36,
  'ү': 37,
  'ф': 38,
  'х': 39,
  'һ': 40,
  'ц': 41,
  'ч': 42,
  'ш': 43,
  'щ': 44,
  'ъ': 45,
  'ы': 46,
  'і': 47,
  'ь': 48,
  'э': 49,
  'ю': 50,
  'я': 51,
};

int _catalogSortRuneWeight(int rune) {
  final character = String.fromCharCode(rune).toLowerCase();
  final alphabetWeight = _catalogAlphabet[character];
  if (alphabetWeight != null) return alphabetWeight;
  if (rune >= 48 && rune <= 57) return rune - 48;
  if (rune >= 65 && rune <= 90) return 100 + rune - 65;
  if (rune >= 97 && rune <= 122) return 100 + rune - 97;
  return 1000 + rune;
}

int catalogAlphabeticalCompare(String left, String right) {
  final leftRunes = left.trim().toLowerCase().runes.toList(growable: false);
  final rightRunes = right.trim().toLowerCase().runes.toList(growable: false);
  final sharedLength = min(leftRunes.length, rightRunes.length);
  for (var index = 0; index < sharedLength; index++) {
    final comparison = _catalogSortRuneWeight(
      leftRunes[index],
    ).compareTo(_catalogSortRuneWeight(rightRunes[index]));
    if (comparison != 0) return comparison;
  }
  return leftRunes.length.compareTo(rightRunes.length);
}

List<CatalogProduct> catalogProductsAlphabetically(
  Iterable<CatalogProduct> products,
) => products.toList()
  ..sort((left, right) => catalogAlphabeticalCompare(left.title, right.title));

enum _CatalogSort { menu, priceLow, priceHigh }

@immutable
class _CatalogFilterResult {
  const _CatalogFilterResult({
    required this.sort,
    required this.onlyAvailable,
    this.dietaryTags = const {},
    this.excludedAllergens = const {},
  });

  final _CatalogSort sort;
  final bool onlyAvailable;
  final Set<String> dietaryTags;
  final Set<String> excludedAllergens;

  bool get isActive =>
      sort != _CatalogSort.menu ||
      onlyAvailable ||
      dietaryTags.isNotEmpty ||
      excludedAllergens.isNotEmpty;
}

class CatalogScreen extends StatefulWidget {
  const CatalogScreen({
    required this.api,
    this.orderType = 'pickup',
    this.hasSelectedOrderType = false,
    this.selectionRevision = 0,
    this.onRequestOrderType,
    this.initialClientUri,
    super.key,
  });

  final BulkaApiClient api;
  final String orderType;
  final bool hasSelectedOrderType;
  final int selectionRevision;
  final VoidCallback? onRequestOrderType;
  final Uri? initialClientUri;

  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen>
    with WidgetsBindingObserver {
  static const _menuRefreshInterval = Duration(seconds: 60);

  final _searchController = TextEditingController();
  final ValueNotifier<Map<String, CatalogProduct>> _liveProducts =
      ValueNotifier(const {});
  String _selectedBakery = '';
  String _selectedBakeryId = '';
  DeliveryAddress? _selectedDeliveryAddress;
  String _searchQuery = '';
  String _selectedCategory = _catalogAllCategoryKey;
  _CatalogSort _sort = _CatalogSort.menu;
  bool _onlyAvailable = false;
  Set<String> _dietaryFilters = const {};
  Set<String> _excludedAllergens = const {};
  Set<String> _favoriteProductIds = const {};
  bool _favoritesOnly = false;
  Map<String, String> _apiCategoryImages = {};
  String? _openedCategory;
  bool _orderTypeDialogOpen = false;
  final _navigationGate = _AsyncActionGate();
  Uri? _pendingClientUri;
  bool _productRouteOpen = false;

  List<String> _categories = const [_catalogAllCategoryKey];
  List<CatalogProduct> _allProducts = const [];
  bool _isLoading = true;
  bool _usingCachedMenu = false;
  DateTime? _menuCachedAt;
  String? _loadError;
  String _trackedCatalogKey = '';
  int _menuLoadRevision = 0;

  // Авто-обновление меню каждую минуту
  Timer? _autoRefreshTimer;
  StreamSubscription<Map<String, dynamic>>? _menuEventSubscription;

  BulkaApiClient get _api => widget.api;

  String get _orderType => _orderTypeFromWire(widget.orderType).wireValue;

  String get _menuEndpoint {
    final query = <String, String>{'orderType': _orderType};
    if (_selectedBakeryId.isNotEmpty) {
      query['branchId'] = _selectedBakeryId;
    }
    return Uri(path: '/api/guest/menu', queryParameters: query).toString();
  }

  String get _menuCacheKey =>
      'catalog_cache_${AppLang.current}_${_orderType}_${_selectedBakeryId.isEmpty ? 'all' : _selectedBakeryId}';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    appLanguageNotifier.addListener(_onLanguageChanged);
    _pendingClientUri = widget.initialClientUri;
    unawaited(_loadSelectedBakery().then((_) => _loadMenu()));
    unawaited(_loadFavorites());
    _menuEventSubscription = _api.customerEvents.listen((event) {
      if (event['type'] == 'menu.updated') unawaited(_silentRefresh());
    });
    // Тихое фоновое обновление каждые 30 секунд
    _autoRefreshTimer = Timer.periodic(_menuRefreshInterval, (_) {
      _silentRefresh();
    });
  }

  static Uri _categoryClientUri(String category) {
    return Uri(pathSegments: ['', 'catalog', 'category', category]);
  }

  static Uri _productClientUri(CatalogProduct product) {
    return Uri(
      pathSegments: ['', 'catalog', 'product', product.id],
      queryParameters: {'category': product.category},
    );
  }

  void applyClientUri(Uri uri) {
    _pendingClientUri = normalizedClientUri(uri);
    _applyPendingClientUri();
  }

  void _applyPendingClientUri() {
    if (!mounted || _isLoading || _allProducts.isEmpty) return;
    final uri = _pendingClientUri;
    if (uri == null) return;
    final segments = uri.pathSegments
        .where((value) => value.isNotEmpty)
        .toList();
    if (segments.isEmpty || segments.first != 'catalog') {
      if (_productRouteOpen) unawaited(Navigator.of(context).maybePop());
      if (_openedCategory != null) setState(() => _openedCategory = null);
      return;
    }

    if (segments.length >= 3 && segments[1] == 'product') {
      final productId = segments[2];
      CatalogProduct? product;
      for (final candidate in _allProducts) {
        if (candidate.id == productId) {
          product = candidate;
          break;
        }
      }
      if (product == null) {
        publishClientRoute(Uri(path: '/catalog'), replace: true);
        if (_openedCategory != null) setState(() => _openedCategory = null);
        return;
      }
      if (_openedCategory != product.category) {
        setState(() => _openedCategory = product!.category);
      }
      if (!_productRouteOpen) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && !_productRouteOpen) {
            unawaited(_openProductDetails(product!, updateClientRoute: false));
          }
        });
      }
      return;
    }

    if (_productRouteOpen) unawaited(Navigator.of(context).maybePop());
    if (segments.length >= 3 && segments[1] == 'category') {
      final requested = segments[2];
      String? category;
      for (final candidate in _categories) {
        if (candidate == _catalogAllCategoryKey) continue;
        if (candidate == requested ||
            candidate.toLowerCase() == requested.toLowerCase()) {
          category = candidate;
          break;
        }
      }
      if (category != null && _openedCategory != category) {
        setState(() => _openedCategory = category);
      }
      return;
    }
    if (_openedCategory != null) setState(() => _openedCategory = null);
  }

  void _onLanguageChanged() {
    _loadMenu();
  }

  @override
  void didUpdateWidget(covariant CatalogScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final previousType = _orderTypeFromWire(oldWidget.orderType).wireValue;
    if (previousType == _orderType &&
        oldWidget.selectionRevision == widget.selectionRevision) {
      return;
    }
    setState(() {
      _selectedCategory = _catalogAllCategoryKey;
      _openedCategory = null;
      _categories = const [_catalogAllCategoryKey];
      _allProducts = const [];
      _apiCategoryImages = {};
      _isLoading = true;
      _usingCachedMenu = false;
      _loadError = null;
      _trackedCatalogKey = '';
    });
    unawaited(_loadSelectedBakery().then((_) => _loadMenu()));
  }

  @override
  void dispose() {
    appLanguageNotifier.removeListener(_onLanguageChanged);
    _autoRefreshTimer?.cancel();
    _menuEventSubscription?.cancel();
    _searchController.dispose();
    _liveProducts.dispose();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Обновить меню когда приложение возвращается из фона
    if (state == AppLifecycleState.resumed) {
      _silentRefresh();
    }
  }

  /// Тихое обновление — без спиннера, данные просто подменяются
  Future<void> _silentRefresh() async {
    if (!mounted) return;
    final revision = ++_menuLoadRevision;
    final endpoint = _menuEndpoint;
    final cacheKey = _menuCacheKey;
    try {
      final json = await _api._get(endpoint);
      if (!_isCurrentMenuRequest(revision, endpoint)) return;

      final categoriesRaw = json['categories'] as List? ?? [];
      final productsRaw = json['products'] as List? ?? [];

      final categoryNames = <String>[_catalogAllCategoryKey];
      final categoryMap = <String, String>{};
      final categoryImages = <String, String>{};
      for (final c in categoriesRaw) {
        final id = (c['id'] ?? '').toString();
        final name = _catalogDisplayName(c['name'] ?? '');
        final imageUrl = (c['imageUrl'] ?? '').toString();
        if (name.isNotEmpty) {
          categoryNames.add(name);
          categoryMap[id] = name;
          if (imageUrl.isNotEmpty) categoryImages[name] = imageUrl;
        }
      }

      final products = <CatalogProduct>[];
      for (final p in productsRaw) {
        products.add(_catalogProduct(p, categoryMap));
      }
      for (final product in products) {
        if (product.imageUrl.trim().isNotEmpty) {
          categoryImages.putIfAbsent(product.category, () => product.imageUrl);
          categoryImages.putIfAbsent(
            _catalogAllCategoryKey,
            () => product.imageUrl,
          );
        }
      }

      final changed =
          jsonEncode(
            products
                .map(
                  (p) => [
                    p.id,
                    p.title,
                    p.price,
                    p.category,
                    p.imageUrl,
                    p.isStopListed,
                    p.preparationMinutes,
                  ],
                )
                .toList(),
          ) !=
          jsonEncode(
            _allProducts
                .map(
                  (p) => [
                    p.id,
                    p.title,
                    p.price,
                    p.category,
                    p.imageUrl,
                    p.isStopListed,
                    p.preparationMinutes,
                  ],
                )
                .toList(),
          );

      final cachedAt = await _cacheMenu(json, cacheKey: cacheKey);
      if (!_isCurrentMenuRequest(revision, endpoint)) return;
      _syncCartWithMenu(products);

      setState(() {
        _categories = categoryNames;
        _apiCategoryImages = categoryImages;
        _allProducts = products;
        _usingCachedMenu = false;
        _menuCachedAt = cachedAt;
        _loadError = null;
      });
      unawaited(_warmProductImages(products));
      if (changed && mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('catalog_menu_updated'.tr)));
      }
    } catch (_) {
      // Тихая ошибка — не показываем пользователю
    }
  }

  Future<void> _loadMenu() async {
    if (!mounted) return;
    final revision = ++_menuLoadRevision;
    final endpoint = _menuEndpoint;
    final cacheKey = _menuCacheKey;
    try {
      setState(() {
        _isLoading = _allProducts.isEmpty;
        if (_allProducts.isEmpty) _usingCachedMenu = false;
        _loadError = null;
      });
      final json = await _api._get(endpoint);
      if (!_isCurrentMenuRequest(revision, endpoint)) return;

      final categoriesRaw = json['categories'] as List? ?? [];
      final productsRaw = json['products'] as List? ?? [];

      final categoryNames = <String>[_catalogAllCategoryKey];
      final categoryMap = <String, String>{};
      final categoryImages = <String, String>{};
      for (final c in categoriesRaw) {
        final id = (c['id'] ?? '').toString();
        final name = _catalogDisplayName(c['name'] ?? '');
        final imageUrl = (c['imageUrl'] ?? '').toString();
        if (name.isNotEmpty) {
          categoryNames.add(name);
          categoryMap[id] = name;
          if (imageUrl.isNotEmpty) categoryImages[name] = imageUrl;
        }
      }

      final products = <CatalogProduct>[];
      for (final p in productsRaw) {
        products.add(_catalogProduct(p, categoryMap));
      }
      for (final product in products) {
        if (product.imageUrl.trim().isNotEmpty) {
          categoryImages.putIfAbsent(product.category, () => product.imageUrl);
          categoryImages.putIfAbsent(
            _catalogAllCategoryKey,
            () => product.imageUrl,
          );
        }
      }

      final cachedAt = await _cacheMenu(json, cacheKey: cacheKey);
      if (!_isCurrentMenuRequest(revision, endpoint)) return;
      _syncCartWithMenu(products);

      setState(() {
        _categories = categoryNames;
        _apiCategoryImages = categoryImages;
        _allProducts = products;
        _isLoading = false;
        _usingCachedMenu = false;
        _menuCachedAt = cachedAt;
      });
      _applyPendingClientUri();
      unawaited(_warmProductImages(products));
      final analyticsKey = '${AppLang.current}:$_orderType:$_selectedBakeryId';
      if (_trackedCatalogKey != analyticsKey) {
        _trackedCatalogKey = analyticsKey;
        _api.trackEvent(
          'catalog_view',
          branchId: _selectedBakeryId,
          properties: {'products': products.length},
        );
      }
    } catch (e) {
      if (!_isCurrentMenuRequest(revision, endpoint)) return;
      if (_allProducts.isNotEmpty) {
        setState(() {
          _isLoading = false;
          _usingCachedMenu = true;
          _loadError = null;
        });
        return;
      }
      if (_allProducts.isEmpty &&
          await _restoreCachedMenu(
            cacheKey: cacheKey,
            revision: revision,
            endpoint: endpoint,
          )) {
        return;
      }
      if (!_isCurrentMenuRequest(revision, endpoint)) return;
      setState(() {
        _isLoading = false;
        _loadError = e.toString();
      });
    }
  }

  bool _isCurrentMenuRequest(int revision, String endpoint) =>
      mounted && revision == _menuLoadRevision && endpoint == _menuEndpoint;

  Future<void> _loadFavorites() async {
    try {
      final local = await FavoriteStore.loadGuest();
      final favorites = _api.isAuthenticated
          ? await FavoriteStore.mergeIntoAccount(
              _api,
              await _api.getFavorites(),
            )
          : local;
      if (!mounted) return;
      setState(() => _favoriteProductIds = favorites);
    } catch (_) {
      if (!mounted) return;
      setState(() => _favoriteProductIds = const {});
    }
  }

  Future<bool> _toggleFavorite(CatalogProduct product) async {
    final wasFavorite = _favoriteProductIds.contains(product.id);
    final nextFavorite = !wasFavorite;
    setState(() {
      final next = {..._favoriteProductIds};
      nextFavorite ? next.add(product.id) : next.remove(product.id);
      _favoriteProductIds = next;
    });
    unawaited(BulkaMotion.selection());
    try {
      if (_api.isAuthenticated) {
        await _api.setFavorite(product.id, nextFavorite);
      } else {
        await FavoriteStore.setGuest(product.id, nextFavorite);
      }
      return nextFavorite;
    } catch (_) {
      if (mounted) {
        setState(() {
          final restored = {..._favoriteProductIds};
          wasFavorite ? restored.add(product.id) : restored.remove(product.id);
          _favoriteProductIds = restored;
        });
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('error_save'.tr)));
      }
      return wasFavorite;
    }
  }

  int? _productAvailability(dynamic raw) {
    final product = _asMap(raw);
    final value = product['availableQuantity'] ?? product['inStockCount'];
    if (value == null) return null;
    final number = value is num ? value : num.tryParse(value.toString());
    return number?.floor().clamp(0, 100000).toInt();
  }

  int _productPreparation(dynamic raw) {
    final value = _asMap(raw)['preparationMinutes'];
    final minutes = value is num ? value.round() : int.tryParse('$value');
    return (minutes ?? 15).clamp(1, 240);
  }

  List<String> _productStringList(dynamic raw, String key) =>
      (_asMap(raw)[key] as List? ?? const [])
          .map((value) => value.toString().trim())
          .where((value) => value.isNotEmpty)
          .toSet()
          .toList();

  double? _productNumber(dynamic value) {
    if (value == null) return null;
    final parsed = value is num
        ? value.toDouble()
        : double.tryParse(value.toString());
    return parsed != null && parsed >= 0 ? parsed : null;
  }

  CatalogProduct _catalogProduct(dynamic raw, Map<String, String> categoryMap) {
    final product = _asMap(raw);
    final availability = _productAvailability(product);
    final nutrition = _asMap(product['nutrition']);
    return CatalogProduct(
      id: _asString(product['id']),
      title: _asString(product['name']),
      price: (product['price'] as num?)?.round() ?? 0,
      category:
          categoryMap[_asString(product['categoryId'])] ??
          'catalog_other_category'.tr,
      imageUrl: _asString(product['imageUrl']),
      inStockCount: availability,
      preparationMinutes: _productPreparation(product),
      description: _asString(product['description']),
      ingredients: _asString(product['ingredients']),
      allergens: _productStringList(product, 'allergens'),
      dietaryTags: _productStringList(product, 'dietaryTags'),
      searchKeywords: _productStringList(product, 'searchKeywords'),
      weightGrams: _productNumber(product['weightGrams'])?.round(),
      caloriesKcal: _productNumber(nutrition['caloriesKcal']),
      proteinGrams: _productNumber(nutrition['proteinGrams']),
      fatGrams: _productNumber(nutrition['fatGrams']),
      carbsGrams: _productNumber(nutrition['carbsGrams']),
      storageConditions: productStorageConditionsFromJson(
        product['storageConditions'],
      ),
      isStopListed:
          product['inStopList'] == true ||
          product['onlineOrderable'] == false ||
          (availability != null && availability <= 0),
    );
  }

  Future<DateTime> _cacheMenu(
    Map<String, dynamic> json, {
    required String cacheKey,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final cachedAt = DateTime.now();
    await prefs.setString(
      cacheKey,
      jsonEncode({
        'cachedAt': cachedAt.toUtc().toIso8601String(),
        'payload': json,
      }),
    );
    return cachedAt;
  }

  Future<bool> _restoreCachedMenu({
    required String cacheKey,
    required int revision,
    required String endpoint,
  }) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(cacheKey);
      if (raw == null) return false;
      final envelope = _asMap(jsonDecode(raw));
      final nested = _asMap(envelope['payload']);
      final json = nested.isEmpty ? envelope : nested;
      final cachedAt = DateTime.tryParse(_asString(envelope['cachedAt']));
      final categoriesRaw = json['categories'] as List? ?? [];
      final productsRaw = json['products'] as List? ?? [];
      final categoryNames = <String>[_catalogAllCategoryKey];
      final categoryMap = <String, String>{};
      final categoryImages = <String, String>{};
      for (final value in categoriesRaw) {
        final category = _asMap(value);
        final id = _asString(category['id']);
        final name = _catalogDisplayName(category['name']);
        final image = _asString(category['imageUrl']);
        if (name.isEmpty) continue;
        categoryNames.add(name);
        categoryMap[id] = name;
        if (image.isNotEmpty) categoryImages[name] = image;
      }
      final products = productsRaw
          .map((value) => _catalogProduct(value, categoryMap))
          .where((product) => product.id.isNotEmpty)
          .toList();
      for (final product in products) {
        if (product.imageUrl.trim().isNotEmpty) {
          categoryImages.putIfAbsent(product.category, () => product.imageUrl);
          categoryImages.putIfAbsent(
            _catalogAllCategoryKey,
            () => product.imageUrl,
          );
        }
      }
      if (!_isCurrentMenuRequest(revision, endpoint) || products.isEmpty) {
        return false;
      }
      _syncCartWithMenu(products);
      setState(() {
        _categories = categoryNames;
        _apiCategoryImages = categoryImages;
        _allProducts = products;
        _isLoading = false;
        _usingCachedMenu = true;
        _menuCachedAt = cachedAt;
        _loadError = null;
      });
      _applyPendingClientUri();
      unawaited(_warmProductImages(products));
      return true;
    } catch (_) {
      return false;
    }
  }

  String get _cacheAgeText {
    final cachedAt = _menuCachedAt;
    if (cachedAt == null) return 'catalog_offline_cache'.tr;
    final minutes = max(
      0,
      DateTime.now().difference(cachedAt.toLocal()).inMinutes,
    );
    if (minutes < 1) return 'catalog_offline_cache_now'.tr;
    if (minutes < 60) {
      return 'catalog_offline_cache_minutes'.trArgs({'minutes': minutes});
    }
    return 'catalog_offline_cache_hours'.trArgs({
      'hours': max(1, minutes ~/ 60),
    });
  }

  Future<void> _warmProductImages(List<CatalogProduct> products) async {
    if (!mounted) return;
    final logicalExtent = min(
      217.0,
      max(120.0, (MediaQuery.sizeOf(context).width - 44) / 2 - 18),
    );
    final pixelSize = _imagePixelBucket(
      logicalExtent *
          networkImageDevicePixelRatio(
            MediaQuery.devicePixelRatioOf(context),
            isWeb: kIsWeb,
          ),
    );
    final urls = products
        .where((product) => !product.isStopListed)
        .map((product) => product.imageUrl.trim())
        .where((url) => url.isNotEmpty)
        .toSet()
        .take(4);

    await Future.wait(
      urls.map((url) async {
        final effectiveUrl = optimizedNetworkImageUrl(
          url,
          pixelWidth: pixelSize,
          pixelHeight: pixelSize,
          resizeMode: 'cover',
        );
        final source = NetworkImage(effectiveUrl);
        final ImageProvider<Object> provider = kIsWeb
            ? source
            : ResizeImage.resizeIfNeeded(pixelSize, pixelSize, source);
        try {
          await precacheImage(provider, context);
        } catch (_) {
          // The normal image error state remains available in the card.
        }
      }),
    );
  }

  void _syncCartWithMenu(List<CatalogProduct> products) {
    final liveProducts = {for (final product in products) product.id: product};
    for (final previous in _liveProducts.value.values) {
      if (liveProducts.containsKey(previous.id)) continue;
      liveProducts[previous.id] = CatalogProduct(
        id: previous.id,
        title: previous.title,
        price: previous.price,
        category: previous.category,
        imageUrl: previous.imageUrl,
        inStockCount: previous.inStockCount,
        preparationMinutes: previous.preparationMinutes,
        description: previous.description,
        ingredients: previous.ingredients,
        allergens: previous.allergens,
        dietaryTags: previous.dietaryTags,
        searchKeywords: previous.searchKeywords,
        weightGrams: previous.weightGrams,
        caloriesKcal: previous.caloriesKcal,
        proteinGrams: previous.proteinGrams,
        fatGrams: previous.fatGrams,
        carbsGrams: previous.carbsGrams,
        storageConditions: previous.storageConditions,
        isStopListed: true,
      );
    }
    _liveProducts.value = liveProducts;
    context.read<CartProvider>().reconcileMenu(
      products.map(
        (product) => CartProductSnapshot(
          id: product.id,
          name: product.title,
          price: product.price,
          imageUrl: product.imageUrl,
          isStopListed: product.isStopListed,
        ),
      ),
    );
  }

  Future<void> _loadSelectedBakery() async {
    final requestedOrderType = _orderType;
    final prefs = await SharedPreferences.getInstance();
    if (requestedOrderType == 'delivery') {
      DeliveryAddress? address;
      BakeryLocation? branch;
      try {
        address = await AddressRepository(api: _api).loadSelectedAddress();
      } catch (_) {
        address = null;
      }
      if (address != null) {
        try {
          branch = await _resolveDeliveryBranch(address);
        } catch (_) {
          branch = null;
        }
      }
      if (!mounted || requestedOrderType != _orderType) return;
      setState(() {
        _selectedBakery = branch?.displayLabel ?? '';
        _selectedBakeryId = branch?.id ?? '';
        _selectedDeliveryAddress = address;
      });
      return;
    }
    final typeKey = 'selected_bakery_location_$requestedOrderType';
    final typeIdKey = 'selected_bakery_location_id_$requestedOrderType';
    final selectedType = prefs.getString('selected_order_type')?.trim() ?? '';
    final selected =
        prefs.getString(typeKey)?.trim() ??
        (selectedType == requestedOrderType
            ? prefs.getString('selected_bakery_location')?.trim()
            : null) ??
        '';
    final selectedId =
        prefs.getString(typeIdKey)?.trim() ??
        (selectedType == requestedOrderType
            ? prefs.getString('selected_bakery_location_id')?.trim()
            : null) ??
        '';
    if (!mounted || requestedOrderType != _orderType) return;
    setState(() {
      _selectedBakery = selected;
      _selectedBakeryId = selectedId;
      _selectedDeliveryAddress = null;
    });
  }

  Future<void> _selectFulfillmentSource() async {
    await _navigationGate.run(() async {
      if (_orderType == 'delivery') {
        final selected = await Navigator.of(context).push<DeliveryAddress>(
          MaterialPageRoute(builder: (_) => AddressSelectionScreen(api: _api)),
        );
        if (!mounted || selected == null) return;
        BakeryLocation? branch;
        try {
          branch = await _resolveDeliveryBranch(selected);
        } catch (_) {
          branch = null;
        }
        if (!mounted) return;
        setState(() {
          _selectedDeliveryAddress = selected;
          _selectedBakery = branch?.displayLabel ?? '';
          _selectedBakeryId = branch?.id ?? '';
        });
        await _loadMenu();
        return;
      }
      final selected = await Navigator.of(context).push<String>(
        MaterialPageRoute(
          builder: (_) => LocationsScreen(orderType: _orderType),
        ),
      );
      if (!mounted || selected == null || selected.trim().isEmpty) return;
      final value = selected.trim();
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('selected_bakery_location', value);
      final selectedId =
          prefs.getString('selected_bakery_location_id')?.trim() ?? '';
      if (mounted) {
        setState(() {
          _selectedBakery = value;
          _selectedBakeryId = selectedId;
        });
        await _loadMenu();
      }
    });
  }

  String get _catalogMenuTitle => switch (_orderType) {
    'delivery' => 'catalog_delivery_menu'.tr,
    'preorder' => 'catalog_preorder_menu'.tr,
    _ => 'catalog_pickup_menu'.tr,
  };

  String get _fulfillmentSourceLabel => _orderType == 'delivery'
      ? 'catalog_delivery_address_label'.tr
      : 'catalog_bakery_label'.tr;

  String get _fulfillmentBannerAsset => switch (_orderType) {
    'delivery' => 'assets/order/delivery_banner.jpg',
    'preorder' => 'assets/order/preorder_banner.jpg',
    _ => 'assets/order/pickup_banner.jpg',
  };

  Future<BakeryLocation?> _resolveDeliveryBranch(
    DeliveryAddress address,
  ) async {
    final locations = await _api.getFulfillmentLocations();
    final candidates = <({BakeryLocation branch, double distance})>[];
    for (final branch in locations) {
      if (!branch.active ||
          !branch.deliveryEnabled ||
          branch.latitude == null ||
          branch.longitude == null) {
        continue;
      }
      final distance = distanceBetweenCoordinatesKm(
        firstLatitude: branch.latitude!,
        firstLongitude: branch.longitude!,
        secondLatitude: address.location.latitude,
        secondLongitude: address.location.longitude,
      );
      if (branch.deliveryZoneForDistance(distance) != null) {
        candidates.add((branch: branch, distance: distance));
      }
    }
    candidates.sort((left, right) => left.distance.compareTo(right.distance));
    return candidates.isEmpty ? null : candidates.first.branch;
  }

  List<String> get _sortedCategories {
    final categories =
        _categories
            .where((category) => category != _catalogAllCategoryKey)
            .toSet()
            .toList()
          ..sort(catalogAlphabeticalCompare);
    return [_catalogAllCategoryKey, ...categories];
  }

  List<CatalogProduct> get _filteredProducts {
    final categoryProducts = _allProducts.where(
      (product) =>
          _selectedCategory == _catalogAllCategoryKey ||
          product.category == _selectedCategory,
    );
    return _applyActiveProductFilters(
      categoryProducts,
      includeSearch: true,
      includeFavorites: true,
    );
  }

  bool get _filterActive => _CatalogFilterResult(
    sort: _sort,
    onlyAvailable: _onlyAvailable,
    dietaryTags: _dietaryFilters,
    excludedAllergens: _excludedAllergens,
  ).isActive;

  List<CatalogProduct> _applyActiveProductFilters(
    Iterable<CatalogProduct> source, {
    required bool includeSearch,
    required bool includeFavorites,
  }) {
    final candidates = source.where((p) {
      final matchesAvailability = !_onlyAvailable || !p.isStopListed;
      final matchesFavorite =
          !includeFavorites ||
          !_favoritesOnly ||
          _favoriteProductIds.contains(p.id);
      final normalizedTags = p.dietaryTags.map(normalizeCatalogSearch).toSet();
      final normalizedAllergens = p.allergens
          .map(normalizeCatalogSearch)
          .toSet();
      final matchesDiet = _dietaryFilters.every(
        (tag) => normalizedTags.contains(normalizeCatalogSearch(tag)),
      );
      final avoidsAllergens = _excludedAllergens.every(
        (allergen) =>
            !normalizedAllergens.contains(normalizeCatalogSearch(allergen)),
      );
      return matchesAvailability &&
          matchesFavorite &&
          matchesDiet &&
          avoidsAllergens;
    }).toList();
    final products = !includeSearch || _searchQuery.trim().isEmpty
        ? candidates
        : rankCatalogProducts(candidates, _searchQuery);
    switch (_sort) {
      case _CatalogSort.priceLow:
        products.sort((a, b) {
          final priceComparison = a.price.compareTo(b.price);
          return priceComparison != 0
              ? priceComparison
              : catalogAlphabeticalCompare(a.title, b.title);
        });
        break;
      case _CatalogSort.priceHigh:
        products.sort((a, b) {
          final priceComparison = b.price.compareTo(a.price);
          return priceComparison != 0
              ? priceComparison
              : catalogAlphabeticalCompare(a.title, b.title);
        });
        break;
      case _CatalogSort.menu:
        if (!includeSearch || _searchQuery.trim().isEmpty) {
          products.sort((a, b) => catalogAlphabeticalCompare(a.title, b.title));
        }
        break;
    }
    return _stopListedLast(products);
  }

  List<CatalogProduct> _stopListedLast(Iterable<CatalogProduct> source) =>
      catalogProductsWithStopListLast(source);

  List<String> get _searchSuggestions => catalogSearchSuggestions(
    _allProducts.where(
      (product) =>
          _selectedCategory == _catalogAllCategoryKey ||
          product.category == _selectedCategory,
    ),
    _searchQuery,
  );

  List<String> get _availableDietaryTags =>
      _allProducts
          .expand((product) => product.dietaryTags)
          .where(_isDietaryFilterTag)
          .toSet()
          .toList()
        ..sort();

  List<String> get _availableAllergens =>
      _allProducts.expand((product) => product.allergens).toSet().toList()
        ..sort();

  Future<void> _openFilterModal() async {
    await _navigationGate.run(() async {
      final result = await Navigator.of(context).push<_CatalogFilterResult>(
        MaterialPageRoute(
          builder: (_) => _CatalogFilterScreen(
            initialSort: _sort,
            initialOnlyAvailable: _onlyAvailable,
            dietaryTags: _availableDietaryTags,
            allergens: _availableAllergens,
            initialDietaryTags: _dietaryFilters,
            initialExcludedAllergens: _excludedAllergens,
          ),
        ),
      );
      if (!mounted || result == null) return;
      setState(() {
        _sort = result.sort;
        _onlyAvailable = result.onlyAvailable;
        _dietaryFilters = result.dietaryTags;
        _excludedAllergens = result.excludedAllergens;
      });
    });
  }

  void _clearSearch() {
    _searchController.clear();
    setState(() => _searchQuery = '');
  }

  void _resetCatalogFilters() {
    _searchController.clear();
    setState(() {
      _searchQuery = '';
      _selectedCategory = _catalogAllCategoryKey;
      _sort = _CatalogSort.menu;
      _onlyAvailable = false;
      _dietaryFilters = const {};
      _excludedAllergens = const {};
      _favoritesOnly = false;
    });
  }

  bool closeCategoryPage() {
    if (_openedCategory == null) return false;
    setState(() {
      _openedCategory = null;
    });
    publishClientRoute(Uri(path: '/catalog'), replace: true);
    return true;
  }

  void _openCategoryPage(String category) {
    if (category.trim().isEmpty) return;
    BulkaMotion.selection();
    setState(() {
      _openedCategory = category;
    });
    publishClientRoute(_categoryClientUri(category));
  }

  List<MapEntry<String, List<CatalogProduct>>> get _categoryGroups {
    final grouped = <String, List<CatalogProduct>>{};
    for (final category in _categories) {
      if (category == _catalogAllCategoryKey) continue;
      grouped.putIfAbsent(category, () => <CatalogProduct>[]);
    }
    for (final product in _allProducts) {
      grouped
          .putIfAbsent(product.category, () => <CatalogProduct>[])
          .add(product);
    }
    final entries = grouped.entries
        .where((entry) => entry.value.isNotEmpty)
        .map(
          (entry) => MapEntry(
            entry.key,
            _stopListedLast(catalogProductsAlphabetically(entry.value)),
          ),
        )
        .toList();
    entries.sort(
      (left, right) => catalogAlphabeticalCompare(left.key, right.key),
    );
    return entries;
  }

  Future<bool> _ensureOrderTypeSelected() async {
    if (widget.hasSelectedOrderType) return true;
    if (_orderTypeDialogOpen || !mounted) return false;
    _orderTypeDialogOpen = true;
    final openHome = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => Dialog(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        insetPadding: const EdgeInsets.symmetric(horizontal: 24),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(BulkaRadii.card),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'catalog_select_order_type_first'.tr,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontFamily: _headingFont,
                  color: _textDark,
                  fontSize: BulkaTypeScale.title,
                  height: 1.35,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: FilledButton(
                  key: const ValueKey('catalog-order-type-required-ok'),
                  onPressed: () => Navigator.of(dialogContext).pop(true),
                  style: FilledButton.styleFrom(
                    backgroundColor: _bulkaYellow,
                    foregroundColor: _textDark,
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(BulkaRadii.control),
                    ),
                  ),
                  child: Text(
                    'catalog_select_order_type_ok'.tr,
                    style: const TextStyle(
                      fontFamily: _headingFont,
                      fontSize: BulkaTypeScale.body,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    _orderTypeDialogOpen = false;
    if (openHome == true && mounted) {
      closeCategoryPage();
      widget.onRequestOrderType?.call();
    }
    return false;
  }

  Future<void> _setProductQuantity(CatalogProduct product, int quantity) async {
    if (product.isStopListed) return;
    final next = quantity.clamp(0, product.inStockCount ?? 999);
    final cart = context.read<CartProvider>();
    final previous = cart.getQuantity(product.id);
    if (next > previous && !await _ensureOrderTypeSelected()) return;
    if (!mounted) return;
    if (next <= 0) {
      cart.removeItem(product.id);
      if (previous > 0) {
        _api.trackEvent(
          'remove_from_cart',
          productId: product.id,
          branchId: _selectedBakeryId,
        );
      }
    } else {
      if (previous == 0) {
        cart.addItem(
          productId: product.id,
          name: product.title,
          price: product.price,
          imageUrl: product.imageUrl,
          isStopListed: product.isStopListed,
        );
        _api.trackEvent(
          'add_to_cart',
          productId: product.id,
          branchId: _selectedBakeryId,
          properties: {'price': product.price},
        );
      }
      cart.setQuantity(product.id, next);
    }
    unawaited(
      next > previous && previous == 0
          ? BulkaMotion.lightImpact()
          : BulkaMotion.selection(),
    );
    if (next > previous && previous == 0 && mounted) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            behavior: SnackBarBehavior.floating,
            content: Row(
              children: [
                const Icon(
                  Icons.thumb_up_alt_rounded,
                  color: Colors.white,
                  size: 20,
                ),
                const SizedBox(width: 10),
                Expanded(child: Text('catalog_added_to_cart'.tr)),
              ],
            ),
          ),
        );
    }
  }

  double _catalogContentBottomInset(BuildContext context) =>
      BulkaLayout.bottomNavContentInset(context);

  Future<void> _openProductDetails(
    CatalogProduct product, {
    bool updateClientRoute = true,
  }) async {
    await _navigationGate.run(() async {
      _api.trackEvent(
        'product_view',
        productId: product.id,
        branchId: _selectedBakeryId,
        properties: {'category': product.category},
      );
      if (updateClientRoute) {
        publishClientRoute(_productClientUri(product));
      }
      _productRouteOpen = true;
      try {
        await Navigator.of(context).push<void>(
          MaterialPageRoute(
            settings: RouteSettings(name: '/catalog/product/${product.id}'),
            builder: (_) => ProductDetailsScreen(
              api: _api,
              product: product,
              liveProducts: _liveProducts,
              initialQuantity: context.read<CartProvider>().getQuantity(
                product.id,
              ),
              onQuantityChanged: _setProductQuantity,
              initialFavorite: _favoriteProductIds.contains(product.id),
              onToggleFavorite: () => _toggleFavorite(product),
              hasSelectedOrderType: widget.hasSelectedOrderType,
              onEnsureOrderTypeSelected: _ensureOrderTypeSelected,
            ),
          ),
        );
      } finally {
        _productRouteOpen = false;
        final current = normalizedClientUri(clientRouteNotifier.value);
        final currentSegments = current.pathSegments
            .where((value) => value.isNotEmpty)
            .toList();
        if (currentSegments.length >= 2 &&
            currentSegments.first == 'catalog' &&
            currentSegments[1] == 'product') {
          publishClientRoute(
            _categoryClientUri(product.category),
            replace: true,
          );
        }
      }
    });
  }

  Widget _buildCategoryGridCard(
    String category,
    List<CatalogProduct> products,
  ) {
    final colors = context.bulkaColors;
    final imageUrl = (_apiCategoryImages[category] ?? '').trim();
    final fallbackAsset = _catalogCategoryFallbackAsset(category);
    final availableCount = products
        .where((product) => !product.isStopListed)
        .length;

    return Semantics(
      key: ValueKey('catalog-category-card-$category'),
      button: true,
      label: availableCount == 0
          ? '$category. ${'catalog_stop_list'.tr}'
          : category,
      hint: '${'catalog_view_all'.tr} $category',
      child: BulkaPressScale(
        pressedScale: 0.975,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: () => _openCategoryPage(category),
            borderRadius: BorderRadius.circular(BulkaRadii.card),
            child: Ink(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(BulkaRadii.card),
                border: Border.all(
                  color: colors.cardBorder.withValues(alpha: 0.72),
                ),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x176D3317),
                    blurRadius: 20,
                    offset: Offset(0, 9),
                  ),
                ],
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(BulkaRadii.card),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    ExcludeSemantics(
                      child: imageUrl.isEmpty
                          ? _CatalogCategoryFallback(
                              key: ValueKey(
                                'catalog-category-fallback-$category',
                              ),
                              category: category,
                              assetPath: fallbackAsset,
                            )
                          : _NetworkImage(
                              key: ValueKey('catalog-category-image-$category'),
                              url: imageUrl,
                              fit: BoxFit.cover,
                            ),
                    ),
                    const DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          stops: [0, 0.42, 0.76],
                          colors: [
                            Color(0xF7FFFFFF),
                            Color(0xA6FFFFFF),
                            Color(0x00FFFFFF),
                          ],
                        ),
                      ),
                    ),
                    Positioned(
                      left: 16,
                      top: 16,
                      right: 16,
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          key: ValueKey('catalog-category-title-$category'),
                          category,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          softWrap: true,
                          style: TextStyle(
                            color: colors.brandBrown,
                            fontFamily: _descriptionFont,
                            fontSize: BulkaTypeScale.body,
                            height: 1.16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                    if (availableCount == 0)
                      Positioned(
                        left: 12,
                        bottom: 12,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 6,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.94),
                            borderRadius: BorderRadius.circular(
                              BulkaRadii.small,
                            ),
                            border: Border.all(
                              color: colors.danger.withValues(alpha: 0.45),
                            ),
                          ),
                          child: Text(
                            'catalog_stop_list'.tr,
                            style: TextStyle(
                              color: colors.danger,
                              fontFamily: _descriptionFont,
                              fontSize: BulkaTypeScale.caption,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildCategoryPage(String category, CartProvider cart) {
    final allProducts = _stopListedLast(
      catalogProductsAlphabetically(
        _allProducts.where((product) => product.category == category),
      ),
    );
    final products = _applyActiveProductFilters(
      allProducts,
      includeSearch: false,
      includeFavorites: false,
    );
    final scheme = Theme.of(context).colorScheme;
    final colors = context.bulkaColors;
    final filterActive = _filterActive;

    return Scaffold(
      key: ValueKey('catalog-category-page-$category'),
      backgroundColor: Colors.white,
      appBar: AppBar(
        toolbarHeight: BulkaLayout.appBarHeight(context),
        automaticallyImplyLeading: false,
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            bottom: Radius.circular(BulkaRadii.card),
          ),
        ),
        leadingWidth: 72,
        leading: Padding(
          padding: const EdgeInsets.only(left: 12),
          child: IconButton(
            key: const ValueKey('catalog-category-back'),
            onPressed: closeCategoryPage,
            tooltip: 'back_tooltip'.tr,
            icon: const Icon(Icons.arrow_back_rounded, size: 25),
            style: IconButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: colors.brandBrown,
              minimumSize: const Size(48, 48),
              side: BorderSide(color: colors.cardBorder),
            ),
          ),
        ),
        title: _BulkaPageTitle(category, color: scheme.onSurface),
        centerTitle: true,
        actions: [
          SizedBox(
            width: 72,
            child: Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Align(
                alignment: Alignment.centerRight,
                child: _buildFilterButton(
                  key: const ValueKey('catalog-category-filter'),
                  filterActive: filterActive,
                  iconOnly: true,
                ),
              ),
            ),
          ),
        ],
      ),
      body: allProducts.isEmpty
          ? _CatalogMessageState(
              icon: Icons.inventory_2_outlined,
              title: 'catalog_empty'.tr,
              subtitle: 'catalog_empty_hint'.tr,
            )
          : CustomScrollView(
              key: ValueKey('catalog-category-list-$category'),
              slivers: [
                if (products.isEmpty)
                  SliverToBoxAdapter(
                    child: _CatalogMessageState(
                      icon: Icons.search_off_rounded,
                      title: 'catalog_empty'.tr,
                      subtitle: 'catalog_empty_hint'.tr,
                    ),
                  )
                else
                  SliverPadding(
                    padding: EdgeInsets.fromLTRB(
                      16,
                      18,
                      16,
                      _catalogContentBottomInset(context),
                    ),
                    sliver: SliverLayoutBuilder(
                      builder: (context, constraints) {
                        const spacing = 14.0;
                        final extent = constraints.crossAxisExtent;
                        final columnCount = extent >= 980
                            ? 4
                            : extent >= 620
                            ? 3
                            : 2;
                        final cardWidth =
                            (extent - spacing * (columnCount - 1)) /
                            columnCount;
                        final textScale = MediaQuery.textScalerOf(
                          context,
                        ).scale(1);
                        return SliverGrid(
                          key: ValueKey('catalog-category-grid-$category'),
                          gridDelegate:
                              SliverGridDelegateWithFixedCrossAxisCount(
                                crossAxisCount: columnCount,
                                mainAxisSpacing: 18,
                                crossAxisSpacing: spacing,
                                mainAxisExtent:
                                    cardWidth + (textScale > 1.2 ? 162 : 122),
                              ),
                          delegate: SliverChildBuilderDelegate((
                            context,
                            index,
                          ) {
                            final product = products[index];
                            return _buildProductCard(
                              product,
                              cart.getQuantity(product.id),
                            );
                          }, childCount: products.length),
                        );
                      },
                    ),
                  ),
              ],
            ),
    );
  }

  Widget _buildCatalogToolsHeader({required bool showCategorySelector}) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    final sortedCategories = _sortedCategories;
    return SizedBox(
      height: showCategorySelector
          ? _CatalogToolsHeaderDelegate.expandedHeight
          : _CatalogToolsHeaderDelegate.compactHeight,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: Row(
              children: [
                Expanded(
                  child: SizedBox(
                    height: 56,
                    child: TextField(
                      key: const ValueKey('catalog-sticky-search'),
                      controller: _searchController,
                      onChanged: (val) => setState(() => _searchQuery = val),
                      textInputAction: TextInputAction.search,
                      autofillHints: const <String>[],
                      autocorrect: false,
                      enableSuggestions: false,
                      style: TextStyle(
                        fontSize: BulkaTypeScale.body,
                        fontWeight: FontWeight.w500,
                        color: scheme.onSurface,
                      ),
                      decoration: InputDecoration(
                        hintText: 'catalog_search'.tr,
                        hintStyle: TextStyle(
                          color: colors.mutedText,
                          fontWeight: FontWeight.w400,
                        ),
                        prefixIcon: Icon(
                          Icons.search_rounded,
                          color: colors.brandBrown,
                        ),
                        suffixIcon: _searchQuery.isEmpty
                            ? null
                            : IconButton(
                                onPressed: _clearSearch,
                                tooltip: 'catalog_clear_search'.tr,
                                icon: const Icon(Icons.close_rounded, size: 20),
                              ),
                        filled: true,
                        fillColor: Colors.white,
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 18,
                        ),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(
                            BulkaRadii.control,
                          ),
                          borderSide: BorderSide.none,
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(
                            BulkaRadii.control,
                          ),
                          borderSide: BorderSide(color: colors.cardBorder),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(
                            BulkaRadii.control,
                          ),
                          borderSide: BorderSide(
                            color: colors.brandGold,
                            width: 1.5,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                IconButton(
                  key: const ValueKey('catalog-favorites-toggle'),
                  onPressed: () {
                    unawaited(BulkaMotion.selection());
                    setState(() => _favoritesOnly = !_favoritesOnly);
                  },
                  tooltip: 'catalog_favorites'.tr,
                  style: IconButton.styleFrom(
                    backgroundColor: _favoritesOnly
                        ? colors.brandBrown
                        : Colors.white,
                    foregroundColor: _favoritesOnly
                        ? Colors.white
                        : colors.brandBrown,
                    minimumSize: const Size(56, 56),
                    tapTargetSize: MaterialTapTargetSize.padded,
                    side: _favoritesOnly
                        ? BorderSide.none
                        : BorderSide(color: colors.cardBorder),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(BulkaRadii.control),
                    ),
                  ),
                  icon: Icon(
                    _favoritesOnly
                        ? Icons.favorite_rounded
                        : Icons.favorite_border_rounded,
                    size: 24,
                  ),
                ),
              ],
            ),
          ),
          if (showCategorySelector)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: SizedBox(
                height: 48,
                child: Row(
                  children: [
                    Expanded(
                      child: _isLoading && sortedCategories.length <= 1
                          ? const _CatalogCategorySkeletonStrip()
                          : ListView.separated(
                              key: const ValueKey('catalog-category-strip'),
                              scrollDirection: Axis.horizontal,
                              itemCount: sortedCategories.length,
                              separatorBuilder: (context, index) =>
                                  const SizedBox(width: 8),
                              itemBuilder: (context, i) {
                                final cat = sortedCategories[i];
                                return _CatalogCategoryChip(
                                  key: ValueKey('catalog-category-chip-$cat'),
                                  label: cat == _catalogAllCategoryKey
                                      ? 'catalog_view_all'.tr
                                      : cat,
                                  imageUrl: _apiCategoryImages[cat],
                                  selected: _selectedCategory == cat,
                                  onTap: () {
                                    unawaited(BulkaMotion.selection());
                                    setState(() => _selectedCategory = cat);
                                  },
                                );
                              },
                            ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildFilterButton({
    required bool filterActive,
    required bool iconOnly,
    Key? key,
  }) {
    final colors = context.bulkaColors;
    final backgroundColor = filterActive ? _bulkaYellow : Colors.white;
    final border = BorderSide(
      color: filterActive ? _bulkaYellow : colors.cardBorder,
    );
    final icon = Badge(
      isLabelVisible: filterActive,
      backgroundColor: _bulkaBrown,
      smallSize: 8,
      child: const Icon(Icons.tune_rounded, size: 22),
    );

    if (iconOnly) {
      return IconButton(
        key: key,
        onPressed: _openFilterModal,
        tooltip: 'catalog_filter'.tr,
        style: IconButton.styleFrom(
          backgroundColor: backgroundColor,
          foregroundColor: _textDark,
          minimumSize: const Size(48, 48),
          tapTargetSize: MaterialTapTargetSize.padded,
          side: border,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(BulkaRadii.control),
          ),
        ),
        icon: icon,
      );
    }

    return SizedBox(
      height: 48,
      child: FilledButton.icon(
        key: key,
        onPressed: _openFilterModal,
        style: FilledButton.styleFrom(
          backgroundColor: backgroundColor,
          foregroundColor: _textDark,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          side: border,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(BulkaRadii.control),
          ),
        ),
        icon: icon,
        label: Text(
          'catalog_filter'.tr,
          maxLines: 1,
          overflow: TextOverflow.fade,
          softWrap: false,
          style: const TextStyle(
            fontFamily: _descriptionFont,
            fontSize: BulkaTypeScale.bodySmall,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartProvider>();
    final openedCategory = _openedCategory;
    if (openedCategory != null) {
      return BulkaMotionSwitcher(
        duration: BulkaMotion.emphasized,
        offset: const Offset(0.025, 0),
        child: KeyedSubtree(
          key: ValueKey('catalog-category-$openedCategory'),
          child: _buildCategoryPage(openedCategory, cart),
        ),
      );
    }
    final scheme = Theme.of(context).colorScheme;
    final visibleProducts = _filteredProducts;
    final filterActive = _filterActive;
    final categoryGroups = _categoryGroups;
    final hasSearchQuery = _searchQuery.trim().isNotEmpty;
    final browseByCategory =
        !hasSearchQuery &&
        _selectedCategory == _catalogAllCategoryKey &&
        !_favoritesOnly &&
        !filterActive &&
        categoryGroups.isNotEmpty;
    final showCategorySelector = !_isLoading && !browseByCategory;
    final searchSuggestions = _searchSuggestions;
    final favoritesEmpty =
        _favoritesOnly &&
        !hasSearchQuery &&
        _selectedCategory == _catalogAllCategoryKey &&
        !filterActive;
    final fulfillmentSourceText = _orderType == 'delivery'
        ? (_selectedDeliveryAddress?.displayAddress ??
              'checkout_select_delivery_address'.tr)
        : (_selectedBakery.isEmpty ? 'catalog_action'.tr : _selectedBakery);

    return BulkaMotionSwitcher(
      duration: BulkaMotion.emphasized,
      offset: const Offset(0.025, 0),
      child: KeyedSubtree(
        key: const ValueKey('catalog-root'),
        child: Scaffold(
          backgroundColor: scheme.surface,
          appBar: AppBar(
            toolbarHeight: BulkaLayout.appBarHeight(context),
            automaticallyImplyLeading: false,
            backgroundColor: scheme.surface,
            surfaceTintColor: Colors.transparent,
            elevation: 0,
            title: _BulkaPageTitle(
              'nav_catalog'.tr,
              key: const ValueKey('catalog-page-title'),
              color: scheme.onSurface,
            ),
            centerTitle: true,
          ),
          body: Stack(
            children: [
              RefreshIndicator(
                color: _bulkaYellow,
                onRefresh: _loadMenu,
                child: CustomScrollView(
                  slivers: [
                    SliverPersistentHeader(
                      pinned: true,
                      delegate: _CatalogToolsHeaderDelegate(
                        backgroundColor: scheme.surface,
                        height: showCategorySelector
                            ? _CatalogToolsHeaderDelegate.expandedHeight
                            : _CatalogToolsHeaderDelegate.compactHeight,
                        child: _buildCatalogToolsHeader(
                          showCategorySelector: showCategorySelector,
                        ),
                      ),
                    ),

                    if (searchSuggestions.isNotEmpty)
                      SliverToBoxAdapter(
                        child: Semantics(
                          container: true,
                          label: 'catalog_suggestions'.tr,
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
                            child: Align(
                              alignment: Alignment.centerLeft,
                              child: Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: searchSuggestions
                                    .map(
                                      (suggestion) => ActionChip(
                                        label: Text(suggestion),
                                        avatar: const Icon(
                                          Icons.auto_fix_high_rounded,
                                          size: 16,
                                        ),
                                        onPressed: () {
                                          _searchController.text = suggestion;
                                          _searchController.selection =
                                              TextSelection.collapsed(
                                                offset: suggestion.length,
                                              );
                                          setState(
                                            () => _searchQuery = suggestion,
                                          );
                                        },
                                      ),
                                    )
                                    .toList(),
                              ),
                            ),
                          ),
                        ),
                      ),

                    SliverToBoxAdapter(
                      child: Column(
                        children: [
                          if (_usingCachedMenu)
                            Padding(
                              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                              child: Semantics(
                                container: true,
                                liveRegion: true,
                                child: Container(
                                  padding: const EdgeInsets.fromLTRB(
                                    14,
                                    8,
                                    8,
                                    8,
                                  ),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFFFF4D8),
                                    borderRadius: BorderRadius.circular(
                                      BulkaRadii.control,
                                    ),
                                    border: Border.all(
                                      color: const Color(0xFFE5BE62),
                                    ),
                                  ),
                                  child: Row(
                                    children: [
                                      const Icon(
                                        Icons.wifi_off_rounded,
                                        color: _bulkaBrown,
                                        size: 21,
                                      ),
                                      const SizedBox(width: 10),
                                      Expanded(
                                        child: Text(
                                          _cacheAgeText,
                                          style: const TextStyle(
                                            color: _textDark,
                                            fontSize: BulkaTypeScale.bodySmall,
                                            height: 1.25,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      ),
                                      IconButton(
                                        onPressed: _loadMenu,
                                        tooltip: 'catalog_retry'.tr,
                                        icon: const Icon(Icons.refresh_rounded),
                                        style: IconButton.styleFrom(
                                          minimumSize: const Size(48, 48),
                                          foregroundColor: _bulkaBrown,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),

                          if (!hasSearchQuery) ...[
                            const SizedBox(height: 14),

                            // Location Banner (Самовывоз/Адрес)
                            Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 16,
                              ),
                              child: Semantics(
                                button: true,
                                label:
                                    '$_catalogMenuTitle. $_fulfillmentSourceLabel: $fulfillmentSourceText',
                                child: BulkaPressScale(
                                  child: Material(
                                    color: Colors.transparent,
                                    child: InkWell(
                                      onTap: _selectFulfillmentSource,
                                      borderRadius: BorderRadius.circular(
                                        BulkaRadii.control,
                                      ),
                                      child: Ink(
                                        key: ValueKey(
                                          'catalog-fulfillment-banner-$_orderType',
                                        ),
                                        decoration: BoxDecoration(
                                          color: const Color(0xFFFFE1A0),
                                          image: DecorationImage(
                                            image: AssetImage(
                                              _fulfillmentBannerAsset,
                                            ),
                                            fit: BoxFit.cover,
                                            alignment: Alignment.centerRight,
                                          ),
                                          borderRadius: BorderRadius.circular(
                                            BulkaRadii.control,
                                          ),
                                          boxShadow: const [
                                            BoxShadow(
                                              color: Color(0x1F9D6210),
                                              blurRadius: 18,
                                              offset: Offset(0, 8),
                                            ),
                                          ],
                                        ),
                                        child: Ink(
                                          padding: const EdgeInsets.fromLTRB(
                                            18,
                                            18,
                                            12,
                                            18,
                                          ),
                                          decoration: BoxDecoration(
                                            gradient: const LinearGradient(
                                              colors: [
                                                Color(0xFFFDF4E2),
                                                Color(0xF2FDF4E2),
                                                Color(0x00FDF4E2),
                                              ],
                                              stops: [0, 0.54, 0.82],
                                              begin: Alignment.centerLeft,
                                              end: Alignment.centerRight,
                                            ),
                                            borderRadius: BorderRadius.circular(
                                              BulkaRadii.control,
                                            ),
                                          ),
                                          child: ConstrainedBox(
                                            constraints: const BoxConstraints(
                                              minHeight: 128,
                                            ),
                                            child: Row(
                                              children: [
                                                Expanded(
                                                  child: Column(
                                                    mainAxisAlignment:
                                                        MainAxisAlignment
                                                            .center,
                                                    crossAxisAlignment:
                                                        CrossAxisAlignment
                                                            .start,
                                                    children: [
                                                      Text(
                                                        _catalogMenuTitle,
                                                        style: const TextStyle(
                                                          fontFamily:
                                                              _headingFont,
                                                          fontSize:
                                                              BulkaTypeScale
                                                                  .titleSmall,
                                                          fontWeight:
                                                              FontWeight.w700,
                                                          height: 1.18,
                                                          color: _textDark,
                                                        ),
                                                      ),
                                                      const SizedBox(height: 9),
                                                      Row(
                                                        crossAxisAlignment:
                                                            CrossAxisAlignment
                                                                .start,
                                                        children: [
                                                          const Padding(
                                                            padding:
                                                                EdgeInsets.only(
                                                                  top: 1,
                                                                ),
                                                            child: Icon(
                                                              Icons
                                                                  .location_on_rounded,
                                                              color: _textDark,
                                                              size: 18,
                                                            ),
                                                          ),
                                                          const SizedBox(
                                                            width: 5,
                                                          ),
                                                          Expanded(
                                                            child: Text(
                                                              '$_fulfillmentSourceLabel: $fulfillmentSourceText',
                                                              softWrap: true,
                                                              style: const TextStyle(
                                                                fontFamily:
                                                                    _descriptionFont,
                                                                color:
                                                                    _textDark,
                                                                fontWeight:
                                                                    FontWeight
                                                                        .w600,
                                                                fontSize:
                                                                    BulkaTypeScale
                                                                        .bodySmall,
                                                                height: 1.3,
                                                              ),
                                                            ),
                                                          ),
                                                        ],
                                                      ),
                                                    ],
                                                  ),
                                                ),
                                                const SizedBox(width: 76),
                                                Container(
                                                  width: 44,
                                                  height: 44,
                                                  decoration: BoxDecoration(
                                                    color: Colors.white
                                                        .withValues(
                                                          alpha: 0.88,
                                                        ),
                                                    shape: BoxShape.circle,
                                                    border: Border.all(
                                                      color: Colors.white,
                                                    ),
                                                  ),
                                                  child: const Icon(
                                                    Icons.chevron_right_rounded,
                                                    color: _textDark,
                                                    size: 25,
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ],

                          if (_isLoading || browseByCategory)
                            const SizedBox(height: 24)
                          else ...[
                            SizedBox(height: hasSearchQuery ? 16 : 22),
                            Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 16,
                              ),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      hasSearchQuery
                                          ? 'catalog_search_results'.tr
                                          : _favoritesOnly
                                          ? 'catalog_favorites'.tr
                                          : _selectedCategory ==
                                                _catalogAllCategoryKey
                                          ? 'catalog_all_categories'.tr
                                          : _selectedCategory,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        fontFamily: _descriptionFont,
                                        fontSize: BulkaTypeScale.title,
                                        fontWeight: FontWeight.w700,
                                        color: scheme.onSurface,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  _buildFilterButton(
                                    key: const ValueKey(
                                      'catalog-results-filter',
                                    ),
                                    filterActive: filterActive,
                                    iconOnly: false,
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(height: 12),
                          ],
                        ],
                      ),
                    ),

                    // Product List
                    if (_isLoading)
                      const SliverToBoxAdapter(child: _CatalogSkeletonCatalog())
                    else if (_loadError != null)
                      SliverToBoxAdapter(
                        child: _CatalogMessageState(
                          icon: Icons.cloud_off_rounded,
                          title: 'catalog_load_failed'.tr,
                          subtitle: 'error_network'.tr,
                          actionLabel: 'catalog_retry'.tr,
                          onAction: _loadMenu,
                        ),
                      )
                    else if (visibleProducts.isEmpty)
                      SliverToBoxAdapter(
                        child: _CatalogMessageState(
                          icon: favoritesEmpty
                              ? Icons.favorite_border_rounded
                              : Icons.search_off_rounded,
                          title: favoritesEmpty
                              ? 'catalog_favorites_empty'.tr
                              : 'catalog_empty'.tr,
                          subtitle: favoritesEmpty
                              ? 'catalog_favorites_empty_hint'.tr
                              : 'catalog_empty_hint'.tr,
                          actionLabel: favoritesEmpty
                              ? 'catalog_browse_menu'.tr
                              : _searchQuery.isNotEmpty ||
                                    _selectedCategory !=
                                        _catalogAllCategoryKey ||
                                    filterActive
                              ? 'catalog_reset_filters'.tr
                              : null,
                          onAction: favoritesEmpty
                              ? _resetCatalogFilters
                              : _searchQuery.isNotEmpty ||
                                    _selectedCategory !=
                                        _catalogAllCategoryKey ||
                                    filterActive
                              ? _resetCatalogFilters
                              : null,
                        ),
                      )
                    else if (browseByCategory)
                      SliverPadding(
                        padding: EdgeInsets.fromLTRB(
                          16,
                          0,
                          16,
                          _catalogContentBottomInset(context),
                        ),
                        sliver: SliverLayoutBuilder(
                          builder: (context, constraints) {
                            const spacing = 14.0;
                            final extent = constraints.crossAxisExtent;
                            final columnCount = extent >= 980
                                ? 4
                                : extent >= 620
                                ? 3
                                : 2;
                            final cardWidth =
                                (extent - spacing * (columnCount - 1)) /
                                columnCount;
                            final textScale = MediaQuery.textScalerOf(
                              context,
                            ).scale(1);
                            return SliverGrid(
                              key: const ValueKey('catalog-category-grid'),
                              gridDelegate:
                                  SliverGridDelegateWithFixedCrossAxisCount(
                                    crossAxisCount: columnCount,
                                    mainAxisSpacing: spacing,
                                    crossAxisSpacing: spacing,
                                    mainAxisExtent:
                                        cardWidth + (textScale > 1.2 ? 24 : 0),
                                  ),
                              delegate: SliverChildBuilderDelegate((
                                context,
                                index,
                              ) {
                                final group = categoryGroups[index];
                                return _buildCategoryGridCard(
                                  group.key,
                                  group.value,
                                );
                              }, childCount: categoryGroups.length),
                            );
                          },
                        ),
                      )
                    else
                      SliverPadding(
                        padding: EdgeInsets.fromLTRB(
                          16,
                          4,
                          16,
                          _catalogContentBottomInset(context),
                        ),
                        sliver: SliverLayoutBuilder(
                          builder: (context, constraints) {
                            final textScale = MediaQuery.textScalerOf(
                              context,
                            ).scale(1);
                            const maxCardWidth = 235.0;
                            const crossSpacing = 12.0;
                            final columnCount = max(
                              1,
                              ((constraints.crossAxisExtent + crossSpacing) /
                                      (maxCardWidth + crossSpacing))
                                  .ceil(),
                            ).toInt();
                            final cardWidth =
                                (constraints.crossAxisExtent -
                                    crossSpacing * (columnCount - 1)) /
                                columnCount;
                            final mainAxisExtent =
                                cardWidth + (textScale > 1.2 ? 162.0 : 122.0);
                            return SliverGrid(
                              gridDelegate:
                                  SliverGridDelegateWithMaxCrossAxisExtent(
                                    maxCrossAxisExtent: maxCardWidth,
                                    mainAxisSpacing: 16,
                                    crossAxisSpacing: crossSpacing,
                                    mainAxisExtent: mainAxisExtent,
                                  ),
                              delegate: SliverChildBuilderDelegate((
                                context,
                                index,
                              ) {
                                final p = visibleProducts[index];
                                final qty = cart.getQuantity(p.id);
                                return _buildProductCard(p, qty);
                              }, childCount: visibleProducts.length),
                            );
                          },
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _formatPrice(BuildContext context, int price) =>
      formatUiInteger(context, price);

  Widget _buildProductCard(CatalogProduct product, int quantity) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    final favorite = _favoriteProductIds.contains(product.id);
    final unavailable = product.isStopListed;

    return Semantics(
      container: true,
      explicitChildNodes: true,
      enabled: !unavailable,
      label: product.title,
      value: [
        '${_formatPrice(context, product.price)} ₸',
        product.isStopListed ? 'catalog_stop_list'.tr : 'catalog_in_stock'.tr,
        if (product.weightGrams != null)
          'catalog_weight_value'.trArgs({'weight': product.weightGrams}),
      ].join('. '),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              BulkaPressScale(
                pressedScale: 0.975,
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: unavailable
                        ? null
                        : () => _openProductDetails(product),
                    borderRadius: BorderRadius.circular(BulkaRadii.card),
                    child: ExcludeSemantics(
                      child: _CatalogProductImage(
                        key: ValueKey('catalog-product-image-${product.id}'),
                        url: product.imageUrl,
                        semanticLabel: product.title,
                        heroTag: 'catalog-product-${product.id}',
                        borderRadius: BorderRadius.circular(BulkaRadii.card),
                        safePadding: EdgeInsets.zero,
                        disabled: unavailable,
                      ),
                    ),
                  ),
                ),
              ),
              Positioned(
                top: 8,
                right: 8,
                child: Semantics(
                  button: true,
                  toggled: favorite,
                  label: favorite
                      ? 'catalog_remove_favorite'.tr
                      : 'catalog_add_favorite'.tr,
                  excludeSemantics: true,
                  child: IconButton(
                    key: ValueKey('catalog-favorite-${product.id}'),
                    onPressed: unavailable
                        ? null
                        : () => unawaited(_toggleFavorite(product)),
                    tooltip: favorite
                        ? 'catalog_remove_favorite'.tr
                        : 'catalog_add_favorite'.tr,
                    style: IconButton.styleFrom(
                      backgroundColor: unavailable
                          ? const Color(0xFFF0EEEB).withValues(alpha: 0.94)
                          : Colors.white.withValues(alpha: 0.9),
                      foregroundColor: unavailable
                          ? colors.mutedText
                          : favorite
                          ? colors.brandBrown
                          : colors.mutedText,
                      minimumSize: const Size(44, 44),
                      side: BorderSide(
                        color: unavailable
                            ? colors.cardBorder
                            : favorite
                            ? colors.brandGold
                            : colors.cardBorder.withValues(alpha: 0.72),
                      ),
                      shape: const CircleBorder(),
                    ),
                    icon: Icon(
                      favorite
                          ? Icons.favorite_rounded
                          : Icons.favorite_border_rounded,
                      size: 23,
                    ),
                  ),
                ),
              ),
              if (unavailable)
                Positioned(
                  left: 8,
                  top: 8,
                  child: ExcludeSemantics(
                    child: Container(
                      key: ValueKey('catalog-stop-list-${product.id}'),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 9,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF0EEEB).withValues(alpha: 0.96),
                        borderRadius: BorderRadius.circular(BulkaRadii.small),
                        border: Border.all(color: colors.cardBorder),
                      ),
                      child: Text(
                        'catalog_stop_list'.tr,
                        style: TextStyle(
                          color: colors.mutedText,
                          fontFamily: _descriptionFont,
                          fontSize: BulkaTypeScale.caption,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                ),
              Positioned(
                right: 7,
                bottom: -20,
                child: _CatalogImageQuantityControl(
                  quantity: quantity,
                  stopListed: unavailable,
                  onAdd: () => _setProductQuantity(product, 1),
                  onDecrease: () => _setProductQuantity(product, quantity - 1),
                  onIncrease: () => _setProductQuantity(product, quantity + 1),
                ),
              ),
            ],
          ),
          const SizedBox(height: 25),
          Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: unavailable ? null : () => _openProductDetails(product),
              borderRadius: BorderRadius.circular(BulkaRadii.control),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 3),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${_formatPrice(context, product.price)} ₸',
                      maxLines: 1,
                      style: TextStyle(
                        fontFamily: _descriptionFont,
                        fontWeight: FontWeight.w700,
                        fontSize: BulkaTypeScale.titleSmall,
                        color: unavailable
                            ? colors.mutedText
                            : colors.brandBrown,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      product.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: BulkaTypeScale.bodySmall,
                        color: unavailable
                            ? colors.mutedText
                            : scheme.onSurface,
                        height: 1.18,
                        letterSpacing: -0.2,
                      ),
                    ),
                    if (product.weightGrams != null) ...[
                      const SizedBox(height: 5),
                      Text(
                        'catalog_weight_short'.trArgs({
                          'weight': product.weightGrams,
                        }),
                        style: TextStyle(
                          fontSize: BulkaTypeScale.caption,
                          fontWeight: FontWeight.w600,
                          color: colors.mutedText,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
