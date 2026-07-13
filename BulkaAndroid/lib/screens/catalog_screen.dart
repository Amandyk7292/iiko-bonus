part of '../main.dart';

class CatalogProduct {
  const CatalogProduct({
    required this.id,
    required this.title,
    required this.price,
    required this.category,
    required this.imageUrl,
    required this.inStockCount,
    this.description = '',
    this.isStopListed = false,
  });

  final String id;
  final String title;
  final int price;
  final String category;
  final String imageUrl;
  final int inStockCount;
  final String description;
  final bool isStopListed;
}

enum _CatalogSort { menu, priceLow, priceHigh }

@immutable
class _CatalogFilterResult {
  const _CatalogFilterResult({required this.sort, required this.onlyAvailable});

  final _CatalogSort sort;
  final bool onlyAvailable;

  bool get isActive => sort != _CatalogSort.menu || onlyAvailable;
}

class CatalogScreen extends StatefulWidget {
  const CatalogScreen({this.onOpenCart, super.key});

  final VoidCallback? onOpenCart;

  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen>
    with WidgetsBindingObserver {
  static const _menuRefreshInterval = Duration(seconds: 30);

  final _api = BulkaApiClient();
  final _searchController = TextEditingController();
  final ValueNotifier<Map<String, CatalogProduct>> _liveProducts =
      ValueNotifier(const {});
  String _selectedBakery = '';
  String _searchQuery = '';
  String _selectedCategory = 'Все';
  _CatalogSort _sort = _CatalogSort.menu;
  bool _onlyAvailable = false;
  Map<String, String> _apiCategoryImages = {};

  List<String> _categories = const ['Все'];
  List<CatalogProduct> _allProducts = const [];
  bool _isLoading = true;
  String? _loadError;

  // Авто-обновление меню каждые 30 сек
  Timer? _autoRefreshTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    appLanguageNotifier.addListener(_onLanguageChanged);
    _loadSelectedBakery();
    _loadMenu();
    // Тихое фоновое обновление каждые 30 секунд
    _autoRefreshTimer = Timer.periodic(_menuRefreshInterval, (_) {
      _silentRefresh();
    });
  }

  void _onLanguageChanged() {
    _loadMenu();
  }

