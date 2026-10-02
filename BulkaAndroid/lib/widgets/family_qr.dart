part of '../main.dart';

class FamilyQrWidget extends StatefulWidget {
  const FamilyQrWidget({
    required this.api,
    this.payment = false,
    @visibleForTesting this.now,
    super.key,
  });
  final BulkaApiClient api;
  final bool payment;
  final DateTime Function()? now;
  @override
  State<FamilyQrWidget> createState() => _FamilyQrWidgetState();
}

class _FamilyQrWidgetState extends State<FamilyQrWidget>
    with WidgetsBindingObserver {
  Timer? _timer;
  String? _token;
  DateTime? _expiresAt;
  bool _loading = false;
  bool _paused = false;
  String? _error;
  int _revision = 0;
  String? _identity;
  DateTime get _now => widget.now?.call() ?? DateTime.now();

  @override
  void initState() {
    super.initState();
    _identity = widget.api.sessionCacheScope;
    WidgetsBinding.instance.addObserver(this);
    unawaited(_load());
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
  }

  @override
  void didUpdateWidget(FamilyQrWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.payment != widget.payment ||
        oldWidget.api != widget.api ||
        _identity != widget.api.sessionCacheScope) {
      _identity = widget.api.sessionCacheScope;
      _revision++;
      _loading = false;
      _token = null;
      _expiresAt = null;
      _error = null;
      unawaited(_load());
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _paused = state != AppLifecycleState.resumed;
    _revision++;
    if (!mounted) return;
    setState(() {
      _token = null;
      _expiresAt = null;
      _loading = false;
    });
    if (!_paused) unawaited(_load());
  }

  int get _remaining => max(
    0,
    ((_expiresAt?.millisecondsSinceEpoch ?? 0) - _now.millisecondsSinceEpoch) ~/
        1000,
  );

  void _tick() {
    if (!mounted || _paused) return;
    if (_identity != widget.api.sessionCacheScope) {
      _identity = widget.api.sessionCacheScope;
      _revision++;
      setState(() {
        _token = null;
        _expiresAt = null;
        _loading = false;
        _error = null;
      });
      unawaited(_load());
      return;
    }
    if (_expiresAt != null && !_now.isBefore(_expiresAt!)) {
      setState(() {
        _token = null;
        _expiresAt = null;
      });
      if (!_loading && _error == null) unawaited(_load());
    } else if (_token != null) {
      setState(() {});
    }
  }

  Future<void> _load() async {
    if (_loading || _paused) return;
    final revision = _revision;
    final startedAt = _now;
    setState(() {
      _loading = true;
      _error = null;
      _token = null;
    });
    try {
      final result = await widget.api.getFamilyQr(payment: widget.payment);
      if (!mounted || revision != _revision || _paused) return;
      final token = _asString(result['token']);
      final ttl = _asInt(result['ttlSeconds']);
      // Use the server lifetime when available; a wrong device clock must not
      // make an otherwise valid QR unusable. Subtract request time conservatively.
      final expiry = ttl > 0 && ttl <= 300
          ? startedAt.add(Duration(seconds: ttl))
          : DateTime.fromMillisecondsSinceEpoch(_asInt(result['expiresAt']));
      if (!token.startsWith('BULKA-FAMILY:') ||
          !expiry.isAfter(_now) ||
          expiry.difference(_now) > const Duration(minutes: 5)) {
        throw ApiException('qr_unavailable'.tr);
      }
      setState(() {
        _token = token;
        _expiresAt = expiry;
        _loading = false;
      });
    } catch (error) {
      if (!mounted || revision != _revision) return;
      setState(() {
        _token = null;
        _expiresAt = null;
        _error = _familyError(error);
        _loading = false;
      });
    }
  }

  @override
  void dispose() {
    _revision++;
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final remaining = _remaining;
    final time =
        '${(remaining ~/ 60).toString().padLeft(2, '0')}:${(remaining % 60).toString().padLeft(2, '0')}';
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          constraints: const BoxConstraints(maxWidth: 236),
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
          ),
          child: AspectRatio(
            aspectRatio: 1,
            child: Center(
              child: _token != null && remaining > 0
                  ? Semantics(
                      label: 'my_qr'.tr,
                      image: true,
                      child: ExcludeSemantics(
                        child: Stack(
                          alignment: Alignment.center,
                          children: [
                            QrImageView(
                              key: ValueKey(_token!),
                              data: _token!,
                              padding: const EdgeInsets.all(8),
                              backgroundColor: Colors.white,
                              errorCorrectionLevel: QrErrorCorrectLevel.H,
                            ),
                            Container(
                              width: 34,
                              height: 34,
                              padding: const EdgeInsets.all(3),
                              decoration: const BoxDecoration(
                                color: Colors.white,
                                shape: BoxShape.circle,
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
                    )
                  : _loading
                  ? const CircularProgressIndicator()
                  : const Icon(
                      Icons.qr_code_2_rounded,
                      size: 80,
                      color: _caramel,
                    ),
            ),
          ),
        ),
        const SizedBox(height: 12),
        if (_token != null && remaining > 0)
          Semantics(
            label: '${'qr_update_in'.tr} $time',
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: context.bulkaColors.disabledSurface,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.refresh_rounded,
                    size: 14,
                    color: context.bulkaColors.mutedText,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    time,
                    style: const TextStyle(
                      fontFamily: _headingFont,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
          )
        else if (_error != null) ...[
          Text(
            _error!,
            textAlign: TextAlign.center,
            style: const TextStyle(color: _errorRed),
          ),
          TextButton.icon(
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh),
            label: Text(_familyText('newQr')),
          ),
        ],
      ],
    );
  }
}
