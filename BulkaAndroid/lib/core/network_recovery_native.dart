import 'package:connectivity_plus/connectivity_plus.dart';

// A transport change is a reason to retry, never proof that a request succeeded.
Stream<void> networkRecoveryEvents() async* {
  final connectivity = Connectivity();
  try {
    // Probe the method channel before attaching the event channel. Widget tests
    // and older installations can lack the native plugin; subscribing first
    // makes Flutter report an uncaught MissingPluginException.
    await connectivity.checkConnectivity();
  } catch (_) {
    return;
  }
  String? previous;
  try {
    await for (final values in connectivity.onConnectivityChanged) {
      final current = (values.map((value) => value.name).toList()..sort()).join(
        ',',
      );
      if (current == previous) continue;
      previous = current;
      if (current.isNotEmpty && current != ConnectivityResult.none.name) {
        yield null;
      }
    }
  } catch (_) {
    // Older installations/tests may lack the platform plugin; SSE/resume
    // recovery remains available until the native application is updated.
  }
}
