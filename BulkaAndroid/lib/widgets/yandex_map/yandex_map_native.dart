import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'yandex_map_types.dart';

class YandexMapView extends StatefulWidget {
  const YandexMapView({
    required this.controller,
    required this.center,
    required this.selectedPoint,
    required this.zoom,
    required this.branches,
    required this.semanticLabel,
    required this.unavailableLabel,
    this.onTap,
    this.onCameraChanged,
    this.interactive = true,
    super.key,
  });

  final YandexMapController controller;
  final LatLng center;
  final LatLng? selectedPoint;
  final double zoom;
  final List<YandexMapBranch> branches;
  final String semanticLabel;
  final String unavailableLabel;
  final YandexMapTap? onTap;
  final YandexCameraChanged? onCameraChanged;
  final bool interactive;

  @override
  State<YandexMapView> createState() => _YandexMapViewState();
}

class _YandexMapViewState extends State<YandexMapView> {
  WebViewController? _webController;
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    try {
      _webController = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setBackgroundColor(const Color(0xFFF7F2E8))
        ..addJavaScriptChannel(
          'BulkaMap',
          onMessageReceived: (message) => _receive(message.message),
        )
        ..setNavigationDelegate(
          NavigationDelegate(
            onNavigationRequest: (request) =>
                request.url.startsWith(yandexMapUrl)
                ? NavigationDecision.navigate
                : NavigationDecision.prevent,
          ),
        )
        ..loadRequest(Uri.parse(yandexMapUrl));
    } catch (_) {
      _webController = null;
    }
    widget.controller.addListener(_sendCommand);
  }

  @override
  void didUpdateWidget(covariant YandexMapView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_sendCommand);
      widget.controller.addListener(_sendCommand);
    }
    _sendState();
  }

  void _receive(String raw) {
    final decoded = jsonDecode(raw);
    if (decoded is! Map) return;
    final payload = Map<String, dynamic>.from(decoded);
    if (payload['type'] == 'ready') {
      _ready = true;
      _sendState();
    }
    if (payload['type'] == 'point') {
      final latitude = (payload['latitude'] as num?)?.toDouble();
      final longitude = (payload['longitude'] as num?)?.toDouble();
      if (latitude != null && longitude != null) {
        widget.onTap?.call(LatLng(latitude, longitude));
      }
    }
    if (payload['type'] == 'camera') {
      final latitude = (payload['latitude'] as num?)?.toDouble();
      final longitude = (payload['longitude'] as num?)?.toDouble();
      final zoom = (payload['zoom'] as num?)?.toDouble();
      if (latitude != null && longitude != null && zoom != null) {
        widget.onCameraChanged?.call(LatLng(latitude, longitude), zoom);
      }
    }
  }

  Map<String, Object?> _statePayload() => {
    'type': 'state',
    'mode': widget.interactive ? 'customer' : 'preview',
    'center': [widget.center.latitude, widget.center.longitude],
    'selected': widget.selectedPoint == null
        ? null
        : [widget.selectedPoint!.latitude, widget.selectedPoint!.longitude],
    'zoom': widget.zoom,
    'branches': widget.branches.map((branch) => branch.toPayload()).toList(),
  };

  Future<void> _post(Map<String, Object?> payload) async {
    final controller = _webController;
    if (controller == null) return;
    final encoded = jsonEncode(jsonEncode(payload));
    await controller.runJavaScript(
      'window.postMessage($encoded, window.location.origin);',
    );
  }

  void _sendState() {
    if (_ready) _post(_statePayload());
  }

  void _sendCommand() {
    final command = widget.controller.command;
    if (_ready && command != null) {
      _post({'type': command.type, ...command.payload});
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_sendCommand);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _webController;
    if (controller != null) {
      return Semantics(
        label: widget.semanticLabel,
        child: WebViewWidget(controller: controller),
      );
    }
    return Material(
      key: const ValueKey('yandex-map-fallback'),
      color: const Color(0xFFF7F2E8),
      child: InkWell(
        onTap: widget.interactive
            ? () => widget.onTap?.call(widget.center)
            : null,
        child: Semantics(
          label: widget.unavailableLabel,
          child: Center(
            child: Icon(
              Icons.map_outlined,
              size: 42,
              color: Theme.of(context).colorScheme.primary,
            ),
          ),
        ),
      ),
    );
  }
}
