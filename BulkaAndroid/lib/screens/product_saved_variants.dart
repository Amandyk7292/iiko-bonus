part of '../main.dart';

extension _ProductSavedVariants on _ProductDetailsScreenState {
  Future<void> _loadSavedVariants() async {
    if (!widget.api.isAuthenticated) return;
    try {
      final variants = await widget.api.getSavedVariants(widget.product.id);
      if (mounted) {
        _updateVariantState(() {
          _savedVariants = variants;
          _variantError = null;
        });
      }
    } catch (error) {
      if (mounted) {
        _updateVariantState(() => _variantError = localizeErrorMessage(error));
      }
    }
  }

  Map<String, dynamic> _selectedVariantConfiguration() => {
    if (_weight != null) 'weight': _weight,
    if (_filling != null) 'filling': _filling,
    if (_design != null) 'design': _design,
    if (_inscriptionController.text.trim().isNotEmpty)
      'inscription': _inscriptionController.text.trim(),
    'candles': _candles,
    if (_referenceUrl != null) 'referenceUrl': _referenceUrl,
  };

  List<Map<String, dynamic>> _selectedVariantModifiers() {
    final result = <Map<String, dynamic>>[];
    for (final raw in _options['modifierGroups'] as List? ?? const []) {
      final group = _asMap(raw);
      final selected = _selectedModifiers[_asString(group['id'])] ?? const {};
      if (selected.isNotEmpty) {
        result.add({
          'groupId': _asString(group['id']),
          'optionIds': selected.toList()..sort(),
        });
      }
    }
    return result;
  }

  String _suggestVariantName(CatalogProduct product) {
    final names = <String>[];
    final config = _asMap(_options['configuration']);
    for (final entry in [
      (config['weightOptions'], _weight),
      (config['fillingOptions'], _filling),
      (config['designOptions'], _design),
    ]) {
      final choices = entry.$1;
      if (choices is! List || entry.$2 == null) continue;
      for (final raw in choices) {
        final option = _asMap(raw);
        if (_asString(option['code'] ?? option['id']) == entry.$2) {
          names.add(_optionTitle(option));
          break;
        }
      }
    }
    for (final raw in _options['modifierGroups'] as List? ?? const []) {
      final group = _asMap(raw);
      final selected = _selectedModifiers[_asString(group['id'])] ?? const {};
      for (final rawOption in group['options'] as List? ?? const []) {
        final option = _asMap(rawOption);
        if (selected.contains(_asString(option['id']))) {
          names.add(_optionTitle(option));
        }
      }
    }
    final suggested = names.isEmpty
        ? product.title
        : '${product.title} · ${names.take(2).join(', ')}';
    return suggested.length <= 100 ? suggested : suggested.substring(0, 100);
  }

