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

class CatalogScreen extends StatefulWidget {
  const CatalogScreen({this.onOpenCart, super.key});

  final VoidCallback? onOpenCart;

  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen>
    with WidgetsBindingObserver {
  static const _menuRefreshInterval = Duration(minutes: 10);

  final _api = BulkaApiClient();
  String _selectedBakery = '';
  String _searchQuery = '';
  String _selectedCategory = 'Все';
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
    return _allProducts.where((p) {
      final matchesQuery =
          _searchQuery.isEmpty ||
          p.title.toLowerCase().contains(_searchQuery.toLowerCase());
      final matchesCategory =
          _selectedCategory == 'Все' || p.category == _selectedCategory;
      return matchesQuery && matchesCategory;
    }).toList();
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

  void _openFilterModal() {
    Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => const _CatalogFilterScreen()),
    );
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
          initialQuantity: context.read<CartProvider>().getQuantity(product.id),
          onQuantityChanged: (q) => _setProductQuantity(product, q),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartProvider>();
    final bakeryText = _selectedBakery.isEmpty
        ? 'catalog_action'.tr
        : _selectedBakery;

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        automaticallyImplyLeading: false,
        backgroundColor: Colors.white,
        elevation: 0,
        title: Text(
          'nav_catalog'.tr,
          style: const TextStyle(
            fontFamily: _headingFont,
            fontWeight: FontWeight.w400,
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
                  // Search & Filter
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                    child: Row(
                      children: [
                        Expanded(
                          child: SizedBox(
                            height: 48,
                            child: TextField(
                              onChanged: (val) =>
                                  setState(() => _searchQuery = val),
                              decoration: InputDecoration(
                                hintText: 'Поиск товаров',
                                prefixIcon: const Icon(
                                  Icons.search_rounded,
                                  color: _textDark,
                                ),
                                filled: true,
                                fillColor: _milkyBackground,
                                contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 20,
                                  vertical: 0,
                                ),
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(24),
                                  borderSide: BorderSide(
                                    color: _almond.withValues(alpha: 0.6),
                                  ),
                                ),
                                enabledBorder: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(24),
                                  borderSide: BorderSide(
                                    color: _almond.withValues(alpha: 0.6),
                                  ),
                                ),
                                focusedBorder: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(24),
                                  borderSide: const BorderSide(
                                    color: _bulkaYellow,
                                    width: 2,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        IconButton(
                          onPressed: _openFilterModal,
                          tooltip: 'Фильтр',
                          style: IconButton.styleFrom(
                            backgroundColor: _bulkaYellow,
                            foregroundColor: _textDark,
                            minimumSize: const Size(48, 48),
                            tapTargetSize: MaterialTapTargetSize.padded,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(18),
                            ),
                          ),
                          icon: const Icon(Icons.tune_rounded),
                        ),
                      ],
                    ),
                  ),

                  // Horizontal Categories Bar
                  SizedBox(
                    height: 38,
                    child: ListView.separated(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      scrollDirection: Axis.horizontal,
                      itemCount: _categories.length,
                      separatorBuilder: (context, index) =>
                          const SizedBox(width: 8),
                      itemBuilder: (context, i) {
                        final cat = _categories[i];
                        final active = _selectedCategory == cat;
                        return ChoiceChip(
                          label: Text(cat),
                          selected: active,
                          onSelected: (_) =>
                              setState(() => _selectedCategory = cat),
                          labelStyle: TextStyle(
                            color: _textDark,
                            fontWeight: active
                                ? FontWeight.w700
                                : FontWeight.w400,
                            fontSize: 13,
                          ),
                          selectedColor: _bulkaYellow,
                          backgroundColor: _milkyBackground,
                          side: BorderSide(
                            color: active
                                ? _bulkaYellow
                                : _almond.withValues(alpha: 0.5),
                          ),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(20),
                          ),
                          materialTapTargetSize: MaterialTapTargetSize.padded,
                        );
                      },
                    ),
                  ),

                  const SizedBox(height: 6),
                  Center(
                    child: IconButton(
                      onPressed: _openCategoriesModal,
                      tooltip: 'Открыть категории',
                      style: IconButton.styleFrom(
                        backgroundColor: _milkyBackground,
                        foregroundColor: _textDark,
                        minimumSize: const Size(48, 48),
                        tapTargetSize: MaterialTapTargetSize.padded,
                      ),
                      icon: const Icon(
                        Icons.keyboard_arrow_down_rounded,
                        size: 20,
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),

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
                                16,
                                16,
                                16,
                              ),
                              decoration: BoxDecoration(
                                gradient: const LinearGradient(
                                  colors: [
                                    Color(0xFFFFDF6C),
                                    Color(0xFFFFB814),
                                  ],
                                  begin: Alignment.topLeft,
                                  end: Alignment.bottomRight,
                                ),
                                borderRadius: BorderRadius.circular(20),
                                boxShadow: _softShadow,
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
                                            fontFamily: _headingFont,
                                            fontSize: 18,
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
                                                  fontSize: 13,
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
                                    width: 58,
                                    height: 58,
                                    decoration: const BoxDecoration(
                                      color: Colors.white,
                                      shape: BoxShape.circle,
                                    ),
                                    child: const Icon(
                                      Icons.storefront_rounded,
                                      color: _textDark,
                                      size: 32,
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

                  const SizedBox(height: 16),

                  // Section Header
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          _selectedCategory,
                          style: const TextStyle(
                            fontFamily: _headingFont,
                            fontSize: 20,
                            color: _textDark,
                          ),
                        ),
                        TextButton.icon(
                          onPressed: _openCategoriesModal,
                          style: TextButton.styleFrom(
                            foregroundColor: _textDark.withValues(alpha: 0.7),
                            minimumSize: const Size(48, 48),
                            tapTargetSize: MaterialTapTargetSize.padded,
                          ),
                          label: const Text('Все'),
                          icon: const Icon(
                            Icons.chevron_right_rounded,
                            size: 20,
                          ),
                          iconAlignment: IconAlignment.end,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
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
                        'Не удалось загрузить меню',
                        style: TextStyle(
                          color: _textDark.withValues(alpha: 0.5),
                          fontSize: 15,
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextButton(
                        onPressed: _loadMenu,
                        child: const Text(
                          'Повторить',
                          style: TextStyle(
                            color: _bulkaYellow,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              )
            else if (_filteredProducts.isEmpty)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.only(top: 40),
                  child: Center(
                    child: Text(
                      'В этой категории пока нет товаров',
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
                    final mainAxisExtent = textScale > 1.2 ? 305.0 : 275.0;
                    return SliverGrid(
                      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: constraints.crossAxisExtent >= 700
                            ? 3
                            : 2,
                        mainAxisSpacing: 14,
                        crossAxisSpacing: 14,
                        mainAxisExtent: mainAxisExtent,
                      ),
                      delegate: SliverChildBuilderDelegate((context, index) {
                        final p = _filteredProducts[index];
                        final qty = cart.getQuantity(p.id);
                        return _buildProductCard(p, qty);
                      }, childCount: _filteredProducts.length),
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
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: () => _openProductDetails(product),
            borderRadius: BorderRadius.circular(20),
            child: Ink(
              decoration: BoxDecoration(
                color: _milkyBackground,
                borderRadius: BorderRadius.circular(20),
                boxShadow: _softShadow,
              ),
              padding: const EdgeInsets.all(10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(14),
                      child: _NetworkImage(
                        url: product.imageUrl,
                        fit: BoxFit.cover,
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    product.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 13,
                      color: _textDark,
                      height: 1.25,
                      letterSpacing: -0.2,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${_formatPrice(product.price)} ₸',
                    style: TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 15,
                      color: colors.priceGold,
                    ),
                  ),
                  if (product.isStopListed == true) ...[
                    const SizedBox(height: 2),
                    const Text(
                      'В стоп-листе',
                      style: TextStyle(
                        fontSize: 11,
                        color: _errorRed,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                  const SizedBox(height: 8),
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
    if (stopListed) {
      return Container(
        height: 48,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: const Color(0xFFF2ECE4),
          borderRadius: BorderRadius.circular(12),
        ),
        child: const Text(
          'Стоп-лист',
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: Color(0xFF9E958A),
          ),
        ),
      );
    }

    if (quantity == 0) {
      return SizedBox(
        height: 48,
        width: double.infinity,
        child: ElevatedButton.icon(
          onPressed: onAdd,
          style: ElevatedButton.styleFrom(
            backgroundColor: colors.brandGold,
            foregroundColor: _textDark,
            elevation: 0,
            minimumSize: const Size(48, 48),
            tapTargetSize: MaterialTapTargetSize.padded,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
          icon: const Icon(Icons.shopping_bag_outlined, size: 20),
          label: const Text('В корзину'),
        ),
      );
    }

    return Container(
      height: 48,
      decoration: BoxDecoration(
        color: colors.brandGold,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          IconButton(
            onPressed: onDecrease,
            tooltip: 'Уменьшить количество',
            style: IconButton.styleFrom(
              minimumSize: const Size(48, 48),
              tapTargetSize: MaterialTapTargetSize.padded,
            ),
            icon: const Icon(Icons.remove, size: 18, color: _textDark),
          ),
          Semantics(
            label: 'Количество',
            value: '$quantity',
            child: Text(
              '$quantity',
              style: const TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 14,
                color: _textDark,
              ),
            ),
          ),
          IconButton(
            onPressed: onIncrease,
            tooltip: 'Увеличить количество',
            style: IconButton.styleFrom(
              minimumSize: const Size(48, 48),
              tapTargetSize: MaterialTapTargetSize.padded,
            ),
            icon: const Icon(Icons.add, size: 18, color: _textDark),
          ),
        ],
      ),
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
        mainAxisSpacing: 14,
        crossAxisSpacing: 14,
        mainAxisExtent: 275,
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
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: _softShadow,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: _CatalogSkeletonBox(radius: 14)),
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

const Map<String, String> _categoryImages = {
  'Все':
      'https://images.unsplash.com/photo-1519915028121-7d3463d20b13?w=400&auto=format&fit=crop&q=80',
  'Пироги Четвертинки':
      'https://images.unsplash.com/photo-1519915028121-7d3463d20b13?w=400&auto=format&fit=crop&q=80',
  'Кофе':
      'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=400&auto=format&fit=crop&q=80',
  'Найди свою половинку':
      'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&auto=format&fit=crop&q=80',
  'Круглые торты':
      'https://images.unsplash.com/photo-1588195538326-c5b1e9f80a1b?w=400&auto=format&fit=crop&q=80',
  'Прямоугольные торты':
      'https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?w=400&auto=format&fit=crop&q=80',
  'Круглые мини торты':
      'https://images.unsplash.com/photo-1535141192574-5d4897c13136?w=400&auto=format&fit=crop&q=80',
  'Пироги':
      'https://images.unsplash.com/photo-1621303837174-89787a7d4729?w=400&auto=format&fit=crop&q=80',
  'Сладкая выпечка':
      'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400&auto=format&fit=crop&q=80',
  'Слоенная выпечка':
      'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=400&auto=format&fit=crop&q=80',
  'Сытная выпечка':
      'https://images.unsplash.com/photo-1509722747041-616f39b57569?w=400&auto=format&fit=crop&q=80',
  'Чизкейки':
      'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=400&auto=format&fit=crop&q=80',
};

class _CatalogFilterScreen extends StatefulWidget {
  const _CatalogFilterScreen();

  @override
  State<_CatalogFilterScreen> createState() => _CatalogFilterScreenState();
}

class _CatalogFilterScreenState extends State<_CatalogFilterScreen> {
  final Set<String> _expandedSections = {'Вкус'};
  final Set<String> _selectedFilters = {};

  final Map<String, List<String>> _sections = const {
    'Вкус': [
      'Медовый',
      'Шоколадный',
      'Фруктовый',
      'Ореховый',
      'Песочное с безе',
      'Ягодный',
      'Мороженое',
      'Кофейный',
      'Карамельный',
      'Ванильный',
    ],
    'Коржи': ['Слоеные', 'Бисквитные', 'Песочные', 'Медовые', 'Заварные'],
    'На сколько человек': [
      '1-2 человека',
      '4-6 человек',
      '8-10 человек',
      '12+ человек',
    ],
    'Начинка': [
      'Сливочная',
      'Творожная',
      'Ягодная',
      'Шоколадная',
      'Сгущенное молоко',
      'Заварной крем',
    ],
  };

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
      if (_selectedFilters.contains(option)) {
        _selectedFilters.remove(option);
      } else {
        _selectedFilters.add(option);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
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
                  const Expanded(
                    child: Center(
                      child: Text(
                        'Фильтр',
                        style: TextStyle(
                          fontFamily: _headingFont,
                          fontSize: 18,
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
                                  sectionTitle,
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
                                      option,
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
                        onPressed: () => Navigator.of(context).pop(),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: _bulkaYellow,
                          foregroundColor: _textDark,
                          elevation: 0,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(25),
                          ),
                        ),
                        child: const Text(
                          'Применить',
                          style: TextStyle(
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
                        onPressed: () =>
                            setState(() => _selectedFilters.clear()),
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: _textDark, width: 1.5),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(25),
                          ),
                        ),
                        child: const Text(
                          'Сбросить',
                          style: TextStyle(
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
                  const Expanded(
                    child: Center(
                      child: Text(
                        'Каталог',
                        style: TextStyle(
                          fontFamily: _headingFont,
                          fontSize: 18,
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
                  final columns = constraints.maxWidth >= 720 ? 4 : 3;
                  return GridView.builder(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 12,
                    ),
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: columns,
                      mainAxisSpacing: 16,
                      crossAxisSpacing: 12,
                      mainAxisExtent: textScale > 1.2 ? 170 : 145,
                    ),
                    itemCount: displayCategories.length,
                    itemBuilder: (context, i) {
                      final cat = displayCategories[i];
                      final imageUrl =
                          apiCategoryImages[cat] ??
                          _categoryImages[cat] ??
                          'https://images.unsplash.com/photo-1519915028121-7d3463d20b13?w=400&auto=format&fit=crop&q=80';

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
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Expanded(
                                    child: Container(
                                      width: double.infinity,
                                      decoration: BoxDecoration(
                                        color: _milkyBackground,
                                        borderRadius: BorderRadius.circular(18),
                                        boxShadow: const [
                                          BoxShadow(
                                            color: Color(0x0A000000),
                                            blurRadius: 8,
                                            offset: Offset(0, 3),
                                          ),
                                        ],
                                      ),
                                      child: ClipRRect(
                                        borderRadius: BorderRadius.circular(18),
                                        child: _NetworkImage(
                                          url: imageUrl,
                                          fit: BoxFit.cover,
                                        ),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(height: 8),
                                  Text(
                                    cat.toUpperCase(),
                                    maxLines: 3,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w700,
                                      letterSpacing: 0.2,
                                      color: Color(0xFF5A4036),
                                      height: 1.25,
                                    ),
                                  ),
                                ],
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
    required this.initialQuantity,
    required this.onQuantityChanged,
  });

  final CatalogProduct product;
  final int initialQuantity;
  final ValueChanged<int> onQuantityChanged;

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

  void _updateQuantity(int newQty) {
    final next = newQty.clamp(0, widget.product.inStockCount);
    setState(() {
      _quantity = next;
    });
    widget.onQuantityChanged(next);
  }

  @override
  Widget build(BuildContext context) {
    final photos = [
      widget.product.imageUrl,
      'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=800&auto=format&fit=crop&q=80',
    ];

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
                      widget.product.title,
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
                            child: Center(
                              child: _NetworkImage(
                                url: photos[i],
                                fit: BoxFit.contain,
                              ),
                            ),
                          );
                        },
                      ),
                    ),
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
                            widget.product.title,
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
                            '${_CatalogScreenState._formatPrice(widget.product.price)} ₸',
                            style: const TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w800,
                              color: Color(0xFFC8902E),
                            ),
                          ),
                          const SizedBox(height: 20),
                          Text(
                            widget.product.description.isNotEmpty
                                ? widget.product.description
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
                stopListed: widget.product.isStopListed,
                onAdd: () => _updateQuantity(1),
                onDecrease: () => _updateQuantity(_quantity - 1),
                onIncrease: () => _updateQuantity(_quantity + 1),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
