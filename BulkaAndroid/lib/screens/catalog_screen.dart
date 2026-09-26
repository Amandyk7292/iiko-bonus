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
    with WidgetsBindingObserver, SingleTickerProviderStateMixin {
  static const _menuRefreshInterval = Duration(seconds: 60);
  static const _menuRetryInterval = Duration(seconds: 15);
  bool _menuScopeReady = false;
  bool _wasActive = false;
  StreamSubscription<void>? _networkRecoverySubscription;

  final _searchController = TextEditingController();
  Timer? _searchDebounce;
  late final AnimationController _categoryEntrance;
  double _catalogViewportHeight = 0;
  final ValueNotifier<Map<String, CatalogProduct>> _liveProducts =
      ValueNotifier(const {});
  String _selectedBakery = '';
  String _selectedBakeryId = '';
  BakeryLocation? _selectedBakeryLocation;
  DeliveryAddress? _selectedDeliveryAddress;
  String _searchQuery = '';
  String _selectedCategory = _catalogAllCategoryKey;
  _CatalogSort _sort = _CatalogSort.menu;
  Set<String> _dietaryFilters = const {};
  Set<String> _excludedAllergens = const {};
  Set<String> _favoriteProductIds = const {};
  Set<String> _configurableProductIds = const {};
  Set<String> _resolvedProductOptionIds = const {};
  bool _favoritesOnly = false;
  Map<String, String> _apiCategoryImages = {};
  String? _openedCategory;
  double _catalogContentExtent = 0;
  bool _orderTypeDialogOpen = false;
  String? _productPendingFulfillment;
  final _navigationGate = _AsyncActionGate();
  Uri? _pendingClientUri;
  bool _productRouteOpen = false;
  Future<bool>? _routeBranchFlight;

  List<String> _categories = const [_catalogAllCategoryKey];
  List<CatalogProduct> _allProducts = const [];
  bool _isLoading = true;
  bool _usingCachedMenu = false;
  String? _loadError;
  String _trackedCatalogKey = '';
  int _menuLoadRevision = 0;
  String _menuProfileKey = '';
  String? _lastLiveMenuScope;
  Map<String, dynamic>? _lastLiveMenu;
  DateTime? _lastMenuCacheWrite;
  int _productOptionsRevision = 0;
  Future<void>? _silentRefreshRequest;
  int _activeMenuLoads = 0;

  // Авто-обновление меню каждую минуту
  Timer? _autoRefreshTimer;
  late final _LiveRefresh _menuLive;
  late final _LiveRefresh _branchLive;

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
    _categoryEntrance = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 200),
      value: 1,
    );
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
    _menuLive = _LiveRefresh(
      _api,
      {'menu', 'locations', 'menu.updated'},
      _silentRefresh,
      busy: () => !_menuScopeReady || _activeMenuLoads > 0,
      active: () => mounted && (_wasActive || _productRouteOpen),
      acceptEvent: _matchesCatalogBranch,
      // The retry timer already handles the healthy/offline intervals.
      fallbackInterval: null,
    );
    _branchLive = _LiveRefresh(
      _api,
      {'locations'},
      _refreshBranchLabel,
      busy: () => !_menuScopeReady,
      active: () => mounted && (_wasActive || _productRouteOpen),
    );
    _networkRecoverySubscription = networkRecoveryEvents().listen(
      (_) => _refreshIfActive(),
    );
    _scheduleMenuRefresh();
  }

  void _scheduleMenuRefresh() {
    _autoRefreshTimer?.cancel();
    if (!mounted) return;
    final interval = _usingCachedMenu || _loadError != null
        ? _menuRetryInterval
        : _menuRefreshInterval;
    _autoRefreshTimer = Timer(interval, () {
      _refreshIfActive();
      // Keep polling after a hidden tab skips a refresh. Completed requests
      // restart this one timer with the latest healthy/offline interval.
      _scheduleMenuRefresh();
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
    if (BulkaMotion.reduced(context)) _categoryEntrance.value = 1;
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

  void _updateCatalogState(VoidCallback update) {
    final previousCategory = _openedCategory;
    setState(update);
    if (_openedCategory != null && _openedCategory != previousCategory) {
      if (BulkaMotion.reduced(context)) {
        _categoryEntrance.value = 1;
      } else {
        _categoryEntrance.forward(from: 0);
      }
    }
  }

  void _queueSearch(String value) {
    _searchDebounce?.cancel();
    if (value.isEmpty) {
      _updateCatalogState(() => _searchQuery = '');
      return;
    }
    _searchDebounce = Timer(const Duration(milliseconds: 180), () {
      if (mounted) _updateCatalogState(() => _searchQuery = value);
    });
  }

  void _submitSearch(String value) {
    _searchDebounce?.cancel();
    _updateCatalogState(() => _searchQuery = value);
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
    _searchDebounce?.cancel();
    setState(() {
      _menuScopeReady = false;
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
    _menuLive.dispose();
    _branchLive.dispose();
    _searchDebounce?.cancel();
    _categoryEntrance.dispose();
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
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      _catalogViewportHeight = constraints.maxHeight;
      _catalogContentExtent = max(0.0, constraints.maxWidth - 32);
      return _buildCatalogScreen(context, _catalogContentExtent);
    },
  );
}
