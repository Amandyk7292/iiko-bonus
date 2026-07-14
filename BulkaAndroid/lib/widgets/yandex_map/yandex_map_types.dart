import 'package:flutter/foundation.dart';
import 'package:latlong2/latlong.dart';

const _mapApiBaseUrl = String.fromEnvironment(
  'BULKA_API_BASE_URL',
  defaultValue: 'https://bulka.com.kz',
);

String get yandexMapUrl => '$_mapApiBaseUrl/maps/yandex';

class YandexDeliveryZone {
  const YandexDeliveryZone({
    required this.id,
    required this.radiusKm,
    required this.fee,
    required this.minOrder,
    required this.color,
  });

  final String id;
  final double radiusKm;
  final int fee;
  final int minOrder;
  final String color;

  Map<String, Object?> toPayload() => {
    'id': id,
    'radiusKm': radiusKm,
    'fee': fee,
    'minOrder': minOrder,
    'color': color,
  };
}

class YandexMapBranch {
  const YandexMapBranch({
    required this.id,
    required this.name,
    required this.address,
    required this.point,
    required this.zones,
    this.active = true,
    this.deliveryEnabled = true,
  });

  final String id;
  final String name;
  final String address;
  final LatLng point;
  final List<YandexDeliveryZone> zones;
  final bool active;
  final bool deliveryEnabled;

  Map<String, Object?> toPayload() => {
    'id': id,
    'name': name,
    'address': address,
    'point': [point.latitude, point.longitude],
    'zones': zones.map((zone) => zone.toPayload()).toList(),
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
}

typedef YandexMapTap = void Function(LatLng point);
typedef YandexCameraChanged = void Function(LatLng center, double zoom);
