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
  });

  final String id;
  final String title;
  final int price;
  final String category;
  final String imageUrl;
  final int inStockCount;
  final String description;
}

class CatalogScreen extends StatefulWidget {
  const CatalogScreen({this.onOpenCart, super.key});

  final VoidCallback? onOpenCart;

  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen> {
  final _addressRepo = const AddressRepository();
  DeliveryAddress? _selectedAddress;
  String _searchQuery = '';
  String _selectedCategory = 'Все';
  final Map<String, int> _cartQuantities = {};

  final List<String> _categories = const [
    'Все',
    'Пироги Четвертинки',
    'Кофе',
    'Найди свою половинку',
    'Круглые торты',
    'Пироги',
    'Сладкая выпечка',
    'Слоенная выпечка',
    'Сытная выпечка',
    'Чизкейки',
  ];

  final List<CatalogProduct> _allProducts = const [
    CatalogProduct(
      id: 'p1',
      title: 'Вишнёво-яблочный пирог четвертинка',
      price: 2500,
      category: 'Пироги Четвертинки',
      imageUrl: 'https://images.unsplash.com/photo-1519915028121-7d3463d20b13?w=600&auto=format&fit=crop&q=80',
      inStockCount: 7,
      description: 'Песочное тесто и нежная начинка из свежих яблок и спелой вишни.',
    ),
    CatalogProduct(
      id: 'p2',
      title: 'Творожно-ягодный пирог четвертинка',
      price: 2600,
      category: 'Пироги Четвертинки',
      imageUrl: 'https://images.unsplash.com/photo-1535141192574-5d4897c13136?w=600&auto=format&fit=crop&q=80',
      inStockCount: 5,
    ),
    CatalogProduct(
      id: 'c1',
      title: 'Капучино на фирменном зерне',
      price: 1200,
      category: 'Кофе',
      imageUrl: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=600&auto=format&fit=crop&q=80',
      inStockCount: 40,
    ),
    CatalogProduct(
      id: 'c2',
      title: 'Латте соленая карамель',
      price: 1400,
      category: 'Кофе',
      imageUrl: 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=600&auto=format&fit=crop&q=80',
      inStockCount: 35,
    ),
    CatalogProduct(
      id: 'h1',
      title: 'Наполеон торт прямоугольный половинка',
      price: 6800,
      category: 'Найди свою половинку',
      imageUrl: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=600&auto=format&fit=crop&q=80',
      inStockCount: 26,
    ),
    CatalogProduct(
      id: 't1',
      title: 'Торт Рафаэлло',
      price: 5900,
      category: 'Круглые торты',
      imageUrl: 'https://images.unsplash.com/photo-1588195538326-c5b1e9f80a1b?w=600&auto=format&fit=crop&q=80',
      inStockCount: 12,
    ),
    CatalogProduct(
      id: 't2',
      title: 'Торт Молочная девочка',
      price: 5500,
      category: 'Круглые торты',
      imageUrl: 'https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=600&auto=format&fit=crop&q=80',
      inStockCount: 15,
    ),
    CatalogProduct(
      id: 'b1',
      title: 'Круассан миндальный',
      price: 1100,
      category: 'Слоенная выпечка',
      imageUrl: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=600&auto=format&fit=crop&q=80',
      inStockCount: 18,
    ),
    CatalogProduct(
      id: 's1',
      title: 'Самса с фирменной говядиной',
      price: 650,
      category: 'Сытная выпечка',
      imageUrl: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=600&auto=format&fit=crop&q=80',
      inStockCount: 30,
    ),
    CatalogProduct(
      id: 'ch1',
      title: 'Чизкейк Сан-Себастьян',
      price: 1800,
      category: 'Чизкейки',
      imageUrl: 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=600&auto=format&fit=crop&q=80',
      inStockCount: 10,
    ),
  ];

  @override
  void initState() {
    super.initState();
    _loadCurrentAddress();
  }

  Future<void> _loadCurrentAddress() async {
    final addresses = await _addressRepo.loadAddresses();
    final selectedId = await _addressRepo.loadSelectedAddressId();
    if (!mounted) return;
    setState(() {
      if (selectedId != null) {
        final match = addresses.where((a) => a.id == selectedId);
        if (match.isNotEmpty) {
          _selectedAddress = match.first;
          return;
        }
      }
      if (addresses.isNotEmpty) {
        _selectedAddress = addresses.first;
      }
    });
  }

  List<CatalogProduct> get _filteredProducts {
    return _allProducts.where((p) {
      final matchesQuery = _searchQuery.isEmpty ||
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
          onSelectCategory: (cat) {
            setState(() => _selectedCategory = cat);
          },
        ),
      ),
    );
  }

