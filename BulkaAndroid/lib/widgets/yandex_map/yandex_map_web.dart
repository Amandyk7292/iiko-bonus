import 'dart:convert';
import 'dart:js_interop';
import 'dart:ui_web' as ui_web;

import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';
import 'package:web/web.dart' as web;

import 'yandex_map_types.dart';

class YandexMapView extends StatefulWidget {
  const YandexMapView({
    required this.controller,
    required this.center,
    required this.selectedPoint,
    required this.zoom,
    required this.branches,
    this.onTap,
    this.onCameraChanged,
    this.interactive = true,
    super.key,
  });

  final YandexMapController controller;
  final LatLng center;
  final LatLng selectedPoint;
  final double zoom;
  final List<YandexMapBranch> branches;
  final YandexMapTap? onTap;
  final YandexCameraChanged? onCameraChanged;
  final bool interactive;

  @override
  State<YandexMapView> createState() => _YandexMapViewState();
}

class _YandexMapViewState extends State<YandexMapView> {
  late final String _viewType;
  late final web.HTMLIFrameElement _frame;
  late final JSFunction _messageListener;
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    _viewType = 'bulka-yandex-map-${identityHashCode(this)}';
    _frame = web.HTMLIFrameElement()
      ..src = yandexMapUrl
      ..title = 'Карта зон доставки Bulka'
      ..style.width = '100%'
      ..style.height = '100%'
      ..style.border = '0'
      ..style.display = 'block';
    ui_web.platformViewRegistry.registerViewFactory(_viewType, (_) => _frame);
    _messageListener = ((web.Event event) {
      final message = event as web.MessageEvent;
      if (message.origin != web.window.location.origin ||
          message.source != _frame.contentWindow) {
        return;
      }
      final raw = message.data?.dartify();
      if (raw is! String) return;
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
    }).toJS;
    web.window.addEventListener('message', _messageListener);
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

  Map<String, Object?> _statePayload() => {
    'type': 'state',
    'mode': widget.interactive ? 'customer' : 'preview',
    'center': [widget.center.latitude, widget.center.longitude],
    'selected': [widget.selectedPoint.latitude, widget.selectedPoint.longitude],
    'zoom': widget.zoom,
    'branches': widget.branches.map((branch) => branch.toPayload()).toList(),
  };

  void _post(Map<String, Object?> payload) {
    _frame.contentWindow?.postMessage(
      jsonEncode(payload).toJS,
      web.window.location.origin.toJS,
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
    web.window.removeEventListener('message', _messageListener);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => HtmlElementView(viewType: _viewType);
}
