part of '../main.dart';

class ProductDetailsScreen extends StatefulWidget {
  const ProductDetailsScreen({
    super.key,
    required this.api,
    required this.product,
    required this.liveProducts,
    required this.initialQuantity,
    required this.onQuantityChanged,
    this.initialFavorite = false,
    this.onToggleFavorite,
    this.hasSelectedOrderType = true,
    this.onEnsureOrderTypeSelected,
  });

  final BulkaApiClient api;
  final CatalogProduct product;
  final ValueListenable<Map<String, CatalogProduct>> liveProducts;
  final int initialQuantity;
  final void Function(CatalogProduct product, int quantity) onQuantityChanged;
  final bool initialFavorite;
  final Future<bool> Function()? onToggleFavorite;
  final bool hasSelectedOrderType;
  final Future<bool> Function()? onEnsureOrderTypeSelected;

  @override
  State<ProductDetailsScreen> createState() => _ProductDetailsScreenState();
}

class _ProductDetailsScreenState extends State<ProductDetailsScreen> {
  late int _quantity;
  late bool _isFavorite;
  int _currentPhotoIndex = 0;
  Map<String, dynamic> _options = const {};
  final Map<String, Set<String>> _selectedModifiers = {};
  final TextEditingController _inscriptionController = TextEditingController();
  String? _weight;
  String? _filling;
  String? _design;
  int _candles = 0;
  String? _referenceUrl;
  bool _uploadingReference = false;
  bool _loadingOptions = true;
  final _sheetGate = _AsyncActionGate();

  @override
  void initState() {
    super.initState();
    _quantity = widget.initialQuantity;
    _isFavorite = widget.initialFavorite;
    unawaited(_loadOptions());
    unawaited(widget.api.recordProductView(widget.product.id));
  }

  @override
  void dispose() {
    _inscriptionController.dispose();
    super.dispose();
  }

