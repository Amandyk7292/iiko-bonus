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
    this.cityLabel,
    this.onCityTap,
    this.onBranchTap,
    this.directoryMode = false,
    this.language = 'ru',
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
  final String? cityLabel;
  final VoidCallback? onCityTap;
  final bool directoryMode;
  final String language;
  final ValueChanged<String>? onBranchTap;

  @override
  Widget build(BuildContext context) => Semantics(
    label: semanticLabel,
    child: ColoredBox(
      color: Colors.white,
      child: Column(
        children: [
          if (cityLabel != null)
            TextButton(onPressed: onCityTap, child: Text(cityLabel!)),
          Expanded(child: Center(child: Text(unavailableLabel))),
        ],
      ),
    ),
  );
}
