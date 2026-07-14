import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';

import 'yandex_map_types.dart';

class YandexMapView extends StatelessWidget {
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
  Widget build(BuildContext context) => const ColoredBox(
    color: Color(0xFFF7F2E8),
    child: Center(child: Text('Карта временно недоступна')),
  );
}
