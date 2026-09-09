part of '../main.dart';

const int _maximumSavedPaymentMethods = 3;

String _paymentMethodAddErrorMessage(Object error) {
  if (error is ApiException &&
      error.code == 'FORTE_WIDGET_PAYMENT_METHOD_LIMIT') {
    return 'payment_methods_limit_reached'.tr;
  }
  return 'payment_methods_add_error'.tr;
}

@visibleForTesting
Widget buildCheckoutSavedCardsPanelForTest({
  required BulkaApiClient api,
  required String? selectedMethodId,
  required ValueChanged<String?> onDefaultResolved,
  required ValueChanged<String> onSelect,
  bool? available = true,
}) {
  return _CheckoutSavedCardsPanel(
    api: api,
    available: available,
    selectedMethodId: selectedMethodId,
    onDefaultResolved: onDefaultResolved,
    onSelect: onSelect,
    onRetryAvailability: () {},
  );
}

class _CheckoutDetails {
  const _CheckoutDetails({
    required this.checkoutId,
    required this.orderType,
    required this.scheduledAt,
    this.savedPaymentMethodId,
    this.useBonuses = false,
    this.bonusSpent = 0,
    this.deliveryQuoteToken,
    this.preorderFulfillmentType,
    this.branch,
    this.branchId,
    this.deliveryAddress,
    this.additionalPhone,
    this.promoCode,
    this.comment,
  });

  final String checkoutId;
  final _OrderType orderType;
  final String scheduledAt;
  final String? savedPaymentMethodId;
  final bool useBonuses;
  final int bonusSpent;
  final String? deliveryQuoteToken;
  final String? preorderFulfillmentType;
  final String? branch;
  final String? branchId;
  final DeliveryAddress? deliveryAddress;
  final String? additionalPhone;
  final String? promoCode;
  final String? comment;
}

class _CheckoutSavedCardsPanel extends StatefulWidget {
  const _CheckoutSavedCardsPanel({
    required this.api,
    required this.available,
    required this.selectedMethodId,
    required this.onDefaultResolved,
    required this.onSelect,
    required this.onRetryAvailability,
  });

  final BulkaApiClient api;
  final bool? available;
  final String? selectedMethodId;
  final ValueChanged<String?> onDefaultResolved;
  final ValueChanged<String> onSelect;
  final VoidCallback onRetryAvailability;

  @override
  State<_CheckoutSavedCardsPanel> createState() =>
      _CheckoutSavedCardsPanelState();
}

class _CheckoutSavedCardsPanelState extends State<_CheckoutSavedCardsPanel> {
  List<Map<String, dynamic>> _methods = const [];
  bool _loading = false;
  bool _adding = false;
  String? _error;
  String? _sessionScope;
  int _loadRevision = 0;

  @override
  void initState() {
    super.initState();
    _sessionScope = widget.api.sessionCacheScope;
    if (widget.available == true) unawaited(_load());
  }

  @override
  void didUpdateWidget(covariant _CheckoutSavedCardsPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    final sessionChanged =
        _sessionScope != widget.api.sessionCacheScope ||
        oldWidget.api != widget.api;
    if (sessionChanged ||
        (widget.available == false && oldWidget.available != false)) {
      _sessionScope = widget.api.sessionCacheScope;
      _loadRevision++;
      _methods = const [];
      _loading = false;
      _error = null;
      _resolveDefault(null);
    }
    if (widget.available == true &&
        (sessionChanged ||
            oldWidget.available == false ||
            (oldWidget.available == null && _methods.isEmpty))) {
      unawaited(_load());
    }
  }

