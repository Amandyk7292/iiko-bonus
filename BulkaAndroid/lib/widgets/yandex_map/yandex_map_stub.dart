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
  Widget build(BuildContext context) => Semantics(
    label: semanticLabel,
    child: ColoredBox(
      color: const Color(0xFFF7F2E8),
      child: Center(child: Text(unavailableLabel)),
    ),
  );
}
