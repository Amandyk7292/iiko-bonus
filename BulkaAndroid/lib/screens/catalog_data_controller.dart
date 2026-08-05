part of '../main.dart';

extension _CatalogDataController on _CatalogScreenState {
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

      final cachedAt = await _cacheMenu(json, cacheKey: cacheKey);
      if (!_isCurrentMenuRequest(revision, endpoint)) return;
      _syncCartWithMenu(products);

      _updateCatalogState(() {
        _categories = categoryNames;
        _apiCategoryImages = categoryImages;
        _allProducts = products;
        _usingCachedMenu = false;
        _menuCachedAt = cachedAt;
        _loadError = null;
      });
      unawaited(_refreshProductOptionFlags(products));
      unawaited(_warmProductImages(products));
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
      _updateCatalogState(() {
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

      _updateCatalogState(() {
        _categories = categoryNames;
        _apiCategoryImages = categoryImages;
        _allProducts = products;
        _isLoading = false;
        _usingCachedMenu = false;
        _menuCachedAt = cachedAt;
      });
      unawaited(_refreshProductOptionFlags(products));
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
        _updateCatalogState(() {
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
      _updateCatalogState(() {
        _isLoading = false;
        _loadError = e.toString();
      });
    }
  }

  bool _isCurrentMenuRequest(int revision, String endpoint) =>
      mounted && revision == _menuLoadRevision && endpoint == _menuEndpoint;

  Future<void> _refreshProductOptionFlags(List<CatalogProduct> products) async {
    final revision = ++_productOptionsRevision;
    try {
      final options = await _api.getProductOptionsBatch(
        products.map((product) => product.id),
      );
      if (!mounted || revision != _productOptionsRevision) return;
      final currentIds = _allProducts.map((product) => product.id).toSet();
      _updateCatalogState(() {
        _resolvedProductOptionIds = options.keys
            .where(currentIds.contains)
            .toSet();
        _configurableProductIds = options.entries
            .where(
              (entry) =>
                  currentIds.contains(entry.key) &&
                  catalogProductOptionsRequireDetails(entry.value),
            )
            .map((entry) => entry.key)
            .toSet();
      });
    } catch (_) {
      // Product details still performs authoritative option validation.
    }
  }

  Future<bool> _productRequiresDetails(CatalogProduct product) async {
    if (_configurableProductIds.contains(product.id)) return true;
    if (_resolvedProductOptionIds.contains(product.id)) return false;
    try {
      final options = await _api.getProductOptions(product.id);
      final requiresDetails = catalogProductOptionsRequireDetails(options);
      if (mounted) {
        _updateCatalogState(() {
          _resolvedProductOptionIds = {
            ..._resolvedProductOptionIds,
            product.id,
          };
          if (requiresDetails) {
            _configurableProductIds = {..._configurableProductIds, product.id};
          }
        });
      }
      return requiresDetails;
    } catch (_) {
      // Do not risk adding an incomplete configured line while metadata is
      // unavailable. The details screen can retry and explain the state.
      return true;
    }
  }

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
      _updateCatalogState(() => _favoriteProductIds = favorites);
    } catch (_) {
      if (!mounted) return;
      _updateCatalogState(() => _favoriteProductIds = const {});
    }
  }

  Future<bool> _toggleFavorite(CatalogProduct product) async {
    final wasFavorite = _favoriteProductIds.contains(product.id);
    final nextFavorite = !wasFavorite;
    _updateCatalogState(() {
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
        _updateCatalogState(() {
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
      _updateCatalogState(() {
        _categories = categoryNames;
        _apiCategoryImages = categoryImages;
        _allProducts = products;
        _isLoading = false;
        _usingCachedMenu = true;
        _menuCachedAt = cachedAt;
        _loadError = null;
      });
      unawaited(_refreshProductOptionFlags(products));
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
      _updateCatalogState(() {
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
    _updateCatalogState(() {
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
        _updateCatalogState(() {
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
        _updateCatalogState(() {
          _selectedBakery = value;
          _selectedBakeryId = selectedId;
        });
        await _loadMenu();
      }
    });
  }
}
