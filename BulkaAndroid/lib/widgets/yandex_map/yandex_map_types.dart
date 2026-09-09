import 'package:flutter/foundation.dart';
import 'package:latlong2/latlong.dart';

import '../../core/api_origin.dart';

String get yandexMapUrl => '$bulkaApiBaseUrl/maps/yandex';

class YandexTrackingPoint {
  const YandexTrackingPoint({
    required this.kind,
    required this.point,
    required this.label,
    required this.address,
  });

  final String kind;
  final LatLng point;
  final String label;
  final String address;

  Map<String, Object?> toPayload() => {
    'kind': kind,
    'point': [point.latitude, point.longitude],
    'label': label,
    'address': address,
  };
}

class YandexMapBranch {
  const YandexMapBranch({
    required this.id,
    required this.name,
    required this.address,
    required this.point,
    this.active = true,
    this.deliveryEnabled = true,
  });

  final String id;
  final String name;
  final String address;
  final LatLng point;
  final bool active;
  final bool deliveryEnabled;

  Map<String, Object?> toPayload() => {
    'id': id,
    'name': name,
    'address': address,
    'point': [point.latitude, point.longitude],
    'active': active,
    'deliveryEnabled': deliveryEnabled,
  };
}

class YandexMapCommand {
  const YandexMapCommand({
    required this.serial,
    required this.type,
    this.payload = const {},
  });

  final int serial;
  final String type;
  final Map<String, Object?> payload;
}

class YandexMapController extends ChangeNotifier {
  int _serial = 0;
  YandexMapCommand? _command;

  YandexMapCommand? get command => _command;

  void move(LatLng center, double zoom, {LatLng? selected}) {
    _command = YandexMapCommand(
      serial: ++_serial,
      type: 'move',
      payload: {
        'center': [center.latitude, center.longitude],
        'selected': [
          (selected ?? center).latitude,
          (selected ?? center).longitude,
        ],
        'zoom': zoom,
      },
    );
    notifyListeners();
  }

  void zoomBy(double delta) {
    _command = YandexMapCommand(
      serial: ++_serial,
      type: 'zoom',
      payload: {'delta': delta},
    );
    notifyListeners();
  }

  void fitTrackingPoints() {
    _command = YandexMapCommand(serial: ++_serial, type: 'fit-tracking');
    notifyListeners();
  }
}

typedef YandexMapTap = void Function(LatLng point);
typedef YandexCameraChanged = void Function(LatLng center, double zoom);
