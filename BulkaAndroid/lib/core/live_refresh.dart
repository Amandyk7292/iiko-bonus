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
  _LiveRefresh(BulkaApiClient api, this.domains, this.refresh, {this.busy}) {
    _events = api.customerEvents.listen((event) {
      if (_dataEventMatches(event, domains)) request();
    });
    _network = networkRecoveryEvents().listen((_) => request());
    WidgetsBinding.instance.addObserver(this);
  }

  final Set<String> domains;
  final Future<void> Function() refresh;
  final bool Function()? busy;
  late final StreamSubscription<Map<String, dynamic>> _events;
  late final StreamSubscription<dynamic> _network;
  Timer? _timer;
  bool _running = false;
  bool _pending = false;
  bool _disposed = false;

  void request() {
    if (_disposed) return;
    _pending = true;
    _timer?.cancel();
    _timer = Timer(const Duration(milliseconds: 250), _flush);
  }

  Future<void> _flush() async {
    if (_disposed || !_pending || _running) return;
    if (busy?.call() == true) {
      request();
      return;
    }
    _pending = false;
    _running = true;
    try {
      await refresh();
    } catch (_) {
      // Keep current data on transport failure; retry on recovery.
    } finally {
      _running = false;
      if (_pending && !_disposed) request();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) request();
  }

  void dispose() {
    _disposed = true;
    _timer?.cancel();
    unawaited(_events.cancel());
    unawaited(_network.cancel());
    WidgetsBinding.instance.removeObserver(this);
  }
}