  @override
  void dispose() {
    appLanguageNotifier.removeListener(_onLanguageChanged);
    _autoRefreshTimer?.cancel();
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
    try {
      final json = await _api._get('/api/guest/menu');
      if (!mounted) return;

      final categoriesRaw = json['categories'] as List? ?? [];
      final productsRaw = json['products'] as List? ?? [];

      final categoryNames = <String>['Все'];
      final categoryMap = <String, String>{};
      final categoryImages = <String, String>{};
      for (final c in categoriesRaw) {
        final id = (c['id'] ?? '').toString();
        final name = (c['name'] ?? '').toString();
        final imageUrl = (c['imageUrl'] ?? '').toString();
        if (name.isNotEmpty) {
          categoryNames.add(name);
          categoryMap[id] = name;
          if (imageUrl.isNotEmpty) categoryImages[name] = imageUrl;
        }
      }

      final products = <CatalogProduct>[];
      for (final p in productsRaw) {
        final catId = (p['categoryId'] ?? '').toString();
        final catName = categoryMap[catId] ?? 'Другое';
        final price = p['price'];
        products.add(
          CatalogProduct(
            id: (p['id'] ?? '').toString(),
            title: (p['name'] ?? '').toString(),
            price: (price is num ? price.toInt() : 0),
            category: catName,
            imageUrl: (p['imageUrl'] ?? '').toString(),
            inStockCount: 99,
            description: (p['description'] ?? '').toString(),
            isStopListed:
                p['inStopList'] == true || p['onlineOrderable'] == false,
          ),
        );
      }
      for (final product in products) {
        if (product.imageUrl.trim().isNotEmpty) {
          categoryImages.putIfAbsent(product.category, () => product.imageUrl);
          categoryImages.putIfAbsent('Все', () => product.imageUrl);
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
                  ],
                )
                .toList(),
          );

      _syncCartWithMenu(products);

      setState(() {
        _categories = categoryNames;
        _apiCategoryImages = categoryImages;
        _allProducts = products;
        _loadError = null;
      });
      if (changed && mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Меню обновлено')));
      }
    } catch (_) {
      // Тихая ошибка — не показываем пользователю
    }
  }

  Future<void> _loadMenu() async {
    try {
      setState(() {
        _isLoading = _allProducts.isEmpty;
        _loadError = null;
      });
      final json = await _api._get('/api/guest/menu');
      if (!mounted) return;

      final categoriesRaw = json['categories'] as List? ?? [];
      final productsRaw = json['products'] as List? ?? [];

      final categoryNames = <String>['Все'];
      final categoryMap = <String, String>{};
      final categoryImages = <String, String>{};
      for (final c in categoriesRaw) {
        final id = (c['id'] ?? '').toString();
        final name = (c['name'] ?? '').toString();
        final imageUrl = (c['imageUrl'] ?? '').toString();
        if (name.isNotEmpty) {
          categoryNames.add(name);
          categoryMap[id] = name;
          if (imageUrl.isNotEmpty) categoryImages[name] = imageUrl;
        }
      }

      final products = <CatalogProduct>[];
      for (final p in productsRaw) {
        final catId = (p['categoryId'] ?? '').toString();
        final catName = categoryMap[catId] ?? 'Другое';
        final price = p['price'];
        products.add(
          CatalogProduct(
            id: (p['id'] ?? '').toString(),
            title: (p['name'] ?? '').toString(),
            price: (price is num ? price.toInt() : 0),
            category: catName,
            imageUrl: (p['imageUrl'] ?? '').toString(),
            inStockCount: 99,
            description: (p['description'] ?? '').toString(),
            isStopListed:
                p['inStopList'] == true || p['onlineOrderable'] == false,
          ),
        );
      }
      for (final product in products) {
        if (product.imageUrl.trim().isNotEmpty) {
          categoryImages.putIfAbsent(product.category, () => product.imageUrl);
          categoryImages.putIfAbsent('Все', () => product.imageUrl);
        }
      }

      _syncCartWithMenu(products);

      setState(() {
        _categories = categoryNames;
        _apiCategoryImages = categoryImages;
        _allProducts = products;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _loadError = e.toString();
      });
    }
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
        description: previous.description,
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
    final prefs = await SharedPreferences.getInstance();
    final selected = prefs.getString('selected_bakery_location')?.trim() ?? '';
    if (!mounted) return;
    setState(() => _selectedBakery = selected);
  }

  Future<void> _selectBakery() async {
    final selected = await Navigator.of(
      context,
    ).push<String>(MaterialPageRoute(builder: (_) => const LocationsScreen()));
    if (!mounted || selected == null || selected.trim().isEmpty) return;
    final value = selected.trim();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('selected_bakery_location', value);
    if (mounted) setState(() => _selectedBakery = value);
  }

  List<CatalogProduct> get _filteredProducts {
    final products = _allProducts.where((p) {
      final matchesQuery =
          _searchQuery.isEmpty ||
          p.title.toLowerCase().contains(_searchQuery.trim().toLowerCase()) ||
          p.description.toLowerCase().contains(
            _searchQuery.trim().toLowerCase(),
          );
      final matchesCategory =
          _selectedCategory == 'Все' || p.category == _selectedCategory;
      final matchesAvailability = !_onlyAvailable || !p.isStopListed;
      return matchesQuery && matchesCategory && matchesAvailability;
    }).toList();
    switch (_sort) {
      case _CatalogSort.priceLow:
        products.sort((a, b) => a.price.compareTo(b.price));
        break;
      case _CatalogSort.priceHigh:
        products.sort((a, b) => b.price.compareTo(a.price));
        break;
      case _CatalogSort.menu:
        break;
    }
    return products;
  }

  void _openCategoriesModal() {
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => _CatalogAllCategoriesScreen(
          categories: _categories,
          selectedCategory: _selectedCategory,
          apiCategoryImages: _apiCategoryImages,
          onSelectCategory: (cat) {
            setState(() => _selectedCategory = cat);
          },
        ),
      ),
    );
  }

  Future<void> _openFilterModal() async {
    final result = await Navigator.of(context).push<_CatalogFilterResult>(
      MaterialPageRoute(
        builder: (_) => _CatalogFilterScreen(
          initialSort: _sort,
          initialOnlyAvailable: _onlyAvailable,
        ),
      ),
    );
    if (!mounted || result == null) return;
    setState(() {
      _sort = result.sort;
      _onlyAvailable = result.onlyAvailable;
    });
  }

  void _clearSearch() {
    _searchController.clear();
    setState(() => _searchQuery = '');
  }

  void _setProductQuantity(CatalogProduct product, int quantity) {
    if (product.isStopListed) return;
    final next = quantity.clamp(0, product.inStockCount);
    final cart = context.read<CartProvider>();
    if (next <= 0) {
      cart.removeItem(product.id);
    } else {
      if (cart.getQuantity(product.id) == 0) {
        cart.addItem(
          productId: product.id,
          name: product.title,
          price: product.price,
          imageUrl: product.imageUrl,
          isStopListed: product.isStopListed,
        );
      }
      cart.setQuantity(product.id, next);
    }
    BulkaMotion.lightImpact();
  }

  void _openProductDetails(CatalogProduct product) {
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => _ProductDetailsScreen(
          product: product,
          liveProducts: _liveProducts,
          initialQuantity: context.read<CartProvider>().getQuantity(product.id),
          onQuantityChanged: _setProductQuantity,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartProvider>();
    final colors = context.bulkaColors;
    final visibleProducts = _filteredProducts;
    final filterActive = _CatalogFilterResult(
      sort: _sort,
      onlyAvailable: _onlyAvailable,
    ).isActive;
    final bakeryText = _selectedBakery.isEmpty
        ? 'catalog_action'.tr
        : _selectedBakery;

    return Scaffold(
      backgroundColor: colors.surfaceCream,
      appBar: AppBar(
        automaticallyImplyLeading: false,
        backgroundColor: colors.surfaceCream,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        title: Text(
          'nav_catalog'.tr,
          style: const TextStyle(
            fontFamily: _brandFont,
            fontSize: 27,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.5,
            color: _textDark,
          ),
        ),
        centerTitle: true,
      ),
      body: RefreshIndicator(
        color: _bulkaYellow,
        onRefresh: _loadMenu,
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 6, 16, 14),
                    child: Row(
                      children: [
                        Expanded(
                          child: SizedBox(
                            height: 56,
                            child: TextField(
                              controller: _searchController,
                              onChanged: (val) =>
                                  setState(() => _searchQuery = val),
                              textInputAction: TextInputAction.search,
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w500,
                                color: _textDark,
                              ),
                              decoration: InputDecoration(
                                hintText: 'catalog_search'.tr,
                                hintStyle: TextStyle(
                                  color: colors.mutedText,
                                  fontWeight: FontWeight.w400,
                                ),
                                prefixIcon: const Icon(
                                  Icons.search_rounded,
                                  color: _bulkaBrown,
                                ),
                                suffixIcon: _searchQuery.isEmpty
                                    ? null
                                    : IconButton(
                                        onPressed: _clearSearch,
                                        tooltip: 'catalog_clear_search'.tr,
                                        icon: const Icon(
                                          Icons.close_rounded,
                                          size: 20,
                                        ),
                                      ),
                                filled: true,
                                fillColor: Colors.white,
                                contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 18,
                                  vertical: 0,
                                ),
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(20),
                                  borderSide: BorderSide.none,
                                ),
                                enabledBorder: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(20),
                                  borderSide: BorderSide(
                                    color: colors.cardBorder,
                                  ),
                                ),
                                focusedBorder: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(20),
                                  borderSide: const BorderSide(
                                    color: _bulkaBrown,
                                    width: 1.5,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        IconButton(
                          onPressed: _openFilterModal,
                          tooltip: 'catalog_filter'.tr,
                          style: IconButton.styleFrom(
                            backgroundColor: _bulkaYellow,
                            foregroundColor: _textDark,
                            minimumSize: const Size(56, 56),
                            tapTargetSize: MaterialTapTargetSize.padded,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(20),
                            ),
                          ),
                          icon: Badge(
                            isLabelVisible: filterActive,
                            backgroundColor: _bulkaBrown,
                            smallSize: 8,
                            child: const Icon(Icons.tune_rounded, size: 24),
                          ),
                        ),
                      ],
                    ),
                  ),

                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Row(
                      children: [
                        Expanded(
                          child: SizedBox(
                            height: 48,
                            child: ListView.separated(
                              scrollDirection: Axis.horizontal,
                              itemCount: _categories.length,
                              separatorBuilder: (context, index) =>
                                  const SizedBox(width: 8),
                              itemBuilder: (context, i) {
                                final cat = _categories[i];
                                return _CatalogCategoryChip(
                                  label: cat,
                                  imageUrl: _apiCategoryImages[cat],
                                  selected: _selectedCategory == cat,
                                  onTap: () =>
                                      setState(() => _selectedCategory = cat),
                                );
                              },
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        IconButton(
                          onPressed: _openCategoriesModal,
                          tooltip: 'catalog_all_categories'.tr,
                          style: IconButton.styleFrom(
                            backgroundColor: Colors.white,
                            foregroundColor: _textDark,
                            minimumSize: const Size(48, 48),
                            tapTargetSize: MaterialTapTargetSize.padded,
                            side: BorderSide(color: colors.cardBorder),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16),
                            ),
                          ),
                          icon: const Icon(Icons.grid_view_rounded, size: 20),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 14),

                  // Location Banner (Самовывоз/Адрес)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Semantics(
                      button: true,
                      label: '${'catalog_bakery_label'.tr}: $bakeryText',
                      child: BulkaPressScale(
                        child: Material(
                          color: Colors.transparent,
                          child: InkWell(
                            onTap: _selectBakery,
                            borderRadius: BorderRadius.circular(20),
                            child: Ink(
                              padding: const EdgeInsets.fromLTRB(
                                18,
                                14,
                                14,
                                14,
                              ),
                              decoration: BoxDecoration(
                                gradient: const LinearGradient(
                                  colors: [
                                    Color(0xFFFFD760),
                                    Color(0xFFFFB814),
                                  ],
                                  begin: Alignment.topLeft,
                                  end: Alignment.bottomRight,
                                ),
                                borderRadius: BorderRadius.circular(20),
                                boxShadow: const [
                                  BoxShadow(
                                    color: Color(0x1F9D6210),
                                    blurRadius: 18,
                                    offset: Offset(0, 8),
                                  ),
                                ],
                              ),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          'catalog_pickup_menu'.tr,
                                          style: const TextStyle(
                                            fontFamily: _brandFont,
                                            fontSize: 16,
                                            fontWeight: FontWeight.w700,
                                            height: 1.2,
                                            color: _textDark,
                                          ),
                                        ),
                                        const SizedBox(height: 6),
                                        Row(
                                          children: [
                                            const Icon(
                                              Icons.location_on_rounded,
                                              color: _textDark,
                                              size: 16,
                                            ),
                                            const SizedBox(width: 4),
                                            Expanded(
                                              child: Text(
                                                '${'catalog_bakery_label'.tr}: $bakeryText',
                                                maxLines: 1,
                                                overflow: TextOverflow.ellipsis,
                                                style: const TextStyle(
                                                  color: _textDark,
                                                  fontWeight: FontWeight.w600,
                                                  fontSize: 12.5,
                                                ),
                                              ),
                                            ),
                                          ],
                                        ),
                                      ],
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Container(
                                    width: 50,
                                    height: 50,
                                    decoration: const BoxDecoration(
                                      color: Colors.white,
                                      shape: BoxShape.circle,
                                    ),
                                    child: const Icon(
                                      Icons.storefront_rounded,
                                      color: _textDark,
                                      size: 27,
                                    ),
                                  ),
                                  const SizedBox(width: 2),
                                  const Icon(
                                    Icons.chevron_right_rounded,
                                    color: _textDark,
                                    size: 22,
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),

                  const SizedBox(height: 22),

                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _selectedCategory,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontFamily: _brandFont,
                                  fontSize: 22,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: -0.35,
                                  color: _textDark,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                '${visibleProducts.length} ${'catalog_products'.tr}',
                                style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w500,
                                  color: colors.mutedText,
                                ),
                              ),
                            ],
                          ),
                        ),
                        TextButton.icon(
                          onPressed: _openCategoriesModal,
                          style: TextButton.styleFrom(
                            foregroundColor: _textDark.withValues(alpha: 0.7),
                            minimumSize: const Size(48, 48),
                            tapTargetSize: MaterialTapTargetSize.padded,
                          ),
                          label: Text('catalog_all_categories'.tr),
                          icon: const Icon(
                            Icons.chevron_right_rounded,
                            size: 20,
                          ),
                          iconAlignment: IconAlignment.end,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
              ),
            ),

            // Product List
            if (_isLoading)
              const SliverToBoxAdapter(child: _CatalogSkeletonGrid())
            else if (_loadError != null)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.only(top: 40),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.cloud_off_rounded,
                        color: _textDark.withValues(alpha: 0.3),
                        size: 48,
                      ),
                      const SizedBox(height: 12),
                      Text(
                        'catalog_load_failed'.tr,
                        style: TextStyle(
                          color: _textDark.withValues(alpha: 0.5),
                          fontSize: 15,
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextButton(
                        onPressed: _loadMenu,
                        child: Text(
                          'catalog_retry'.tr,
                          style: const TextStyle(
                            color: _bulkaYellow,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              )
            else if (visibleProducts.isEmpty)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.only(top: 40),
                  child: Center(
                    child: Text(
                      'catalog_empty'.tr,
                      style: TextStyle(color: _textDark.withValues(alpha: 0.5)),
                    ),
                  ),
                ),
              )
            else
              SliverPadding(
                padding: EdgeInsets.fromLTRB(
                  16,
                  4,
                  16,
                  BulkaLayout.bottomNavContentInset(context),
                ),
                sliver: SliverLayoutBuilder(
                  builder: (context, constraints) {
                    final textScale = MediaQuery.textScalerOf(context).scale(1);
                    final mainAxisExtent = textScale > 1.2 ? 352.0 : 326.0;
                    return SliverGrid(
                      gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(
                        maxCrossAxisExtent: 235,
                        mainAxisSpacing: 16,
                        crossAxisSpacing: 12,
                        mainAxisExtent: mainAxisExtent,
                      ),
                      delegate: SliverChildBuilderDelegate((context, index) {
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
    );
  }

  /// Формат цены: 1500 -> "1 500"
  static String _formatPrice(int price) {
    final s = price.toString();
    final buf = StringBuffer();
    for (var i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 == 0) buf.write(' ');
      buf.write(s[i]);
    }
    return buf.toString();
  }

  Widget _buildProductCard(CatalogProduct product, int quantity) {
    final colors = context.bulkaColors;
    return Semantics(
      button: true,
      label: product.title,
      value: '${_formatPrice(product.price)} ₸',
      child: BulkaPressScale(
        pressedScale: 0.975,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: () => _openProductDetails(product),
            borderRadius: BorderRadius.circular(22),
            child: Ink(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(22),
                border: Border.all(
                  color: colors.cardBorder.withValues(alpha: 0.65),
                ),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x126D3317),
                    blurRadius: 18,
                    offset: Offset(0, 8),
                  ),
                ],
              ),
              padding: const EdgeInsets.all(9),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        BulkaHero(
                          tag: 'catalog-product-${product.id}',
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(17),
                            child: _NetworkImage(
                              url: product.imageUrl,
                              fit: BoxFit.cover,
                              semanticLabel: product.title,
                            ),
                          ),
                        ),
                        if (product.isStopListed)
                          ClipRRect(
                            borderRadius: BorderRadius.circular(17),
                            child: ColoredBox(
                              color: Colors.white.withValues(alpha: 0.58),
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  SizedBox(
                    height: 38,
                    child: Text(
                      product.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                        color: _textDark,
                        height: 1.25,
                        letterSpacing: -0.15,
                      ),
                    ),
                  ),
                  Text(
                    '${_formatPrice(product.price)} ₸',
                    style: TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 17,
                      color: _textDark,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                  const SizedBox(height: 3),
                  Row(
                    children: [
                      Container(
                        width: 7,
                        height: 7,
                        decoration: BoxDecoration(
                          color: product.isStopListed
                              ? colors.danger
                              : colors.success,
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          product.isStopListed
                              ? 'catalog_stop_list'.tr
                              : 'catalog_in_stock'.tr,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w600,
                            color: product.isStopListed
                                ? colors.danger
                                : colors.success,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 9),
                  _CatalogQuantityControl(
                    quantity: quantity,
                    stopListed: product.isStopListed,
                    onAdd: () => _setProductQuantity(product, 1),
                    onDecrease: () =>
                        _setProductQuantity(product, quantity - 1),
                    onIncrease: () =>
                        _setProductQuantity(product, quantity + 1),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CatalogCategoryChip extends StatelessWidget {
  const _CatalogCategoryChip({
    required this.label,
    required this.imageUrl,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String? imageUrl;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      child: BulkaPressScale(
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(16),
            child: AnimatedContainer(
              duration: BulkaMotion.duration(context, BulkaMotion.fast),
              curve: BulkaMotion.standardCurve,
              height: 48,
              padding: const EdgeInsets.fromLTRB(6, 5, 14, 5),
              decoration: BoxDecoration(
                color: selected ? _bulkaYellow : Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: selected ? _bulkaYellow : colors.cardBorder,
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: colors.surfaceCream,
                      shape: BoxShape.circle,
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: imageUrl == null || imageUrl!.isEmpty
                        ? const Icon(
                            Icons.grid_view_rounded,
                            size: 18,
                            color: _bulkaBrown,
                          )
                        : _NetworkImage(
                            url: imageUrl!,
                            fit: BoxFit.cover,
                            semanticLabel: label,
                          ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: _textDark,
                      fontSize: 13,
                      fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CatalogQuantityControl extends StatelessWidget {
  const _CatalogQuantityControl({
    required this.quantity,
    required this.stopListed,
    required this.onAdd,
    required this.onDecrease,
    required this.onIncrease,
  });

  final int quantity;
  final bool stopListed;
  final VoidCallback onAdd;
  final VoidCallback onDecrease;
  final VoidCallback onIncrease;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    late final Widget control;
    if (stopListed) {
      control = Container(
        key: const ValueKey('catalog-stop'),
        height: 46,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: const Color(0xFFF2ECE4),
          borderRadius: BorderRadius.circular(15),
        ),
        child: Text(
          'catalog_stop_list'.tr,
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: Color(0xFF9E958A),
          ),
        ),
      );
    } else if (quantity == 0) {
      control = SizedBox(
        key: const ValueKey('catalog-add'),
        height: 46,
        width: double.infinity,
        child: ElevatedButton.icon(
          onPressed: onAdd,
          style: ElevatedButton.styleFrom(
            backgroundColor: colors.brandGold,
            foregroundColor: _textDark,
            elevation: 0,
            minimumSize: const Size(48, 46),
            tapTargetSize: MaterialTapTargetSize.padded,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(15),
            ),
          ),
          icon: const Icon(Icons.shopping_bag_outlined, size: 18),
          label: Text(
            'catalog_add_to_cart'.tr,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 12.5),
          ),
        ),
      );
    } else {
      control = Container(
        key: const ValueKey('catalog-quantity'),
        height: 46,
        decoration: BoxDecoration(
          color: colors.brandGold,
          borderRadius: BorderRadius.circular(15),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            IconButton(
              onPressed: onDecrease,
              tooltip: 'Уменьшить количество',
              style: IconButton.styleFrom(
                minimumSize: const Size(44, 44),
                tapTargetSize: MaterialTapTargetSize.padded,
              ),
              icon: const Icon(Icons.remove, size: 18, color: _textDark),
            ),
            Semantics(
              label: 'Количество',
              value: '$quantity',
              child: AnimatedSwitcher(
                duration: BulkaMotion.duration(context, BulkaMotion.fast),
                child: Text(
                  '$quantity',
                  key: ValueKey(quantity),
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 14,
                    color: _textDark,
                  ),
                ),
              ),
            ),
            IconButton(
              onPressed: onIncrease,
              tooltip: 'Увеличить количество',
              style: IconButton.styleFrom(
                minimumSize: const Size(44, 44),
                tapTargetSize: MaterialTapTargetSize.padded,
              ),
              icon: const Icon(Icons.add, size: 18, color: _textDark),
            ),
          ],
        ),
      );
    }

    return BulkaMotionSwitcher(
      duration: BulkaMotion.fast,
      offset: const Offset(0, 0.06),
      scale: 0.98,
      child: control,
    );
  }
}

class _CatalogSkeletonGrid extends StatelessWidget {
  const _CatalogSkeletonGrid();

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
      physics: const NeverScrollableScrollPhysics(),
      shrinkWrap: true,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: 16,
        crossAxisSpacing: 12,
        mainAxisExtent: 326,
      ),
      itemCount: 6,
      itemBuilder: (context, index) => const _CatalogSkeletonCard(),
    );
  }
}

class _CatalogSkeletonCard extends StatelessWidget {
  const _CatalogSkeletonCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(9),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFEADBBE)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: _CatalogSkeletonBox(radius: 17)),
          const SizedBox(height: 10),
          const _CatalogSkeletonBox(width: double.infinity, height: 14),
          const SizedBox(height: 6),
          const _CatalogSkeletonBox(width: 92, height: 14),
          const SizedBox(height: 8),
          const _CatalogSkeletonBox(width: 72, height: 18),
          const SizedBox(height: 10),
          const _CatalogSkeletonBox(
            width: double.infinity,
            height: 48,
            radius: 12,
          ),
        ],
      ),
    );
  }
}

class _CatalogSkeletonBox extends StatelessWidget {
  const _CatalogSkeletonBox({this.width, this.height, this.radius = 8});

  final double? width;
  final double? height;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: const Color(0xFFF0EBE3),
        borderRadius: BorderRadius.circular(radius),
      ),
    );
  }
}

