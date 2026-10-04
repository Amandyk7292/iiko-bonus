part of '../main.dart';

class _CashierRegistrationField extends StatefulWidget {
  const _CashierRegistrationField({
    required this.enabled,
    required this.onChanged,
    required this.onBusyChanged,
    this.onLookup,
    this.onScan,
  });

  final bool enabled;
  final ValueChanged<String?> onChanged;
  final ValueChanged<bool> onBusyChanged;
  final Future<CashierInviteDetails> Function(String token)? onLookup;
  final Future<String?> Function()? onScan;

  @override
  State<_CashierRegistrationField> createState() =>
      _CashierRegistrationFieldState();
}

class _CashierRegistrationFieldState extends State<_CashierRegistrationField> {
  CashierInviteDetails? _cashier;
  String? _pendingToken;
  String? _error;
  bool _busy = false;
  int _revision = 0;
  ValueNotifier<bool>? _scanCancelled;

  @override
  void initState() {
    super.initState();
    PendingCashierInvite.tokenNotifier.addListener(_pendingChanged);
    unawaited(PendingCashierInvite.read().then((_) => _pendingChanged()));
  }

  @override
  void dispose() {
    _revision++;
    _scanCancelled?.value = true;
    PendingCashierInvite.tokenNotifier.removeListener(_pendingChanged);
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant _CashierRegistrationField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.enabled) _scanCancelled?.value = true;
  }

  void _pendingChanged() {
    if (!mounted) return;
    final token = PendingCashierInvite.tokenNotifier.value;
    if (token == _pendingToken) return;
    if (token == null) {
      _revision++;
      widget.onChanged(null);
      widget.onBusyChanged(false);
      setState(() {
        _pendingToken = null;
        _cashier = null;
        _busy = false;
        _error = null;
      });
      return;
    }
    unawaited(_lookup(token));
  }

  Future<void> _lookup(String token) async {
    if (!mounted) return;
    final lookup = widget.onLookup;
    final revision = ++_revision;
    widget.onChanged(null);
    widget.onBusyChanged(true);
    setState(() {
      _pendingToken = token;
      _cashier = null;
      _busy = true;
      _error = null;
    });
    try {
      if (lookup == null) throw ApiException('cashier_qr_unavailable'.tr);
      final cashier = await lookup(token);
      if (!mounted || revision != _revision) return;
      if (cashier.token != token) throw ApiException('cashier_qr_invalid'.tr);
      // Persist only after the server confirms who owns this invitation.
      await PendingCashierInvite.setToken(
        token,
        isCurrent: () => mounted && revision == _revision,
      );
      if (!mounted || revision != _revision) return;
      widget.onChanged(token);
      setState(() => _cashier = cashier);
    } catch (_) {
      if (!mounted || revision != _revision) return;
      setState(() => _error = 'cashier_qr_unavailable'.tr);
    } finally {
      if (mounted && revision == _revision) {
        widget.onBusyChanged(false);
        setState(() => _busy = false);
      }
    }
  }

  bool get _legacyIosPhoto =>
      !kIsWeb &&
      defaultTargetPlatform == TargetPlatform.iOS &&
      !const bool.fromEnvironment('BULKA_IOS_QR_CAMERA_AVAILABLE');

  Future<String?> _captureQr() async {
    if (kIsWeb) {
      final cancelled = ValueNotifier(false);
      _scanCancelled = cancelled;
      try {
        return await Navigator.of(context).push<String>(
          MaterialPageRoute(
            fullscreenDialog: true,
            builder: (_) => CashierQrScanner(cancelled: cancelled),
          ),
        );
      } finally {
        if (identical(_scanCancelled, cancelled)) _scanCancelled = null;
        cancelled.dispose();
      }
    }
    // Older iOS releases have no camera usage description. Their existing
    // photo picker is safe; a future native build can opt into camera support.
    final file = await ImagePicker().pickImage(
      source: _legacyIosPhoto ? ImageSource.gallery : ImageSource.camera,
      preferredCameraDevice: CameraDevice.rear,
      maxWidth: 1600,
      maxHeight: 1600,
      imageQuality: 92,
    );
    if (file == null) return null;
    if (await file.length() > 12 * 1024 * 1024) {
      throw ApiException('cashier_qr_invalid'.tr);
    }
    final bytes = await file.readAsBytes();
    await cashier_qr.loadLibrary();
    final raw = await compute(cashier_qr.decodeCashierInviteQr, bytes);
    if (raw == null) throw ApiException('cashier_qr_invalid'.tr);
    return raw;
  }

  Future<void> _scan() async {
    if (_busy || !widget.enabled) return;
    FocusManager.instance.primaryFocus?.unfocus();
    final revision = ++_revision;
    widget.onBusyChanged(true);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final raw = await (widget.onScan ?? _captureQr)();
      if (!mounted || !widget.enabled || revision != _revision || raw == null) {
        return;
      }
      final uri = Uri.tryParse(raw.trim());
      final token = uri == null ? null : PendingCashierInvite.tokenFromUri(uri);
      if (token == null) throw ApiException('cashier_qr_invalid'.tr);
      await _lookup(token);
    } catch (error) {
      if (!mounted || revision != _revision) return;
      setState(() {
        _error = error is ApiException
            ? 'cashier_qr_invalid'.tr
            : 'cashier_qr_camera_error'.tr;
      });
    } finally {
      if (mounted && revision == _revision) {
        widget.onBusyChanged(false);
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _remove() async {
    _revision++;
    widget.onChanged(null);
    widget.onBusyChanged(false);
    setState(() {
      _pendingToken = null;
      _cashier = null;
      _busy = false;
      _error = null;
    });
    await PendingCashierInvite.clear();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final cashier = _cashier;
    return Container(
      key: const ValueKey('cashier-registration-field'),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: cashier == null
            ? Theme.of(context).colorScheme.surface
            : colors.surfaceCream,
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        border: Border.all(color: colors.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 22,
                backgroundColor: _bulkaYellow.withValues(alpha: 0.25),
                child: Icon(Icons.badge_outlined, color: colors.brandBrown),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      cashier?.name ?? 'cashier_helped_me'.tr,
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        color: colors.brandBrown,
                        fontSize: BulkaTypeScale.bodySmall,
                      ),
                    ),
                    if (cashier?.location.isNotEmpty == true) ...[
                      const SizedBox(height: 3),
                      Text(
                        cashier!.location,
                        style: TextStyle(
                          color: colors.mutedText,
                          fontSize: BulkaTypeScale.caption,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (_pendingToken != null || cashier != null)
                IconButton(
                  key: const ValueKey('cashier-invite-remove'),
                  tooltip: 'cashier_qr_remove'.tr,
                  onPressed: widget.enabled ? _remove : null,
                  icon: const Icon(Icons.close_rounded),
                ),
            ],
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Semantics(
              liveRegion: true,
              child: Text(
                _error!,
                style: TextStyle(
                  color: Theme.of(context).colorScheme.error,
                  fontSize: BulkaTypeScale.caption,
                ),
              ),
            ),
          ],
          if (cashier == null) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              key: const ValueKey('cashier-invite-scan'),
              onPressed: _busy || !widget.enabled ? null : _scan,
              icon: _busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.qr_code_scanner_rounded, size: 20),
              label: Text(
                _busy
                    ? 'cashier_qr_checking'.tr
                    : _legacyIosPhoto
                    ? 'cashier_qr_photo'.tr
                    : 'cashier_qr_scan'.tr,
                textAlign: TextAlign.center,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
