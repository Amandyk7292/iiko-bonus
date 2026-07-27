part of '../main.dart';

enum ForteCheckoutReturn { cancelled, completed }

@visibleForTesting
bool supportsEmbeddedForteCheckout({
  required bool isWeb,
  required TargetPlatform platform,
}) {
  return !isWeb &&
      (platform == TargetPlatform.android || platform == TargetPlatform.iOS);
}

@visibleForTesting
ForteCheckoutReturn? forteCheckoutReturnFromUri(Uri uri) {
  final path = uri.path.replaceFirst(RegExp(r'/+$'), '');
  if (uri.scheme.toLowerCase() != 'https' ||
      uri.host.toLowerCase() != 'bulka.com.kz' ||
      !const {'/orders', '/profile'}.contains(path)) {
    return null;
  }

  String? queryValue(String key) {
    for (final entry in uri.queryParameters.entries) {
      if (entry.key.toLowerCase() == key.toLowerCase()) return entry.value;
    }
    return null;
  }

  if ((queryValue('payment') ?? '').toLowerCase() != 'forte') return null;
  final orderId = queryValue(path == '/profile' ? 'setup' : 'order') ?? '';
  if (!RegExp(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    caseSensitive: false,
  ).hasMatch(orderId)) {
    return null;
  }

  final status = (queryValue('status') ?? '').toLowerCase().replaceAll(
    RegExp('[^a-z]'),
    '',
  );
  if (const {
    'cancelled',
    'canceled',
    'cancelledbyuser',
    'canceledbyuser',
  }.contains(status)) {
    return ForteCheckoutReturn.cancelled;
  }
  return ForteCheckoutReturn.completed;
}

@visibleForTesting
String forteCheckoutAcceptLanguage(String languageCode) {
  return switch (languageCode.toLowerCase()) {
    'kk' => 'kk-KZ,kk;q=1.0,ru;q=0.8',
    'en' => 'en-US,en;q=1.0,ru;q=0.6',
    _ => 'ru-RU,ru;q=1.0',
  };
}

@visibleForTesting
bool isAllowedForteCheckoutUri(Uri uri) {
  if (uri.scheme.toLowerCase() != 'https' ||
      uri.userInfo.isNotEmpty ||
      (uri.hasPort && uri.port != 443)) {
    return false;
  }
  final host = uri.host.toLowerCase();
  if (host == 'ecom.fortebank.com') {
    return uri.path == '/flex/' && uri.fragment.isEmpty;
  }
  if (host == 'bulka.com.kz') {
    return uri.path == '/payments/forte-widget' &&
        uri.query.isEmpty &&
        uri.fragment.isNotEmpty;
  }
  return false;
}

class FortePaymentScreen extends StatefulWidget {
  const FortePaymentScreen({
    required this.api,
    required this.operationId,
    required this.redirectUrl,
    this.cardSetup = false,
    super.key,
  });

  final BulkaApiClient api;
  final String operationId;
  final String redirectUrl;
  final bool cardSetup;

  @override
  State<FortePaymentScreen> createState() => _FortePaymentScreenState();
}

class _FortePaymentScreenState extends State<FortePaymentScreen> {
  Timer? _timer;
  final DateTime _deadline = DateTime.now().add(const Duration(minutes: 30));
  String _paymentStatus = 'pending';
  String? _checkoutError;
  String? _statusError;
  bool _checking = false;
  bool _opening = false;
  bool _embeddedCheckoutVisible = false;
  bool _checkoutReturned = false;
  bool _cancelledByCustomer = false;
  int _loadingProgress = 0;

  Uri? get _checkoutUri {
    final uri = Uri.tryParse(widget.redirectUrl);
    return uri != null && isAllowedForteCheckoutUri(uri) ? uri : null;
  }

