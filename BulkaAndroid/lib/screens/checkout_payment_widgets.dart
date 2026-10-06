part of '../main.dart';

const int _maximumSavedPaymentMethods = 3;

String _paymentMethodAddErrorMessage(Object error) {
  if (error is ApiException && error.code == 'CARD_SETUP_CANCEL_UNAVAILABLE') {
    return 'card_setup_cancel_error'.tr;
  }
  if (error is ApiException &&
      error.code == 'FORTE_WIDGET_PAYMENT_METHOD_LIMIT') {
    return 'payment_methods_limit_reached'.tr;
  }
  if (error is ApiException && error.code == 'FORTE_WIDGET_CHECKOUT_DISABLED') {
    return 'payment_methods_add_unavailable'.tr;
  }
  if (error is ApiException && error.code == 'CARD_SETUP_CLOSED') {
    return 'card_setup_failed_hint'.tr;
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
  bool compact = false,
  bool personalAccountSelected = false,
  ValueChanged<bool>? onPersonalAccountAvailable,
  VoidCallback? onSelectPersonalAccount,
}) {
  return _CheckoutSavedCardsPanel(
    api: api,
    available: available,
    selectedMethodId: selectedMethodId,
    onDefaultResolved: onDefaultResolved,
    onSelect: onSelect,
    onActivate: () {},
    onRetryAvailability: () {},
    compact: compact,
    active: !personalAccountSelected,
    onPersonalAccountAvailable: onPersonalAccountAvailable,
    onSelectPersonalAccount: onSelectPersonalAccount,
  );
}

class _CheckoutDetails {
  const _CheckoutDetails({
    required this.checkoutId,
    required this.orderType,
    required this.scheduledAt,
    this.paymentMethod = 'forte_card',
    this.expectedTotal,
    this.savedPaymentMethodId,
    this.useBonuses = false,
    this.bonusSpent = 0,
    this.deliveryQuoteToken,
    this.preorderFulfillmentType,
    this.branch,
    this.branchId,
    this.deliveryAddress,
    this.promoCode,
    this.comment,
    this.pickupPhotoId,
  });

  final String checkoutId;
  final String paymentMethod;
  final double? expectedTotal;
  final _OrderType orderType;
  final String? scheduledAt;
  final String? savedPaymentMethodId;
  final bool useBonuses;
  final int bonusSpent;
  final String? deliveryQuoteToken;
  final String? preorderFulfillmentType;
  final String? branch;
  final String? branchId;
  final DeliveryAddress? deliveryAddress;
  final String? promoCode;
  final String? comment;
  final String? pickupPhotoId;
}

class _CheckoutSavedCardsPanel extends StatefulWidget {
  const _CheckoutSavedCardsPanel({
    required this.api,
    required this.available,
    required this.selectedMethodId,
    required this.onDefaultResolved,
    required this.onSelect,
    required this.onActivate,
    required this.onRetryAvailability,
    this.active = true,
    this.compact = false,
    this.onPersonalAccountAvailable,
    this.onSelectPersonalAccount,
    this.busy = false,
    this.onBusyChanged,
  });

  final BulkaApiClient api;
  final bool? available;
  final String? selectedMethodId;
  final ValueChanged<String?> onDefaultResolved;
  final ValueChanged<String> onSelect;
  final VoidCallback onActivate;
  final VoidCallback onRetryAvailability;
  final bool active;
  final bool compact;
  final ValueChanged<bool>? onPersonalAccountAvailable;
  final VoidCallback? onSelectPersonalAccount;
  final bool busy;
  final ValueChanged<bool>? onBusyChanged;

  @override
  State<_CheckoutSavedCardsPanel> createState() =>
      _CheckoutSavedCardsPanelState();
}

class _CheckoutSavedCardsPanelState extends State<_CheckoutSavedCardsPanel> {
  late _LiveRefresh _live;
  List<Map<String, dynamic>> _methods = const [];
  bool _loading = false;
  bool _adding = false;
  String? _error;
  String? _sessionScope;
  int _loadRevision = 0;
  _LiveRefresh? _accountLive;
  final _pickerRevision = ValueNotifier(0);
  bool _pickerRefreshQueued = false;
  Map<String, dynamic>? _account;
  String? _accountError;
  bool _accountLoading = false;
  int _accountLoadRevision = 0;

  @override
  void initState() {
    super.initState();
    _sessionScope = widget.api.sessionCacheScope;
    _bindLive();
    if (widget.available == true) unawaited(_load());
  }

