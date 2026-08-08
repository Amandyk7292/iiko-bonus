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
}) {
  return _CheckoutSavedCardsPanel(
    api: api,
    available: true,
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

  @override
  void initState() {
    super.initState();
    if (widget.available == true) unawaited(_load());
  }

  @override
  void didUpdateWidget(covariant _CheckoutSavedCardsPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.available == true && oldWidget.available != true) {
      unawaited(_load());
    }
    if (widget.available != true &&
        oldWidget.available == true &&
        _methods.isNotEmpty) {
      setState(() {
        _methods = const [];
        _error = null;
      });
      _resolveDefault(null);
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
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final methods = (await widget.api.getFortePaymentMethods())
          .where((method) => (method['id'] ?? '').toString().isNotEmpty)
          .take(_maximumSavedPaymentMethods)
          .toList(growable: false);
      if (!mounted) return;
      setState(() => _methods = methods);
      _resolveDefault(_preferredMethodId(methods));
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'payment_methods_load_error'.tr);
      _resolveDefault(null);
    } finally {
      if (mounted) setState(() => _loading = false);
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
    if (widget.available == null || _loading) {
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

    if (widget.available != true) {
      return _CheckoutSavedCardsNotice(
        key: const ValueKey('checkout-saved-cards-unavailable'),
        icon: Icons.error_outline_rounded,
        message: 'checkout_forte_unavailable'.tr,
        actionLabel: 'retry_btn'.tr,
        onAction: widget.onRetryAvailability,
      );
    }

    if (_error != null) {
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

    return Column(
      children: [
        ..._methods.map((method) {
          final id = (method['id'] ?? '').toString();
          return Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: _CheckoutSavedCardTile(
              method: method,
              selected: widget.selectedMethodId == id,
              onTap: () => widget.onSelect(id),
            ),
          );
        }),
        if (_methods.length < _maximumSavedPaymentMethods)
          SizedBox(
            width: double.infinity,
            height: 52,
            child: OutlinedButton.icon(
              key: const ValueKey('checkout-add-saved-card'),
              onPressed: _adding ? null : _addCard,
              icon: _adding
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.add_card_rounded),
              label: Text(
                'payment_methods_add'.tr,
                style: const TextStyle(
                  fontFamily: _headingFont,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          )
        else
          const _CheckoutSavedCardsLimitNotice(
            key: ValueKey('checkout-saved-cards-limit'),
          ),
      ],
    );
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

class _CheckoutSavedCardTile extends StatelessWidget {
  const _CheckoutSavedCardTile({
    required this.method,
    required this.selected,
    required this.onTap,
  });

  final Map<String, dynamic> method;
  final bool selected;
  final VoidCallback onTap;

  String get _id => (method['id'] ?? '').toString();

  String get _cardLabel {
    final brand = (method['brand'] ?? 'card').toString().trim().toUpperCase();
    final lastFour = (method['lastFour'] ?? '').toString().trim();
    return '$brand •••• $lastFour';
  }

  String get _details {
    final month = int.tryParse('${method['expMonth'] ?? ''}');
    final year = int.tryParse('${method['expYear'] ?? ''}');
    final values = <String>[];
    if (month != null && year != null) {
      values.add(
        '${'payment_methods_expiry'.tr} '
        '${month.toString().padLeft(2, '0')}/'
        '${(year % 100).toString().padLeft(2, '0')}',
      );
    }
    if (method['isDefault'] == true) {
      values.add('payment_methods_default'.tr);
    }
    return values.join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    final details = _details;
    return Semantics(
      button: true,
      selected: selected,
      label: details.isEmpty ? _cardLabel : '$_cardLabel. $details',
      onTap: onTap,
      excludeSemantics: true,
      child: Material(
        key: ValueKey('checkout-saved-card-surface-$_id'),
        color: selected ? scheme.secondaryContainer : scheme.surface,
        animationDuration: const Duration(milliseconds: 180),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(BulkaRadii.control),
          side: BorderSide(
            color: selected ? colors.brandBrown : colors.cardBorder,
            width: selected ? 2 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          key: ValueKey('checkout-saved-card-$_id'),
          onTap: onTap,
          excludeFromSemantics: true,
          child: Container(
            width: double.infinity,
            constraints: const BoxConstraints(minHeight: 78),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
            child: Row(
              children: [
                Container(
                  width: 46,
                  height: 42,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: colors.cardBorder),
                  ),
                  child: Icon(
                    Icons.credit_card_rounded,
                    color: colors.brandBrown,
                    size: 24,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        _cardLabel,
                        style: const TextStyle(
                          fontFamily: _headingFont,
                          fontSize: BulkaTypeScale.body,
                          fontWeight: FontWeight.w700,
                          color: _textDark,
                        ),
                      ),
                      if (details.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(
                          details,
                          style: TextStyle(
                            color: colors.mutedText,
                            fontSize: BulkaTypeScale.caption,
                            height: 1.25,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                Icon(
                  selected
                      ? Icons.check_circle_rounded
                      : Icons.radio_button_unchecked_rounded,
                  color: selected ? colors.brandBrown : colors.mutedText,
                  size: 24,
                ),
              ],
            ),
          ),
        ),
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