  bool get _supportsEmbeddedCheckout => supportsEmbeddedForteCheckout(
    isWeb: kIsWeb,
    platform: defaultTargetPlatform,
  );

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(
      const Duration(seconds: 3),
      (_) => unawaited(_checkStatus()),
    );
    unawaited(_checkStatus());
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_startCheckout());
    });
  }

  Future<void> _checkStatus() async {
    if (_checking || !mounted) return;
    if (DateTime.now().isAfter(_deadline)) {
      _timer?.cancel();
      setState(() => _statusError = 'payment_timeout'.tr);
      return;
    }
    _checking = true;
    try {
      final result = widget.cardSetup
          ? await widget.api.checkForteCardSetupStatus(widget.operationId)
          : await widget.api.checkFortePaymentStatus(widget.operationId);
      if (!mounted) return;
      final status = (result['paymentStatus'] ?? result['status'] ?? 'pending')
          .toString()
          .toLowerCase();
      setState(() {
        _paymentStatus = status;
        if (status == 'paid') _cancelledByCustomer = false;
        _statusError = null;
      });
      if (['paid', 'failed', 'expired'].contains(_paymentStatus)) {
        _timer?.cancel();
      }
    } catch (_) {
      // Temporary network failures are retried until the deadline.
    } finally {
      _checking = false;
    }
  }

  Future<void> _startCheckout() async {
    final uri = _checkoutUri;
    if (uri == null) {
      setState(() => _checkoutError = 'forte_checkout_invalid'.tr);
      return;
    }
    if (_supportsEmbeddedCheckout) {
      setState(() {
        _checkoutError = null;
        _embeddedCheckoutVisible = true;
        _loadingProgress = 0;
        _opening = true;
      });
      return;
    }
    await _openHostedCheckout();
  }

  Future<void> _openHostedCheckout() async {
    if (_opening) return;
    final uri = _checkoutUri;
    if (uri == null) {
      setState(() => _checkoutError = 'forte_checkout_invalid'.tr);
      return;
    }
    setState(() {
      _opening = true;
      _checkoutError = null;
    });
    try {
      final opened = await launchUrl(
        uri,
        mode: kIsWeb ? LaunchMode.platformDefault : LaunchMode.inAppBrowserView,
        browserConfiguration: const BrowserConfiguration(showTitle: false),
        webOnlyWindowName: kIsWeb ? '_self' : null,
      );
      if (!opened && mounted) {
        setState(() => _checkoutError = 'forte_payment_open_failed'.tr);
      }
    } catch (_) {
      if (mounted) {
        setState(() => _checkoutError = 'forte_payment_open_failed'.tr);
      }
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  Future<bool> _openExternalCheckoutUri(Uri uri) async {
    final blockedSchemes = {'javascript', 'file', 'data', 'blob', 'about'};
    if (uri.scheme.isEmpty ||
        blockedSchemes.contains(uri.scheme.toLowerCase())) {
      return false;
    }
    try {
      return await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      return false;
    }
  }

  void _handleCheckoutReturn(Uri uri) {
    if (_checkoutReturned) return;
    final result = forteCheckoutReturnFromUri(uri);
    if (result == null) return;
    setState(() {
      _checkoutReturned = true;
      _embeddedCheckoutVisible = false;
      _opening = false;
      _loadingProgress = 100;
      _checkoutError = null;
      _cancelledByCustomer = result == ForteCheckoutReturn.cancelled;
    });
    if (_cancelledByCustomer) _timer?.cancel();
    unawaited(_checkStatus());
  }

  void _handleEmbeddedReady() {
    if (!mounted) return;
    setState(() {
      _opening = false;
      _loadingProgress = 100;
    });
  }

  void _handleEmbeddedUnavailable() {
    if (!mounted || _checkoutReturned) return;
    setState(() {
      _embeddedCheckoutVisible = false;
      _opening = false;
      _checkoutError = 'forte_payment_embed_failed'.tr;
    });
  }

  void _showExternalOpenError() {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('forte_external_app_failed'.tr)));
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final paid = _paymentStatus == 'paid';
    final terminalFailure =
        _cancelledByCustomer ||
        _paymentStatus == 'failed' ||
        _paymentStatus == 'expired';
    final verifying = _checkoutReturned && !paid && !terminalFailure;
    final showEmbeddedCheckout =
        _embeddedCheckoutVisible && !paid && !terminalFailure;
    final title = widget.cardSetup
        ? paid
              ? 'card_setup_success'.tr
              : terminalFailure
              ? 'card_setup_failed'.tr
              : verifying
              ? 'card_setup_verifying'.tr
              : 'card_setup_confirm'.tr
        : paid
        ? 'payment_received'.tr
        : terminalFailure
        ? 'payment_failed'.tr
        : verifying
        ? 'forte_payment_verifying_title'.tr
        : 'payment_confirm'.tr;
    final message = widget.cardSetup
        ? paid
              ? 'card_setup_success_hint'.tr
              : terminalFailure
              ? 'card_setup_failed_hint'.tr
              : verifying
              ? 'card_setup_verifying_hint'.tr
              : 'card_setup_hint'.tr
        : paid
        ? 'payment_saved'.tr
        : terminalFailure
        ? 'payment_not_charged'.tr
        : verifying
        ? 'forte_payment_verifying_hint'.tr
        : 'forte_payment_hint'.tr;

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        toolbarHeight: BulkaLayout.appBarHeight(context),
        leading: IconButton(
          tooltip: 'close_tooltip'.tr,
          icon: const Icon(Icons.close_rounded),
          onPressed: () => Navigator.pop(context, false),
        ),
        title: _FortePaymentAppBarTitle(
          title: widget.cardSetup
              ? 'payment_methods_add'.tr
              : 'forte_payment_title'.tr,
        ),
        actions: const [SizedBox(width: BulkaLayout.appBarSideSlot)],
        bottom: showEmbeddedCheckout
            ? PreferredSize(
                preferredSize: const Size.fromHeight(38),
                child: Semantics(
                  label: 'forte_secure_page'.tr,
                  child: Container(
                    key: const ValueKey('forte-secure-page-header'),
                    height: 38,
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF8EA),
                      border: Border(
                        top: BorderSide(color: _almond.withValues(alpha: 0.55)),
                        bottom: BorderSide(
                          color: _almond.withValues(alpha: 0.75),
                        ),
                      ),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(
                          Icons.lock_outline_rounded,
                          size: 17,
                          color: _successGreen,
                        ),
                        const SizedBox(width: 8),
                        Text(
                          'forte_secure_page'.tr,
                          style: const TextStyle(
                            fontFamily: _descriptionFont,
                            fontSize: BulkaTypeScale.caption,
                            fontWeight: FontWeight.w600,
                            color: _textDark,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              )
            : null,
      ),
      body: showEmbeddedCheckout
          ? SafeArea(
              child: Stack(
                children: [
                  Positioned.fill(
                    child: ForteCheckoutWebView(
                      key: ValueKey('forte-webview-${widget.operationId}'),
                      initialUri: _checkoutUri!,
                      acceptLanguage: forteCheckoutAcceptLanguage(
                        AppLang.current,
                      ),
                      semanticLabel: 'forte_secure_page'.tr,
                      isReturnUri: (uri) =>
                          forteCheckoutReturnFromUri(uri) != null,
                      onReturn: _handleCheckoutReturn,
                      onProgress: (progress) {
                        if (mounted && progress != _loadingProgress) {
                          setState(() => _loadingProgress = progress);
                        }
                      },
                      onReady: _handleEmbeddedReady,
                      onUnavailable: _handleEmbeddedUnavailable,
                      openExternalUri: _openExternalCheckoutUri,
                      onExternalOpenFailed: _showExternalOpenError,
                    ),
                  ),
                  if (_loadingProgress < 100)
                    Align(
                      alignment: Alignment.topCenter,
                      child: LinearProgressIndicator(
                        value: _loadingProgress <= 0
                            ? null
                            : _loadingProgress / 100,
                        minHeight: 3,
                        color: _bulkaYellow,
                        backgroundColor: const Color(0xFFFFF1D0),
                      ),
                    ),
                ],
              ),
            )
          : SafeArea(
              child: Center(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(28),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        paid
                            ? Icons.check_circle_rounded
                            : terminalFailure
                            ? Icons.error_outline_rounded
                            : Icons.credit_card_rounded,
                        color: paid
                            ? _successGreen
                            : terminalFailure
                            ? _errorRed
                            : _bulkaYellow,
                        size: 88,
                      ),
                      const SizedBox(height: 24),
                      Text(
                        title,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontFamily: _headingFont,
                          fontSize: BulkaTypeScale.titleLarge,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        message,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: BulkaTypeScale.body,
                          height: 1.4,
                          color: _textDark.withValues(alpha: 0.72),
                        ),
                      ),
                      if (!paid && !terminalFailure) ...[
                        const SizedBox(height: 28),
                        const CircularProgressIndicator(color: _bulkaYellow),
                        if (!verifying) ...[
                          const SizedBox(height: 24),
                          SizedBox(
                            width: double.infinity,
                            child: GradientButton(
                              onPressed: _opening ? null : _startCheckout,
                              loading: _opening,
                              child: Text('forte_payment_open'.tr),
                            ),
                          ),
                        ],
                      ],
                      if ((_checkoutError ?? _statusError) != null) ...[
                        const SizedBox(height: 18),
                        Text(
                          (_checkoutError ?? _statusError)!,
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: _errorRed),
                        ),
                      ],
                      if (_checkoutError != null &&
                          _supportsEmbeddedCheckout) ...[
                        const SizedBox(height: 10),
                        TextButton(
                          onPressed: _opening ? null : _openHostedCheckout,
                          child: Text('forte_payment_open_external'.tr),
                        ),
                      ],
                      if (paid || terminalFailure) ...[
                        const SizedBox(height: 28),
                        SizedBox(
                          width: double.infinity,
                          child: GradientButton(
                            onPressed: () => Navigator.pop(context, paid),
                            child: Text(
                              paid ? 'payment_done'.tr : 'payment_back_cart'.tr,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
    );
  }
}

class _FortePaymentAppBarTitle extends StatelessWidget {
  const _FortePaymentAppBarTitle({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      header: true,
      label: 'Bulka, $title',
      excludeSemantics: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Image.asset(
            'assets/brand/bulka_logo.png',
            width: 54,
            height: 28,
            fit: BoxFit.contain,
            errorBuilder: (_, _, _) => const Text(
              'Bulka',
              style: TextStyle(
                fontFamily: _headingFont,
                fontWeight: FontWeight.w700,
                color: _bulkaBrown,
              ),
            ),
          ),
          const SizedBox(width: 9),
          Container(width: 1, height: 24, color: const Color(0xFFE8D8B8)),
          const SizedBox(width: 9),
          Flexible(
            child: Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: _bulkaPageTitleTextStyle.copyWith(
                fontSize: BulkaTypeScale.titleSmall,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
