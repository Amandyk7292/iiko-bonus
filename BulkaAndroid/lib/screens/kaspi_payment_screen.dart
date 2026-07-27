part of '../main.dart';

class KaspiPaymentScreen extends StatefulWidget {
  const KaspiPaymentScreen({
    required this.api,
    required this.operationId,
    this.qrToken,
    super.key,
  });

  final BulkaApiClient api;
  final String operationId;
  final String? qrToken;

  @override
  State<KaspiPaymentScreen> createState() => _KaspiPaymentScreenState();
}

class _KaspiPaymentScreenState extends State<KaspiPaymentScreen> {
  Timer? _timer;
  final DateTime _deadline = DateTime.now().add(const Duration(minutes: 10));
  String _paymentStatus = 'pending';
  String? _error;
  bool _checking = false;

  @override
  void initState() {
    super.initState();
    unawaited(_checkStatus());
    _timer = Timer.periodic(
      const Duration(seconds: 3),
      (_) => unawaited(_checkStatus()),
    );
  }

  Future<void> _checkStatus() async {
    if (_checking || !mounted) return;
    if (DateTime.now().isAfter(_deadline)) {
      _timer?.cancel();
      setState(() => _error = 'payment_timeout'.tr);
      return;
    }
    _checking = true;
    try {
      final result = await widget.api.checkKaspiPaymentStatus(
        widget.operationId,
      );
      if (!mounted) return;
      setState(() {
        _paymentStatus =
            (result['paymentStatus'] ?? result['status'] ?? 'pending')
                .toString();
        _error = null;
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

  Future<void> _openKaspi() async {
    final value = widget.qrToken;
    if (value == null || value.isEmpty) return;
    final uri = Uri.tryParse(value);
    if (uri == null ||
        !await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      if (mounted) {
        setState(() => _error = 'payment_open_failed'.tr);
      }
    }
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
        _paymentStatus == 'failed' || _paymentStatus == 'expired';
    final title = paid
        ? 'payment_received'.tr
        : terminalFailure
        ? 'payment_failed'.tr
        : 'payment_confirm'.tr;
    final message = paid
        ? 'payment_saved'.tr
        : terminalFailure
        ? 'payment_not_charged'.tr
        : 'payment_open_kaspi_hint'.tr;

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        toolbarHeight: BulkaLayout.appBarHeight(context),
        title: _BulkaPageTitle('payment_title'.tr),
        actions: const [SizedBox(width: BulkaLayout.appBarSideSlot)],
      ),
      body: SafeArea(
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
                      : Icons.account_balance_wallet_outlined,
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
                  if (widget.qrToken?.isNotEmpty == true) ...[
                    const SizedBox(height: 24),
                    SizedBox(
                      width: double.infinity,
                      child: GradientButton(
                        onPressed: _openKaspi,
                        child: Text('payment_open_kaspi'.tr),
                      ),
                    ),
                  ],
                ],
                if (_error != null) ...[
                  const SizedBox(height: 18),
                  Text(
                    _error!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: _errorRed),
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
