part of '../main.dart';

class CatalogScreen extends StatefulWidget {
  const CatalogScreen({
    required this.api,
    this.orderType = 'pickup',
    this.hasSelectedOrderType = false,
    this.selectionRevision = 0,
    this.onRequestOrderType,
    this.onRequireAuth,
    this.initialClientUri,
    super.key,
  });

  final BulkaApiClient api;
  final String orderType;
  final bool hasSelectedOrderType;
  final int selectionRevision;
  final VoidCallback? onRequestOrderType;
  final Future<bool> Function()? onRequireAuth;
  final Uri? initialClientUri;

  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen>
    with WidgetsBindingObserver {
  static const _menuRefreshInterval = Duration(seconds: 60);
  static const _menuRetryInterval = Duration(seconds: 15);
  DateTime? _lastMenuAttempt;
  bool _menuScopeReady = false;
  bool _wasActive = false;
  StreamSubscription<void>? _networkRecoverySubscription;

  final _searchController = TextEditingController();
  final ValueNotifier<Map<String, CatalogProduct>> _liveProducts =
      ValueNotifier(const {});
  String _selectedBakery = '';
  String _selectedBakeryId = '';
  DeliveryAddress? _selectedDeliveryAddress;
  String _searchQuery = '';
  String _selectedCategory = _catalogAllCategoryKey;
  _CatalogSort _sort = _CatalogSort.menu;
  Set<String> _dietaryFilters = const {};
  Set<String> _excludedAllergens = const {};
  Set<String> _favoriteProductIds = const {};
  Map<String, StockSubscription> _stockSubscriptions = const {};
  Set<String> _stockSubscriptionBusy = const {};
  Set<String> _configurableProductIds = const {};
  Set<String> _resolvedProductOptionIds = const {};
  bool _favoritesOnly = false;
  Map<String, String> _apiCategoryImages = {};
  String? _openedCategory;
  bool _orderTypeDialogOpen = false;
  String? _productPendingFulfillment;
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
  int _productOptionsRevision = 0;
  Future<void>? _silentRefreshRequest;
  int _activeMenuLoads = 0;

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
    unawaited(
      _loadSelectedBakery().then((_) async {
        if (!mounted) return;
        _menuScopeReady = true;
        await _loadMenu();
      }),
    );
    unawaited(_loadFavorites());
    unawaited(_loadStockSubscriptions());
    _menuEventSubscription = _api.customerEvents.listen((event) {
      if (event['type'] == 'menu.updated') unawaited(_silentRefresh());
    });
    _networkRecoverySubscription = networkRecoveryEvents().listen(
      (_) => _refreshIfActive(),
    );
    _autoRefreshTimer = Timer.periodic(_menuRetryInterval, (_) {
      final interval = _usingCachedMenu || _loadError != null
          ? _menuRetryInterval
          : _menuRefreshInterval;
      if (_lastMenuAttempt == null ||
          DateTime.now().difference(_lastMenuAttempt!) >= interval) {
        _refreshIfActive();
      }
    });
  }

  void _refreshIfActive() {
    if (!mounted || !_menuScopeReady || !TickerMode.of(context)) return;
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    if (lifecycle != null && lifecycle != AppLifecycleState.resumed) return;
    unawaited(_silentRefresh());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final active = TickerMode.of(context);
    if (active && !_wasActive) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _refreshIfActive());
    }
    _wasActive = active;
  }

  static Uri _categoryClientUri(String category) {
    return Uri(pathSegments: ['', 'catalog', 'category', category]);
  }

  static Uri _productClientUri(CatalogProduct product) {
    return productClientUri(product.id);
  }

  static String _formatPrice(BuildContext context, int price) =>
      formatUiInteger(context, price);

  void _updateCatalogState(VoidCallback update) => setState(update);

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
    if (segments.isEmpty || !{'catalog', 'p'}.contains(segments.first)) {
      if (_productRouteOpen) unawaited(Navigator.of(context).maybePop());
      if (_openedCategory != null) setState(() => _openedCategory = null);
      return;
    }

    final productId = productIdFromClientUri(uri);
    if (productId != null) {
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
      _menuLoadRevision++;
      _productOptionsRevision++;
      _resolvedProductOptionIds = const {};
      _configurableProductIds = const {};
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
    unawaited(
      _loadSelectedBakery().then((_) async {
        if (!mounted) return;
        _menuScopeReady = true;
        await _loadMenu();
      }),
    );
  }

  @override
  void dispose() {
    appLanguageNotifier.removeListener(_onLanguageChanged);
    _autoRefreshTimer?.cancel();
    _networkRecoverySubscription?.cancel();
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
      _refreshIfActive();
    }
  }

  /// Тихое обновление — без спиннера, данные просто подменяются

  @override
  Widget build(BuildContext context) => _buildCatalogScreen(context);
}
