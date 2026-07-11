part of '../main.dart';

class QrDialog extends StatefulWidget {
  const QrDialog({
    required this.api,
    required this.customer,
    required this.heroTag,
    super.key,
  });

  final BulkaApiClient api;
  final Customer customer;
  final Object heroTag;

  @override
  State<QrDialog> createState() => _QrDialogState();
}

class _QrDialogState extends State<QrDialog> {
  Timer? _timer;
  int _timeRemaining = 300;
  int? _loadedWindow;
  String? _token;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _tick();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _tick() async {
    if (!mounted) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    final window = now ~/ 300000;
    setState(() => _timeRemaining = 300 - ((now % 300000) ~/ 1000));
    if (_loadedWindow == window && _token != null) return;
    try {
      final token = await widget.api.getQrToken(widget.customer.phone);
      if (!mounted) return;
      setState(() {
        _token = token;
        _loadedWindow = window;
        _failed = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _failed = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final minutes = (_timeRemaining ~/ 60).toString().padLeft(2, '0');
    final seconds = (_timeRemaining % 60).toString().padLeft(2, '0');
    final isApple = defaultTargetPlatform == TargetPlatform.iOS;
    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
      backgroundColor: _cream,
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      child: Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'my_qr'.tr,
                  style: const TextStyle(
                    color: _textDark,
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                  ),
                ),
                IconButton(
                  onPressed: () {
                    BulkaMotion.lightImpact();
                    Navigator.of(context).pop();
                  },
                  style: IconButton.styleFrom(
                    backgroundColor: _almond.withValues(alpha: 0.35),
                    foregroundColor: _cocoa,
                  ),
                  tooltip: 'close_tooltip'.tr,
                  icon: const Icon(Icons.close_rounded),
                ),
              ],
            ),
            const SizedBox(height: 16),
            BulkaHero(
              tag: widget.heroTag,
              child: Container(
                width: 216,
                height: 216,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(28),
                  border: Border.all(color: _almond.withValues(alpha: 0.45)),
                  boxShadow: [
                    BoxShadow(
                      color: _cocoa.withValues(alpha: 0.12),
                      blurRadius: 22,
                      offset: const Offset(0, 12),
                    ),
                  ],
                ),
                alignment: Alignment.center,
                child: _token == null && !_failed
                    ? const CircularProgressIndicator(color: _bulkaYellow)
                    : _failed
                    ? Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.qr_code_2_rounded,
                            color: _caramel,
                            size: 64,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'qr_unavailable'.tr,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: _errorRed,
                              fontSize: 12,
                            ),
                          ),
                          TextButton(
                            onPressed: _tick,
                            child: Text('retry_btn'.tr),
                          ),
                        ],
                      )
                    : Stack(
                        alignment: Alignment.center,
                        children: [
                          QrImageView(
                            data: _token!,
                            size: 200,
                            backgroundColor: Colors.white,
                            errorCorrectionLevel: QrErrorCorrectLevel.H,
                            eyeStyle: const QrEyeStyle(
                              eyeShape: QrEyeShape.square,
                              color: Color(0xFF4E2C1E),
                            ),
                            dataModuleStyle: const QrDataModuleStyle(
                              dataModuleShape: QrDataModuleShape.circle,
                              color: Color(0xFF4E2C1E),
                            ),
                          ),
                          Container(
                            width: 38,
                            height: 38,
                            decoration: BoxDecoration(
                              color: Colors.white,
                              shape: BoxShape.circle,
                              border: Border.all(color: Colors.white, width: 3),
                            ),
                            child: ClipOval(
                              child: Image.asset(
                                'assets/brand/qr_logo.png',
                                fit: BoxFit.cover,
                              ),
                            ),
                          ),
                        ],
                      ),
              ),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: _almond.withValues(alpha: 0.28),
                borderRadius: BorderRadius.circular(18),
              ),
              child: Column(
                children: [
                  Text(
                    'qr_update_in'.tr,
                    style: TextStyle(
                      color: _textDark.withValues(alpha: 0.58),
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '$minutes:$seconds',
                    style: const TextStyle(
                      color: _textDark,
                      fontSize: 24,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            _PrimaryButton(
              text: isApple ? 'add_apple_wallet'.tr : 'add_google_wallet'.tr,
              icon: Icons.account_balance_wallet_rounded,
              color: const Color(0xFF1F1F1F),
              textColor: Colors.white,
              onPressed: _openWallet,
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openWallet() async {
    try {
      final uri = Uri.parse(
        await widget.api.createWalletUrl(widget.customer.phone),
      );
      if (!mounted) return;
      await _openExternalUrl(context, uri, 'error_open_wallet'.tr);
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('wallet_unavailable'.tr)));
    }
  }
}
