part of '../main.dart';

extension _OrdersCartEmptyView on _OrdersScreenState {
  void _ensurePopularProducts() {
    if (_popularProductsRequested) return;
    _popularProductsRequested = true;
    unawaited(_loadPopularProducts());
  }

  Future<void> _loadPopularProducts() async {
    final prefs = await SharedPreferences.getInstance();
    final savedType = prefs.getString('selected_order_type')?.trim() ?? '';
    final orderType = _orderTypeFromWire(savedType).wireValue;
    final branchId =
        prefs.getString('selected_bakery_location_id_$orderType')?.trim() ??
        (savedType == orderType
            ? prefs.getString('selected_bakery_location_id')?.trim()
            : null) ??
        '';
    final cacheKeys = <String>[
      'catalog_cache_${AppLang.current}_${orderType}_${branchId.isEmpty ? 'all' : branchId}',
      'catalog_cache_${AppLang.current}_${orderType}_all',
    ];

    Map<String, dynamic>? payload;
    List<String> recommendationIds = const [];
    try {
      final endpoint = Uri(
        path: '/api/guest/menu',
        queryParameters: {
          'orderType': orderType,
          if (branchId.isNotEmpty) 'branchId': branchId,
        },
      ).toString();
      final results = await Future.wait<dynamic>([
        widget.api._get(endpoint),
        _loadRecommendationIds(),
      ]);
      payload = _asMap(results.first);
      recommendationIds = (results.last as List).cast<String>();
    } catch (_) {
      for (final key in cacheKeys.toSet()) {
        final raw = prefs.getString(key);
        if (raw == null) continue;
        try {
          final cached = _asMap(jsonDecode(raw));
          final nested = _asMap(cached['payload']);
          payload = nested.isEmpty ? cached : nested;
          if (payload.isNotEmpty) break;
        } catch (_) {}
      }
    }
    if (!mounted) return;
    final suggestions = _suggestionsFromMenu(payload, recommendationIds);
    _updateOrdersState(() => _popularProducts = suggestions);
  }

  Future<List<String>> _loadRecommendationIds() async {
    if (!widget.api.isAuthenticated) return const [];
    try {
      return await widget.api.getRecommendationProductIds();
    } catch (_) {
      return const [];
    }
  }

  List<_CartSuggestion> _suggestionsFromMenu(
    Map<String, dynamic>? payload,
    List<String> recommendationIds,
  ) {
    if (payload == null) return const [];
    final ranking = {
      for (var index = 0; index < recommendationIds.length; index++)
        recommendationIds[index]: index,
    };
    final indexed = <({int index, _CartSuggestion product})>[];
    final seen = <String>{};
    final products = payload['products'] as List? ?? const [];
    for (var index = 0; index < products.length; index++) {
      final raw = _asMap(products[index]);
      final id = _asString(raw['id']).trim();
      final nameValue = raw['name'];
      final names = _asMap(nameValue);
      final name = _catalogDisplayName(
        names.isEmpty
            ? nameValue
            : names[AppLang.current] ?? names['ru'] ?? names['en'] ?? '',
      );
      final price = (raw['price'] as num?)?.round() ?? 0;
      final available = raw['availableQuantity'] ?? raw['inStockCount'];
      final availableCount = available is num
          ? available
          : num.tryParse('$available');
      if (id.isEmpty ||
          name.isEmpty ||
          price <= 0 ||
          !seen.add(id) ||
          raw['onlineOrderable'] == false ||
          raw['catalogAvailable'] == false ||
          raw['inStopList'] == true ||
          (availableCount != null && availableCount <= 0)) {
        continue;
      }
      indexed.add((
        index: index,
        product: _CartSuggestion(
          id: id,
          name: name,
          price: price,
          imageUrl: _asString(raw['imageUrl']),
        ),
      ));
    }
    indexed.sort((a, b) {
      final aRank = ranking[a.product.id];
      final bRank = ranking[b.product.id];
      if (aRank != null || bRank != null) {
        return (aRank ?? 100000).compareTo(bRank ?? 100000);
      }
      return a.index.compareTo(b.index);
    });
    return indexed.take(3).map((entry) => entry.product).toList();
  }

  void _openCatalog() {
    final callback = widget.onExplore;
    if (callback != null) {
      callback();
      return;
    }
    Navigator.of(
      context,
    ).push<void>(MaterialPageRoute(builder: (_) => const LocationsScreen()));
  }

  Widget _buildEmptyState(BuildContext context) {
    final colors = context.bulkaColors;
    return ListView(
      padding: EdgeInsets.fromLTRB(
        16,
        18,
        16,
        BulkaLayout.bottomNavContentInset(context),
      ),
      children: [
        Container(
          key: const ValueKey('cart-empty-state'),
          padding: const EdgeInsets.fromLTRB(20, 22, 20, 20),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            borderRadius: BorderRadius.circular(BulkaRadii.card),
            border: Border.all(
              color: colors.cardBorder,
              width: BulkaStrokes.hairline,
            ),
            boxShadow: BulkaShadows.card,
          ),
          child: Column(
            children: [
              Container(
                width: 82,
                height: 82,
                decoration: BoxDecoration(
                  color: colors.brandGold.withValues(alpha: 0.16),
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: colors.cardBorder,
                    width: BulkaStrokes.hairline,
                  ),
                ),
                child: Icon(
                  Icons.shopping_bag_outlined,
                  size: 38,
                  color: colors.brandBrown,
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'cart_empty_title'.tr,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: colors.brandBrown,
                  fontFamily: _headingFont,
                  fontSize: BulkaTypeScale.pageTitle,
                  fontWeight: FontWeight.w400,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'cart_empty_sub'.tr,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: colors.mutedText,
                  fontSize: BulkaTypeScale.body,
                  height: 1.35,
                ),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: GradientButton(
                  onPressed: _openCatalog,
                  child: Text(
                    'cart_action'.tr,
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
        if (_popularProducts.isNotEmpty) ...[
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(
                child: Text(
                  'cart_popular_title'.tr,
                  style: const TextStyle(
                    fontFamily: _headingFont,
                    color: _textDark,
                    fontSize: BulkaTypeScale.titleSmall,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              TextButton(
                onPressed: _openCatalog,
                child: Text('cart_action'.tr),
              ),
            ],
          ),
          const SizedBox(height: 10),
          SizedBox(
            key: const ValueKey('cart-popular-products'),
            height: 206,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _popularProducts.length,
              separatorBuilder: (_, _) => const SizedBox(width: 12),
              itemBuilder: (context, index) => _CartPopularProductCard(
                product: _popularProducts[index],
                onTap: () {
                  final productId = _popularProducts[index].id;
                  final callback = widget.onOpenProduct;
                  if (callback != null) {
                    callback(productId);
                  } else {
                    Navigator.of(context).push<void>(
                      MaterialPageRoute(
                        builder: (_) => CatalogScreen(
                          api: widget.api,
                          initialClientUri: productClientUri(productId),
                        ),
                      ),
                    );
                  }
                },
              ),
            ),
          ),
        ],
      ],
    );
  }
}
