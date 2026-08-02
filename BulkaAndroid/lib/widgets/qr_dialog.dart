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

class _QrDialogState extends State<QrDialog> with WidgetsBindingObserver {
  Timer? _timer;
  int _timeRemaining = 300;
  int? _loadedWindow;
  String? _token;
  bool _failed = false;
  bool _brightnessOverridden = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_activateQrDisplay());
    _tick();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
  }

  bool get _supportsNativeBrightness =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);

  Future<void> _activateQrDisplay() async {
    try {
      await WakelockPlus.enable();
    } catch (_) {}
    if (!_supportsNativeBrightness || _brightnessOverridden) return;
    try {
      await ScreenBrightness.instance.setAutoReset(true);
      await ScreenBrightness.instance.setAnimate(true);
      await ScreenBrightness.instance.setApplicationScreenBrightness(1);
      _brightnessOverridden = true;
    } catch (_) {
      _brightnessOverridden = false;
    }
  }

  Future<void> _restoreQrDisplay() async {
    try {
      await WakelockPlus.disable();
    } catch (_) {}
    if (!_supportsNativeBrightness || !_brightnessOverridden) return;
    _brightnessOverridden = false;
    try {
      await ScreenBrightness.instance.resetApplicationScreenBrightness();
    } catch (_) {}
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.resumed:
        unawaited(_activateQrDisplay());
        break;
      case AppLifecycleState.inactive:
      case AppLifecycleState.hidden:
      case AppLifecycleState.paused:
      case AppLifecycleState.detached:
        unawaited(_restoreQrDisplay());
        break;
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    unawaited(_restoreQrDisplay());
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
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    final minutes = (_timeRemaining ~/ 60).toString().padLeft(2, '0');
    final seconds = (_timeRemaining % 60).toString().padLeft(2, '0');
    final isApple = defaultTargetPlatform == TargetPlatform.iOS;
    return Dialog(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(BulkaRadii.sheet),
      ),
      backgroundColor: scheme.surface,
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
                  style: TextStyle(
                    fontFamily: _headingFont,
                    color: scheme.onSurface,
                    fontWeight: FontWeight.w700,
                    fontSize: BulkaTypeScale.body,
                  ),
                ),
                IconButton(
                  onPressed: () {
                    BulkaMotion.lightImpact();
                    Navigator.of(context).pop();
                  },
                  style: IconButton.styleFrom(
                    backgroundColor: colors.surfaceCream,
                    foregroundColor: colors.brandBrown,
                  ),
                  tooltip: 'close_tooltip'.tr,
                  icon: const Icon(Icons.close_rounded),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Semantics(
              image: true,
              label: '${'my_qr'.tr}. ${'qr_update_in'.tr} $minutes:$seconds',
              child: ExcludeSemantics(
                child: BulkaHero(
                  tag: widget.heroTag,
                  child: Container(
                    width: 216,
                    height: 216,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(BulkaRadii.card),
                      border: Border.all(
                        color: _almond.withValues(alpha: 0.45),
                      ),
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
                                  fontSize: BulkaTypeScale.caption,
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
                                  border: Border.all(
                                    color: Colors.white,
                                    width: 3,
                                  ),
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
              ),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: colors.brandGold.withValues(alpha: 0.14),
                borderRadius: BorderRadius.circular(BulkaRadii.control),
              ),
              child: Column(
                children: [
                  Text(
                    'qr_update_in'.tr,
                    style: TextStyle(
                      color: colors.mutedText,
                      fontSize: BulkaTypeScale.caption,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '$minutes:$seconds',
                    style: TextStyle(
                      fontFamily: _headingFont,
                      color: scheme.onSurface,
                      fontSize: BulkaTypeScale.titleLarge,
                      fontWeight: FontWeight.w700,
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
      await _openExternalUrl(
        context,
        uri,
        'error_open_wallet'.tr,
        sameWindowOnWeb: true,
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('wallet_unavailable'.tr)));
    }
  }
}