  void _resolveDefault(String? methodId) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.onDefaultResolved(methodId);
    });
  }

  String? _preferredMethodId(List<Map<String, dynamic>> methods) {
    final current = widget.selectedMethodId;
    if (current != null &&
        methods.any((method) => (method['id'] ?? '').toString() == current)) {
      return current;
    }
    for (final method in methods) {
      if (method['isDefault'] == true) {
        return (method['id'] ?? '').toString();
      }
    }
    return methods.isEmpty ? null : (methods.first['id'] ?? '').toString();
  }

  Future<void> _load() async {
    if (widget.available != true || _loading) return;
    final revision = ++_loadRevision;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final methods = (await widget.api.getFortePaymentMethods())
          .where((method) => (method['id'] ?? '').toString().isNotEmpty)
          .take(_maximumSavedPaymentMethods)
          .toList(growable: false);
      if (!mounted || revision != _loadRevision) return;
      setState(() => _methods = methods);
      _resolveDefault(_preferredMethodId(methods));
    } catch (_) {
      if (!mounted || revision != _loadRevision) return;
      setState(() => _error = 'payment_methods_load_error'.tr);
      if (_methods.isEmpty) _resolveDefault(null);
    } finally {
      if (mounted && revision == _loadRevision) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _addCard() async {
    if (_adding || _loading) return;
    if (_methods.length >= _maximumSavedPaymentMethods) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('payment_methods_limit_reached'.tr)),
      );
      return;
    }
    final previousIds = _methods
        .map((method) => (method['id'] ?? '').toString())
        .toSet();
    setState(() => _adding = true);
    try {
      final result = await widget.api.createForteCardSetup();
      final operationId = (result['operationId'] ?? '').toString();
      final redirectUrl = (result['redirectUrl'] ?? '').toString();
      if (operationId.isEmpty || redirectUrl.isEmpty) {
        throw ApiException('payment_methods_add_error'.tr);
      }
      if (!mounted) return;
      final setupResult = await Navigator.of(context).push<FortePaymentResult>(
        MaterialPageRoute(
          builder: (_) => FortePaymentScreen(
            api: widget.api,
            operationId: operationId,
            redirectUrl: redirectUrl,
            cardSetup: true,
          ),
        ),
      );
      if (setupResult?.paid != true || !mounted) return;
      await _load();
      if (!mounted) return;
      String? addedMethodId;
      for (final method in _methods) {
        final id = (method['id'] ?? '').toString();
        if (id.isNotEmpty && !previousIds.contains(id)) {
          addedMethodId = id;
          break;
        }
      }
      final selectedId = addedMethodId ?? _preferredMethodId(_methods);
      if (selectedId != null && selectedId.isNotEmpty) {
        widget.onSelect(selectedId);
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('payment_methods_add_error'.tr)));
      }
    } finally {
      if (mounted) setState(() => _adding = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    if (_methods.isEmpty && (widget.available == null || _loading)) {
      return Container(
        key: const ValueKey('checkout-saved-cards-loading'),
        width: double.infinity,
        constraints: const BoxConstraints(minHeight: 88),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        decoration: BoxDecoration(
          color: colors.surfaceCream,
          borderRadius: BorderRadius.circular(BulkaRadii.control),
          border: Border.all(color: colors.cardBorder),
        ),
        child: Row(
          children: [
            SizedBox.square(
              dimension: 24,
              child: CircularProgressIndicator(
                strokeWidth: 2.2,
                color: colors.brandGold,
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Text(
                'payment_methods_loading'.tr,
                style: TextStyle(color: colors.mutedText),
              ),
            ),
          ],
        ),
      );
    }

    if (widget.available == false) {
      return _CheckoutSavedCardsNotice(
        key: const ValueKey('checkout-saved-cards-unavailable'),
        icon: Icons.error_outline_rounded,
        message: 'checkout_forte_unavailable'.tr,
        actionLabel: 'retry_btn'.tr,
        onAction: widget.onRetryAvailability,
      );
    }

    if (_error != null && _methods.isEmpty) {
      return _CheckoutSavedCardsNotice(
        key: const ValueKey('checkout-saved-cards-error'),
        icon: Icons.error_outline_rounded,
        message: _error!,
        actionLabel: 'retry_btn'.tr,
        onAction: _load,
      );
    }

    if (_methods.isEmpty) {
      return _CheckoutSavedCardsNotice(
        key: const ValueKey('checkout-saved-cards-empty'),
        icon: Icons.credit_card_off_rounded,
        message: 'payment_methods_empty'.tr,
        actionLabel: 'payment_methods_add'.tr,
        actionLoading: _adding,
        onAction: _addCard,
      );
    }

    final selectedId = _preferredMethodId(_methods);
    final selected = _methods.firstWhere(
      (method) => method['id'] == selectedId,
      orElse: () => _methods.first,
    );
    return Material(
      key: const ValueKey('checkout-payment-method'),
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        side: BorderSide(color: colors.cardBorder),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        key: const ValueKey('checkout-choose-card'),
        onTap: _adding ? null : _chooseCard,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              Row(
                children: [
                  Icon(Icons.credit_card_outlined, color: colors.brandBrown),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'checkout_card_payment'.tr,
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  Icon(Icons.radio_button_checked, color: colors.brandBrown),
                ],
              ),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 14),
                child: Divider(height: 1, color: colors.cardBorder),
              ),
              _CheckoutCardIdentity(
                method: selected,
                trailing: _adding
                    ? const SizedBox.square(
                        dimension: 22,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Icon(
                        Icons.keyboard_arrow_down_rounded,
                        color: colors.brandBrown,
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _chooseCard() async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      builder: (sheetContext) => _CheckoutCardPicker(
        methods: _methods,
        selectedId: _preferredMethodId(_methods),
      ),
    );
    if (!mounted || selected == null) return;
    if (selected == 'add') {
      await _addCard();
    } else {
      widget.onSelect(selected);
    }
  }
}

class _CheckoutSavedCardsLimitNotice extends StatelessWidget {
  const _CheckoutSavedCardsLimitNotice({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Container(
      width: double.infinity,
      constraints: const BoxConstraints(minHeight: 48),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: colors.surfaceCream,
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        border: Border.all(color: colors.cardBorder),
      ),
      child: Row(
        children: [
          Icon(Icons.info_outline_rounded, color: colors.brandBrown, size: 22),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'payment_methods_limit_reached'.tr,
              style: TextStyle(
                color: colors.mutedText,
                fontSize: BulkaTypeScale.bodySmall,
                height: 1.3,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CheckoutSavedCardsNotice extends StatelessWidget {
  const _CheckoutSavedCardsNotice({
    super.key,
    required this.icon,
    required this.message,
    required this.actionLabel,
    required this.onAction,
    this.actionLoading = false,
  });

  final IconData icon;
  final String message;
  final String actionLabel;
  final VoidCallback onAction;
  final bool actionLoading;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: colors.surfaceCream,
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        border: Border.all(color: colors.cardBorder),
      ),
      child: Column(
        children: [
          Icon(icon, size: 34, color: colors.brandBrown),
          const SizedBox(height: 10),
          Text(
            message,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: colors.mutedText,
              fontSize: BulkaTypeScale.bodySmall,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: GradientButton(
              onPressed: actionLoading ? null : onAction,
              loading: actionLoading,
              child: Text(
                actionLabel,
                style: const TextStyle(
                  fontFamily: _headingFont,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