class _CatalogFilterScreen extends StatefulWidget {
  const _CatalogFilterScreen({
    required this.initialSort,
    required this.initialOnlyAvailable,
  });

  final _CatalogSort initialSort;
  final bool initialOnlyAvailable;

  @override
  State<_CatalogFilterScreen> createState() => _CatalogFilterScreenState();
}

class _CatalogFilterScreenState extends State<_CatalogFilterScreen> {
  final Set<String> _expandedSections = {'Сортировка', 'Наличие'};
  final Set<String> _selectedFilters = {};

  final Map<String, List<String>> _sections = const {
    'Сортировка': ['menu', 'priceLow', 'priceHigh'],
    'Наличие': ['available'],
  };

  @override
  void initState() {
    super.initState();
    _selectedFilters.add(widget.initialSort.name);
    if (widget.initialOnlyAvailable) _selectedFilters.add('available');
  }

  void _toggleSection(String title) {
    setState(() {
      if (_expandedSections.contains(title)) {
        _expandedSections.remove(title);
      } else {
        _expandedSections.add(title);
      }
    });
  }

  void _toggleFilter(String option) {
    setState(() {
      if (option == 'available') {
        if (_selectedFilters.contains(option)) {
          _selectedFilters.remove(option);
        } else {
          _selectedFilters.add(option);
        }
      } else {
        _selectedFilters.removeAll(
          _CatalogSort.values.map((sort) => sort.name),
        );
        _selectedFilters.add(option);
      }
    });
  }

