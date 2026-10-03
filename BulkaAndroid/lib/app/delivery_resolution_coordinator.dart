part of '../main.dart';

/// Owns the single customer decision overlay across screens and push navigation.
class DeliveryResolutionCoordinator extends NavigatorObserver {
  DeliveryResolutionCoordinator({
    required this.api,
    required this.canPresent,
    required this.onOrderChanged,
  });
  final BulkaApiClient api;
  final bool Function() canPresent;
  final ValueChanged<CustomerOrder> onOrderChanged;
  final _routes = <Route<dynamic>>[];
  List<CustomerOrder> _orders = const [];
  ValueNotifier<CustomerOrder?>? _visibleOrder;
  bool _scheduled = false;
  bool _disposed = false;

  bool get hasPendingDecision =>
      _orders.any((order) => order.needsDeliveryDecision);

  void updateOrders(List<CustomerOrder> orders) {
    if (_disposed) return;
    _orders = orders;
    final visible = _visibleOrder;
    if (visible != null) {
      visible.value = orders
          .where((order) => order.id == visible.value?.id)
          .firstOrNull;
    }
    _schedule();
  }

  void clear() {
    _orders = const [];
    _visibleOrder?.value = null;
  }

  void dispose() {
    _disposed = true;
    clear();
  }

  void _schedule() {
    if (_scheduled || _disposed) return;
    _scheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _scheduled = false;
      unawaited(_present());
    });
    WidgetsBinding.instance.ensureVisualUpdate();
  }

  Future<void> _present() async {
    final nav = navigator;
    if (_disposed ||
        _visibleOrder != null ||
        !canPresent() ||
        nav == null ||
        !nav.mounted ||
        _routes.lastOrNull is! PageRoute) {
      return;
    }
    final pending = _orders
        .where((order) => order.needsDeliveryDecision)
        .firstOrNull;
    if (pending == null) return;
    final live = ValueNotifier<CustomerOrder?>(pending);
    _visibleOrder = live;
    try {
      final updated = await showDialog<CustomerOrder>(
        context: nav.context,
        barrierDismissible: false,
        routeSettings: const RouteSettings(name: 'delivery-resolution'),
        animationStyle: BulkaMotion.reduced(nav.context)
            ? AnimationStyle.noAnimation
            : null,
        builder: (_) => DeliveryResolutionDialog(api: api, order: live),
      );
      if (!_disposed && updated != null && canPresent()) {
        _orders = [
          for (final order in _orders) order.id == updated.id ? updated : order,
        ];
        onOrderChanged(updated);
      }
    } finally {
      _visibleOrder = null;
      live.dispose();
      _schedule();
    }
  }

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    _routes.add(route);
    _schedule();
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    _routes.remove(route);
    _schedule();
  }

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) {
    _routes.remove(route);
    _schedule();
  }

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    final index = oldRoute == null ? -1 : _routes.indexOf(oldRoute);
    if (index >= 0) {
      if (newRoute == null) {
        _routes.removeAt(index);
      } else {
        _routes[index] = newRoute;
      }
    }
    _schedule();
  }
}