  void _openFilterModal() {
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => const _CatalogFilterScreen(),
      ),
    );
  }

  void _openProductDetails(CatalogProduct product) {
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => _ProductDetailsScreen(
          product: product,
          initialQuantity: _cartQuantities[product.id] ?? 0,
          onQuantityChanged: (q) {
            setState(() {
              if (q <= 0) {
                _cartQuantities.remove(product.id);
              } else {
                _cartQuantities[product.id] = q;
              }
            });
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final addressText = _selectedAddress != null
        ? _selectedAddress!.displayAddress
        : 'Аскарова, 21';

    return Scaffold(
      backgroundColor: _cream,
      appBar: AppBar(
        automaticallyImplyLeading: false,
        backgroundColor: _cream,
        elevation: 0,
        title: const Text(
          'Каталог',
          style: TextStyle(
            fontFamily: _headingFont,
            fontWeight: FontWeight.w400,
            color: _textDark,
          ),
        ),
        centerTitle: true,
      ),
      body: Column(
        children: [
          // Search & Filter
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
            child: Row(
              children: [
                Expanded(
                  child: Container(
                    height: 48,
                    decoration: BoxDecoration(
                      color: _milkyBackground,
                      borderRadius: BorderRadius.circular(24),
                      border: Border.all(color: _almond.withValues(alpha: 0.6)),
                    ),
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Row(
                      children: [
                        const Icon(Icons.search_rounded, color: _caramel),
                        const SizedBox(width: 10),
                        Expanded(
                          child: TextField(
                            onChanged: (val) => setState(() => _searchQuery = val),
                            decoration: const InputDecoration(
                              hintText: 'Поиск товаров',
                              border: InputBorder.none,
                              isDense: true,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                GestureDetector(
                  onTap: _openFilterModal,
                  child: Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: _bulkaYellow.withValues(alpha: 0.4),
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: const Icon(Icons.tune_rounded, color: _textDark),
                  ),
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
              separatorBuilder: (context, index) => const SizedBox(width: 8),
              itemBuilder: (context, i) {
                final cat = _categories[i];
                final active = _selectedCategory == cat;
                return GestureDetector(
                  onTap: () => setState(() => _selectedCategory = cat),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    decoration: BoxDecoration(
                      color: active ? _caramel : _milkyBackground,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                        color: active ? _caramel : _almond.withValues(alpha: 0.5),
                      ),
                    ),
                    child: Text(
                      cat,
                      style: TextStyle(
                        color: active ? _milkyBackground : _textDark,
                        fontWeight: active ? FontWeight.w600 : FontWeight.w400,
                        fontSize: 13,
                      ),
                    ),
                  ),
                );
              },
            ),
          ),

          const SizedBox(height: 6),
          Center(
            child: GestureDetector(
              onTap: _openCategoriesModal,
              child: Container(
                width: 44,
                height: 20,
                decoration: BoxDecoration(
                  color: _milkyBackground,
                  borderRadius: BorderRadius.circular(10),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x0C000000),
                      blurRadius: 4,
                      offset: Offset(0, 2),
                    ),
                  ],
                ),
                child: const Icon(
                  Icons.keyboard_arrow_down_rounded,
                  size: 18,
                  color: _textDark,
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),

          // Location Banner (Самовывоз/Адрес)
          GestureDetector(
            onTap: () async {
              await Navigator.of(context).push<void>(
                MaterialPageRoute(builder: (_) => const AddressSelectionScreen()),
              );
              _loadCurrentAddress();
            },
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 16),
              padding: const EdgeInsets.fromLTRB(18, 16, 16, 16),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFFFBF0DB), Color(0xFFE9C587)],
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
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Данное меню доступно\nдля САМОВЫВОЗА!',
                          style: TextStyle(
                            fontFamily: _headingFont,
                            fontSize: 18,
                            height: 1.2,
                            color: _textDark,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            const Icon(Icons.location_on_rounded,
                                color: _caramel, size: 16),
                            const SizedBox(width: 4),
                            Expanded(
                              child: Text(
                                'Адрес: $addressText',
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
                    decoration: BoxDecoration(
                      color: _cream.withValues(alpha: 0.8),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.storefront_rounded,
                      color: _caramel,
                      size: 32,
                    ),
                  ),
                ],
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
                GestureDetector(
                  onTap: _openCategoriesModal,
                  child: Row(
                    children: [
                      Text(
                        'Все',
                        style: TextStyle(
                          color: _textDark.withValues(alpha: 0.7),
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      Icon(
                        Icons.chevron_right_rounded,
                        color: _textDark.withValues(alpha: 0.7),
                        size: 20,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 10),

          // Product List
          Expanded(
            child: _filteredProducts.isEmpty
                ? Center(
                    child: Text(
                      'В этой категории пока нет товаров',
                      style: TextStyle(color: _textDark.withValues(alpha: 0.5)),
                    ),
                  )
                : GridView.builder(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 100),
                    gridDelegate:
                        const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      mainAxisSpacing: 14,
                      crossAxisSpacing: 14,
                      childAspectRatio: 0.68,
                    ),
                    itemCount: _filteredProducts.length,
                    itemBuilder: (context, index) {
                      final p = _filteredProducts[index];
                      final qty = _cartQuantities[p.id] ?? 0;
                      return _buildProductCard(p, qty);
                    },
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildProductCard(CatalogProduct product, int quantity) {
    return GestureDetector(
      onTap: () => _openProductDetails(product),
      child: Container(
        decoration: BoxDecoration(
          color: _milkyBackground,
          borderRadius: BorderRadius.circular(20),
          boxShadow: _softShadow,
        ),
        padding: const EdgeInsets.all(10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Image
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  _NetworkImage(
                    url: product.imageUrl,
                    fit: BoxFit.cover,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          // Title
          Text(
            product.title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontWeight: FontWeight.w600,
              fontSize: 13,
              color: _textDark,
              height: 1.2,
            ),
          ),
          const SizedBox(height: 4),
          // Price
          Text(
            '${product.price} тенге',
            style: const TextStyle(
              fontWeight: FontWeight.w700,
              fontSize: 14,
              color: _textDark,
            ),
          ),
          const SizedBox(height: 2),
          // In stock subtext
          Text(
            'В наличии - ${product.inStockCount} шт',
            style: TextStyle(
              fontSize: 11,
              color: _sage.withValues(alpha: 0.9),
            ),
          ),
          const SizedBox(height: 8),
          // Cart Button / Controls
          SizedBox(
            height: 36,
            child: quantity == 0
                ? SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: () {
                        setState(() {
                          _cartQuantities[product.id] = 1;
                        });
                        BulkaMotion.lightImpact();
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _bulkaYellow.withValues(alpha: 0.4),
                        foregroundColor: _textDark,
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      child: const Icon(Icons.shopping_bag_outlined,
                          size: 20, color: _textDark),
                    ),
                  )
                : Container(
                    decoration: BoxDecoration(
                      color: _bulkaYellow.withValues(alpha: 0.4),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [
                        IconButton(
                          onPressed: () {
                            setState(() {
                              if (quantity > 1) {
                                _cartQuantities[product.id] = quantity - 1;
                              } else {
                                _cartQuantities.remove(product.id);
                              }
                            });
                          },
                          icon: const Icon(Icons.remove, size: 18, color: _textDark),
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(),
                        ),
                        Text(
                          '$quantity',
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 14,
                            color: _textDark,
                          ),
                        ),
                        IconButton(
                          onPressed: () {
                            setState(() {
                              _cartQuantities[product.id] = quantity + 1;
                            });
                          },
                          icon: const Icon(Icons.add, size: 18, color: _textDark),
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(),
                        ),
                      ],
                    ),
                  ),
          ),
        ],
      ),
    ),
    );
  }
}

const Map<String, String> _categoryImages = {
  'Все': 'https://images.unsplash.com/photo-1519915028121-7d3463d20b13?w=400&auto=format&fit=crop&q=80',
  'Пироги Четвертинки': 'https://images.unsplash.com/photo-1519915028121-7d3463d20b13?w=400&auto=format&fit=crop&q=80',
  'Кофе': 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=400&auto=format&fit=crop&q=80',
  'Найди свою половинку': 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&auto=format&fit=crop&q=80',
  'Круглые торты': 'https://images.unsplash.com/photo-1588195538326-c5b1e9f80a1b?w=400&auto=format&fit=crop&q=80',
  'Прямоугольные торты': 'https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?w=400&auto=format&fit=crop&q=80',
  'Круглые мини торты': 'https://images.unsplash.com/photo-1535141192574-5d4897c13136?w=400&auto=format&fit=crop&q=80',
  'Пироги': 'https://images.unsplash.com/photo-1621303837174-89787a7d4729?w=400&auto=format&fit=crop&q=80',
  'Сладкая выпечка': 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400&auto=format&fit=crop&q=80',
  'Слоенная выпечка': 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=400&auto=format&fit=crop&q=80',
  'Сытная выпечка': 'https://images.unsplash.com/photo-1509722747041-616f39b57569?w=400&auto=format&fit=crop&q=80',
  'Чизкейки': 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=400&auto=format&fit=crop&q=80',
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
    'Коржи': [
      'Слоеные',
      'Бисквитные',
      'Песочные',
      'Медовые',
      'Заварные',
    ],
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
      backgroundColor: _cream,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                children: [
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.chevron_left_rounded, size: 28, color: _textDark),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
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
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
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
                            final isSelected = _selectedFilters.contains(option);
                            return InkWell(
                              onTap: () => _toggleFilter(option),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(vertical: 12),
                                child: Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                  Text(
                                    option,
                                    style: TextStyle(
                                      fontSize: 15,
                                      color: isSelected ? _textDark : const Color(0xFF7A6C65),
                                      fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                                    ),
                                  ),
                                  Container(
                                    width: 22,
                                    height: 22,
                                    decoration: BoxDecoration(
                                      shape: BoxShape.circle,
                                      color: isSelected ? _caramel : const Color(0xFFE8E4DD),
                                    ),
                                    child: isSelected
                                        ? const Icon(Icons.check, size: 14, color: Colors.white)
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
                          backgroundColor: _caramel,
                          foregroundColor: Colors.white,
                          elevation: 0,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(25),
                          ),
                        ),
                        child: const Text(
                          'Применить',
                          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
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
                        onPressed: () => setState(() => _selectedFilters.clear()),
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: _caramel, width: 1.5),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(25),
                          ),
                        ),
                        child: const Text(
                          'Сбросить',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                            color: _caramel,
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
  });

  final List<String> categories;
  final String selectedCategory;
  final ValueChanged<String> onSelectCategory;

  @override
  Widget build(BuildContext context) {
    final displayCategories = categories.where((c) => c != 'Все').toList();

    return Scaffold(
      backgroundColor: _cream,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                children: [
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.chevron_left_rounded, size: 28, color: _textDark),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
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
              child: GridView.builder(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 3,
                  mainAxisSpacing: 16,
                  crossAxisSpacing: 12,
                  childAspectRatio: 0.72,
                ),
                itemCount: displayCategories.length,
                itemBuilder: (context, i) {
                  final cat = displayCategories[i];
                  final imageUrl = _categoryImages[cat] ??
                      'https://images.unsplash.com/photo-1519915028121-7d3463d20b13?w=400&auto=format&fit=crop&q=80';

                  return GestureDetector(
                    onTap: () {
                      onSelectCategory(cat);
                      Navigator.of(context).pop();
                    },
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Container(
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
                          cat,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: _textDark,
                            height: 1.2,
                          ),
                        ),
                      ],
                    ),
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
    setState(() {
      _quantity = newQty;
    });
    widget.onQuantityChanged(newQty);
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
                    icon: const Icon(Icons.chevron_left_rounded, size: 28, color: _textDark),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
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
                        onPageChanged: (i) => setState(() => _currentPhotoIndex = i),
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
                          duration: const Duration(milliseconds: 250),
                          margin: const EdgeInsets.symmetric(horizontal: 4),
                          width: active ? 22 : 8,
                          height: 8,
                          decoration: BoxDecoration(
                            color: active ? _caramel : const Color(0xFFE5E0DA),
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
                        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
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
                            '${widget.product.price} тенге',
                            style: const TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w700,
                              color: _textDark,
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
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
              child: SizedBox(
                height: 52,
                width: double.infinity,
                child: _quantity == 0
                    ? ElevatedButton(
                        onPressed: () => _updateQuantity(1),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: _caramel,
                          foregroundColor: Colors.white,
                          elevation: 0,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(26),
                          ),
                        ),
                        child: const Text(
                          'в корзину',
                          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
                        ),
                      )
                    : Container(
                        decoration: BoxDecoration(
                          color: _caramel,
                          borderRadius: BorderRadius.circular(26),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            IconButton(
                              onPressed: () => _updateQuantity(_quantity - 1),
                              icon: const Icon(Icons.remove, color: Colors.white, size: 22),
                            ),
                            Text(
                              '$_quantity',
                              style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w700,
                                color: Colors.white,
                              ),
                            ),
                            IconButton(
                              onPressed: () => _updateQuantity(_quantity + 1),
                              icon: const Icon(Icons.add, color: Colors.white, size: 22),
                            ),
                          ],
                        ),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
