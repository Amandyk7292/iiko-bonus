part of '../main.dart';

class PaymentMethodsScreen extends StatefulWidget {
  const PaymentMethodsScreen({required this.api, super.key});

  final BulkaApiClient api;

  @override
  State<PaymentMethodsScreen> createState() => _PaymentMethodsScreenState();
}

class _PaymentMethodsScreenState extends State<PaymentMethodsScreen> {
  List<Map<String, dynamic>> _methods = const [];
  bool _loading = true;
  String? _error;
  final Set<String> _busyMethodIds = {};
  bool _defaultUpdateInFlight = false;
  bool _adding = false;
  bool _reconcilingReturn = false;

  @override
  void initState() {
    super.initState();
    final cardSetupReturn = forteCardSetupReturnFromUri(currentClientUri());
    if (cardSetupReturn == null) {
      unawaited(_load());
    } else {
      _reconcilingReturn = true;
      publishClientRoute(Uri(path: '/profile'), replace: true);
      unawaited(_reconcileCardSetupReturn(cardSetupReturn));
    }
  }

  Future<void> _reconcileCardSetupReturn(
    ({String operationId, ForteCheckoutReturn outcome}) cardSetupReturn,
  ) async {
    if (cardSetupReturn.outcome == ForteCheckoutReturn.cancelled) {
      _reconcilingReturn = false;
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(bulkaSnackBar(content: Text('card_setup_cancelled'.tr)));
      }
      return;
    }

    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    var status = 'pending';
    var cardSaved = false;
    String? refundStatus;
    try {
      for (var attempt = 0; attempt < 10; attempt++) {
        final result = await widget.api.checkForteCardSetupStatus(
          cardSetupReturn.operationId,
        );
        status = (result['paymentStatus'] ?? result['status'] ?? 'pending')
            .toString()
            .toLowerCase();
        cardSaved = result['cardSaved'] == true;
        refundStatus = result['refundStatus']?.toString().toLowerCase();
        if (cardSaved || const {'paid', 'failed', 'expired'}.contains(status)) {
          break;
        }
        await Future<void>.delayed(const Duration(seconds: 2));
      }
      await _load();
      if (!mounted) return;
      final refundComplete = const {
        'succeeded',
        'not_required',
      }.contains(refundStatus);
      ScaffoldMessenger.of(context).showSnackBar(
        bulkaSnackBar(
          content: Text(
            cardSaved && !refundComplete
                ? 'card_setup_saved_refund_pending'.tr
                : status == 'paid'
                ? 'card_setup_success'.tr
                : status == 'pending'
                ? 'card_setup_token_missing'.tr
                : 'card_setup_failed_hint'.tr,
          ),
        ),
      );
    } catch (_) {
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          bulkaSnackBar(content: Text('card_setup_token_missing'.tr)),
        );
      }
    } finally {
      if (mounted) setState(() => _reconcilingReturn = false);
    }
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final methods = await widget.api.getFortePaymentMethods();
      if (!mounted) return;
      setState(() => _methods = methods);
    } catch (_) {
      if (mounted) setState(() => _error = 'payment_methods_load_error'.tr);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _setDefault(String id) async {
    if (_defaultUpdateInFlight || _busyMethodIds.contains(id)) return;
    final previousDefaultId = _methods
        .where((method) => method['isDefault'] == true)
        .map((method) => (method['id'] ?? '').toString())
        .firstOrNull;
    setState(() {
      _defaultUpdateInFlight = true;
      _busyMethodIds.add(id);
      _methods = [
        for (final method in _methods)
          {...method, 'isDefault': (method['id'] ?? '').toString() == id},
      ];
    });
    try {
      await widget.api.setDefaultFortePaymentMethod(id);
      unawaited(widget.api.isFortePaymentAvailable().catchError((_) => false));
    } catch (_) {
      if (mounted) {
        setState(() {
          _methods = [
            for (final method in _methods)
              {
                ...method,
                'isDefault':
                    (method['id'] ?? '').toString() == previousDefaultId,
              },
          ];
        });
        ScaffoldMessenger.of(context).showSnackBar(
          bulkaSnackBar(content: Text('payment_methods_update_error'.tr)),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _defaultUpdateInFlight = false;
          _busyMethodIds.remove(id);
        });
      }
    }
  }

  Future<void> _addCard() async {
    if (_adding) return;
    if (_methods.length >= _maximumSavedPaymentMethods) {
      ScaffoldMessenger.of(context).showSnackBar(
        bulkaSnackBar(content: Text('payment_methods_limit_reached'.tr)),
      );
      return;
    }
    setState(() => _adding = true);
    try {
      final session = widget.api.sessionCacheScope;
      final result = await widget.api.createForteCardSetup();
      if (!mounted || session != widget.api.sessionCacheScope) return;
      if (result['paymentStatus'] == 'paid') {
        await _load();
        return;
      }
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
      if (setupResult?.paid == true) {
        await widget.api.isFortePaymentAvailable();
        await _load();
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          bulkaSnackBar(content: Text(_paymentMethodAddErrorMessage(error))),
        );
      }
    } finally {
      if (mounted) setState(() => _adding = false);
    }
  }

  Future<void> _remove(String id) async {
    if (_busyMethodIds.contains(id)) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => BulkaActionDialog(
        title: Text('payment_methods_remove_title'.tr),
        content: Text('payment_methods_remove_message'.tr),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text('cancel_btn'.tr),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text('delete_btn'.tr),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final removedIndex = _methods.indexWhere(
      (method) => (method['id'] ?? '').toString() == id,
    );
    if (removedIndex < 0) return;
    final removedMethod = Map<String, dynamic>.from(_methods[removedIndex]);
    setState(() {
      _busyMethodIds.add(id);
      _methods = [
        for (final method in _methods)
          if ((method['id'] ?? '').toString() != id) method,
      ];
    });
    try {
      await widget.api.removeFortePaymentMethod(id);
      unawaited(widget.api.isFortePaymentAvailable().catchError((_) => false));
    } catch (_) {
      if (mounted) {
        setState(() {
          if (_methods.any((method) => (method['id'] ?? '').toString() == id)) {
            return;
          }
          final restored = [..._methods];
          restored.insert(min(removedIndex, restored.length), removedMethod);
          _methods = restored;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          bulkaSnackBar(content: Text('payment_methods_remove_error'.tr)),
        );
      }
    } finally {
      if (mounted) setState(() => _busyMethodIds.remove(id));
    }
  }

  String _cardLabel(Map<String, dynamic> method) {
    final brand = (method['brand'] ?? 'card').toString().toUpperCase();
    final lastFour = (method['lastFour'] ?? '').toString();
    return '$brand •••• $lastFour';
  }

  String? _expiryLabel(Map<String, dynamic> method) {
    final month = int.tryParse('${method['expMonth'] ?? ''}');
    final year = int.tryParse('${method['expYear'] ?? ''}');
    if (month == null || year == null) return null;
    return '${month.toString().padLeft(2, '0')}/${(year % 100).toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final reachedLimit = _methods.length >= _maximumSavedPaymentMethods;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          tooltip: 'back_tooltip'.tr,
          onPressed: () => Navigator.of(context).pop(),
          icon: const Icon(Icons.arrow_back_rounded),
        ),
        title: _BulkaPageTitle('payment_methods_title'.tr),
      ),
      body: SafeArea(
        child: RefreshIndicator(
          color: colors.brandGold,
          onRefresh: _load,
          child: _loading
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(28),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const CircularProgressIndicator(),
                        if (_reconcilingReturn) ...[
                          const SizedBox(height: 20),
                          Text(
                            'card_setup_verifying'.tr,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              fontFamily: _headingFont,
                              fontSize: BulkaTypeScale.title,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                )
              : ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(20, 20, 20, 36),
                  children: [
                    SizedBox(
                      width: double.infinity,
                      child: GradientButton(
                        onPressed: _adding || reachedLimit ? null : _addCard,
                        loading: _adding,
                        child: Text('payment_methods_add'.tr),
                      ),
                    ),
                    if (reachedLimit) ...[
                      const SizedBox(height: 10),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(
                            Icons.info_outline_rounded,
                            size: 20,
                            color: colors.brandBrown,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'payment_methods_limit_reached'.tr,
                              style: TextStyle(
                                color: colors.mutedText,
                                fontSize: BulkaTypeScale.bodySmall,
                                height: 1.35,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                    const SizedBox(height: 20),
                    if (_error != null)
                      _PaymentMethodsEmpty(
                        icon: Icons.error_outline_rounded,
                        title: _error!,
                      )
                    else if (_methods.isEmpty)
                      _PaymentMethodsEmpty(
                        icon: Icons.credit_card_off_outlined,
                        title: 'payment_methods_empty'.tr,
                      )
                    else
                      ..._methods.map((method) {
                        final id = (method['id'] ?? '').toString();
                        final isDefault = method['isDefault'] == true;
                        final expiry = _expiryLabel(method);
                        final busy = _busyMethodIds.contains(id);
                        return Container(
                          margin: const EdgeInsets.only(bottom: 12),
                          decoration: BoxDecoration(
                            color: colors.surfaceCream,
                            borderRadius: BorderRadius.circular(
                              BulkaRadii.control,
                            ),
                            border: Border.all(
                              color: isDefault
                                  ? colors.brandGold
                                  : colors.cardBorder,
                              width: isDefault ? 1.6 : 1,
                            ),
                          ),
                          child: ListTile(
                            minVerticalPadding: 14,
                            leading: _PaymentBrandMark(
                              brand: (method['brand'] ?? '').toString(),
                            ),
                            title: Text(
                              _cardLabel(method),
                              style: const TextStyle(
                                fontFamily: _headingFont,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            subtitle: Text(
                              [
                                if (expiry != null)
                                  '${'payment_methods_expiry'.tr} $expiry',
                                if (isDefault) 'payment_methods_default'.tr,
                              ].join(' · '),
                            ),
                            trailing: busy
                                ? const SizedBox.square(
                                    dimension: 22,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : PopupMenuButton<String>(
                                    onSelected: (action) {
                                      if (action == 'default') {
                                        unawaited(_setDefault(id));
                                      } else if (action == 'remove') {
                                        unawaited(_remove(id));
                                      }
                                    },
                                    itemBuilder: (_) => [
                                      if (!isDefault)
                                        PopupMenuItem(
                                          value: 'default',
                                          child: Text(
                                            'payment_methods_make_default'.tr,
                                          ),
                                        ),
                                      PopupMenuItem(
                                        value: 'remove',
                                        child: Text(
                                          'payment_methods_remove'.tr,
                                        ),
                                      ),
                                    ],
                                  ),
                          ),
                        );
                      }),
                  ],
                ),
        ),
      ),
    );
  }
}

class _PaymentBrandMark extends StatelessWidget {
  const _PaymentBrandMark({required this.brand});

  final String brand;

  String get _normalized =>
      brand.trim().toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '');

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final value = _normalized;
    final Widget mark;
    if (value.contains('visa')) {
      mark = const Text(
        'VISA',
        key: ValueKey('payment-brand-visa'),
        style: TextStyle(
          color: Color(0xFF1434CB),
          fontSize: 14,
          fontWeight: FontWeight.w900,
          fontStyle: FontStyle.italic,
          letterSpacing: -0.8,
        ),
      );
    } else if (value.contains('mastercard') || value == 'mc') {
      mark = const _OverlappingCardCircles(
        key: ValueKey('payment-brand-mastercard'),
        left: Color(0xFFEB001B),
        right: Color(0xFFF79E1B),
      );
    } else if (value.contains('maestro')) {
      mark = const _OverlappingCardCircles(
        key: ValueKey('payment-brand-maestro'),
        left: Color(0xFF0099DF),
        right: Color(0xFFED1C24),
      );
    } else if (value.contains('unionpay')) {
      mark = const _PaymentBrandWordmark(
        key: ValueKey('payment-brand-unionpay'),
        label: 'UP',
        background: Color(0xFF0066B3),
        foreground: Colors.white,
      );
    } else if (value.contains('amex') || value.contains('americanexpress')) {
      mark = const _PaymentBrandWordmark(
        key: ValueKey('payment-brand-amex'),
        label: 'AMEX',
        background: Color(0xFF006FCF),
        foreground: Colors.white,
      );
    } else if (value == 'mir') {
      mark = const _PaymentBrandWordmark(
        key: ValueKey('payment-brand-mir'),
        label: 'MIR',
        background: Color(0xFF128F55),
        foreground: Colors.white,
      );
    } else {
      mark = Icon(
        Icons.credit_card_rounded,
        key: const ValueKey('payment-brand-generic'),
        color: colors.brandBrown,
        size: 24,
      );
    }
    return Semantics(
      label: brand.trim().isEmpty ? 'payment_methods_card'.tr : brand,
      image: true,
      child: Container(
        key: const ValueKey('payment-brand-mark'),
        width: 42,
        height: 30,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: colors.cardBorder,
            width: BulkaStrokes.hairline,
          ),
        ),
        child: mark,
      ),
    );
  }
}