  String _optionLabel(String option) {
    return switch (option) {
      'priceLow' => 'catalog_sort_price_low'.tr,
      'priceHigh' => 'catalog_sort_price_high'.tr,
      'available' => 'catalog_only_available'.tr,
      _ => 'catalog_sort_default'.tr,
    };
  }

  void _apply() {
    final sort = _selectedFilters.contains('priceLow')
        ? _CatalogSort.priceLow
        : _selectedFilters.contains('priceHigh')
        ? _CatalogSort.priceHigh
        : _CatalogSort.menu;
    Navigator.of(context).pop(
      _CatalogFilterResult(
        sort: sort,
        onlyAvailable: _selectedFilters.contains('available'),
      ),
    );
  }

  void _reset() {
    setState(() {
      _selectedFilters
        ..clear()
        ..add(_CatalogSort.menu.name);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.bulkaColors.surfaceCream,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                children: [
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(
                      Icons.chevron_left_rounded,
                      size: 28,
                      color: _textDark,
                    ),
                    tooltip: 'back_tooltip'.tr,
                    style: IconButton.styleFrom(
                      minimumSize: const Size(48, 48),
                      tapTargetSize: MaterialTapTargetSize.padded,
                    ),
                  ),
                  Expanded(
                    child: Center(
                      child: Text(
                        'catalog_filter'.tr,
                        style: const TextStyle(
                          fontFamily: _brandFont,
                          fontSize: 22,
                          fontWeight: FontWeight.w700,
                          color: _textDark,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 28),
                ],
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(
                  horizontal: 20,
                  vertical: 8,
                ),
                child: Column(
                  children: _sections.entries.map((entry) {
                    final sectionTitle = entry.key;
                    final options = entry.value;
                    final isExpanded = _expandedSections.contains(sectionTitle);

                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        InkWell(
                          onTap: () => _toggleSection(sectionTitle),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  sectionTitle == 'Сортировка'
                                      ? 'catalog_sort_title'.tr
                                      : 'catalog_availability'.tr,
                                  style: const TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w600,
                                    color: _textDark,
                                  ),
                                ),
                                Icon(
                                  isExpanded
                                      ? Icons.keyboard_arrow_up_rounded
                                      : Icons.keyboard_arrow_down_rounded,
                                  color: _textDark,
                                  size: 24,
                                ),
                              ],
                            ),
                          ),
                        ),
                        if (isExpanded)
                          ...options.map((option) {
                            final isSelected = _selectedFilters.contains(
                              option,
                            );
                            return InkWell(
                              onTap: () => _toggleFilter(option),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  vertical: 12,
                                ),
                                child: Row(
                                  mainAxisAlignment:
                                      MainAxisAlignment.spaceBetween,
                                  children: [
                                    Text(
                                      _optionLabel(option),
                                      style: TextStyle(
                                        fontSize: 15,
                                        color: isSelected
                                            ? _textDark
                                            : const Color(0xFF7A6C65),
                                        fontWeight: isSelected
                                            ? FontWeight.w600
                                            : FontWeight.w400,
                                      ),
                                    ),
                                    Container(
                                      width: 22,
                                      height: 22,
                                      decoration: BoxDecoration(
                                        shape: BoxShape.circle,
                                        color: isSelected
                                            ? _bulkaYellow
                                            : const Color(0xFFE8E4DD),
                                      ),
                                      child: isSelected
                                          ? const Icon(
                                              Icons.check,
                                              size: 14,
                                              color: _textDark,
                                            )
                                          : null,
                                    ),
                                  ],
                                ),
                              ),
                            );
                          }),
                        const Divider(color: Color(0xFFEDE8DF), height: 1),
                      ],
                    );
                  }).toList(),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
              child: Row(
                children: [
                  Expanded(
                    flex: 11,
                    child: SizedBox(
                      height: 50,
                      child: ElevatedButton(
                        onPressed: _apply,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: _bulkaYellow,
                          foregroundColor: _textDark,
                          elevation: 0,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(25),
                          ),
                        ),
                        child: Text(
                          'catalog_apply'.tr,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: _textDark,
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    flex: 9,
                    child: SizedBox(
                      height: 50,
                      child: OutlinedButton(
                        onPressed: _reset,
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: _textDark, width: 1.5),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(25),
                          ),
                        ),
                        child: Text(
                          'catalog_reset'.tr,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                            color: _textDark,
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CatalogAllCategoriesScreen extends StatelessWidget {
  const _CatalogAllCategoriesScreen({
    required this.categories,
    required this.selectedCategory,
    required this.onSelectCategory,
    required this.apiCategoryImages,
  });

  final List<String> categories;
  final String selectedCategory;
  final ValueChanged<String> onSelectCategory;
  final Map<String, String> apiCategoryImages;

  @override
  Widget build(BuildContext context) {
    final displayCategories = categories.where((c) => c != 'Все').toList();

    return Scaffold(
      backgroundColor: context.bulkaColors.surfaceCream,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                children: [
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(
                      Icons.chevron_left_rounded,
                      size: 28,
                      color: _textDark,
                    ),
                    tooltip: 'back_tooltip'.tr,
                    style: IconButton.styleFrom(
                      minimumSize: const Size(48, 48),
                      tapTargetSize: MaterialTapTargetSize.padded,
                    ),
                  ),
                  Expanded(
                    child: Center(
                      child: Text(
                        'nav_catalog'.tr,
                        style: const TextStyle(
                          fontFamily: _brandFont,
                          fontSize: 22,
                          fontWeight: FontWeight.w700,
                          color: _textDark,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 28),
                ],
              ),
            ),
            Expanded(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final textScale = MediaQuery.textScalerOf(context).scale(1);
                  final columns = constraints.maxWidth >= 900
                      ? 4
                      : constraints.maxWidth >= 600
                      ? 3
                      : 2;
                  return GridView.builder(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 12,
                    ),
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: columns,
                      mainAxisSpacing: 16,
                      crossAxisSpacing: 12,
                      mainAxisExtent: textScale > 1.2 ? 218 : 190,
                    ),
                    itemCount: displayCategories.length,
                    itemBuilder: (context, i) {
                      final cat = displayCategories[i];
                      final imageUrl = apiCategoryImages[cat] ?? '';

                      return Semantics(
                        button: true,
                        selected: selectedCategory == cat,
                        label: cat,
                        child: BulkaPressScale(
                          child: Material(
                            color: Colors.transparent,
                            child: InkWell(
                              onTap: () {
                                onSelectCategory(cat);
                                Navigator.of(context).pop();
                              },
                              borderRadius: BorderRadius.circular(18),
                              child: Ink(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  borderRadius: BorderRadius.circular(20),
                                  border: Border.all(
                                    color: selectedCategory == cat
                                        ? _bulkaYellow
                                        : context.bulkaColors.cardBorder,
                                    width: selectedCategory == cat ? 2 : 1,
                                  ),
                                ),
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: [
                                    Expanded(
                                      child: ClipRRect(
                                        borderRadius: BorderRadius.circular(15),
                                        child: _NetworkImage(
                                          url: imageUrl,
                                          fit: BoxFit.cover,
                                          semanticLabel: cat,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(height: 10),
                                    Text(
                                      cat,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        fontSize: 14,
                                        fontWeight: FontWeight.w700,
                                        color: _textDark,
                                        height: 1.25,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                      );
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ProductDetailsScreen extends StatefulWidget {
  const _ProductDetailsScreen({
    required this.product,
    required this.liveProducts,
    required this.initialQuantity,
    required this.onQuantityChanged,
  });

  final CatalogProduct product;
  final ValueListenable<Map<String, CatalogProduct>> liveProducts;
  final int initialQuantity;
  final void Function(CatalogProduct product, int quantity) onQuantityChanged;

  @override
  State<_ProductDetailsScreen> createState() => _ProductDetailsScreenState();
}

class _ProductDetailsScreenState extends State<_ProductDetailsScreen> {
  late int _quantity;
  int _currentPhotoIndex = 0;

  @override
  void initState() {
    super.initState();
    _quantity = widget.initialQuantity;
  }

  void _updateQuantity(CatalogProduct product, int newQty) {
    if (product.isStopListed) return;
    final next = newQty.clamp(0, product.inStockCount);
    setState(() {
      _quantity = next;
    });
    widget.onQuantityChanged(product, next);
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<Map<String, CatalogProduct>>(
      valueListenable: widget.liveProducts,
      builder: (context, products, _) =>
          _buildContent(context, products[widget.product.id] ?? widget.product),
    );
  }

  Widget _buildContent(BuildContext context, CatalogProduct product) {
    final photos = [product.imageUrl];

    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                children: [
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(
                      Icons.chevron_left_rounded,
                      size: 28,
                      color: _textDark,
                    ),
                    tooltip: 'back_tooltip'.tr,
                    style: IconButton.styleFrom(
                      minimumSize: const Size(48, 48),
                      tapTargetSize: MaterialTapTargetSize.padded,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      product.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontFamily: _headingFont,
                        fontSize: 17,
                        fontWeight: FontWeight.w700,
                        color: _textDark,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      height: 290,
                      child: PageView.builder(
                        itemCount: photos.length,
                        onPageChanged: (i) =>
                            setState(() => _currentPhotoIndex = i),
                        itemBuilder: (context, i) {
                          return Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 24),
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(24),
                              child: i == 0
                                  ? BulkaHero(
                                      tag: 'catalog-product-${product.id}',
                                      child: _NetworkImage(
                                        url: photos[i],
                                        fit: BoxFit.cover,
                                        semanticLabel: product.title,
                                      ),
                                    )
                                  : _NetworkImage(
                                      url: photos[i],
                                      fit: BoxFit.cover,
                                      semanticLabel: product.title,
                                    ),
                            ),
                          );
                        },
                      ),
                    ),
                    if (photos.length > 1) ...[
                      const SizedBox(height: 12),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: List.generate(photos.length, (i) {
                          final active = _currentPhotoIndex == i;
                          return AnimatedContainer(
                            duration: BulkaMotion.duration(
                              context,
                              BulkaMotion.fast,
                            ),
                            margin: const EdgeInsets.symmetric(horizontal: 4),
                            width: active ? 22 : 8,
                            height: 8,
                            decoration: BoxDecoration(
                              color: active
                                  ? _bulkaYellow
                                  : const Color(0xFFE5E0DA),
                              borderRadius: BorderRadius.circular(4),
                            ),
                          );
                        }),
                      ),
                    ],
                    const SizedBox(height: 24),
                    Container(
                      width: double.infinity,
                      decoration: const BoxDecoration(
                        color: _cream,
                        borderRadius: BorderRadius.vertical(
                          top: Radius.circular(28),
                        ),
                      ),
                      padding: const EdgeInsets.fromLTRB(24, 28, 24, 40),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            product.title,
                            style: const TextStyle(
                              fontFamily: _headingFont,
                              fontSize: 21,
                              fontWeight: FontWeight.w700,
                              color: _textDark,
                              height: 1.25,
                            ),
                          ),
                          const SizedBox(height: 12),
                          Text(
                            '${_CatalogScreenState._formatPrice(product.price)} ₸',
                            style: const TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w800,
                              color: Color(0xFFC8902E),
                            ),
                          ),
                          const SizedBox(height: 20),
                          Text(
                            product.description.isNotEmpty
                                ? product.description
                                : 'Песочное тесто и нежная начинка из свежих отборных ингредиентов. Свежая выпечка каждый день.',
                            style: const TextStyle(
                              fontSize: 15,
                              color: Color(0xFF5A4D46),
                              height: 1.45,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Container(
              color: _cream,
              padding: EdgeInsets.fromLTRB(
                20,
                8,
                20,
                16 + MediaQuery.paddingOf(context).bottom,
              ),
              child: _CatalogQuantityControl(
                quantity: _quantity,
                stopListed: product.isStopListed,
                onAdd: () => _updateQuantity(product, 1),
                onDecrease: () => _updateQuantity(product, _quantity - 1),
                onIncrease: () => _updateQuantity(product, _quantity + 1),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