  Future<void> _loadOptions() async {
    try {
      final options = await widget.api.getProductOptions(widget.product.id);
      final configuration = _asMap(options['configuration']);
      final groups = options['modifierGroups'] as List? ?? const [];
      if (!mounted) return;
      setState(() {
        _options = options;
        _weight = _defaultOptionCode(configuration['weightOptions']);
        _filling = _defaultOptionCode(configuration['fillingOptions']);
        _design = _defaultOptionCode(configuration['designOptions']);
        for (final raw in groups) {
          final group = _asMap(raw);
          final defaults = (group['options'] as List? ?? const [])
              .where((item) => _asMap(item)['isDefault'] == true)
              .map((item) => _asString(_asMap(item)['id']))
              .where((value) => value.isNotEmpty)
              .toSet();
          if (defaults.isNotEmpty) {
            _selectedModifiers[_asString(group['id'])] = defaults;
          }
        }
        _loadingOptions = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loadingOptions = false);
    }
  }

  String? _defaultOptionCode(dynamic raw) {
    final list = raw is List ? raw : const [];
    if (list.isEmpty) return null;
    final first = _asMap(list.first);
    return _asString(first['code'] ?? first['id']);
  }

  bool get _hasCustomOptions {
    final configuration = _asMap(_options['configuration']);
    return (configuration['enabled'] == true &&
            _asString(configuration['productKind']) != 'standard') ||
        (_options['modifierGroups'] as List? ?? const []).isNotEmpty;
  }

  int _optionDelta(dynamic raw, String? selected) {
    if (raw is! List || selected == null) return 0;
    for (final item in raw) {
      final value = _asMap(item);
      if (_asString(value['code'] ?? value['id']) == selected) {
        return (value['priceDelta'] as num?)?.round() ?? 0;
      }
    }
    return 0;
  }

  int get _configuredPrice {
    final config = _asMap(_options['configuration']);
    var total = widget.product.price;
    total += _optionDelta(config['weightOptions'], _weight);
    total += _optionDelta(config['fillingOptions'], _filling);
    total += _optionDelta(config['designOptions'], _design);
    for (final rawGroup in _options['modifierGroups'] as List? ?? const []) {
      final group = _asMap(rawGroup);
      final selected = _selectedModifiers[_asString(group['id'])] ?? const {};
      for (final rawOption in group['options'] as List? ?? const []) {
        final option = _asMap(rawOption);
        if (selected.contains(_asString(option['id']))) {
          total += (option['priceDelta'] as num?)?.round() ?? 0;
        }
      }
    }
    return total;
  }

  String _optionTitle(Map<String, dynamic> value) {
    final title = _asMap(value['title']);
    final fallback = _asString(title['ru'] ?? value['name'] ?? value['code']);
    final translated = _asString(title[AppLang.current]);
    if (translated.isEmpty ||
        (AppLang.current != 'ru' &&
            translated.trim().toLowerCase() == fallback.trim().toLowerCase())) {
      return localizeCatalogOptionLabel(fallback);
    }
    return translated;
  }

  Future<void> _pickReference() async {
    if (!widget.api.isAuthenticated) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('catalog_upload_login_required'.tr)),
      );
      return;
    }
    final file = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 82,
      maxWidth: 1600,
      maxHeight: 1600,
    );
    if (file == null || !mounted) return;
    setState(() => _uploadingReference = true);
    try {
      final url = await widget.api.uploadCakeReference(
        bytes: await file.readAsBytes(),
        fileName: file.name,
      );
      if (mounted) setState(() => _referenceUrl = url);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(localizeErrorMessage(error))));
      }
    } finally {
      if (mounted) setState(() => _uploadingReference = false);
    }
  }

  Future<bool> _ensureOrderTypeSelected() async {
    if (widget.hasSelectedOrderType) return true;
    final allowed = await widget.onEnsureOrderTypeSelected?.call() ?? false;
    if (!allowed && mounted && Navigator.of(context).canPop()) {
      Navigator.of(context).pop();
    }
    return allowed;
  }

  Future<void> _updateQuantity(CatalogProduct product, int newQty) async {
    if (product.isStopListed) return;
    if (newQty > _quantity && !await _ensureOrderTypeSelected()) return;
    if (!mounted) return;
    final next = newQty.clamp(0, _catalogProductQuantityLimit(product));
    setState(() {
      _quantity = next;
    });
    widget.onQuantityChanged(product, next);
  }

  Widget _choiceSection({
    required String title,
    required dynamic rawOptions,
    required String? selected,
    required ValueChanged<String> onSelected,
  }) {
    final options = rawOptions is List ? rawOptions : const [];
    if (options.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontFamily: _headingFont,
              fontSize: BulkaTypeScale.body,
              fontWeight: FontWeight.w700,
              color: _textDark,
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: options.map<Widget>((raw) {
              final option = _asMap(raw);
              final code = _asString(option['code'] ?? option['id']);
              final delta = (option['priceDelta'] as num?)?.round() ?? 0;
              return ChoiceChip(
                selected: selected == code,
                onSelected: (_) => onSelected(code),
                label: Text.rich(
                  TextSpan(
                    text: _optionTitle(option),
                    children: [
                      if (delta > 0)
                        TextSpan(
                          text:
                              '  +${_CatalogScreenState._formatPrice(context, delta)} ₸',
                          style: const TextStyle(
                            fontFamily: _descriptionFont,
                            fontWeight: FontWeight.w700,
                            fontFeatures: [FontFeature.tabularFigures()],
                          ),
                        ),
                    ],
                  ),
                ),
                selectedColor: _bulkaYellow.withValues(alpha: 0.24),
                backgroundColor: Colors.white,
                side: BorderSide(
                  color: selected == code
                      ? _bulkaYellow
                      : const Color(0xFFE4D8CB),
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(BulkaRadii.control),
                ),
                labelStyle: const TextStyle(
                  color: _textDark,
                  fontWeight: FontWeight.w600,
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _modifierSections() {
    final groups = _options['modifierGroups'] as List? ?? const [];
    return Column(
      children: groups.map<Widget>((raw) {
        final group = _asMap(raw);
        final groupId = _asString(group['id']);
        final selected = _selectedModifiers[groupId] ?? <String>{};
        final multiple = group['selectionType'] == 'multiple';
        final required = group['required'] == true;
        final maxSelected = (group['maxSelected'] as num?)?.toInt() ?? 1;
        return Padding(
          padding: const EdgeInsets.only(top: 22),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text.rich(
                TextSpan(
                  text: _optionTitle(group),
                  children: [
                    if (required)
                      const TextSpan(
                        text: ' *',
                        style: TextStyle(
                          color: _errorRed,
                          fontFamily: _descriptionFont,
                        ),
                      ),
                  ],
                ),
                style: const TextStyle(
                  fontFamily: _headingFont,
                  fontSize: BulkaTypeScale.body,
                  fontWeight: FontWeight.w700,
                  color: _textDark,
                ),
              ),
              const SizedBox(height: 10),
              ...((group['options'] as List? ?? const []).map((rawOption) {
                final option = _asMap(rawOption);
                final optionId = _asString(option['id']);
                final active = selected.contains(optionId);
                final delta = (option['priceDelta'] as num?)?.round() ?? 0;
                return Semantics(
                  button: true,
                  checked: active,
                  child: InkWell(
                    onTap: () {
                      setState(() {
                        final next = {...selected};
                        if (multiple) {
                          if (active) {
                            next.remove(optionId);
                          } else if (next.length < maxSelected) {
                            next.add(optionId);
                          }
                        } else {
                          next
                            ..clear()
                            ..add(optionId);
                        }
                        _selectedModifiers[groupId] = next;
                      });
                    },
                    borderRadius: BorderRadius.circular(BulkaRadii.control),
                    child: Container(
                      constraints: const BoxConstraints(minHeight: 52),
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 10,
                      ),
                      decoration: BoxDecoration(
                        color: active
                            ? _bulkaYellow.withValues(alpha: 0.15)
                            : Colors.white,
                        borderRadius: BorderRadius.circular(BulkaRadii.control),
                        border: Border.all(
                          color: active
                              ? _bulkaYellow
                              : const Color(0xFFE6DDD4),
                        ),
                      ),
                      child: Row(
                        children: [
                          Icon(
                            multiple
                                ? active
                                      ? Icons.check_box_rounded
                                      : Icons.check_box_outline_blank_rounded
                                : active
                                ? Icons.radio_button_checked_rounded
                                : Icons.radio_button_off_rounded,
                            color: active
                                ? const Color(0xFFC8902E)
                                : const Color(0xFF9A8D84),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              _optionTitle(option),
                              style: const TextStyle(
                                fontSize: BulkaTypeScale.body,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          if (delta > 0)
                            Text(
                              '+${_CatalogScreenState._formatPrice(context, delta)} ₸',
                              style: const TextStyle(
                                fontFamily: _descriptionFont,
                                fontWeight: FontWeight.w700,
                                fontFeatures: [FontFeature.tabularFigures()],
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                );
              })),
            ],
          ),
        );
      }).toList(),
    );
  }

  bool _validateConfiguredSelection() {
    for (final raw in _options['modifierGroups'] as List? ?? const []) {
      final group = _asMap(raw);
      final count =
          (_selectedModifiers[_asString(group['id'])] ?? const {}).length;
      final minimum = max(
        group['required'] == true ? 1 : 0,
        (group['minSelected'] as num?)?.toInt() ?? 0,
      );
      if (count < minimum) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'catalog_select_option'.trArgs({'option': _optionTitle(group)}),
            ),
          ),
        );
        return false;
      }
    }
    return true;
  }

  Future<void> _addConfiguredProduct(CatalogProduct product) async {
    if (!await _ensureOrderTypeSelected()) return;
    if (!mounted) return;
    if (!_validateConfiguredSelection()) return;
    final modifiers = <Map<String, dynamic>>[];
    for (final raw in _options['modifierGroups'] as List? ?? const []) {
      final group = _asMap(raw);
      final selected = _selectedModifiers[_asString(group['id'])] ?? const {};
      if (selected.isNotEmpty) {
        modifiers.add({
          'groupId': _asString(group['id']),
          'optionIds': selected.toList(),
        });
      }
    }
    context.read<CartProvider>().addConfiguredItem(
      productId: product.id,
      name: product.title,
      basePrice: product.price,
      unitPrice: _configuredPrice,
      imageUrl: product.imageUrl,
      configuration: {
        if (_weight != null) 'weight': _weight,
        if (_filling != null) 'filling': _filling,
        if (_design != null) 'design': _design,
        if (_inscriptionController.text.trim().isNotEmpty)
          'inscription': _inscriptionController.text.trim(),
        'candles': _candles,
        if (_referenceUrl != null) 'referenceUrl': _referenceUrl,
      },
      modifiers: modifiers,
    );
    BulkaMotion.lightImpact();
  }

  String _factNumber(double? value) {
    if (value == null) return '—';
    return value == value.roundToDouble()
        ? value.round().toString()
        : value.toStringAsFixed(1);
  }

  Widget _nutritionMetric(
    String label,
    double? value,
    String unit, {
    required double width,
  }) {
    final colors = context.bulkaColors;
    return SizedBox(
      width: width,
      child: Column(
        children: [
          Text(
            label,
            maxLines: 2,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontFamily: _descriptionFont,
              color: colors.mutedText,
              fontSize: BulkaTypeScale.caption,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 7),
          Text(
            value == null ? '—' : '${_factNumber(value)} $unit',
            maxLines: 2,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontFamily: _descriptionFont,
              fontSize: BulkaTypeScale.bodySmall,
              fontWeight: FontWeight.w700,
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }

  Widget _nutritionGrid(CatalogProduct product) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final textScale = MediaQuery.textScalerOf(context).scale(1);
        final columns = constraints.maxWidth >= 430 && textScale <= 1.15
            ? 4
            : 2;
        const spacing = 12.0;
        final width =
            (constraints.maxWidth - spacing * (columns - 1)) / columns;
        return Wrap(
          spacing: spacing,
          runSpacing: 16,
          alignment: WrapAlignment.center,
          children: [
            if (product.caloriesKcal != null)
              _nutritionMetric(
                'catalog_calories'.tr,
                product.caloriesKcal,
                'catalog_kcal'.tr,
                width: width,
              ),
            if (product.proteinGrams != null)
              _nutritionMetric(
                'catalog_protein'.tr,
                product.proteinGrams,
                'catalog_grams'.tr,
                width: width,
              ),
            if (product.fatGrams != null)
              _nutritionMetric(
                'catalog_fat'.tr,
                product.fatGrams,
                'catalog_grams'.tr,
                width: width,
              ),
            if (product.carbsGrams != null)
              _nutritionMetric(
                'catalog_carbs'.tr,
                product.carbsGrams,
                'catalog_grams'.tr,
                width: width,
              ),
          ],
        );
      },
    );
  }

  Future<void> _toggleProductFavorite() async {
    final callback = widget.onToggleFavorite;
    if (callback == null) return;
    final next = await callback();
    if (mounted) setState(() => _isFavorite = next);
  }

  Future<void> _shareProduct(CatalogProduct product) async {
    final url = catalogProductShareUri(product).toString();
    await Clipboard.setData(ClipboardData(text: '${product.title}\n$url'));
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('catalog_product_link_copied'.tr)));
  }

  Future<void> _showIngredientsSheet(CatalogProduct product) async {
    final colors = context.bulkaColors;
    final ingredients = product.ingredients.trim();
    await _sheetGate.run(() async {
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        backgroundColor: Colors.transparent,
        barrierColor: Colors.black.withValues(alpha: 0.34),
        builder: (sheetContext) => FractionallySizedBox(
          heightFactor: 0.88,
          child: Material(
            color: Colors.white,
            surfaceTintColor: Colors.transparent,
            shape: const RoundedRectangleBorder(
              borderRadius: BorderRadius.vertical(
                top: Radius.circular(BulkaRadii.sheet),
              ),
            ),
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 14, 14, 10),
                  child: Row(
                    children: [
                      const SizedBox(width: 48),
                      Expanded(
                        child: Text(
                          'catalog_about_product'.tr,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontFamily: _headingFont,
                            fontSize: BulkaTypeScale.title,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      IconButton(
                        key: const ValueKey('product-ingredients-close'),
                        onPressed: () => Navigator.pop(sheetContext),
                        tooltip: 'close_tooltip'.tr,
                        style: IconButton.styleFrom(
                          backgroundColor: Colors.white,
                          foregroundColor: colors.brandBrown,
                          minimumSize: const Size(48, 48),
                          side: BorderSide(color: colors.cardBorder),
                        ),
                        icon: const Icon(Icons.close_rounded),
                      ),
                    ],
                  ),
                ),
                Divider(height: 1, color: colors.cardBorder),
                Expanded(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(28, 28, 28, 48),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (ingredients.isNotEmpty) ...[
                          Text(
                            'catalog_ingredients'.tr,
                            style: const TextStyle(
                              fontFamily: _headingFont,
                              fontSize: BulkaTypeScale.title,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 22),
                          Text(
                            ingredients,
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.onSurface,
                              fontSize: BulkaTypeScale.body,
                              height: 1.55,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                        if (product.allergens.isNotEmpty) ...[
                          if (ingredients.isNotEmpty)
                            const SizedBox(height: 28),
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(18),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(
                                BulkaRadii.control,
                              ),
                              border: Border.all(color: colors.cardBorder),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'catalog_allergens'.tr,
                                  style: const TextStyle(
                                    fontFamily: _headingFont,
                                    fontSize: BulkaTypeScale.titleSmall,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                const SizedBox(height: 14),
                                _ProductFactGrid(
                                  values: product.allergens,
                                  isAllergen: true,
                                ),
                              ],
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    });
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
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                children: [
                  IconButton(
                    key: const ValueKey('product-share'),
                    onPressed: () => _shareProduct(product),
                    icon: const Icon(Icons.ios_share_rounded, size: 23),
                    tooltip: 'catalog_share_product'.tr,
                    style: IconButton.styleFrom(
                      minimumSize: const Size(48, 48),
                      tapTargetSize: MaterialTapTargetSize.padded,
                      backgroundColor: Colors.white,
                      foregroundColor: colors.brandBrown,
                      side: BorderSide(color: colors.cardBorder),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton(
                    key: const ValueKey('product-favorite'),
                    onPressed: widget.onToggleFavorite == null
                        ? null
                        : _toggleProductFavorite,
                    icon: Icon(
                      _isFavorite
                          ? Icons.favorite_rounded
                          : Icons.favorite_border_rounded,
                      size: 24,
                    ),
                    tooltip: 'catalog_favorites'.tr,
                    style: IconButton.styleFrom(
                      minimumSize: const Size(48, 48),
                      backgroundColor: Colors.white,
                      foregroundColor: colors.brandBrown,
                      disabledForegroundColor: colors.mutedText,
                      side: BorderSide(
                        color: _isFavorite
                            ? colors.brandGold
                            : colors.cardBorder,
                      ),
                    ),
                  ),
                  const Spacer(),
                  IconButton(
                    key: const ValueKey('product-close'),
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded, size: 27),
                    tooltip: 'close_tooltip'.tr,
                    style: IconButton.styleFrom(
                      minimumSize: const Size(52, 52),
                      backgroundColor: Colors.white,
                      foregroundColor: colors.brandBrown,
                      side: BorderSide(color: colors.cardBorder),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                clipBehavior: Clip.hardEdge,
                padding: const EdgeInsets.only(bottom: 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      height: min(
                        440,
                        max(330, MediaQuery.sizeOf(context).width * 1.02),
                      ),
                      child: PageView.builder(
                        itemCount: photos.length,
                        onPageChanged: (i) =>
                            setState(() => _currentPhotoIndex = i),
                        itemBuilder: (context, i) {
                          return Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(
                                BulkaRadii.sheet,
                              ),
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
                              borderRadius: BorderRadius.circular(
                                BulkaRadii.small,
                              ),
                            ),
                          );
                        }),
                      ),
                    ],
                    const SizedBox(height: 24),
                    Container(
                      width: double.infinity,
                      decoration: BoxDecoration(
                        color: scheme.surface,
                        borderRadius: const BorderRadius.vertical(
                          top: Radius.circular(BulkaRadii.card),
                        ),
                      ),
                      padding: const EdgeInsets.fromLTRB(24, 28, 24, 40),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Center(
                            child: Text(
                              product.title,
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                fontFamily: _headingFont,
                                fontSize: BulkaTypeScale.titleLarge,
                                fontWeight: FontWeight.w700,
                                color: scheme.onSurface,
                                height: 1.18,
                              ),
                            ),
                          ),
                          if (product.weightGrams != null) ...[
                            const SizedBox(height: 12),
                            Center(
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 16,
                                  vertical: 8,
                                ),
                                decoration: BoxDecoration(
                                  color: colors.brandGold.withValues(
                                    alpha: 0.15,
                                  ),
                                  borderRadius: BorderRadius.circular(
                                    BulkaRadii.pill,
                                  ),
                                  border: Border.all(
                                    color: colors.brandGold.withValues(
                                      alpha: 0.48,
                                    ),
                                  ),
                                ),
                                child: Text(
                                  'catalog_weight_short'.trArgs({
                                    'weight': product.weightGrams,
                                  }),
                                  style: TextStyle(
                                    fontFamily: _headingFont,
                                    color: colors.brandBrown,
                                    fontSize: BulkaTypeScale.bodySmall,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            ),
                          ],
                          if (product.hasProductDetails) ...[
                            const SizedBox(height: 28),
                            Center(
                              child: Text(
                                'catalog_about_product'.tr,
                                style: const TextStyle(
                                  fontFamily: _headingFont,
                                  fontSize: BulkaTypeScale.titleLarge,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            const SizedBox(height: 14),
                          ],
                          if (product.description.trim().isNotEmpty)
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.all(20),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(
                                  BulkaRadii.card,
                                ),
                                border: Border.all(color: colors.cardBorder),
                              ),
                              child: Text(
                                product.description.trim(),
                                style: TextStyle(
                                  fontFamily: _descriptionFont,
                                  fontSize: BulkaTypeScale.body,
                                  color: scheme.onSurface,
                                  height: 1.5,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ),
                          if (product.hasNutrition ||
                              product.hasComposition) ...[
                            if (product.description.trim().isNotEmpty)
                              const SizedBox(height: 14),
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.fromLTRB(
                                14,
                                20,
                                14,
                                18,
                              ),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(
                                  BulkaRadii.card,
                                ),
                                border: Border.all(color: colors.cardBorder),
                              ),
                              child: Column(
                                children: [
                                  if (product.hasNutrition) ...[
                                    Text(
                                      'catalog_product_information'.tr,
                                      textAlign: TextAlign.center,
                                      style: const TextStyle(
                                        fontFamily: _headingFont,
                                        fontSize: BulkaTypeScale.title,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                    const SizedBox(height: 5),
                                    Text(
                                      'catalog_nutrition_whole_product'.tr,
                                      style: TextStyle(
                                        fontFamily: _descriptionFont,
                                        color: colors.mutedText,
                                        fontSize: BulkaTypeScale.bodySmall,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                    const SizedBox(height: 18),
                                    _nutritionGrid(product),
                                  ],
                                  if (product.hasNutrition &&
                                      product.hasComposition)
                                    const SizedBox(height: 18),
                                  if (product.hasComposition)
                                    SizedBox(
                                      width: double.infinity,
                                      child: OutlinedButton(
                                        key: const ValueKey(
                                          'product-show-ingredients',
                                        ),
                                        onPressed: () =>
                                            _showIngredientsSheet(product),
                                        style: OutlinedButton.styleFrom(
                                          backgroundColor: colors.surfaceCream,
                                          foregroundColor: colors.brandBrown,
                                          side: BorderSide(
                                            color: colors.cardBorder,
                                          ),
                                          minimumSize: const Size.fromHeight(
                                            52,
                                          ),
                                          shape: const StadiumBorder(),
                                        ),
                                        child: Text(
                                          'catalog_view_ingredients'.tr,
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
                          ],
                          if (product.storageConditions.isNotEmpty) ...[
                            if (product.description.trim().isNotEmpty ||
                                product.hasNutrition ||
                                product.hasComposition)
                              const SizedBox(height: 14),
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.all(20),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(
                                  BulkaRadii.card,
                                ),
                                border: Border.all(color: colors.cardBorder),
                              ),
                              child: Column(
                                children: [
                                  Text(
                                    'catalog_storage_conditions'.tr,
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(
                                      fontFamily: _headingFont,
                                      fontSize: BulkaTypeScale.title,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                  const SizedBox(height: 18),
                                  _ProductStorageConditions(
                                    conditions: product.storageConditions,
                                  ),
                                ],
                              ),
                            ),
                          ],
                          if (product.dietaryTags.isNotEmpty) ...[
                            if (product.description.trim().isNotEmpty ||
                                product.hasNutrition ||
                                product.hasComposition ||
                                product.storageConditions.isNotEmpty)
                              const SizedBox(height: 14),
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.all(20),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(
                                  BulkaRadii.card,
                                ),
                                border: Border.all(color: colors.cardBorder),
                              ),
                              child: Column(
                                children: [
                                  Text(
                                    'catalog_certificates'.tr,
                                    style: const TextStyle(
                                      fontFamily: _headingFont,
                                      fontSize: BulkaTypeScale.title,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                  const SizedBox(height: 14),
                                  _ProductFactGrid(
                                    values: product.dietaryTags,
                                    isAllergen: false,
                                  ),
                                ],
                              ),
                            ),
                          ],
                          if (_loadingOptions) ...[
                            const SizedBox(height: 24),
                            const LinearProgressIndicator(
                              minHeight: 3,
                              color: _bulkaYellow,
                              backgroundColor: Color(0xFFEDE5DB),
                            ),
                          ] else if (_hasCustomOptions) ...[
                            Builder(
                              builder: (context) {
                                final configuration = _asMap(
                                  _options['configuration'],
                                );
                                return Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    _choiceSection(
                                      title: 'catalog_weight'.tr,
                                      rawOptions:
                                          configuration['weightOptions'],
                                      selected: _weight,
                                      onSelected: (value) =>
                                          setState(() => _weight = value),
                                    ),
                                    _choiceSection(
                                      title: 'catalog_builder_filling'.tr,
                                      rawOptions:
                                          configuration['fillingOptions'],
                                      selected: _filling,
                                      onSelected: (value) =>
                                          setState(() => _filling = value),
                                    ),
                                    _choiceSection(
                                      title: 'catalog_builder_design'.tr,
                                      rawOptions:
                                          configuration['designOptions'],
                                      selected: _design,
                                      onSelected: (value) =>
                                          setState(() => _design = value),
                                    ),
                                    _modifierSections(),
                                    if (configuration['allowInscription'] ==
                                        true) ...[
                                      const SizedBox(height: 22),
                                      Text(
                                        'catalog_inscription'.tr,
                                        style: TextStyle(
                                          fontFamily: _headingFont,
                                          fontSize: BulkaTypeScale.body,
                                          fontWeight: FontWeight.w700,
                                          color: scheme.onSurface,
                                        ),
                                      ),
                                      const SizedBox(height: 10),
                                      TextField(
                                        controller: _inscriptionController,
                                        maxLength:
                                            (configuration['inscriptionMaxLength']
                                                    as num?)
                                                ?.toInt() ??
                                            80,
                                        decoration: InputDecoration(
                                          hintText:
                                              'catalog_inscription_hint'.tr,
                                          filled: true,
                                          fillColor: Colors.white,
                                          border: OutlineInputBorder(
                                            borderRadius: BorderRadius.circular(
                                              16,
                                            ),
                                            borderSide: BorderSide.none,
                                          ),
                                        ),
                                      ),
                                    ],
                                    if (configuration['allowCandles'] ==
                                        true) ...[
                                      const SizedBox(height: 16),
                                      Row(
                                        children: [
                                          Expanded(
                                            child: Text(
                                              'catalog_candles'.tr,
                                              style: const TextStyle(
                                                fontFamily: _headingFont,
                                                fontSize: BulkaTypeScale.body,
                                                fontWeight: FontWeight.w700,
                                              ),
                                            ),
                                          ),
                                          Semantics(
                                            button: true,
                                            enabled: _candles > 0,
                                            label:
                                                'catalog_decrease_quantity'.tr,
                                            child: ExcludeSemantics(
                                              child: IconButton(
                                                onPressed: _candles > 0
                                                    ? () => setState(
                                                        () => _candles--,
                                                      )
                                                    : null,
                                                icon: const Icon(
                                                  Icons.remove_rounded,
                                                ),
                                              ),
                                            ),
                                          ),
                                          SizedBox(
                                            width: 36,
                                            child: Text(
                                              '$_candles',
                                              textAlign: TextAlign.center,
                                              style: const TextStyle(
                                                fontFamily: _headingFont,
                                                fontSize: BulkaTypeScale.body,
                                                fontWeight: FontWeight.w700,
                                              ),
                                            ),
                                          ),
                                          Semantics(
                                            button: true,
                                            enabled: _candles < 99,
                                            label:
                                                'catalog_increase_quantity'.tr,
                                            child: ExcludeSemantics(
                                              child: IconButton(
                                                onPressed: _candles < 99
                                                    ? () => setState(
                                                        () => _candles++,
                                                      )
                                                    : null,
                                                icon: const Icon(
                                                  Icons.add_rounded,
                                                ),
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                    if (configuration['allowReferenceUpload'] ==
                                        true) ...[
                                      const SizedBox(height: 16),
                                      OutlinedButton.icon(
                                        onPressed: _uploadingReference
                                            ? null
                                            : _pickReference,
                                        icon: Icon(
                                          _referenceUrl == null
                                              ? Icons
                                                    .add_photo_alternate_outlined
                                              : Icons
                                                    .check_circle_outline_rounded,
                                        ),
                                        label: Text(
                                          _uploadingReference
                                              ? 'catalog_uploading'.tr
                                              : _referenceUrl == null
                                              ? 'catalog_upload_reference'.tr
                                              : 'catalog_reference_uploaded'.tr,
                                        ),
                                        style: OutlinedButton.styleFrom(
                                          minimumSize: const Size(
                                            double.infinity,
                                            52,
                                          ),
                                          foregroundColor: colors.brandBrown,
                                          side: BorderSide(
                                            color: colors.cardBorder,
                                          ),
                                          shape: RoundedRectangleBorder(
                                            borderRadius: BorderRadius.circular(
                                              16,
                                            ),
                                          ),
                                        ),
                                      ),
                                    ],
                                  ],
                                );
                              },
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Container(
              color: scheme.surface,
              padding: EdgeInsets.fromLTRB(
                20,
                16,
                20,
                16 + MediaQuery.paddingOf(context).bottom,
              ),
              child: _hasCustomOptions && !_loadingOptions
                  ? DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [Color(0xFFFFD044), Color(0xFFFFA900)],
                        ),
                        borderRadius: BorderRadius.circular(BulkaRadii.control),
                      ),
                      child: FilledButton.icon(
                        onPressed: product.isStopListed
                            ? null
                            : () => _addConfiguredProduct(product),
                        icon: const Icon(Icons.shopping_bag_outlined),
                        label: product.isStopListed
                            ? Text('catalog_stop_list'.tr)
                            : Text.rich(
                                TextSpan(
                                  children: [
                                    TextSpan(
                                      text: '${'catalog_add_to_cart'.tr} · ',
                                    ),
                                    TextSpan(
                                      text:
                                          '${_CatalogScreenState._formatPrice(context, _configuredPrice)} ₸',
                                      style: const TextStyle(
                                        fontFamily: _descriptionFont,
                                        fontWeight: FontWeight.w700,
                                        fontFeatures: [
                                          FontFeature.tabularFigures(),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                        style: FilledButton.styleFrom(
                          minimumSize: const Size(double.infinity, 56),
                          backgroundColor: Colors.transparent,
                          disabledBackgroundColor: const Color(0xFFD8D3CD),
                          foregroundColor: _textDark,
                          shadowColor: Colors.transparent,
                          textStyle: const TextStyle(
                            fontFamily: _headingFont,
                            fontSize: BulkaTypeScale.body,
                            fontWeight: FontWeight.w700,
                          ),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(
                              BulkaRadii.control,
                            ),
                          ),
                        ),
                      ),
                    )
                  : Container(
                      constraints: const BoxConstraints(minHeight: 64),
                      padding: const EdgeInsets.fromLTRB(20, 6, 8, 6),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.96),
                        borderRadius: BorderRadius.circular(BulkaRadii.sheet),
                        border: Border.all(color: colors.cardBorder),
                        boxShadow: [
                          BoxShadow(
                            color: colors.brandBrown.withValues(alpha: 0.15),
                            blurRadius: 14,
                            offset: const Offset(0, 6),
                          ),
                        ],
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              '${_CatalogScreenState._formatPrice(context, product.price)} ₸',
                              style: TextStyle(
                                fontFamily: _descriptionFont,
                                color: colors.brandBrown,
                                fontSize: BulkaTypeScale.title,
                                fontWeight: FontWeight.w700,
                                fontFeatures: const [
                                  FontFeature.tabularFigures(),
                                ],
                              ),
                            ),
                          ),
                          _CatalogImageQuantityControl(
                            quantity: _quantity,
                            stopListed: product.isStopListed,
                            onAdd: () => _updateQuantity(product, 1),
                            onDecrease: () =>
                                _updateQuantity(product, _quantity - 1),
                            onIncrease:
                                _quantity >=
                                    _catalogProductQuantityLimit(product)
                                ? null
                                : () => _updateQuantity(product, _quantity + 1),
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