class _OverlappingCardCircles extends StatelessWidget {
  const _OverlappingCardCircles({
    required this.left,
    required this.right,
    super.key,
  });

  final Color left;
  final Color right;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 28,
    height: 18,
    child: Stack(
      children: [
        Positioned(left: 1, child: _CardCircle(color: left)),
        Positioned(right: 1, child: _CardCircle(color: right)),
      ],
    ),
  );
}

class _CardCircle extends StatelessWidget {
  const _CardCircle({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    width: 18,
    height: 18,
    decoration: BoxDecoration(color: color, shape: BoxShape.circle),
  );
}

class _PaymentBrandWordmark extends StatelessWidget {
  const _PaymentBrandWordmark({
    required this.label,
    required this.background,
    required this.foreground,
    super.key,
  });

  final String label;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) => Container(
    constraints: const BoxConstraints(minWidth: 28),
    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 3),
    decoration: BoxDecoration(
      color: background,
      borderRadius: BorderRadius.circular(4),
    ),
    child: Text(
      label,
      textAlign: TextAlign.center,
      style: TextStyle(
        color: foreground,
        fontSize: label.length > 2 ? 8 : 10,
        fontWeight: FontWeight.w900,
        height: 1,
      ),
    ),
  );
}

class _PaymentMethodsEmpty extends StatelessWidget {
  const _PaymentMethodsEmpty({required this.icon, required this.title});

  final IconData icon;
  final String title;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 34),
      decoration: BoxDecoration(
        color: colors.surfaceCream,
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        border: Border.all(
          color: colors.cardBorder,
          width: BulkaStrokes.hairline,
        ),
      ),
      child: Column(
        children: [
          Icon(icon, size: 54, color: colors.mutedText),
          const SizedBox(height: 14),
          Text(
            title,
            textAlign: TextAlign.center,
            style: TextStyle(color: colors.mutedText, height: 1.4),
          ),
        ],
      ),
    );
  }
}
