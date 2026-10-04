part of '../main.dart';

enum _CashierScannerStatus { loading, running, denied, unavailable, paused }

/// Browser scanner: an invitation is returned once, after strict URL validation.
class CashierQrScanner extends StatefulWidget {
  const CashierQrScanner({this.camera, this.decode, this.cancelled, super.key});

  final CashierLiveCamera? camera;
  final Future<String?> Function(CashierCameraFrame)? decode;
  final ValueListenable<bool>? cancelled;

  @override
  State<CashierQrScanner> createState() => _CashierQrScannerState();
}

class _CashierQrScannerState extends State<CashierQrScanner>
    with WidgetsBindingObserver {
  late final CashierLiveCamera _camera;
  late final Uri _initialRoute;
  _CashierScannerStatus _status = _CashierScannerStatus.loading;
  Timer? _frames;
  int _revision = 0;
  bool _decoding = false;
  bool _finished = false;
  bool _starting = false;
  bool _invalidQr = false;

  @override
  void initState() {
    super.initState();
    _camera = widget.camera ?? createCashierLiveCamera();
    _camera.onInterrupted = _pause;
    _initialRoute = clientRouteNotifier.value;
    clientRouteNotifier.addListener(_routeChanged);
    widget.cancelled?.addListener(_cancelled);
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && !_finished) unawaited(_start());
    });
  }

  @override
  void dispose() {
    _finished = true;
    _revision++;
    _frames?.cancel();
    widget.cancelled?.removeListener(_cancelled);
    clientRouteNotifier.removeListener(_routeChanged);
    WidgetsBinding.instance.removeObserver(this);
    _camera.dispose();
    super.dispose();
  }

  void _routeChanged() {
    if (clientRouteNotifier.value != _initialRoute) {
      _finish(null, deferred: true);
    }
  }

  void _cancelled() {
    if (widget.cancelled?.value == true) _finish(null, deferred: true);
  }

  bool get _foreground => mounted && ModalRoute.of(context)?.isCurrent == true;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // ModalRoute notifies dependants when another route covers this scanner.
    if (!_foreground && !_finished) _pause();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.hidden ||
        state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      _pause();
    }
  }

  void _stop() {
    _starting = false;
    _revision++;
    _frames?.cancel();
    _frames = null;
    _camera.stop();
  }

  void _pause() {
    if (!mounted || _finished) return;
    if (_status == _CashierScannerStatus.paused) return;
    _stop();
    setState(() => _status = _CashierScannerStatus.paused);
  }

  Future<void> _start() async {
    if (!mounted || _finished || _starting || widget.cancelled?.value == true) {
      return;
    }
    if (!_foreground) {
      _pause();
      return;
    }
    _stop();
    _starting = true;
    final revision = _revision;
    setState(() {
      _status = _CashierScannerStatus.loading;
      _invalidQr = false;
    });
    try {
      await Future.wait([
        _camera.start(),
        if (widget.decode == null) cashier_qr.loadLibrary(),
      ]).timeout(const Duration(seconds: 20));
      if (!mounted || _finished || revision != _revision) return;
      if (!_foreground) {
        _pause();
        return;
      }
      _starting = false;
      setState(() => _status = _CashierScannerStatus.running);
      _frames = Timer.periodic(const Duration(milliseconds: 350), (_) {
        unawaited(_sample());
      });
    } catch (error) {
      if (!mounted || _finished || revision != _revision) return;
      _stop();
      setState(() {
        _status =
            error is CashierCameraException &&
                error.failure == CashierCameraFailure.denied
            ? _CashierScannerStatus.denied
            : _CashierScannerStatus.unavailable;
      });
    }
  }

  Future<void> _sample() async {
    if (_decoding || _finished || _status != _CashierScannerStatus.running) {
      return;
    }
    if (!_foreground) {
      _pause();
      return;
    }
    final revision = _revision;
    _decoding = true;
    try {
      final frame = _camera.captureFrame();
      if (frame == null) return;
      final raw =
          await (widget.decode?.call(frame) ??
              compute(cashier_qr.decodeCashierInviteFrame, frame.decoderInput));
      if (!mounted || _finished || revision != _revision || raw == null) return;
      if (!_foreground) {
        _pause();
        return;
      }
      final uri = raw.length <= 2048 ? Uri.tryParse(raw.trim()) : null;
      if (uri == null || PendingCashierInvite.tokenFromUri(uri) == null) {
        if (!_invalidQr) setState(() => _invalidQr = true);
        return;
      }
      _finish(raw.trim());
    } catch (_) {
      if (!mounted || _finished || revision != _revision) return;
      _stop();
      setState(() => _status = _CashierScannerStatus.unavailable);
    } finally {
      _decoding = false;
    }
  }

  void _finish(String? result, {bool deferred = false}) {
    if (_finished) return;
    _finished = true;
    _stop();
    void leave() {
      if (!mounted) return;
      final route = ModalRoute.of(context);
      final navigator = Navigator.of(context);
      if (route?.isCurrent == true) {
        navigator.pop(result);
      } else if (route != null && route.isActive) {
        navigator.removeRoute(route, result);
      }
    }

    if (deferred) {
      WidgetsBinding.instance.addPostFrameCallback((_) => leave());
    } else {
      leave();
    }
  }

  @override
  Widget build(BuildContext context) => PopScope<String>(
    onPopInvokedWithResult: (didPop, _) {
      if (didPop) {
        _finished = true;
        _stop();
      }
    },
    child: _buildScanner(),
  );
}
