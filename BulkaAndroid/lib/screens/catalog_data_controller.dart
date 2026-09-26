part of '../main.dart';

extension _CatalogDataController on _CatalogScreenState {
  Future<void> _refreshBranchLabel() async {
    final id = _selectedBakeryId;
    if (id.isEmpty) return;
    final locations = await _api.getFulfillmentLocations();
    if (!mounted || id != _selectedBakeryId) return;
    final branch = locations
        .where((b) => b.id == id && b.active && b.supports(_orderType))
        .firstOrNull;
    if (_selectedBakery == (branch?.displayLabel ?? '') &&
        _selectedBakeryId == (branch?.id ?? '') &&
        _sameJsonValue(_selectedBakeryLocation?.toJson(), branch?.toJson())) {
      return;
    }
    _updateCatalogState(() {
      _selectedBakery = branch?.displayLabel ?? '';
      _selectedBakeryId = branch?.id ?? '';
      _selectedBakeryLocation = branch;
    });
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      'selected_bakery_location_$_orderType',
      branch?.displayLabel ?? '',
    );
    await prefs.setString(
      'selected_bakery_location_id_$_orderType',
      branch?.id ?? '',
    );
    if (branch == null) _menuLive.request();
  }

  Future<void> _silentRefresh() {
    if (!mounted ||
        !_menuScopeReady ||
        (_selectedBakeryId.isEmpty && _requestedRouteBranch.isEmpty) ||
        (_activeMenuLoads > 0 || _routeBranchFlight != null)) {
      return Future<void>.value();
    }
    return _silentRefreshRequest ??= _loadMenu(silent: true).whenComplete(() {
      _silentRefreshRequest = null;
    });
  }

  Future<void> _loadMenu({bool silent = false}) async {
    if (!mounted) return;
    if (_requestedRouteBranch.isNotEmpty &&
        _requestedRouteBranch != _selectedBakeryId &&
        !await _prepareRequestedBranch()) {
      return;
    }
    final previewProductId = _pendingClientUri == null
        ? null
        : productIdFromClientUri(_pendingClientUri!);
    if (_selectedBakeryId.isEmpty && previewProductId == null) {
      _updateCatalogState(() {
        _categories = const [_catalogAllCategoryKey];
        _apiCategoryImages = const {};
        _allProducts = const [];
        _liveProducts.value = const {};
        _isLoading = false;
        _usingCachedMenu = false;
        _loadError = null;
      });
      return;
    }
    _activeMenuLoads++;
    final revision = ++_menuLoadRevision;
    final endpoint = _menuEndpoint;
    final cacheKey = _menuCacheKey;
    try {
      if (!silent) {
        _updateCatalogState(() {
          _isLoading = _allProducts.isEmpty;
          if (_allProducts.isEmpty) _usingCachedMenu = false;
          _loadError = null;
        });
      }
      if (_allProducts.isEmpty) {
        await _restoreCachedMenu(
          cacheKey: cacheKey,
          revision: revision,
          endpoint: endpoint,
          preview: true,
        );
        if (!_isCurrentMenuRequest(revision, endpoint)) return;
      }
      final json = await _api._get(endpoint);
      if (!_isCurrentMenuRequest(revision, endpoint)) return;

      final snapshot = <String, dynamic>{
        'categories': json['categories'],
        'products': json['products'],
        'iikoProfile': json['iikoProfile'],
      };
      if (silent &&
          !_usingCachedMenu &&
          _loadError == null &&
          _allProducts.isNotEmpty &&
          _lastLiveMenuScope == cacheKey &&
          _sameJsonValue(_lastLiveMenu, snapshot)) {
        // Reconcile newly added cart lines, but keep displayed widgets and
        // details notifiers intact when the server sends the same menu.
        if (_lastMenuCacheWrite == null ||
            DateTime.now().difference(_lastMenuCacheWrite!) >=
                const Duration(minutes: 5)) {
          unawaited(_cacheMenu(json, cacheKey: cacheKey));
        }
        _syncCartWithMenu(_allProducts, notifyDetails: false);
        unawaited(_refreshProductOptionFlags(_allProducts));
        _resumeProductAfterFulfillment();
        _applyPendingClientUri();
        return;
      }
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

      _lastLiveMenu = snapshot;
      _lastLiveMenuScope = cacheKey;
      unawaited(_cacheMenu(json, cacheKey: cacheKey));
      _syncCartWithMenu(products);

      _updateCatalogState(() {
        _categories = categoryNames;
        _menuProfileKey = _asString(json['iikoProfile']);
        _apiCategoryImages = categoryImages;
        _allProducts = products;
        _isLoading = false;
        _usingCachedMenu = false;
        _loadError = null;
      });
      unawaited(_refreshProductOptionFlags(products));
      _resumeProductAfterFulfillment();
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
        _applyPendingClientUri();
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
    } finally {
      _activeMenuLoads--;
      _scheduleMenuRefresh();
    }
  }

  bool _isCurrentMenuRequest(int revision, String endpoint) =>
      mounted && revision == _menuLoadRevision && endpoint == _menuEndpoint;

  Future<void> _refreshProductOptionFlags(List<CatalogProduct> products) async {
    final revision = ++_productOptionsRevision;
    try {
      final optionFlags = await _api.getProductOptionFlagsBatch(
        products.map((product) => product.id),
      );
      if (!mounted || revision != _productOptionsRevision) return;
      final currentIds = _allProducts.map((product) => product.id).toSet();
      final resolved = optionFlags.keys.where(currentIds.contains).toSet();
      final configurable = optionFlags.entries
          .where((entry) => currentIds.contains(entry.key) && entry.value)
          .map((entry) => entry.key)
          .toSet();
      if (setEquals(resolved, _resolvedProductOptionIds) &&
          setEquals(configurable, _configurableProductIds)) {
        return;
      }
      _updateCatalogState(() {
        _resolvedProductOptionIds = resolved;
        _configurableProductIds = configurable;
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
        ).showSnackBar(bulkaSnackBar(content: Text('error_save'.tr)));
      }
      return wasFavorite;
    }
  }

  num? _productAvailability(dynamic raw) {
    final product = _asMap(raw);
    final value = product['availableQuantity'] ?? product['inStockCount'];
    if (value == null) return null;
    final number = value is num ? value : num.tryParse(value.toString());
    return number?.clamp(0, 100000);
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
      catalogAvailable: product['catalogAvailable'] as bool?,
      quantityStep: product['quantityStep'] as num? ?? 1,
      unit: _asString(product['unit']).isEmpty
          ? 'шт.'
          : _asString(product['unit']),
      preparationMinutes: _productPreparation(product),
      description: _asString(product['description']),
      ingredients: _asString(product['ingredients']),
      allergens: _productStringList(product, 'allergens'),
      dietaryTags: _productStringList(product, 'dietaryTags'),
      badges: (product['badges'] is List ? product['badges'] as List : const [])
          .whereType<Map>()
          .take(3)
          .map((b) => Map<String, dynamic>.from(b))
          .toList(),
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
    final cachedAt = DateTime.now();
    _lastMenuCacheWrite = cachedAt;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        cacheKey,
        jsonEncode({
          'cachedAt': cachedAt.toUtc().toIso8601String(),
          'payload': json,
        }),
      );
    } catch (_) {
      // Storage quota/privacy errors must not discard a successful response.
    }
    return cachedAt;
  }

  Future<bool> _restoreCachedMenu({
    required String cacheKey,
    required int revision,
    required String endpoint,
    bool preview = false,
  }) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(cacheKey);
      if (raw == null) return false;
      final envelope = _asMap(jsonDecode(raw));
      final nested = _asMap(envelope['payload']);
      final json = nested.isEmpty ? envelope : nested;
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
      // Cached prices and stock may be stale: only the live response should
      // update cart lines during online revalidation.
      if (!preview) _syncCartWithMenu(products);
      _updateCatalogState(() {
        _categories = categoryNames;
        _menuProfileKey = _asString(json['iikoProfile']);
        _apiCategoryImages = categoryImages;
        _allProducts = products;
        _isLoading = false;
        _usingCachedMenu = true;
        _loadError = null;
      });
      if (!preview) {
        unawaited(_refreshProductOptionFlags(products));
        _applyPendingClientUri();
      }
      unawaited(_warmProductImages(products));
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> _warmProductImages(List<CatalogProduct> products) async {
    final category = _openedCategory;
    if (!mounted || category == null || _catalogContentExtent <= 0) return;
    // Use the actual category grid width, not a separate phone-only estimate.
    final logicalExtent = catalogCategoryGridGeometry(
      _catalogContentExtent,
    ).cardExtent;
    final pixelSize = _imagePixelBucket(
      logicalExtent *
          networkImageDevicePixelRatio(
            MediaQuery.devicePixelRatioOf(context),
            isWeb: kIsWeb,
          ),
    );
    final visibleProducts = _applyActiveProductFilters(
      products.where((product) => product.category == category),
      includeSearch: false,
      includeFavorites: false,
    );
    final urls = visibleProducts
        .map((product) => product.imageUrl.trim())
        .where((url) => url.isNotEmpty)
        .toSet()
        .take(4);
    // Avoid a burst of unrelated decodes while the user opens a category.
    for (final url in urls) {
      if (!mounted || category != _openedCategory) return;
      final effectiveUrl = optimizedNetworkImageUrl(
        url,
        pixelWidth: pixelSize,
        pixelHeight: pixelSize,
        resizeMode: 'cover',
      );
      final provider = networkImageCacheProvider(
        effectiveUrl,
        pixelWidth: pixelSize,
        pixelHeight: pixelSize,
      );
      try {
        await precacheImage(provider, context);
      } catch (_) {
        // The normal image error state remains available in the card.
      }
    }
  }

  void _syncCartWithMenu(
    List<CatalogProduct> products, {
    bool notifyDetails = true,
  }) {
    if (notifyDetails) {
      final liveProducts = {
        for (final product in products) product.id: product,
      };
      for (final previous in _liveProducts.value.values) {
        if (liveProducts.containsKey(previous.id)) continue;
        liveProducts[previous.id] = CatalogProduct(
          id: previous.id,
          title: previous.title,
          price: previous.price,
          category: previous.category,
          imageUrl: previous.imageUrl,
          inStockCount: previous.inStockCount,
          quantityStep: previous.quantityStep,
          unit: previous.unit,
          preparationMinutes: previous.preparationMinutes,
          description: previous.description,
          ingredients: previous.ingredients,
          allergens: previous.allergens,
          dietaryTags: previous.dietaryTags,
          badges: previous.badges,
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
    }
    context.read<CartProvider>().reconcileMenu(
      products.map(
        (product) => CartProductSnapshot(
          id: product.id,
          name: product.title,
          price: product.price,
          imageUrl: product.imageUrl,
          isStopListed: product.isStopListed,
          quantityStep: product.quantityStep,
          unit: product.unit,
        ),
      ),
    );
  }
}