  void _bindLive() {
    _live = _LiveRefresh(widget.api, {'payment.methods.updated'}, () async {
      if ((widget.active || widget.compact) && !_adding) await _load();
    });
    if (widget.compact) {
      _accountLive = _LiveRefresh(
        widget.api,
        {'personal-account.updated'},
        _loadAccount,
        busy: () => _accountLoading,
      )..request(immediate: true);
    }
  }

  @override
  void dispose() {
    _live.dispose();
    _accountLive?.dispose();
    _pickerRevision.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant _CheckoutSavedCardsPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.api != widget.api) {
      _live.dispose();
      _accountLive?.dispose();
      _bindLive();
    }
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
      if (sessionChanged) {
        _accountLoadRevision++;
        _account = null;
        _accountError = null;
        _accountLoading = false;
        _accountLive?.request(immediate: true);
      }
      _resolveDefault(null);
    }
    if (widget.available == true &&
        (sessionChanged ||
            oldWidget.available == false ||
            (oldWidget.available == null && _methods.isEmpty))) {
      unawaited(_load());
    }
    _notifyPicker();
  }

  void _setPaymentState(VoidCallback update) {
    setState(update);
    _notifyPicker();
  }

  void _notifyPicker() {
    if (_pickerRefreshQueued) return;
    _pickerRefreshQueued = true;
    // A payment availability update can arrive while the checkout is building.
    // The sheet belongs to another route, so notify it after that frame.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _pickerRefreshQueued = false;
      if (mounted) _pickerRevision.value++;
    });
  }

  Future<void> _loadAccount() async {
    if (!widget.compact || _accountLoading) return;
    final revision = ++_accountLoadRevision;
    final session = widget.api.sessionCacheScope;
    _setPaymentState(() => _accountLoading = true);
    try {
      final account = await widget.api.getPersonalAccount();
      if (!mounted ||
          revision != _accountLoadRevision ||
          session != widget.api.sessionCacheScope) {
        return;
      }
      _setPaymentState(() {
        _account = account;
        _accountError = null;
      });
      widget.onPersonalAccountAvailable?.call(
        account['enabled'] == true && account['blocked'] != true,
      );
    } catch (error) {
      if (!mounted ||
          revision != _accountLoadRevision ||
          session != widget.api.sessionCacheScope) {
        return;
      }
      _setPaymentState(() => _accountError = localizeErrorMessage(error));
      if (_account == null) widget.onPersonalAccountAvailable?.call(false);
      rethrow;
    } finally {
      if (mounted && revision == _accountLoadRevision) {
        _setPaymentState(() => _accountLoading = false);
      }
    }
  }

  void _resolveDefault(String? methodId) {
    final revision = _loadRevision;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && revision == _loadRevision) {
        widget.onDefaultResolved(methodId);
      }
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
    _setPaymentState(() {
      _loading = true;
      _error = null;
    });
    try {
      final methods = (await widget.api.getFortePaymentMethods())
          .where((method) => (method['id'] ?? '').toString().isNotEmpty)
          .take(_maximumSavedPaymentMethods)
          .toList(growable: false);
      if (!mounted || revision != _loadRevision) return;
      _setPaymentState(() => _methods = methods);
      _resolveDefault(_preferredMethodId(methods));
    } catch (_) {
      if (!mounted || revision != _loadRevision) return;
      _setPaymentState(() => _error = 'payment_methods_load_error'.tr);
      if (_methods.isEmpty) _resolveDefault(null);
    } finally {
      if (mounted && revision == _loadRevision) {
        _setPaymentState(() => _loading = false);
      }
    }
  }

  Future<void> _addCard() async {
    if (_adding || _loading || widget.busy) return;
    if (_methods.length >= _maximumSavedPaymentMethods) {
      ScaffoldMessenger.of(context).showSnackBar(
        bulkaSnackBar(content: Text('payment_methods_limit_reached'.tr)),
      );
      return;
    }
    final previousIds = _methods
        .map((method) => (method['id'] ?? '').toString())
        .toSet();
    _setPaymentState(() => _adding = true);
    widget.onBusyChanged?.call(true);
    try {
      final session = widget.api.sessionCacheScope;
      final result = await PendingCardSetupStore.createOrResume(widget.api);
      if (!mounted || session != widget.api.sessionCacheScope) return;
      if (result['paymentStatus'] == 'paid') {
        await _load();
        _selectAddedCard(previousIds);
        return;
      }
      if (isTerminalForteFailure((result['paymentStatus'] ?? '').toString())) {
        throw ApiException(
          'card_setup_failed_hint'.tr,
          code: 'CARD_SETUP_CLOSED',
        );
      }
      final operationId = (result['operationId'] ?? '').toString();
      final redirectUrl = (result['redirectUrl'] ?? '').toString();
      if (operationId.isNotEmpty &&
          (result['canResume'] == false || result['cancelled'] == true)) {
        await PendingCardSetupStore.cancel(widget.api, operationId);
        throw ApiException(
          'card_setup_failed_hint'.tr,
          code: 'CARD_SETUP_CLOSED',
        );
      }
      if (operationId.isEmpty || redirectUrl.isEmpty) {
        throw ApiException('payment_methods_add_error'.tr);
      }
      if (!mounted || widget.busy) return;
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
      if (!mounted || session != widget.api.sessionCacheScope) return;
      if (setupResult == null || setupResult.cancelCardSetup) {
        final cancelled = await PendingCardSetupStore.cancel(
          widget.api,
          operationId,
        );
        if (!mounted || session != widget.api.sessionCacheScope) return;
        if (cancelled['cardSaved'] == true ||
            cancelled['paymentStatus'] == 'paid') {
          await _load();
          _selectAddedCard(previousIds);
        }
        return;
      }
      if (setupResult.outcome != FortePaymentOutcome.pending) {
        await PendingCardSetupStore.clear(widget.api, operationId);
      }
      if (!setupResult.paid || !mounted) return;
      await _load();
      if (!mounted) return;
      _selectAddedCard(previousIds);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          bulkaSnackBar(content: Text(_paymentMethodAddErrorMessage(error))),
        );
      }
    } finally {
      if (mounted) {
        _setPaymentState(() => _adding = false);
        widget.onBusyChanged?.call(false);
      }
    }
  }

  void _selectAddedCard(Set<String> previousIds) {
    if (!mounted || widget.busy) return;
    final added = _methods.where(
      (method) => !previousIds.contains((method['id'] ?? '').toString()),
    );
    final selectedId = added.isEmpty
        ? _preferredMethodId(_methods)
        : (added.first['id'] ?? '').toString();
    if (selectedId != null && selectedId.isNotEmpty) {
      widget.onSelect(selectedId);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    if (widget.compact) return _buildCompactSelector(context);
    if (!widget.active) {
      return Material(
        key: const ValueKey('checkout-card-payment-choice'),
        color: colors.surfaceCream,
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        child: InkWell(
          onTap: widget.onActivate,
          borderRadius: BorderRadius.circular(BulkaRadii.control),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(
              children: [
                Icon(
                  Icons.radio_button_off_rounded,
                  color: colors.brandBrown,
                  size: 22,
                ),
                const SizedBox(width: 10),
                Icon(
                  Icons.credit_card_outlined,
                  color: colors.brandBrown,
                  size: 22,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'checkout_card_payment'.tr,
                    style: const TextStyle(
                      fontSize: BulkaTypeScale.body,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                Icon(
                  Icons.chevron_right_rounded,
                  color: colors.mutedText,
                  size: 22,
                ),
              ],
            ),
          ),
        ),
      );
    }
    if (_methods.isEmpty && (widget.available == null || _loading)) {
      return Container(
        key: const ValueKey('checkout-saved-cards-loading'),
        width: double.infinity,
        constraints: const BoxConstraints(minHeight: 88),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        decoration: BoxDecoration(
          color: colors.surfaceCream,
          borderRadius: BorderRadius.circular(BulkaRadii.control),
          border: Border.all(
            color: colors.cardBorder,
            width: BulkaStrokes.hairline,
          ),
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

    if (widget.available == true && !widget.api.forteCardSetupAvailable) {
      return Padding(
        key: const ValueKey('checkout-hosted-payment'),
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(Icons.credit_card_outlined, color: colors.brandBrown),
            const SizedBox(width: 12),
            Expanded(child: Text('checkout_hosted_payment_hint'.tr)),
          ],
        ),
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
        side: BorderSide(
          color: colors.cardBorder,
          width: BulkaStrokes.hairline,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        key: const ValueKey('checkout-choose-card'),
        onTap: _adding ? null : _chooseCard,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          child: Column(
            children: [
              Row(
                children: [
                  Icon(Icons.credit_card_outlined, color: colors.brandBrown),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'checkout_card_payment'.tr,
                      style: const TextStyle(
                        fontSize: BulkaTypeScale.body,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  Icon(
                    widget.active
                        ? Icons.radio_button_checked
                        : Icons.radio_button_off,
                    color: colors.brandBrown,
                  ),
                ],
              ),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
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

  Widget _buildCompactSelector(BuildContext context) {
    final colors = context.bulkaColors;
    final selectedId = _preferredMethodId(_methods);
    final selected = _methods.where((method) => method['id'] == selectedId);
    final hasCard = widget.active && selected.isNotEmpty;
    final label = !widget.active
        ? _accountText('title')
        : hasCard
        ? '•••• ${selected.first['lastFour'] ?? ''}'
        : 'checkout_card_payment'.tr;
    return Semantics(
      key: const ValueKey('checkout-payment-selector'),
      button: true,
      label: '${'checkout_payment_title'.tr}: $label',
      child: Material(
        color: colors.surfaceCream,
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        child: InkWell(
          key: const ValueKey('checkout-choose-card'),
          borderRadius: BorderRadius.circular(BulkaRadii.control),
          onTap: _adding || widget.busy ? null : _chooseCard,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 48),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (_adding ||
                      (widget.active &&
                          _methods.isEmpty &&
                          (widget.available == null || _loading)))
                    SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: colors.brandGold,
                      ),
                    )
                  else
                    Icon(
                      widget.active
                          ? _methods.isEmpty &&
                                    widget.api.forteCardSetupAvailable
                                ? Icons.credit_card_off_rounded
                                : Icons.credit_card_outlined
                          : Icons.account_balance_wallet_outlined,
                      color: colors.brandBrown,
                      size: 22,
                    ),
                  const SizedBox(width: 9),
                  Flexible(
                    child: Text(
                      label,
                      maxLines: 2,
                      style: TextStyle(
                        color: colors.brandBrown,
                        fontWeight: FontWeight.w600,
                        fontSize: BulkaTypeScale.bodySmall,
                      ),
                    ),
                  ),
                  const SizedBox(width: 7),
                  Icon(
                    Icons.keyboard_arrow_down_rounded,
                    color: colors.brandBrown,
                    size: 19,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _chooseCard() async {
    if (widget.busy) return;
    final selected = await showModalBottomSheet<String>(
      context: context,
      sheetAnimationStyle: BulkaMotion.sheetStyle(context),
      isScrollControlled: true,
      backgroundColor: Colors.white,
      builder: (sheetContext) => ValueListenableBuilder<int>(
        valueListenable: _pickerRevision,
        builder: (context, _, child) => _CheckoutCardPicker(
          methods: _methods,
          selectedId: widget.active ? _preferredMethodId(_methods) : null,
          includePaymentMethods: widget.compact,
          personalAccount: _account,
          personalAccountSelected: !widget.active,
          personalAccountError: _accountError,
          personalAccountLoading: _accountLoading,
          cardsAvailable: widget.available,
          cardsLoading: _loading,
          cardsError: _error,
          hostedCardPayment: !widget.api.forteCardSetupAvailable,
        ),
      ),
    );
    if (!mounted || selected == null || widget.busy) return;
    if (selected == 'add') {
      await _addCard();
    } else if (selected == 'personal-account') {
      if (_account?['enabled'] == true && _account?['blocked'] != true) {
        widget.onSelectPersonalAccount?.call();
      }
    } else if (selected == 'topup') {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => PersonalAccountScreen(
            api: widget.api,
            initialBalance: _asDouble(_account?['balance']),
          ),
        ),
      );
      if (mounted) _accountLive?.request(immediate: true);
    } else if (selected == 'retry-account') {
      _accountLive?.request(immediate: true);
    } else if (selected == 'retry-cards') {
      if (widget.available == true) {
        unawaited(_load());
      } else {
        widget.onRetryAvailability();
      }
    } else if (selected == 'hosted-card') {
      widget.onActivate();
    } else {
      if (_methods.any((method) => method['id'] == selected) &&
          widget.available == true) {
        widget.onSelect(selected);
      }
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
        border: Border.all(
          color: colors.cardBorder,
          width: BulkaStrokes.hairline,
        ),
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
        border: Border.all(
          color: colors.cardBorder,
          width: BulkaStrokes.hairline,
        ),
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
