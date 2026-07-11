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
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => Container(
        decoration: const BoxDecoration(
          color: _cream,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        padding: const EdgeInsets.all(24),
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.8,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: _almond,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 18),
            const Text(
              'Каталог',
              style: TextStyle(
                fontFamily: _headingFont,
                fontSize: 22,
                color: _textDark,
              ),
            ),
            const SizedBox(height: 20),
            Expanded(
              child: GridView.builder(
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 3,
                  mainAxisSpacing: 12,
                  crossAxisSpacing: 12,
                  childAspectRatio: 0.88,
                ),
                itemCount: _categories.length - 1,
                itemBuilder: (context, i) {
                  final cat = _categories[i + 1];
                  final isSelected = _selectedCategory == cat;
                  return InkWell(
                    onTap: () {
                      Navigator.of(context).pop();
                      setState(() => _selectedCategory = cat);
                    },
                    borderRadius: BorderRadius.circular(16),
                    child: Container(
                      decoration: BoxDecoration(
                        color: isSelected ? _almond : _milkyBackground,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: isSelected ? _caramel : _almond.withValues(alpha: 0.5),
                        ),
                      ),
                      padding: const EdgeInsets.all(8),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            Icons.bakery_dining_rounded,
                            color: isSelected ? _textDark : _caramel,
                            size: 32,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            cat,
                            textAlign: TextAlign.center,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                              color: _textDark,
                            ),
                          ),
                        ],
                      ),
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

  @override
  Widget build(BuildContext context) {
    final addressText = _selectedAddress != null
        ? _selectedAddress!.displayAddress
        : 'Аскарова, 21';

    return Scaffold(
      backgroundColor: _cream,
      appBar: AppBar(
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
                  onTap: _openCategoriesModal,
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

          const SizedBox(height: 12),

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
    return Container(
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
    );
  }
}
