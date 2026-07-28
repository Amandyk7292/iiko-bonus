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
  String? _busyMethodId;
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
        ).showSnackBar(SnackBar(content: Text('card_setup_cancelled'.tr)));
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
    try {
      for (var attempt = 0; attempt < 10; attempt++) {
        final result = await widget.api.checkForteCardSetupStatus(
          cardSetupReturn.operationId,
        );
        status = (result['paymentStatus'] ?? result['status'] ?? 'pending')
            .toString()
            .toLowerCase();
        if (const {'paid', 'failed', 'expired'}.contains(status)) break;
        await Future<void>.delayed(const Duration(seconds: 2));
      }
      await _load();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            status == 'paid'
                ? 'card_setup_success_hint'.tr
                : status == 'pending'
                ? 'card_setup_token_missing'.tr
                : 'card_setup_failed_hint'.tr,
          ),
        ),
      );
    } catch (_) {
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('card_setup_token_missing'.tr)));
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
    if (_busyMethodId != null) return;
    setState(() => _busyMethodId = id);
    try {
      await widget.api.setDefaultFortePaymentMethod(id);
      await widget.api.isFortePaymentAvailable();
      await _load();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('payment_methods_update_error'.tr)),
        );
      }
    } finally {
      if (mounted) setState(() => _busyMethodId = null);
    }
  }

  Future<void> _addCard() async {
    if (_adding || _busyMethodId != null) return;
    setState(() => _adding = true);
    try {
      final result = await widget.api.createForteCardSetup();
      final operationId = (result['operationId'] ?? '').toString();
      final redirectUrl = (result['redirectUrl'] ?? '').toString();
      if (operationId.isEmpty || redirectUrl.isEmpty) {
        throw ApiException('payment_methods_add_error'.tr);
      }
      if (!mounted) return;
      final saved = await Navigator.of(context).push<bool>(
        MaterialPageRoute(
          builder: (_) => FortePaymentScreen(
            api: widget.api,
            operationId: operationId,
            redirectUrl: redirectUrl,
            cardSetup: true,
          ),
        ),
      );
      if (saved == true) {
        await widget.api.isFortePaymentAvailable();
        await _load();
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

  Future<void> _remove(String id) async {
    if (_busyMethodId != null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
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
    setState(() => _busyMethodId = id);
    try {
      await widget.api.removeFortePaymentMethod(id);
      await _load();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('payment_methods_remove_error'.tr)),
        );
      }
    } finally {
      if (mounted) setState(() => _busyMethodId = null);
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
                          const SizedBox(height: 8),
                          Text(
                            'card_setup_verifying_hint'.tr,
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              color: colors.mutedText,
                              height: 1.4,
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
                        onPressed: _adding ? null : _addCard,
                        loading: _adding,
                        child: Text('payment_methods_add'.tr),
                      ),
                    ),
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
                        final busy = _busyMethodId == id;
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
                            leading: Icon(
                              Icons.credit_card_rounded,
                              color: colors.brandBrown,
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
        border: Border.all(color: colors.cardBorder),
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