  Future<void> _saveCurrentVariant(CatalogProduct product) async {
    if (_variantBusy ||
        _loadingOptions ||
        _optionsFailed ||
        !_validateConfiguredSelection()) {
      return;
    }
    if (!widget.api.isAuthenticated) {
      if (!await (widget.onRequireAuth?.call() ?? Future.value(false))) return;
      if (!mounted) return;
    }
    if (!await _ensureOrderTypeSelected() || !mounted) return;
    final branchId = widget.branchId?.trim() ?? '';
    if (branchId.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        bulkaSnackBar(content: Text('order_repeat_choose_branch'.tr)),
      );
      return;
    }
    final nameController = TextEditingController(
      text: _suggestVariantName(product),
    );
    final name = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('variant_name_title'.tr),
        content: TextField(
          key: const ValueKey('variant-name-input'),
          controller: nameController,
          maxLength: 100,
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(labelText: 'variant_name'.tr),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: Text('cancel_btn'.tr),
          ),
          FilledButton(
            key: const ValueKey('variant-confirm-save'),
            onPressed: () =>
                Navigator.pop(dialogContext, nameController.text.trim()),
            child: Text('variant_save'.tr),
          ),
        ],
      ),
    );
    nameController.dispose();
    if (!mounted || name == null || name.isEmpty) return;
    _updateVariantState(() => _variantBusy = true);
    try {
      await widget.api.saveVariant(
        productId: product.id,
        name: name,
        branchId: branchId,
        orderType: widget.orderType,
        configuration: _selectedVariantConfiguration(),
        modifiers: _selectedVariantModifiers(),
      );
      await _loadSavedVariants();
      if (!_isFavorite && widget.onToggleFavorite != null) {
        final favorite = await widget.onToggleFavorite!();
        if (mounted) _updateVariantState(() => _isFavorite = favorite);
      }
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(bulkaSnackBar(content: Text('variant_saved'.tr)));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          bulkaSnackBar(content: Text(localizeErrorMessage(error))),
        );
      }
    } finally {
      if (mounted) _updateVariantState(() => _variantBusy = false);
    }
  }

  Future<void> _addSavedVariant(
    Map<String, dynamic> variant,
    CatalogProduct product,
  ) async {
    if (_variantBusy || !await _ensureOrderTypeSelected() || !mounted) return;
    final branchId = widget.branchId?.trim() ?? '';
    if (branchId.isEmpty) return;
    final cart = context.read<CartProvider>();
    _updateVariantState(() => _variantBusy = true);
    try {
      final priced = await widget.api.quoteSavedVariant(
        id: _asString(variant['id']),
        branchId: branchId,
        orderType: widget.orderType,
        quantity: cart.getQuantity(product.id) + product.increment,
      );
      if (!mounted) return;
      cart.addConfiguredItem(
        productId: product.id,
        name: _asString(priced['name'], fallback: product.title),
        basePrice: _asInt(priced['basePrice']),
        unitPrice: _asInt(priced['price']),
        imageUrl: product.imageUrl,
        configuration: _asMap(priced['configuration']),
        modifiers: (priced['modifiers'] as List? ?? const [])
            .whereType<Map>()
            .map((value) => Map<String, dynamic>.from(value))
            .toList(),
        quantity: product.increment,
        quantityStep: product.quantityStep,
        unit: product.unit,
      );
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(bulkaSnackBar(content: Text('variant_added'.tr)));
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          bulkaSnackBar(content: Text(localizeErrorMessage(error))),
        );
      }
    } finally {
      if (mounted) _updateVariantState(() => _variantBusy = false);
    }
  }

  Future<void> _deleteSavedVariant(Map<String, dynamic> variant) async {
    if (_variantBusy) return;
    _updateVariantState(() => _variantBusy = true);
    try {
      await widget.api.deleteSavedVariant(_asString(variant['id']));
      await _loadSavedVariants();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          bulkaSnackBar(content: Text(localizeErrorMessage(error))),
        );
      }
    } finally {
      if (mounted) _updateVariantState(() => _variantBusy = false);
    }
  }

  Widget _buildSavedVariants(CatalogProduct product) {
    if (!widget.api.isAuthenticated) return const SizedBox.shrink();
    if (_variantError != null) {
      return TextButton(
        onPressed: _loadSavedVariants,
        child: Text('variant_retry'.tr),
      );
    }
    if (_savedVariants.isEmpty) return const SizedBox.shrink();
    return Column(
      key: const ValueKey('saved-variants-section'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 18),
        Text(
          'variant_my_variants'.tr,
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18),
        ),
        const SizedBox(height: 8),
        for (final variant in _savedVariants)
          Card(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      _asString(variant['name']),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  IconButton(
                    key: ValueKey('variant-delete-${variant['id']}'),
                    tooltip: 'variant_delete'.tr,
                    onPressed: _variantBusy
                        ? null
                        : () => _deleteSavedVariant(variant),
                    icon: const Icon(Icons.delete_outline_rounded),
                  ),
                  FilledButton(
                    key: ValueKey('variant-add-${variant['id']}'),
                    onPressed: _variantBusy || product.isStopListed
                        ? null
                        : () => _addSavedVariant(variant, product),
                    child: Text('variant_add'.tr),
                  ),
                ],
              ),
            ),
          ),
        const SizedBox(height: 12),
      ],
    );
  }
}
