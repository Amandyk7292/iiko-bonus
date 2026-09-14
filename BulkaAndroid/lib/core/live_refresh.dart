part of '../main.dart';

bool _dataEventMatches(Map<String, dynamic> event, Set<String> domains) {
  if (event['type'] == 'connected') return true;
  if (domains.contains(event['type'])) return true;
  if (event['type'] != 'client.data.changed') return false;
  final values = _asMap(event['data'])['domains'];
  return values is List && values.any(domains.contains);
}

/// One refresh per burst; an invalidation during a request always runs again.
/// Recovery also refreshes data, since event history can be lost on a restart.
class _LiveRefresh with WidgetsBindingObserver {
  _LiveRefresh(
    this.api,
    this.domains,
    this.refresh, {
    this.busy,
    this.acceptEvent,
    Duration fallbackInterval = const Duration(seconds: 60),
  }) {
    _events = api.customerEvents.listen((event) {
      if (_dataEventMatches(event, domains) &&
          acceptEvent?.call(event) != false) {
        request();
      }
    });
    _network = networkRecoveryEvents().listen((_) => _recover());
    WidgetsBinding.instance.addObserver(this);
    _fallback = Timer.periodic(fallbackInterval, (_) => request());
  }

  final BulkaApiClient api;
  final Set<String> domains;
  final Future<void> Function() refresh;
  final bool Function()? busy;
  final bool Function(Map<String, dynamic>)? acceptEvent;
  late final StreamSubscription<Map<String, dynamic>> _events;
  late final StreamSubscription<dynamic> _network;
  Timer? _timer;
  Timer? _fallback;
  int _failures = 0;
  bool _running = false;
  bool _pending = false;
  bool _disposed = false;

  void request({bool immediate = false}) {
    if (_disposed) return;
    _pending = true;
    if (immediate) _timer?.cancel();
    // Bound the wait even if stock events keep arriving on a busy branch.
    if (_timer?.isActive == true) return;
    _timer = Timer(
      immediate ? Duration.zero : const Duration(milliseconds: 250),
      _flush,
    );
  }

  Future<void> _flush() async {
    if (_disposed || !_pending || _running) return;
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    if (lifecycle != null && lifecycle != AppLifecycleState.resumed) return;
    if (busy?.call() == true) {
      request();
      return;
    }
    _pending = false;
    _running = true;
    try {
      await refresh();
      _failures = 0;
    } catch (_) {
      if (_disposed) return;
      // Retry transient failures without requiring a new event or navigation.
      _pending = true;
      _failures = (_failures + 1).clamp(1, 5);
      _timer?.cancel();
      _timer = Timer(Duration(seconds: 1 << _failures), _flush);
    } finally {
      _running = false;
      if (_pending && !_disposed) request();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _recover();
  }

  void _recover() {
    api.reconnectEvents();
    request(immediate: true);
  }

  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _fallback?.cancel();
    unawaited(_events.cancel());
    unawaited(_network.cancel());
    WidgetsBinding.instance.removeObserver(this);
  }
}
